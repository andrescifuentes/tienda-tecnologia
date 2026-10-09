-- =====================================================================
--  Angie Tech · 04 · Envío de facturas (WhatsApp y correo)
--  Crea el espacio "facturas" en Storage para guardar el PDF de cada
--  factura enviada y compartirlo con un enlace difícil de adivinar.
--  Ejecutar en Supabase > SQL Editor. Se puede ejecutar más de una vez.
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('facturas', 'facturas', true)
on conflict (id) do nothing;

drop policy if exists "facturas_pdf_leer"  on storage.objects;
drop policy if exists "facturas_pdf_subir" on storage.objects;

-- No se crea política de lectura: el enlace público funciona igual y así
-- nadie puede listar las facturas de otros clientes.

-- Solo usuarios activos que pueden vender suben PDFs de facturas
create policy "facturas_pdf_subir" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'facturas' and public.tiene_permiso('vender'));

-- Verificación: debe mostrar una fila
select id, public from storage.buckets where id = 'facturas';
