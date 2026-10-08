-- =====================================================================
--  TechStore · Borrar los usuarios de prueba
--  Ejecutar cuando ya vayas a crear los usuarios reales.
-- =====================================================================

-- OPCIÓN A (la más segura): desactivar. Pierden el acceso pero el historial
-- de facturas, compras y movimientos que hicieron se conserva.
update perfiles set activo = false
where correo in ('admin@prueba.com', 'vendedor@prueba.com');

-- OPCIÓN B: borrarlos del todo. Solo funciona si NO hicieron facturas,
-- compras ni movimientos. Si ya los usaste para probar, sale un error de
-- llave foránea: en ese caso usa la OPCIÓN A, o limpia primero los datos de
-- prueba con la OPCIÓN C. (Quita los "--" de las líneas para ejecutarla.)
--
-- delete from auth.users where email in ('admin@prueba.com', 'vendedor@prueba.com');

-- OPCIÓN C: borrar TODOS los datos de prueba (productos, facturas, compras,
-- clientes, movimientos...) y reiniciar los consecutivos. ¡NO la ejecutes
-- si ya hay datos reales! Deja intactos los perfiles, las categorías y la
-- configuración de la tienda. (Quita los "--" para ejecutarla.)
--
-- truncate table
--   reclamos_garantia, garantias, devolucion_items, devoluciones, factura_envios,
--   factura_items, facturas, unidades_serializadas, compra_items, pagos_proveedor,
--   compras, movimientos_inventario, productos, proveedores, clientes, movimientos
--   restart identity cascade;
-- update tienda set ultimo_numero_factura = 0 where id = 1;
