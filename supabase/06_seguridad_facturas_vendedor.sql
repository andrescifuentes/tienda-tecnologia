-- PREPARADO LOCALMENTE. NO EJECUTADO. Requiere 01, 03 y 05.
-- Revisar políticas/grants remotos y relaciones de PostgREST antes de aplicar.
-- Activar VITE_SAFE_INVOICE_VIEWS solo tras validar esta migración completa.
begin;
do $$ begin
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='facturas' and column_name='request_id') then
    raise exception 'Aplicar y validar primero 05_ventas_idempotentes.sql';
  end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename in ('facturas','factura_items','productos') and cmd in ('SELECT','ALL') and policyname not in ('facturas_select','factura_items_select','productos_select')) then
    raise exception 'Existen políticas adicionales de lectura: revisarlas antes de aplicar seguridad';
  end if;
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('facturas','factura_items','productos','factura_envios','devoluciones','devolucion_items') and not c.relrowsecurity) then
    raise exception 'RLS deshabilitado: revisar el esquema antes de aplicar seguridad';
  end if;
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='facturas_netas' and coalesce(c.reloptions,'{}') @> array['security_invoker=true']) then
    raise exception 'Revisar facturas_netas: debe respetar RLS como security_invoker';
  end if;
end $$;
create or replace function public.puede_consultar_factura(p_id bigint) returns boolean
language sql stable security definer set search_path=public as $$
  select public.es_admin() or (public.es_activo() and exists(select 1 from public.facturas f where f.id=p_id and f.vendedor_id=auth.uid()))
$$;
revoke all on function public.puede_consultar_factura(bigint) from public,anon;
grant execute on function public.puede_consultar_factura(bigint) to authenticated;

-- Owner views intentionally project ONLY safe columns and explicitly check the JWT actor.
create or replace view public.facturas_venta with (security_barrier=true) as
select f.id,f.prefijo,f.numero,f.cliente_id,f.vendedor_id,f.metodo_pago,f.subtotal,f.descuento,f.total,
       f.estado,f.notas,f.fecha,f.comision_pct,f.comision,f.motivo_anulacion,f.anulada_por,f.anulada_en,f.request_id
from public.facturas f where public.puede_consultar_factura(f.id);
create or replace view public.factura_items_venta with (security_barrier=true) as
select i.id,i.factura_id,i.producto_id,i.unidad_id,i.nombre,i.cantidad,i.precio_unitario,i.descuento
from public.factura_items i where public.puede_consultar_factura(i.factura_id);
create or replace view public.facturas_venta_netas with (security_barrier=true) as
select f.id,f.prefijo,f.numero,f.cliente_id,f.vendedor_id,f.metodo_pago,f.subtotal,f.descuento,f.total,
       f.estado,f.notas,f.fecha,f.comision_pct,f.comision,f.motivo_anulacion,f.anulada_por,f.anulada_en,f.request_id,
       f.total-coalesce(d.total_devuelto,0) as total_neto,
       coalesce(f.comision,0)-coalesce(d.comision_revertida,0) as comision_neta
from public.facturas f left join (
  select factura_id,sum(total_devuelto) as total_devuelto,sum(comision_revertida) as comision_revertida
  from public.devoluciones group by factura_id
) d on d.factura_id=f.id where public.puede_consultar_factura(f.id);
revoke all on public.facturas_venta,public.factura_items_venta,public.facturas_venta_netas from public,anon;
grant select on public.facturas_venta,public.factura_items_venta,public.facturas_venta_netas to authenticated;

drop policy if exists facturas_select on public.facturas;
create policy facturas_select on public.facturas for select to authenticated using(public.es_admin());
drop policy if exists factura_items_select on public.factura_items;
create policy factura_items_select on public.factura_items for select to authenticated using(public.es_admin());
drop policy if exists productos_select on public.productos;
create policy productos_select on public.productos for select to authenticated using(public.es_admin());
-- Existing productos_venta is the cost-free inventory view supplied by 03.

drop policy if exists envios_select on public.factura_envios;
create policy envios_select on public.factura_envios for select to authenticated using(public.puede_consultar_factura(factura_id));
drop policy if exists envios_insert on public.factura_envios;
create policy envios_insert on public.factura_envios for insert to authenticated with check(enviado_por=auth.uid() and public.puede_consultar_factura(factura_id));
drop policy if exists devoluciones_select on public.devoluciones;
create policy devoluciones_select on public.devoluciones for select to authenticated using(public.puede_consultar_factura(factura_id));
drop policy if exists devitems_select on public.devolucion_items;
create policy devitems_select on public.devolucion_items for select to authenticated using(exists(select 1 from public.devoluciones d where d.id=devolucion_id and public.puede_consultar_factura(d.factura_id)));
-- Preserve the existing seller KPI calculation after base cost tables become Admin-only.
create or replace function public.ventas_por_empleado(p_desde date,p_hasta date)
returns table(vendedor_id uuid,nombre text,facturas bigint,total_vendido numeric,comision numeric)
language sql stable security invoker set search_path=public as $$
  select fn.vendedor_id,pf.nombre,count(*),sum(fn.total_neto),sum(fn.comision_neta)
  from public.facturas_venta_netas fn join public.perfiles pf on pf.id=fn.vendedor_id
  where fn.estado='emitida' and (fn.fecha at time zone 'America/Bogota')::date between p_desde and p_hasta
  group by fn.vendedor_id,pf.nombre order by 4 desc
$$;
create or replace function resumen_dashboard()
returns table (
  ventas_hoy numeric, facturas_hoy bigint,
  ventas_mes numeric, facturas_mes bigint,
  ingresos_mes numeric, gastos_mes numeric, utilidad_mes numeric,
  valor_inventario numeric, productos_stock_bajo bigint
)
language plpgsql stable security definer set search_path = public as $$
declare
  tz constant text := 'America/Bogota';
  v_hoy date := hoy_tienda();
  v_mes date := date_trunc('month', hoy_tienda())::date;
  v_ventas_hoy numeric; v_fact_hoy bigint; v_ventas_mes numeric; v_fact_mes bigint; v_costo_mes numeric;
  v_ing_man numeric; v_gastos numeric;
begin
  if not es_admin() then
    raise exception 'No tienes permiso para ver el dashboard';
  end if;

  select coalesce(sum(total_neto) filter (where (fecha at time zone tz)::date = v_hoy), 0),
         count(*)                 filter (where (fecha at time zone tz)::date = v_hoy),
         coalesce(sum(total_neto), 0), count(*), coalesce(sum(costo_neto), 0)
    into v_ventas_hoy, v_fact_hoy, v_ventas_mes, v_fact_mes, v_costo_mes
    from facturas_netas
   where estado = 'emitida' and (fecha at time zone tz)::date >= v_mes;

  select coalesce(sum(monto) filter (where tipo = 'ingreso'), 0),
         coalesce(sum(monto) filter (where tipo = 'gasto'), 0)
    into v_ing_man, v_gastos
    from movimientos where fecha >= v_mes;

  return query select
    v_ventas_hoy, v_fact_hoy, v_ventas_mes, v_fact_mes,
    v_ventas_mes + v_ing_man, v_gastos,
    v_ventas_mes - v_costo_mes + v_ing_man - v_gastos,
    (select coalesce(sum(stock * precio_compra), 0) from productos where activo),
    (select count(*) from productos where activo and stock <= stock_min);
end $$;
notify pgrst, 'reload schema';
commit;
