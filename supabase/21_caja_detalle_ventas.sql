-- =====================================================================
--  Angie Tech · 21 · Detalle de las ventas de una caja
--  Ejecutar en Supabase > SQL Editor, DESPUÉS de 18. Se puede repetir.
--
--  Al tocar «Total venta en efectivo / con tarjeta / por transferencia»
--  (o «Total venta») en la caja, se ven las ventas de esa caja con los
--  productos vendidos. Lo ve cualquiera que pueda ver la caja del local
--  (vendedores del local y administradores), aunque la venta la haya hecho
--  otro vendedor. No incluye costos.
-- =====================================================================
begin;
create or replace function public.caja_ventas_detalle(p_caja_id bigint, p_metodo text default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.caja_sesiones%rowtype; r jsonb;
begin
  perform public._caja_validar();
  select * into s from public.caja_sesiones where id = p_caja_id and negocio_id = public.mi_negocio();
  if not found or not public._caja_puede_ver(s.local_id, s.responsable_id) then
    raise exception using errcode = '42501', message = 'No tienes permiso para esta caja';
  end if;
  if p_metodo is not null and p_metodo not in ('efectivo', 'tarjeta', 'transferencia') then raise exception 'Medio de pago inválido'; end if;
  select coalesce(jsonb_agg(v order by v->>'fecha' desc), '[]'::jsonb) into r from (
    select jsonb_build_object(
             'id', f.id, 'prefijo', f.prefijo, 'numero', f.numero, 'fecha', f.fecha, 'estado', f.estado,
             'metodo', e.metodo, 'total', f.total, 'descuento', f.descuento,
             'vendedor', (select p.nombre from public.perfiles p where p.id = f.vendedor_id),
             'cliente', (select c.nombre from public.clientes c where c.id = f.cliente_id),
             'items', (select coalesce(jsonb_agg(jsonb_build_object('producto_id', i.producto_id, 'nombre', i.nombre, 'cantidad', i.cantidad,
                                                                    'precio_unitario', i.precio_unitario, 'descuento', i.descuento,
                                                                    'total', i.precio_unitario * i.cantidad - i.descuento) order by i.id), '[]'::jsonb)
                         from public.factura_items i where i.factura_id = f.id)) v
      from public.caja_eventos e
      join public.facturas f on f.id = e.origen_id and f.negocio_id = e.negocio_id
     where e.caja_id = s.id and e.tipo = 'venta' and (p_metodo is null or e.metodo = p_metodo)
  ) x;
  return r;
end $$;
revoke all on function public.caja_ventas_detalle(bigint, text) from public, anon;
grant execute on function public.caja_ventas_detalle(bigint, text) to authenticated;
notify pgrst, 'reload schema';
commit;

select proname from pg_proc where proname = 'caja_ventas_detalle';
