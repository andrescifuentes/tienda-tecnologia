-- PREPARADO LOCALMENTE. NO EJECUTADO EN REMOTO.
-- Cierre de caja diario consolidado + permiso individual «cerrar_caja».
-- Requiere 10_multi_negocio.sql y 14_caja.sql aplicados antes (16 es opcional:
-- si existe, el resumen separa transferencias por medio).
-- No modifica facturas, devoluciones, inventario ni Finanzas. Solo añade un registro
-- inmutable del cierre y exige el permiso para cerrar turnos (caja_cerrar).

-- 1. Permiso nuevo. Postgres no permite USAR un valor de enum en la misma transacción
--    que lo crea (el editor de Supabase ejecuta todo el script como una sola). Por eso
--    el valor solo se referencia dentro de funciones plpgsql, que lo resuelven al
--    ejecutarse, después del commit.
alter type public.permiso_tipo add value if not exists 'cerrar_caja';

begin;
create table if not exists public.caja_cierres_diarios (
  id               bigint generated always as identity primary key,
  negocio_id       integer not null references public.tienda(id),
  fecha            date not null,
  alcance          text not null check (alcance in ('negocio', 'responsable')),
  responsable_id   uuid references public.perfiles(id),
  responsable_nombre text,
  resumen          jsonb not null,
  huella           text not null,
  esperado_cent    bigint not null,
  contado_cent     bigint not null check (contado_cent between 0 and 9007199254740991),
  diferencia_cent  bigint not null,
  observaciones    text not null default '' check (length(observaciones) <= 1000),
  cerrado_por      uuid not null references public.perfiles(id),
  cerrado_nombre   text,
  cerrado_en       timestamptz not null default clock_timestamp(),
  request_id       text not null,
  unique (negocio_id, request_id),
  check ((alcance = 'negocio') = (responsable_id is null)),
  check (diferencia_cent = 0 or length(trim(observaciones)) > 0)
);
-- Un único cierre por día y alcance (todo el negocio, o cada responsable).
create unique index if not exists caja_cierre_dia_unico on public.caja_cierres_diarios
  (negocio_id, fecha, coalesce(responsable_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists caja_cierres_diarios_lista on public.caja_cierres_diarios (negocio_id, id desc);

-- plpgsql resuelve 'cerrar_caja' al ejecutarse, no al crearse: así la política no
-- usa el valor nuevo del enum dentro de esta misma transacción.
create or replace function public.puede_cerrar_caja() returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return public.tiene_permiso('cerrar_caja');
end $$;
revoke all on function public.puede_cerrar_caja() from public, anon;
grant execute on function public.puede_cerrar_caja() to authenticated;

alter table public.caja_cierres_diarios enable row level security;
drop policy if exists caja_cierres_diarios_select on public.caja_cierres_diarios;
create policy caja_cierres_diarios_select on public.caja_cierres_diarios for select to authenticated
  using (negocio_id = (select public.mi_negocio()) and public.es_activo()
         and (public.es_admin() or (responsable_id = auth.uid() and public.puede_cerrar_caja())));
revoke all on public.caja_cierres_diarios from public, anon, authenticated;
grant select on public.caja_cierres_diarios to authenticated;   -- escrituras solo por RPC

create or replace function public._caja_validar_cierre() returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or public.mi_negocio() is null or not public.es_activo()
     or not exists (select 1 from public.tienda t where t.id = public.mi_negocio() and coalesce(t.activo, true))
     or not public.tiene_permiso('cerrar_caja') then   -- tiene_permiso es verdadero para administradores
    raise exception using errcode = '42501', message = 'No tienes permiso para realizar cierres de caja';
  end if;
  return auth.uid();
end $$;

-- Vendedor: siempre su propio alcance. Administrador: todo el negocio (null) o un responsable.
create or replace function public._caja_dia_alcance(p_responsable uuid) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.es_admin() then
    if p_responsable is not null and p_responsable <> auth.uid() then
      raise exception using errcode = '42501', message = 'Solo puedes consultar tu propio cierre';
    end if;
    return auth.uid();
  end if;
  if p_responsable is not null and not exists (select 1 from public.perfiles where id = p_responsable and negocio_id = public.mi_negocio()) then
    raise exception using errcode = '42501', message = 'El responsable no pertenece al negocio';
  end if;
  return p_responsable;
end $$;

-- Misma fórmula que src/lib/cashDaily.js (dailyCashSummary). Centavos enteros.
create or replace function public._caja_dia_resumen(p_negocio integer, p_fecha date, p_responsable uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_n bigint; v_anuladas bigint; v_ef bigint; v_ta bigint; v_tr bigint; v_medios jsonb;
  d_n bigint; d_ef bigint; d_ta bigint; d_tr bigint;
  a_n bigint; a_ef bigint; a_ta bigint; a_tr bigint;
  c_ini bigint; c_ent bigint; c_sal bigint; c_ree bigint; c_esp bigint; c_eventos bigint;
  v_abiertas jsonb; v_pend bigint; r jsonb; v_nombre text;
begin
  select count(*), count(*) filter (where estado::text = 'anulada'),
         coalesce(sum(cent) filter (where metodo = 'efectivo'), 0), coalesce(sum(cent) filter (where metodo = 'tarjeta'), 0), coalesce(sum(cent) filter (where metodo = 'transferencia'), 0)
    into v_n, v_anuladas, v_ef, v_ta, v_tr
    from (select f.estado, f.metodo_pago::text metodo, (abs(f.total) * 100)::bigint cent from public.facturas f
           where f.negocio_id = p_negocio and (f.fecha at time zone 'America/Bogota')::date = p_fecha
             and (p_responsable is null or f.vendedor_id = p_responsable)) s;
  select coalesce(jsonb_agg(jsonb_build_object('nombre', nombre, 'cent', cent) order by nombre), '[]'::jsonb) into v_medios
    from (select coalesce(to_jsonb(f)->'medio_transferencia'->>'nombre', 'Sin medio registrado') nombre, sum((abs(f.total) * 100)::bigint)::bigint cent
            from public.facturas f
           where f.negocio_id = p_negocio and (f.fecha at time zone 'America/Bogota')::date = p_fecha and f.metodo_pago::text = 'transferencia'
             and (p_responsable is null or f.vendedor_id = p_responsable) group by 1) x;

  select count(*), coalesce(sum(cent) filter (where metodo = 'efectivo'), 0), coalesce(sum(cent) filter (where metodo = 'tarjeta'), 0), coalesce(sum(cent) filter (where metodo = 'transferencia'), 0)
    into d_n, d_ef, d_ta, d_tr
    from (select f.metodo_pago::text metodo, (d.total_devuelto * 100)::bigint cent from public.devoluciones d join public.facturas f on f.id = d.factura_id
           where f.negocio_id = p_negocio and (d.fecha at time zone 'America/Bogota')::date = p_fecha and d.total_devuelto > 0
             and (p_responsable is null or d.creado_por = p_responsable)) s;

  select count(*), coalesce(sum(cent) filter (where metodo = 'efectivo'), 0), coalesce(sum(cent) filter (where metodo = 'tarjeta'), 0), coalesce(sum(cent) filter (where metodo = 'transferencia'), 0)
    into a_n, a_ef, a_ta, a_tr
    from (select f.metodo_pago::text metodo, (greatest(0, f.total - coalesce((select sum(total_devuelto) from public.devoluciones x where x.factura_id = f.id), 0)) * 100)::bigint cent
            from public.facturas f
           where f.negocio_id = p_negocio and f.estado::text = 'anulada' and (f.anulada_en at time zone 'America/Bogota')::date = p_fecha
             and (p_responsable is null or f.anulada_por = p_responsable)) s
   where cent > 0;

  select coalesce(sum(inicial_cent) filter (where (apertura_en at time zone 'America/Bogota')::date = p_fecha), 0),
         coalesce(jsonb_agg(jsonb_build_object('id', id, 'responsable_nombre', responsable_nombre) order by id)
                  filter (where estado = 'abierta' and (apertura_en at time zone 'America/Bogota')::date <= p_fecha), '[]'::jsonb)
    into c_ini, v_abiertas
    from public.caja_sesiones where negocio_id = p_negocio and (p_responsable is null or responsable_id = p_responsable);
  select coalesce(sum(e.efectivo_cent) filter (where e.tipo = 'entrada'), 0),
         coalesce(sum(e.efectivo_cent) filter (where e.tipo in ('salida', 'gasto', 'pago_proveedor')), 0),
         coalesce(sum(e.efectivo_cent) filter (where e.tipo = 'reembolso'), 0), count(*)
    into c_ent, c_sal, c_ree, c_eventos
    from public.caja_eventos e join public.caja_sesiones s on s.id = e.caja_id
   where s.negocio_id = p_negocio and (p_responsable is null or s.responsable_id = p_responsable)
     and (e.fecha at time zone 'America/Bogota')::date = p_fecha;
  c_esp := c_ini + v_ef + c_ent + c_sal + c_ree;

  -- Ajustes del día sin un reembolso confirmado en caja que apunte a su evento.
  select count(*) into v_pend from (
    select 'devolucion:' || d.id k from public.devoluciones d join public.facturas f on f.id = d.factura_id
     where f.negocio_id = p_negocio and (d.fecha at time zone 'America/Bogota')::date = p_fecha and d.total_devuelto > 0 and (p_responsable is null or d.creado_por = p_responsable)
    union all
    select 'anulacion:' || f.id from public.facturas f
     where f.negocio_id = p_negocio and f.estado::text = 'anulada' and (f.anulada_en at time zone 'America/Bogota')::date = p_fecha and (p_responsable is null or f.anulada_por = p_responsable)
       and f.total - coalesce((select sum(total_devuelto) from public.devoluciones x where x.factura_id = f.id), 0) > 0
  ) a where not exists (select 1 from public.caja_eventos ev where ev.negocio_id = p_negocio and ev.origen = a.k
                          and exists (select 1 from public.caja_eventos rb where rb.tipo = 'reembolso' and rb.ajuste_id = ev.id));

  if greatest(abs(v_ef + v_ta + v_tr), abs(c_esp), abs(d_ef + d_ta + d_tr), abs(a_ef + a_ta + a_tr)) > 9007199254740991 then
    raise exception 'El total supera el límite seguro de caja';
  end if;
  select nombre into v_nombre from public.perfiles where id = p_responsable;
  r := jsonb_build_object(
    'fecha', p_fecha, 'alcance', case when p_responsable is null then 'negocio' else 'responsable' end,
    'responsable_id', p_responsable, 'responsable_nombre', v_nombre,
    'ventas', jsonb_build_object('cantidad', v_n, 'anuladas', v_anuladas, 'bruto_cent', v_ef + v_ta + v_tr,
               'por_metodo', jsonb_build_object('efectivo', v_ef, 'tarjeta', v_ta, 'transferencia', v_tr), 'transferencias_por_medio', v_medios),
    'devoluciones', jsonb_build_object('cantidad', d_n, 'cent', d_ef + d_ta + d_tr, 'por_metodo', jsonb_build_object('efectivo', d_ef, 'tarjeta', d_ta, 'transferencia', d_tr)),
    'anulaciones', jsonb_build_object('cantidad', a_n, 'cent', a_ef + a_ta + a_tr, 'por_metodo', jsonb_build_object('efectivo', a_ef, 'tarjeta', a_ta, 'transferencia', a_tr)),
    'neto_por_metodo', jsonb_build_object('efectivo', v_ef - d_ef - a_ef, 'tarjeta', v_ta - d_ta - a_ta, 'transferencia', v_tr - d_tr - a_tr),
    'neto_cent', (v_ef + v_ta + v_tr) - (d_ef + d_ta + d_tr) - (a_ef + a_ta + a_tr),
    'efectivo', jsonb_build_object('inicial_cent', c_ini, 'ventas_cent', v_ef, 'entradas_cent', c_ent, 'salidas_cent', c_sal, 'reembolsos_cent', c_ree, 'esperado_cent', c_esp),
    'pendientes', jsonb_build_object('cajas_abiertas', v_abiertas, 'reembolsos_sin_confirmar', v_pend),
    'huella', concat_ws('|', v_n, v_ef + v_ta + v_tr, d_n, d_ef + d_ta + d_tr, a_n, a_ef + a_ta + a_tr, c_esp, c_eventos, jsonb_array_length(v_abiertas)));
  return r;
end $$;

create or replace function public.caja_dia_estado(p_fecha date, p_responsable uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_scope uuid; v_hoy date := (now() at time zone 'America/Bogota')::date; v_cierre jsonb; v_facturas jsonb;
begin
  perform public._caja_validar_cierre();
  if p_fecha is null or p_fecha > v_hoy or p_fecha < date '2020-01-01' then raise exception 'Elige una fecha válida, hasta hoy'; end if;
  v_scope := public._caja_dia_alcance(p_responsable);
  select to_jsonb(c) into v_cierre from public.caja_cierres_diarios c
   where c.negocio_id = public.mi_negocio() and c.fecha = p_fecha and c.responsable_id is not distinct from v_scope;
  select coalesce(jsonb_agg(x order by x->>'fecha' desc), '[]'::jsonb) into v_facturas from (
    select jsonb_build_object('id', f.id, 'prefijo', f.prefijo, 'numero', f.numero, 'fecha', f.fecha, 'total', f.total, 'metodo_pago', f.metodo_pago,
                              'estado', f.estado, 'medio_transferencia', to_jsonb(f)->'medio_transferencia') x
      from public.facturas f
     where f.negocio_id = public.mi_negocio() and (f.fecha at time zone 'America/Bogota')::date = p_fecha and (v_scope is null or f.vendedor_id = v_scope)
     order by f.fecha desc limit 200) l;
  return jsonb_build_object('version', 1, 'resumen', public._caja_dia_resumen(public.mi_negocio(), p_fecha, v_scope), 'cierre', v_cierre, 'facturas', v_facturas, 'hoy', v_hoy);
end $$;

create or replace function public.caja_cerrar_dia(p_fecha date, p_responsable uuid, p_request_id text, p_huella text, p_contado_cent bigint, p_observaciones text default '') returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid; v_scope uuid; v_neg integer := public.mi_negocio(); v_id bigint; r jsonb; v_dif bigint; v_nombre text; v_resp text;
begin
  actor := public._caja_validar_cierre();
  if p_fecha is null or p_fecha > (now() at time zone 'America/Bogota')::date or p_fecha < date '2020-01-01' then raise exception 'Elige una fecha válida, hasta hoy'; end if;
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9-]{8,100}$' then raise exception 'Identificador de operación inválido'; end if;
  v_scope := public._caja_dia_alcance(p_responsable);
  perform pg_advisory_xact_lock(hashtextextended('caja-dia:' || v_neg || ':' || p_fecha || ':' || coalesce(v_scope::text, 'negocio'), 0));
  select id into v_id from public.caja_cierres_diarios where negocio_id = v_neg and request_id = p_request_id;
  if found then return v_id; end if;
  if exists (select 1 from public.caja_cierres_diarios where negocio_id = v_neg and fecha = p_fecha and responsable_id is not distinct from v_scope) then
    raise exception 'Este día ya tiene un cierre confirmado para este alcance';
  end if;
  r := public._caja_dia_resumen(v_neg, p_fecha, v_scope);
  if p_huella is distinct from r->>'huella' then raise exception 'Hubo movimientos nuevos en el día. Actualiza y revisa los totales antes de cerrar'; end if;
  if jsonb_array_length(r->'pendientes'->'cajas_abiertas') > 0 then raise exception 'Cierra primero los turnos de caja abiertos'; end if;
  if p_contado_cent is null or p_contado_cent < 0 or p_contado_cent > 9007199254740991 or length(coalesce(p_observaciones, '')) > 1000 then
    raise exception 'Efectivo contado u observaciones inválidos';
  end if;
  v_dif := p_contado_cent - (r->'efectivo'->>'esperado_cent')::bigint;
  if v_dif <> 0 and coalesce(trim(p_observaciones), '') = '' then raise exception 'Explica el sobrante o faltante en observaciones'; end if;
  select nombre into v_nombre from public.perfiles where id = actor;
  select nombre into v_resp from public.perfiles where id = v_scope;
  insert into public.caja_cierres_diarios (negocio_id, fecha, alcance, responsable_id, responsable_nombre, resumen, huella, esperado_cent, contado_cent, diferencia_cent, observaciones, cerrado_por, cerrado_nombre, request_id)
  values (v_neg, p_fecha, r->>'alcance', v_scope, v_resp, r, r->>'huella', (r->'efectivo'->>'esperado_cent')::bigint, p_contado_cent, v_dif, coalesce(trim(p_observaciones), ''), actor, v_nombre, p_request_id)
  returning id into v_id;
  perform public.registrar_actividad('caja.cierre_diario', 'caja_cierres_diarios', v_id::text, jsonb_build_object('fecha', p_fecha, 'alcance', r->>'alcance', 'diferencia_cent', v_dif));
  return v_id;
end $$;

create or replace function public.caja_cierres_dia(p_antes_id bigint default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_rows jsonb; v_total bigint;
begin
  perform public._caja_validar_cierre();
  select coalesce(jsonb_agg((to_jsonb(c) - 'resumen') || jsonb_build_object('neto_cent', c.resumen->'neto_cent', 'vendido_cent', c.resumen->'ventas'->'bruto_cent') order by c.id desc), '[]'::jsonb)
    into v_rows from (select * from public.caja_cierres_diarios
                       where negocio_id = public.mi_negocio() and (public.es_admin() or responsable_id = auth.uid()) and (p_antes_id is null or id < p_antes_id)
                       order by id desc limit 30) c;
  select count(*) into v_total from public.caja_cierres_diarios
   where negocio_id = public.mi_negocio() and (public.es_admin() or responsable_id = auth.uid()) and (p_antes_id is null or id < p_antes_id);
  return jsonb_build_object('cierres', v_rows, 'limitado', v_total > 30);
end $$;

-- 2. Cerrar un turno también requiere el permiso (antes bastaba «vender»).
create or replace function public.caja_cerrar(p_caja_id bigint,p_request_id text,p_revision bigint,p_contado_cent bigint,p_observaciones text default '')returns bigint
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid;s public.caja_sesiones%rowtype;summary jsonb;difference bigint;nombre text;
begin
 actor:=public._caja_validar();
 if not public.tiene_permiso('cerrar_caja') then raise exception using errcode='42501',message='No tienes permiso para cerrar caja. Pide autorización al administrador'; end if;
 select * into s from public.caja_sesiones where id=p_caja_id and negocio_id=public.mi_negocio();
 if not found or not(public.es_admin() or s.responsable_id=actor)then raise exception using errcode='42501',message='No tienes permiso para esta caja';end if;
 perform pg_advisory_xact_lock(hashtextextended('caja:'||s.negocio_id::text||':'||s.responsable_id::text,0));
 select * into s from public.caja_sesiones where id=p_caja_id and negocio_id=public.mi_negocio() for update;
 if s.cierre_request_id=p_request_id then return s.id;end if;
 if s.estado<>'abierta'then raise exception 'La caja ya está cerrada';end if;
 if p_request_id is null or p_request_id!~'^[A-Za-z0-9-]{8,100}$' or p_contado_cent is null or p_contado_cent<0 or p_contado_cent>9007199254740991 or p_revision is distinct from s.revision then raise exception 'La caja recibió movimientos nuevos o los datos de cierre no son válidos. Actualiza y revisa el efectivo antes de cerrar';end if;
 summary:=public._caja_resumen(s.id);
 difference:=p_contado_cent-(summary->>'efectivo_esperado_cent')::bigint;
 if abs(difference::numeric)>9007199254740991 then raise exception 'La diferencia supera el límite seguro';end if;
 if length(coalesce(p_observaciones,''))>1000 or(difference<>0 and coalesce(trim(p_observaciones),'')='')then raise exception 'Explica el sobrante o faltante en observaciones';end if;
 select p.nombre into nombre from public.perfiles p where p.id=actor;
 update public.caja_sesiones set estado='cerrada',cierre_en=clock_timestamp(),cerrado_por=actor,cerrado_nombre=nombre,contado_cent=p_contado_cent,diferencia_cent=difference,observaciones=trim(p_observaciones),resumen_cierre=summary,cierre_request_id=p_request_id where id=s.id;
 perform public.registrar_actividad('caja.cierre','caja_sesiones',s.id::text,jsonb_build_object('contado_cent',p_contado_cent,'diferencia_cent',difference));
 return s.id;
end $$;

revoke all on function public._caja_validar_cierre(), public._caja_dia_alcance(uuid), public._caja_dia_resumen(integer, date, uuid) from public, anon, authenticated;
revoke all on function public.caja_dia_estado(date, uuid), public.caja_cerrar_dia(date, uuid, text, text, bigint, text), public.caja_cierres_dia(bigint) from public, anon;
grant execute on function public.caja_dia_estado(date, uuid), public.caja_cerrar_dia(date, uuid, text, text, bigint, text), public.caja_cierres_dia(bigint) to authenticated;
notify pgrst, 'reload schema';
commit;
