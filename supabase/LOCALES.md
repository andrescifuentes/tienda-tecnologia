# Locales (sedes) · script 16

Ejecutar `16_locales.sql` en Supabase › SQL Editor **después de 10 al 15** (respaldo antes).

- Crea `locales` y deja cada negocio con «Local 1» (toma dirección, número de local y teléfono del negocio).
- `stock_local`: stock por local. `productos.stock` sigue siendo el total. Todo el inventario actual queda en el Local 1.
- `local_id` en facturas (local que vende), factura_items (local de donde sale el producto), compras, movimientos de inventario, unidades con serial, ingresos/gastos (null = general) y perfiles (local del empleado; admin sin local = todos).
- Funciones nuevas o con parámetro opcional `p_local_id`: `emitir_factura`, `emitir_factura_segura`, `registrar_compra`, `ajustar_inventario`, `resumen_dashboard`, `ventas_por_empleado`, `trasladar_inventario` (nueva).
- Seguridad: nadie escribe `stock_local` directo; solo el administrador crea/edita locales y cambia el local de un empleado; las unidades con serial solo cambian de local con «Trasladar». El vendedor vende en su local y puede vender stock del otro local (se descuenta allá).
- La app funciona igual si el script no se ha ejecutado (un solo local).
- Si después se ejecuta `13_datos_empresa.sql`, este redefine `factura_publica` sin la dirección del local: volver a ejecutar `16_locales.sql` al final.
