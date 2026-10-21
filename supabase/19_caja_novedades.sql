-- =====================================================================
--  Angie Tech · 19 · Novedades de caja y reabrir una caja cerrada por error
--  Ejecutar en Supabase > SQL Editor, DESPUÉS de 18. Se puede repetir.
--
--  Una «novedad» es una nota del día en la caja del local, sin dinero:
--  por ejemplo «se dañó el datáfono», «cliente pagó con billete dudoso»,
--  «faltó la base porque…». La registra cualquier vendedor del local o un
--  administrador mientras la caja está abierta. Queda con la hora y quién
--  la escribió, sale en el cierre y no cambia el efectivo esperado.
--
--  Reabrir: si cierran la caja por error a mitad del día, un administrador
--  la reabre (el mismo día, con motivo). El cierre anterior queda guardado
--  en el historial y las ventas hechas mientras estuvo cerrada se suman.
-- =====================================================================
begin;

alter table public.caja_eventos drop constraint if exists caja_eventos_tipo_check;
alter table public.caja_eventos add constraint caja_eventos_tipo_check
  check (tipo in ('venta','devolucion','anulacion','entrada','salida','gasto','pago_proveedor','reembolso','novedad'));
alter table public.caja_eventos drop constraint if exists caja_eventos_novedad_sin_dinero;
alter table public.caja_eventos add constraint caja_eventos_novedad_sin_dinero
  check (tipo <> 'novedad' or (monto_cent = 0 and efectivo_cent = 0));

create or replace function public.caja_novedad(p_caja_id bigint, p_request_id text, p_descripcion text) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid; s public.caja_sesiones%rowtype; result_id bigint; nombre text;
begin
  actor := public._caja_validar();
  select * into s from public.caja_sesiones where id = p_caja_id and negocio_id = public.mi_negocio();
  perform public._caja_permiso(s);
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9-]{8,100}$' then raise exception 'Identificador inválido'; end if;
  select id into result_id from public.caja_eventos where caja_id = p_caja_id and request_id = p_request_id;
  if found then return result_id; end if;
  if s.estado <> 'abierta' then raise exception 'La caja está cerrada'; end if;
  if coalesce(length(trim(p_descripcion)), 0) not between 1 and 500 then raise exception 'Escribe la novedad (máximo 500 caracteres)'; end if;
  select p.nombre into nombre from public.perfiles p where p.id = actor;
  insert into public.caja_eventos (negocio_id, caja_id, tipo, metodo, monto_cent, efectivo_cent, descripcion, referencia, creado_por, request_id)
  values (s.negocio_id, s.id, 'novedad', 'efectivo', 0, 0, trim(p_descripcion), coalesce(nombre, 'Novedad'), actor, p_request_id)
  returning id into result_id;
  perform public.registrar_actividad('caja.novedad', 'caja_sesiones', s.id::text, jsonb_build_object('evento_id', result_id, 'novedad', trim(p_descripcion)));
  return result_id;
end $$;

-- El resumen cuenta las novedades (para el cierre)
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
    'novedades', count(*) filter (where tipo = 'novedad'),
    'ajustes_cent', coalesce(sum(monto_cent) filter (where tipo in ('devolucion', 'anulacion')), 0),
    'efectivo_esperado_cent', expected, 'eventos', count(*),
    'reembolsos_por_confirmar', (select count(*) from public.caja_eventos a where a.caja_id = p_id and a.tipo in ('devolucion', 'anulacion') and not exists (select 1 from public.caja_eventos b where b.ajuste_id = a.id))
  ) into r from public.caja_eventos where caja_id = p_id;
  if abs((r->>'vendido_bruto_cent')::numeric) > 9007199254740991 or abs((r->>'ajustes_cent')::numeric) > 9007199254740991 then raise exception 'El total supera el límite seguro de caja'; end if;
  return r;
end $$;

alter table public.caja_sesiones add column if not exists cierres_anteriores jsonb not null default '[]'::jsonb;

create or replace function public.caja_reabrir(p_caja_id bigint, p_request_id text, p_motivo text) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid; s public.caja_sesiones%rowtype; nombre text; f record; n integer := 0;
begin
  actor := public._caja_validar();
  if not public.es_admin() then raise exception using errcode = '42501', message = 'Solo un administrador puede reabrir la caja'; end if;
  select * into s from public.caja_sesiones where id = p_caja_id and negocio_id = public.mi_negocio();
  perform public._caja_permiso(s);
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9-]{8,100}$' then raise exception 'Identificador inválido'; end if;
  if coalesce(length(trim(p_motivo)), 0) not between 3 and 500 then raise exception 'Escribe por qué se reabre la caja'; end if;
  perform pg_advisory_xact_lock(hashtextextended('caja-local:' || s.local_id::text, 0));
  select * into s from public.caja_sesiones where id = p_caja_id for update;
  if exists (select 1 from public.caja_eventos where caja_id = s.id and request_id = p_request_id) then return s.id; end if;
  if s.estado <> 'cerrada' then raise exception 'La caja ya está abierta'; end if;
  if (s.apertura_en at time zone 'America/Bogota')::date <> public.hoy_tienda() then raise exception 'Solo se puede reabrir una caja del día de hoy'; end if;
  if exists (select 1 from public.caja_sesiones where local_id = s.local_id and estado = 'abierta') then raise exception 'Este local ya tiene otra caja abierta'; end if;
  select p.nombre into nombre from public.perfiles p where p.id = actor;
  update public.caja_sesiones
     set estado = 'abierta',
         cierres_anteriores = cierres_anteriores || jsonb_build_array(jsonb_build_object(
           'cierre_en', cierre_en, 'cerrado_nombre', cerrado_nombre, 'contado_cent', contado_cent,
           'diferencia_cent', diferencia_cent, 'observaciones', observaciones, 'resumen', resumen_cierre,
           'reabierta_en', clock_timestamp(), 'reabierta_por', nombre, 'motivo', trim(p_motivo))),
         cierre_en = null, cerrado_por = null, cerrado_nombre = null, contado_cent = null, diferencia_cent = null,
         observaciones = null, resumen_cierre = null, cierre_request_id = null, revision = revision + 1
   where id = s.id;
  insert into public.caja_eventos (negocio_id, caja_id, tipo, metodo, monto_cent, efectivo_cent, descripcion, referencia, creado_por, request_id)
  values (s.negocio_id, s.id, 'novedad', 'efectivo', 0, 0, 'Caja reabierta: ' || trim(p_motivo), coalesce(nombre, 'Administrador'), actor, p_request_id);
  -- Ventas del local hechas mientras la caja estuvo cerrada
  for f in select x.* from public.facturas x
            where x.local_id = s.local_id and x.negocio_id = s.negocio_id and x.estado = 'emitida' and x.total > 0
              and x.fecha >= s.cierre_en
              and not exists (select 1 from public.caja_eventos e where e.negocio_id = x.negocio_id and e.origen = 'venta:' || x.id) loop
    perform public._caja_capturar(f.negocio_id, f.local_id, 'venta', f.metodo_pago::text, f.total, f.id, f.prefijo || '-' || f.numero::text);
    n := n + 1;
  end loop;
  perform public.registrar_actividad('caja.reabierta', 'caja_sesiones', s.id::text, jsonb_build_object('motivo', trim(p_motivo), 'ventas_recuperadas', n));
  return s.id;
end $$;

revoke all on function public.caja_reabrir(bigint, text, text) from public, anon;
grant execute on function public.caja_reabrir(bigint, text, text) to authenticated;
revoke all on function public.caja_novedad(bigint, text, text) from public, anon;
grant execute on function public.caja_novedad(bigint, text, text) to authenticated;
revoke all on function public._caja_resumen(bigint) from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;

-- Verificación: debe devolver 2 filas
select proname from pg_proc where proname in ('caja_novedad', 'caja_reabrir');
