-- =====================================================================
--  TechStore / Angie Tech · 03 · Detalle de productos
--  Agrega a los productos: modelo compatible, color, descripción, foto y stock máximo.
--  Crea las categorías del diseño y el espacio de fotos (Storage).
--  Ejecutar en Supabase > SQL Editor, DESPUÉS de 01_esquema.sql.
--  Se puede ejecutar más de una vez sin problema.
-- =====================================================================

-- 1. Nuevas columnas (todas opcionales)
alter table productos
  add column if not exists modelo      text,
  add column if not exists color       text,
  add column if not exists descripcion text,
  add column if not exists foto_url    text,
  add column if not exists stock_max   integer check (stock_max is null or stock_max >= 0);

-- 2. Categorías usadas en el diseño de inventario
insert into categorias (nombre) values
  ('Fundas'), ('Cargadores'), ('Cables'), ('Audífonos'), ('Protectores')
on conflict do nothing;

-- 3. Vista para vendedores (sin costos) con los nuevos campos al final
create or replace view productos_venta as
select p.id, p.codigo, p.codigo_barras, p.nombre, p.marca,
       c.nombre as categoria, p.precio_venta, p.stock, p.stock_min,
       p.maneja_serial, p.garantia_meses,
       p.modelo, p.color, p.descripcion, p.foto_url, p.stock_max
from productos p
left join categorias c on c.id = p.categoria_id
where p.activo and tiene_permiso('ver_inventario');

-- 4. Fotos de productos en Storage (bucket público de solo lectura)
insert into storage.buckets (id, name, public)
values ('productos', 'productos', true)
on conflict (id) do nothing;

drop policy if exists "productos_fotos_leer"      on storage.objects;
drop policy if exists "productos_fotos_subir"     on storage.objects;
drop policy if exists "productos_fotos_cambiar"   on storage.objects;
drop policy if exists "productos_fotos_borrar"    on storage.objects;

create policy "productos_fotos_leer" on storage.objects
  for select using (bucket_id = 'productos');
create policy "productos_fotos_subir" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'productos' and public.tiene_permiso('editar_inventario'));
create policy "productos_fotos_cambiar" on storage.objects
  for update to authenticated
  using (bucket_id = 'productos' and public.tiene_permiso('editar_inventario'));
create policy "productos_fotos_borrar" on storage.objects
  for delete to authenticated
  using (bucket_id = 'productos' and public.tiene_permiso('editar_inventario'));

-- Verificación
select column_name from information_schema.columns
where table_name = 'productos' and column_name in ('modelo','color','descripcion','foto_url','stock_max');
