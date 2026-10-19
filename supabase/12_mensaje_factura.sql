-- =====================================================================
--  Angie Tech · 12 · Mensaje al cliente personalizable
--  Ejecutar en Supabase > SQL Editor, DESPUÉS de 10 y 11.
--  Se puede ejecutar más de una vez. No borra datos.
--
--  Cada negocio guarda el texto que reciben sus clientes con la factura
--  (WhatsApp y correo). Lo edita el administrador en
--  Más › Configuración › Mensaje al cliente. Vacío = mensaje por defecto.
-- =====================================================================
alter table tienda add column if not exists mensaje_factura text
  check (mensaje_factura is null or length(mensaje_factura) <= 1500);
notify pgrst, 'reload schema';

-- Verificación: debe devolver 1 fila
select column_name from information_schema.columns where table_name = 'tienda' and column_name = 'mensaje_factura';
