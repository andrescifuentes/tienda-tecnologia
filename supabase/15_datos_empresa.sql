-- =====================================================================
--  Angie Tech · 15 · Datos de la empresa en la factura
--  Ejecutar en Supabase > SQL Editor, DESPUÉS de 11.
--  Se puede ejecutar más de una vez. No borra datos.
--
--  Agrega el "Número de local" y "Otros datos" (los que quieras) a los
--  datos del negocio. Nombre, NIT,
--  dirección, local, teléfono y correo se editan en
--  Más › Configuración › Datos de la empresa y salen en todas las facturas,
--  el PDF y la página de la factura que recibe el cliente.
-- =====================================================================
begin;
alter table tienda add column if not exists local text;
-- Otros datos que el administrador quiera mostrar (ej. Instagram, horario, régimen): [{"etiqueta":"…","valor":"…"}]
alter table tienda add column if not exists datos_extra jsonb not null default '[]'::jsonb;

-- Lo que ve el cliente al abrir el enlace (sin sesión)
create or replace function factura_publica(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e factura_enlaces%rowtype; f facturas%rowtype;
begin
  if p_token is null or length(p_token) <> 12 then return null; end if;
  select * into e from factura_enlaces where token = p_token and vence_en > now();
  if not found then return null; end if;
  select * into f from facturas where id = e.factura_id;
  if not found then return null; end if;
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
    'tienda', (select jsonb_build_object('id', t.id, 'nombre', t.nombre, 'nit', t.nit, 'direccion', t.direccion, 'telefono', t.telefono,
                                         'correo', t.correo, 'local', t.local, 'datos_extra', t.datos_extra, 'factura_pie', t.factura_pie, 'logo_url', t.logo_url)
                 from tienda t where t.id = f.negocio_id)
  );
end $$;

notify pgrst, 'reload schema';
commit;

-- Verificación: debe devolver 2 filas
select column_name from information_schema.columns where table_name = 'tienda' and column_name in ('local', 'datos_extra');
