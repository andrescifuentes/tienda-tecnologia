-- =====================================================================
--  Angie Tech · 20 · Base de caja para el día siguiente
--  Ejecutar en Supabase > SQL Editor, DESPUÉS de 18 y 19. Se puede repetir.
--
--  Al cerrar la caja se elige si se deja base en el cajón y cuánto.
--  Esa base es el saldo inicial de la caja del local al día siguiente.
--  Lo que no se deja de base es el efectivo que se retira al cerrar.
--  Si no se indica (cierres anteriores), la base es lo contado al cierre.
-- =====================================================================
begin;
alter table public.caja_sesiones add column if not exists base_siguiente_cent bigint
  check (base_siguiente_cent is null or base_siguiente_cent between 0 and 9007199254740991);

drop function if exists public.caja_cerrar(bigint, text, bigint, bigint, text);
create or replace function public.caja_cerrar(p_caja_id bigint, p_request_id text, p_revision bigint, p_contado_cent bigint,
                                              p_observaciones text default '', p_base_siguiente_cent bigint default null) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid; s public.caja_sesiones%rowtype; summary jsonb; difference bigint; nombre text; v_base bigint;
begin
  actor := public._caja_validar();
  select * into s from public.caja_sesiones where id = p_caja_id and negocio_id = public.mi_negocio();
  perform public._caja_permiso(s);
  perform pg_advisory_xact_lock(hashtextextended('caja-local:' || s.local_id::text, 0));
  select * into s from public.caja_sesiones where id = p_caja_id and negocio_id = public.mi_negocio() for update;
  if s.cierre_request_id = p_request_id then return s.id; end if;
  if s.estado <> 'abierta' then raise exception 'La caja ya está cerrada'; end if;
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9-]{8,100}$' or p_contado_cent is null or p_contado_cent < 0 or p_contado_cent > 9007199254740991 or p_revision is distinct from s.revision then raise exception 'La caja recibió movimientos nuevos o los datos de cierre no son válidos. Actualiza y revisa el efectivo antes de cerrar'; end if;
  v_base := coalesce(p_base_siguiente_cent, p_contado_cent);
  if v_base < 0 or v_base > p_contado_cent then raise exception 'La base para mañana no puede ser mayor que el efectivo contado'; end if;
  summary := public._caja_resumen(s.id);
  difference := p_contado_cent - (summary->>'efectivo_esperado_cent')::bigint;
  if abs(difference::numeric) > 9007199254740991 then raise exception 'La diferencia supera el límite seguro'; end if;
  if length(coalesce(p_observaciones, '')) > 1000 or (difference <> 0 and coalesce(trim(p_observaciones), '') = '') then raise exception 'Explica el sobrante o faltante en observaciones'; end if;
  select p.nombre into nombre from public.perfiles p where p.id = actor;
  update public.caja_sesiones set estado = 'cerrada', cierre_en = clock_timestamp(), cerrado_por = actor, cerrado_nombre = nombre,
         contado_cent = p_contado_cent, diferencia_cent = difference, observaciones = trim(p_observaciones),
         resumen_cierre = summary || jsonb_build_object('base_siguiente_cent', v_base, 'retirado_cent', p_contado_cent - v_base),
         base_siguiente_cent = v_base, cierre_request_id = p_request_id
   where id = s.id;
  perform public.registrar_actividad('caja.cierre', 'caja_sesiones', s.id::text, jsonb_build_object('contado_cent', p_contado_cent, 'diferencia_cent', difference,
          'base_siguiente_cent', v_base, 'local', public.nombre_local(s.local_id)));
  return s.id;
end $$;

-- Si reabren la caja, la base elegida se borra (se vuelve a elegir al cerrar)
create or replace function public._caja_base_reabrir() returns trigger
language plpgsql as $$
begin
  if old.estado = 'cerrada' and new.estado = 'abierta' then new.base_siguiente_cent := null; end if;
  return new;
end $$;
drop trigger if exists trg_caja_base_reabrir on public.caja_sesiones;
create trigger trg_caja_base_reabrir before update of estado on public.caja_sesiones
  for each row execute function public._caja_base_reabrir();

revoke all on function public.caja_cerrar(bigint, text, bigint, bigint, text, bigint) from public, anon;
grant execute on function public.caja_cerrar(bigint, text, bigint, bigint, text, bigint) to authenticated;
notify pgrst, 'reload schema';
commit;

select column_name from information_schema.columns where table_name = 'caja_sesiones' and column_name = 'base_siguiente_cent';
