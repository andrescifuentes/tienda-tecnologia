-- =====================================================================
--  Angie Tech · 22 · Historial de cierres de caja por día, mes o año
--  Ejecutar en Supabase > SQL Editor, DESPUÉS de 18, 19 y 20. Se puede repetir.
--
--  Devuelve las cajas cerradas entre dos fechas (hora Colombia), con su
--  resumen: vendido por medio de pago, contado, diferencia y base.
--  El vendedor ve las de su local; el administrador las del local que elija
--  (o de todos los locales si no elige).
-- =====================================================================
begin;
create or replace function public.caja_historial(p_desde date, p_hasta date, p_local_id bigint default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_local bigint; r jsonb;
begin
  perform public._caja_validar();
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 400 then raise exception 'Rango de fechas inválido'; end if;
  -- Vendedor: siempre su local. Administrador: el local elegido o todos (null)
  v_local := case when public.es_admin() then p_local_id else coalesce(public.mi_local(), public.local_principal(public.mi_negocio())) end;
  if v_local is not null and not public.local_de_mi_negocio(v_local) then raise exception 'El local no es válido'; end if;
  select coalesce(jsonb_agg(x order by (x->>'cierre_en') desc), '[]'::jsonb) into r from (
    select jsonb_build_object(
             'id', c.id, 'local_id', c.local_id, 'local', (select l.nombre from public.locales l where l.id = c.local_id),
             'apertura_en', c.apertura_en, 'cierre_en', c.cierre_en,
             'responsable_nombre', c.responsable_nombre, 'cerrado_nombre', c.cerrado_nombre,
             'inicial_cent', c.inicial_cent, 'contado_cent', c.contado_cent, 'diferencia_cent', c.diferencia_cent,
             'base_siguiente_cent', c.base_siguiente_cent, 'observaciones', c.observaciones,
             'reabierta', jsonb_array_length(coalesce(c.cierres_anteriores, '[]'::jsonb)) > 0,
             'resumen', c.resumen_cierre) x
      from public.caja_sesiones c
     where c.negocio_id = public.mi_negocio() and c.estado = 'cerrada'
       and (v_local is null or c.local_id = v_local)
       and (c.cierre_en at time zone 'America/Bogota')::date between p_desde and p_hasta
     order by c.cierre_en desc
     limit 500) t;
  return r;
end $$;
revoke all on function public.caja_historial(date, date, bigint) from public, anon;
grant execute on function public.caja_historial(date, date, bigint) to authenticated;
notify pgrst, 'reload schema';
commit;

select proname from pg_proc where proname = 'caja_historial';
