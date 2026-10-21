-- =====================================================================
--  Angie Tech · 18 · Caja por local
--  Ejecutar en Supabase > SQL Editor, DESPUÉS de 14_caja, 16 y 17.
--  Se puede ejecutar más de una vez. No toca facturas, inventario ni Finanzas.
--
--  Qué cambia:
--  1. Cada local tiene UNA caja abierta a la vez (antes era una por persona).
--  2. La caja del local suma TODAS las ventas del día de ese local, sin
--     importar qué vendedor o administrador vendió.
--  3. La abre y la cierra cualquier vendedor de ese local o un administrador.
--  4. El vendedor ve las cajas de su local; el administrador ve las de todos
--     los locales y el total de ambos.
--  5. Si al migrar un local tenía varias cajas abiertas (una por persona),
--     se deja la más reciente y las demás se cierran con el efectivo esperado,
--     con la nota «Cerrada al unificar la caja del local».
-- =====================================================================
begin;

alter table public.caja_sesiones add column if not exists local_id bigint references public.locales(id);
create index if not exists caja_sesiones_local on public.caja_sesiones(local_id, id);

-- Cajas existentes: al local de quien la abrió (o al principal)
update public.caja_sesiones c
   set local_id = coalesce((select p.local_id from public.perfiles p where p.id = c.responsable_id), public.local_principal(c.negocio_id))
 where c.local_id is null;

-- Una sola caja abierta por local: las sobrantes se cierran con el efectivo esperado
do $$
declare s record; esperado bigint; resumen jsonb;
begin
  for s in
    select c.* from public.caja_sesiones c
     where c.estado = 'abierta'
       and exists (select 1 from public.caja_sesiones d where d.local_id = c.local_id and d.estado = 'abierta' and d.id > c.id)
  loop
    select s.inicial_cent + coalesce(sum(e.efectivo_cent), 0) into esperado from public.caja_eventos e where e.caja_id = s.id;
    select jsonb_build_object(
      'ventas', jsonb_build_object(
        'efectivo', coalesce(sum(monto_cent) filter (where tipo = 'venta' and metodo = 'efectivo'), 0),
        'tarjeta', coalesce(sum(monto_cent) filter (where tipo = 'venta' and metodo = 'tarjeta'), 0),
        'transferencia', coalesce(sum(monto_cent) filter (where tipo = 'venta' and metodo = 'transferencia'), 0)),
      'vendido_bruto_cent', coalesce(sum(monto_cent) filter (where tipo = 'venta'), 0),
      'ajustes_cent', coalesce(sum(monto_cent) filter (where tipo in ('devolucion', 'anulacion')), 0),
      'efectivo_esperado_cent', esperado, 'eventos', count(*), 'reembolsos_por_confirmar', 0)
      into resumen from public.caja_eventos where caja_id = s.id;
    update public.caja_sesiones
       set estado = 'cerrada', cierre_en = clock_timestamp(), cerrado_por = s.responsable_id, cerrado_nombre = s.responsable_nombre,
           contado_cent = greatest(esperado, 0), diferencia_cent = greatest(esperado, 0) - esperado,
           observaciones = 'Cerrada al unificar la caja del local', resumen_cierre = resumen,
           cierre_request_id = 'unificar-' || s.id
     where id = s.id;
  end loop;
end $$;

alter table public.caja_sesiones alter column local_id set not null;
drop index if exists public.caja_una_abierta;
create unique index if not exists caja_una_abierta_local on public.caja_sesiones(local_id) where estado = 'abierta';
alter table public.caja_sesiones drop constraint if exists caja_sesiones_negocio_id_responsable_id_request_id_key;
create unique index if not exists caja_sesiones_local_request on public.caja_sesiones(negocio_id, local_id, request_id);

-- Quién ve qué: el administrador todo el negocio; el vendedor su local (y las que abrió él)
create or replace function public._caja_puede_ver(p_local bigint, p_responsable uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.es_admin() or p_local = public.mi_local() or p_responsable = auth.uid()
$$;
drop policy if exists caja_sesiones_select on public.caja_sesiones;
create policy caja_sesiones_select on public.caja_sesiones for select to authenticated
  using (negocio_id = public.mi_negocio() and public.es_activo() and public._caja_puede_ver(local_id, responsable_id));
drop policy if exists caja_eventos_select on public.caja_eventos;
create policy caja_eventos_select on public.caja_eventos for select to authenticated
  using (negocio_id = public.mi_negocio() and public.es_activo()
         and exists (select 1 from public.caja_sesiones s where s.id = caja_id and s.negocio_id = public.mi_negocio()
                     and public._caja_puede_ver(s.local_id, s.responsable_id)));

-- Local con el que opera quien inició sesión. El vendedor, siempre el suyo.
create or replace function public._caja_local(p_local_id bigint) returns bigint
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v bigint;
begin
  if public.es_admin() then v := coalesce(p_local_id, public.mi_local(), public.local_principal(public.mi_negocio()));
  else v := coalesce(public.mi_local(), public.local_principal(public.mi_negocio())); end if;
  if v is null or not public.local_de_mi_negocio(v) then raise exception 'El local de la caja no es válido'; end if;
  return v;
end $$;

-- Puede operar esta caja: administrador o alguien de ese local
create or replace function public._caja_permiso(s public.caja_sesiones) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if s.id is null or s.negocio_id <> public.mi_negocio()
     or not (public.es_admin() or s.local_id = coalesce(public.mi_local(), public.local_principal(s.negocio_id))) then
    raise exception using errcode = '42501', message = 'No tienes permiso para esta caja';
  end if;
end $$;

drop function if exists public.caja_estado(bigint, bigint);
create or replace function public.caja_estado(p_caja_id bigint default null, p_antes_id bigint default null, p_local_id bigint default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare actor uuid; v_local bigint; s public.caja_sesiones%rowtype; active_row jsonb; history_rows jsonb; event_rows jsonb; allowed_count bigint; v_locales jsonb;
begin
  actor := public._caja_validar();
  v_local := public._caja_local(p_local_id);
  select to_jsonb(c) into active_row from public.caja_sesiones c where c.local_id = v_local and c.estado = 'abierta';
  if p_caja_id is not null then
    select * into s from public.caja_sesiones where id = p_caja_id and negocio_id = public.mi_negocio();
    if not found or not public._caja_puede_ver(s.local_id, s.responsable_id) then raise exception using errcode = '42501', message = 'No tienes permiso para esta caja'; end if;
  else select * into s from public.caja_sesiones where local_id = v_local and estado = 'abierta'; end if;
  -- Historial: el del local elegido (el administrador con «todos» ve el de todo el negocio)
  select jsonb_agg(to_jsonb(c) order by c.id desc) into history_rows from (
    select * from public.caja_sesiones
     where negocio_id = public.mi_negocio()
       and (local_id = v_local or (public.es_admin() and p_local_id is null and public.mi_local() is null))
       and (p_antes_id is null or id < p_antes_id)
     order by id desc limit 30) c;
  select count(*) into allowed_count from public.caja_sesiones
   where negocio_id = public.mi_negocio()
     and (local_id = v_local or (public.es_admin() and p_local_id is null and public.mi_local() is null))
     and (p_antes_id is null or id < p_antes_id);
  select jsonb_agg(to_jsonb(e) order by e.id desc) into event_rows from (select * from public.caja_eventos where caja_id = s.id order by id desc limit 100) e;
  -- Para el administrador: estado de la caja de cada local y lo vendido hoy
  if public.es_admin() then
    select jsonb_agg(jsonb_build_object(
             'local_id', l.id, 'local', l.nombre,
             'caja', (select to_jsonb(c) - 'resumen_cierre' from public.caja_sesiones c where c.local_id = l.id order by (c.estado = 'abierta') desc, c.id desc limit 1),
             'resumen', (select coalesce(c.resumen_cierre, public._caja_resumen(c.id)) from public.caja_sesiones c where c.local_id = l.id order by (c.estado = 'abierta') desc, c.id desc limit 1)
           ) order by l.id)
      into v_locales
      from public.locales l where l.negocio_id = public.mi_negocio() and l.activo;
  end if;
  return jsonb_build_object('version', 2, 'local_id', v_local, 'active', active_row,
    'session', case when s.id is not null then to_jsonb(s) else null end,
    'history', coalesce(history_rows, '[]'::jsonb), 'history_limited', allowed_count > 30,
    'pending_adjustments', coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from (select e.* from public.caja_eventos e where e.caja_id = s.id and e.tipo in ('devolucion', 'anulacion') and not exists (select 1 from public.caja_eventos p where p.ajuste_id = e.id) order by e.id limit 100) a), '[]'::jsonb),
    'events', coalesce(event_rows, '[]'::jsonb),
    'events_limited', (select count(*) > 100 from public.caja_eventos where caja_id = s.id),
    'summary', case when s.id is null then null else coalesce(s.resumen_cierre, public._caja_resumen(s.id)) end,
    'locales', coalesce(v_locales, '[]'::jsonb));
end $$;

-- _caja_resumen y caja_movimiento/cerrar ya no dependen del responsable
create or replace function public._caja_resumen(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.caja_sesiones%rowtype; r jsonb; expected numeric;
begin
  select * into strict s from public.caja_sesiones where id = p_id and negocio_id = public.mi_negocio();
  select s.inicial_cent::numeric + coalesce(sum(efectivo_cent), 0) into expected from public.caja_eventos where caja_id = p_id;
  if abs(expected) > 9007199254740991 then raise exception 'El total supera el límite seguro de caja'; end if;
  select jsonb_build_object(
    'ventas', jsonb_build_object('efectivo', coalesce(sum(monto_cent) filter (where tipo = 'venta' and metodo = 'efectivo'), 0),
                                 'tarjeta', coalesce(sum(monto_cent) filter (where tipo = 'venta' and metodo = 'tarjeta'), 0),
                                 'transferencia', coalesce(sum(monto_cent) filter (where tipo = 'venta' and metodo = 'transferencia'), 0)),
    'vendido_bruto_cent', coalesce(sum(monto_cent) filter (where tipo = 'venta'), 0),
    'ventas_cantidad', count(*) filter (where tipo = 'venta'),
    'ajustes_cent', coalesce(sum(monto_cent) filter (where tipo in ('devolucion', 'anulacion')), 0),
    'efectivo_esperado_cent', expected, 'eventos', count(*),
    'reembolsos_por_confirmar', (select count(*) from public.caja_eventos a where a.caja_id = p_id and a.tipo in ('devolucion', 'anulacion') and not exists (select 1 from public.caja_eventos b where b.ajuste_id = a.id))
  ) into r from public.caja_eventos where caja_id = p_id;
  if abs((r->>'vendido_bruto_cent')::numeric) > 9007199254740991 or abs((r->>'ajustes_cent')::numeric) > 9007199254740991 then raise exception 'El total supera el límite seguro de caja'; end if;
  return r;
end $$;

drop function if exists public.caja_abrir(bigint, text);
create or replace function public.caja_abrir(p_inicial_cent bigint, p_request_id text, p_local_id bigint default null) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid; v_local bigint; previous_id bigint; nombre text; result_id bigint;
begin
  actor := public._caja_validar();
  v_local := public._caja_local(p_local_id);
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9-]{8,100}$' or p_inicial_cent is null or p_inicial_cent < 0 or p_inicial_cent > 9007199254740991 then raise exception 'Saldo inicial o identificador inválido'; end if;
  perform pg_advisory_xact_lock(hashtextextended('caja-local:' || v_local::text, 0));
  select id into previous_id from public.caja_sesiones where negocio_id = public.mi_negocio() and local_id = v_local and request_id = p_request_id;
  if found then return previous_id; end if;
  select id into previous_id from public.caja_sesiones where local_id = v_local and estado = 'abierta';
  if found then raise exception 'La caja de % ya está abierta', public.nombre_local(v_local); end if;
  select p.nombre into nombre from public.perfiles p where p.id = actor and p.negocio_id = public.mi_negocio();
  insert into public.caja_sesiones (negocio_id, local_id, responsable_id, responsable_nombre, inicial_cent, request_id)
  values (public.mi_negocio(), v_local, actor, nombre, p_inicial_cent, p_request_id) returning id into result_id;
  perform public.registrar_actividad('caja.apertura', 'caja_sesiones', result_id::text, jsonb_build_object('inicial_cent', p_inicial_cent, 'local', public.nombre_local(v_local)));
  return result_id;
end $$;

create or replace function public.caja_movimiento(p_caja_id bigint, p_request_id text, p_tipo text, p_monto_cent bigint, p_metodo text, p_descripcion text, p_referencia text, p_ajuste_id bigint default null) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid; s public.caja_sesiones%rowtype; a public.caja_eventos%rowtype; result_id bigint; signed_value bigint;
begin
  actor := public._caja_validar();
  select * into s from public.caja_sesiones where id = p_caja_id and negocio_id = public.mi_negocio();
  perform public._caja_permiso(s);
  perform pg_advisory_xact_lock(hashtextextended('caja-local:' || s.local_id::text, 0));
  select * into s from public.caja_sesiones where id = p_caja_id and negocio_id = public.mi_negocio() for update;
  select id into result_id from public.caja_eventos where caja_id = p_caja_id and request_id = p_request_id;
  if found then return result_id; end if;
  if s.estado <> 'abierta' then raise exception 'La caja está cerrada'; end if;
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9-]{8,100}$' or p_tipo is null or p_tipo not in ('entrada','salida','gasto','pago_proveedor','reembolso') or p_monto_cent is null or p_monto_cent <= 0 or p_monto_cent > 9007199254740991 or p_metodo is null or p_metodo not in ('efectivo','tarjeta','transferencia') or (p_tipo <> 'reembolso' and p_metodo <> 'efectivo') then raise exception 'Movimiento o importe inválido'; end if;
  if coalesce(length(trim(p_descripcion)), 0) not between 1 and 500 or coalesce(length(trim(p_referencia)), 0) not between 1 and 120 then raise exception 'Motivo y referencia obligatorios'; end if;
  if p_tipo = 'reembolso' then
    select * into a from public.caja_eventos where id = p_ajuste_id and caja_id = s.id and tipo in ('devolucion','anulacion');
    if not found or abs(a.monto_cent) <> p_monto_cent or exists (select 1 from public.caja_eventos where ajuste_id = a.id) then raise exception 'Selecciona un ajuste pendiente y su importe exacto; no puede pagarse dos veces'; end if;
  elsif p_ajuste_id is not null then raise exception 'Referencia de ajuste inválida'; end if;
  signed_value := case when p_tipo = 'entrada' then p_monto_cent else -p_monto_cent end;
  insert into public.caja_eventos (negocio_id, caja_id, tipo, metodo, monto_cent, efectivo_cent, descripcion, referencia, ajuste_id, creado_por, request_id)
  values (s.negocio_id, s.id, p_tipo, p_metodo, signed_value, case when p_metodo = 'efectivo' then signed_value else 0 end, trim(p_descripcion), trim(p_referencia), p_ajuste_id, actor, p_request_id) returning id into result_id;
  update public.caja_sesiones set revision = revision + 1 where id = s.id;
  perform public._caja_resumen(s.id);
  perform public.registrar_actividad('caja.movimiento', 'caja_sesiones', s.id::text, jsonb_build_object('evento_id', result_id, 'tipo', p_tipo));
  return result_id;
end $$;

create or replace function public.caja_cerrar(p_caja_id bigint, p_request_id text, p_revision bigint, p_contado_cent bigint, p_observaciones text default '') returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid; s public.caja_sesiones%rowtype; summary jsonb; difference bigint; nombre text;
begin
  actor := public._caja_validar();
  select * into s from public.caja_sesiones where id = p_caja_id and negocio_id = public.mi_negocio();
  perform public._caja_permiso(s);
  perform pg_advisory_xact_lock(hashtextextended('caja-local:' || s.local_id::text, 0));
  select * into s from public.caja_sesiones where id = p_caja_id and negocio_id = public.mi_negocio() for update;
  if s.cierre_request_id = p_request_id then return s.id; end if;
  if s.estado <> 'abierta' then raise exception 'La caja ya está cerrada'; end if;
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9-]{8,100}$' or p_contado_cent is null or p_contado_cent < 0 or p_contado_cent > 9007199254740991 or p_revision is distinct from s.revision then raise exception 'La caja recibió movimientos nuevos o los datos de cierre no son válidos. Actualiza y revisa el efectivo antes de cerrar'; end if;
  summary := public._caja_resumen(s.id);
  difference := p_contado_cent - (summary->>'efectivo_esperado_cent')::bigint;
  if abs(difference::numeric) > 9007199254740991 then raise exception 'La diferencia supera el límite seguro'; end if;
  if length(coalesce(p_observaciones, '')) > 1000 or (difference <> 0 and coalesce(trim(p_observaciones), '') = '') then raise exception 'Explica el sobrante o faltante en observaciones'; end if;
  select p.nombre into nombre from public.perfiles p where p.id = actor;
  update public.caja_sesiones set estado = 'cerrada', cierre_en = clock_timestamp(), cerrado_por = actor, cerrado_nombre = nombre, contado_cent = p_contado_cent, diferencia_cent = difference, observaciones = trim(p_observaciones), resumen_cierre = summary, cierre_request_id = p_request_id where id = s.id;
  perform public.registrar_actividad('caja.cierre', 'caja_sesiones', s.id::text, jsonb_build_object('contado_cent', p_contado_cent, 'diferencia_cent', difference, 'local', public.nombre_local(s.local_id)));
  return s.id;
end $$;

-- Ventas, anulaciones y devoluciones entran a la caja abierta del LOCAL de la venta
drop function if exists public._caja_capturar(integer, text, text, numeric, bigint, text);
create or replace function public._caja_capturar(p_negocio_id integer, p_local_id bigint, p_tipo text, p_method text, p_value numeric, p_source_id bigint, p_reference text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid := auth.uid(); s public.caja_sesiones%rowtype; cent bigint; source_key text; v_local bigint;
begin
  if actor is null or p_value <= 0 then return; end if;
  if p_negocio_id is distinct from public.mi_negocio() then raise exception using errcode = '42501', message = 'El movimiento no pertenece al negocio autorizado'; end if;
  v_local := coalesce(p_local_id, public.local_principal(p_negocio_id));
  perform pg_advisory_xact_lock(hashtextextended('caja-local:' || v_local::text, 0));
  select * into s from public.caja_sesiones where local_id = v_local and estado = 'abierta' for update;
  if not found then return; end if;
  if p_value * 100 <> trunc(p_value * 100) or p_value * 100 > 9007199254740991 then raise exception 'Importe de caja fuera de rango'; end if;
  cent := (p_value * 100)::bigint; source_key := p_tipo || ':' || p_source_id::text;
  if exists (select 1 from public.caja_eventos where negocio_id = p_negocio_id and origen = source_key) then return; end if;
  insert into public.caja_eventos (negocio_id, caja_id, tipo, metodo, monto_cent, efectivo_cent, descripcion, referencia, origen, origen_id, creado_por)
  values (s.negocio_id, s.id, p_tipo, p_method, case when p_tipo = 'venta' then cent else -cent end,
          case when p_tipo = 'venta' and p_method = 'efectivo' then cent else 0 end,
          case when p_tipo = 'venta' then 'Venta confirmada' else 'Ajuste comercial; confirma el reembolso realizado' end,
          p_reference, source_key, p_source_id, actor);
  update public.caja_sesiones set revision = revision + 1 where id = s.id;
  perform public._caja_resumen(s.id);
end $$;

create or replace function public._caja_factura_trigger() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare remainder numeric;
begin
  if new.estado = 'emitida' and new.total > 0 then
    perform public._caja_capturar(new.negocio_id, new.local_id, 'venta', new.metodo_pago::text, new.total, new.id, new.prefijo || '-' || new.numero::text);
  elsif tg_op = 'UPDATE' then
    if old.estado = 'emitida' and new.estado = 'anulada' then
      select greatest(0, new.total - coalesce(sum(total_devuelto), 0)) into remainder from public.devoluciones where factura_id = new.id;
      perform public._caja_capturar(new.negocio_id, new.local_id, 'anulacion', new.metodo_pago::text, remainder, new.id, new.prefijo || '-' || new.numero::text);
    end if;
  end if;
  return new;
end $$;

create or replace function public._caja_devolucion_trigger() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare f public.facturas%rowtype;
begin
  if new.total_devuelto > 0 then
    select * into strict f from public.facturas where id = new.factura_id;
    perform public._caja_capturar(f.negocio_id, f.local_id, 'devolucion', f.metodo_pago::text, new.total_devuelto, new.id, 'Devolución ' || new.id::text || ' · ' || f.prefijo || '-' || f.numero::text);
  end if;
  return new;
end $$;

revoke all on function public._caja_resumen(bigint), public._caja_capturar(integer, bigint, text, text, numeric, bigint, text),
                       public._caja_local(bigint), public._caja_permiso(public.caja_sesiones), public._caja_factura_trigger(), public._caja_devolucion_trigger()
  from public, anon, authenticated;
revoke all on function public._caja_puede_ver(bigint, uuid) from public, anon;
grant execute on function public._caja_puede_ver(bigint, uuid) to authenticated;
revoke all on function public.caja_estado(bigint, bigint, bigint), public.caja_abrir(bigint, text, bigint) from public, anon;
grant execute on function public.caja_estado(bigint, bigint, bigint), public.caja_abrir(bigint, text, bigint),
                          public.caja_movimiento(bigint, text, text, bigint, text, text, text, bigint),
                          public.caja_cerrar(bigint, text, bigint, bigint, text) to authenticated;
notify pgrst, 'reload schema';
commit;

-- Verificación: una fila por local con su caja abierta (si la hay)
select l.nombre as local, c.id as caja, c.estado, c.responsable_nombre as abrio
  from public.locales l left join public.caja_sesiones c on c.local_id = l.id and c.estado = 'abierta'
 order by l.id;
