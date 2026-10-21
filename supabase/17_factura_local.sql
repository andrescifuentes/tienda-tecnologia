-- =====================================================================
--  Angie Tech · 17 · La factura siempre muestra el local donde se vendió
--  Ejecutar en Supabase > SQL Editor, DESPUÉS de 16. Se puede repetir.
--  El enlace público de la factura (WhatsApp) muestra la sede, la
--  dirección, el número de local y el teléfono del local que vendió,
--  aunque el negocio tenga un solo local.
-- =====================================================================
begin;
create or replace function factura_publica(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e factura_enlaces%rowtype; f facturas%rowtype; l locales%rowtype;
begin
  if p_token is null or length(p_token) <> 12 then return null; end if;
  select * into e from factura_enlaces where token = p_token and vence_en > now();
  if not found then return null; end if;
  select * into f from facturas where id = e.factura_id;
  if not found then return null; end if;
  select * into l from locales where id = f.local_id;
  return jsonb_build_object(
    'factura', jsonb_build_object('id', f.id, 'prefijo', f.prefijo, 'numero', f.numero, 'fecha', f.fecha, 'estado', f.estado,
                                  'subtotal', f.subtotal, 'descuento', f.descuento, 'total', f.total,
                                  'metodo_pago', f.metodo_pago, 'notas', f.notas,
                                  'devuelto', (select coalesce(sum(total_devuelto), 0) from devoluciones where factura_id = f.id)),
    'cliente', (select jsonb_build_object('nombre', c.nombre, 'tipo_documento', c.tipo_documento, 'documento', c.documento,
                                          'telefono', c.telefono, 'correo', c.correo, 'direccion', c.direccion)
                  from clientes c where c.id = f.cliente_id),
    'vendedor', (select jsonb_build_object('nombre', p.nombre) from perfiles p where p.id = f.vendedor_id),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('nombre', i.nombre, 'cantidad', i.cantidad,
                                                           'precio_unitario', i.precio_unitario, 'descuento', i.descuento) order by i.id), '[]'::jsonb)
                from factura_items i where i.factura_id = f.id),
    'tienda', (select jsonb_build_object('id', t.id, 'nombre', t.nombre, 'nit', t.nit,
                                         'direccion', coalesce(nullif(trim(l.direccion), ''), t.direccion),
                                         'telefono', coalesce(nullif(trim(l.telefono), ''), t.telefono),
                                         'correo', t.correo,
                                         'local', coalesce(nullif(trim(l.numero), ''), t.local),
                                         'sede', l.nombre,
                                         'datos_extra', t.datos_extra, 'factura_pie', t.factura_pie, 'logo_url', t.logo_url)
                 from tienda t where t.id = f.negocio_id)
  );
end $$;
grant execute on function factura_publica(text) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
