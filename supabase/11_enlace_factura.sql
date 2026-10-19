-- =====================================================================
--  Angie Tech · 11 · Enlace corto y bonito para la factura del cliente
--  Ejecutar en Supabase > SQL Editor, DESPUÉS de 10.
--  Se puede ejecutar más de una vez. No borra datos.
--
--  En vez del enlace largo del PDF, el cliente recibe algo como
--    https://angie-tech.vercel.app/f/Kq7mZ2xP9wRt
--  y ve su factura con el diseño del negocio y el botón para descargar el PDF.
--  El código es aleatorio (imposible de adivinar), solo muestra ESA factura
--  y vence en un año. No muestra costos, comisiones ni datos internos.
-- =====================================================================
begin;

create table if not exists factura_enlaces (
  token      text primary key,
  factura_id bigint not null references facturas(id) on delete cascade,
  negocio_id integer not null references tienda(id),
  creado_por uuid references perfiles(id),
  creado_en  timestamptz not null default now(),
  vence_en   timestamptz not null default now() + interval '1 year'
);
create index if not exists idx_factura_enlaces_factura on factura_enlaces (factura_id);
alter table factura_enlaces enable row level security;   -- sin políticas: solo por las funciones

-- El vendedor (de sus facturas) o el administrador crean el enlace
create or replace function crear_enlace_factura(p_factura bigint) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare f facturas%rowtype; v_token text;
begin
  select * into f from facturas where id = p_factura and negocio_id = mi_negocio();
  if not found or not (es_admin() or (tiene_permiso('vender') and f.vendedor_id = auth.uid())) then
    raise exception 'La factura no existe';
  end if;
  select token into v_token from factura_enlaces where factura_id = f.id and vence_en > now() + interval '30 days'
   order by creado_en desc limit 1;
  if v_token is not null then return v_token; end if;
  loop
    v_token := translate(encode(gen_random_bytes(9), 'base64'), '+/=', 'xyz');   -- 12 caracteres
    exit when not exists (select 1 from factura_enlaces where token = v_token);
  end loop;
  insert into factura_enlaces (token, factura_id, negocio_id, creado_por) values (v_token, f.id, f.negocio_id, auth.uid());
  return v_token;
end $$;

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
                                         'correo', t.correo, 'factura_pie', t.factura_pie, 'logo_url', t.logo_url)
                 from tienda t where t.id = f.negocio_id)
  );
end $$;

revoke all on function crear_enlace_factura(bigint) from public, anon;
grant execute on function crear_enlace_factura(bigint) to authenticated;
revoke all on function factura_publica(text) from public;
grant execute on function factura_publica(text) to anon, authenticated;

notify pgrst, 'reload schema';
commit;

-- Verificación: debe devolver 2 filas
select proname from pg_proc where proname in ('crear_enlace_factura', 'factura_publica');
