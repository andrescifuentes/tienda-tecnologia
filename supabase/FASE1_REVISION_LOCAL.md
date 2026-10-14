# Parches locales de fase 1 — sin ejecutar

Se mantienen los valores actuales de .env y el esquema remoto. Las siguientes piezas requieren revisión/aprobación independiente para su aplicación.

1. 05_ventas_idempotentes.sql agrega un identificador de solicitud a facturas y un RPC transaccional emitir_factura_segura. El bloqueo por vendedor/solicitud y el índice único evitan duplicados incluso si una respuesta se pierde. El RPC valida el actor y conserva el emisor original, stock, seriales, comisiones y cálculos existentes.
2. 06_seguridad_facturas_vendedor.sql separa vistas de facturas/líneas sin costos y limita las lecturas de las tablas con costos al administrador. Sus vistas comprueban explícitamente el propietario de la factura. Actualiza las políticas dependientes de envíos/devoluciones y restringe el dashboard con utilidad al administrador. Conserva ventas_por_empleado consultando la vista neta segura, con el cálculo original. Rechaza la aplicación si RLS está deshabilitado o facturas_netas no respeta RLS.
3. Verificar previamente el esquema real, políticas adicionales, grants, propietarios de las vistas y cualquier RPC SECURITY DEFINER que devuelva costos. La migración rechaza políticas adicionales de lectura en las tablas protegidas para evitar una falsa garantía por reglas permisivas que se sumen por OR.
4. Validar en un entorno de prueba las relaciones de PostgREST con clientes/perfiles desde las vistas, lectura propia/cruzada, anulación autorizada, devoluciones, envío PDF, compras, finanzas y acceso completo Admin. Recargar el esquema de PostgREST tras revisar la migración.
5. Solo después de aplicar/validar 05, habilitar VITE_IDEMPOTENT_SALES=true en una fase autorizada. Solo después de aplicar/validar 06, habilitar VITE_SAFE_INVOICE_VIEWS=true. Ninguna de estas opciones fue activada aquí.

Con el backend actual sin esas capacidades, la app solicita columnas explícitas sin costos para vendedor. Ante una respuesta perdida sin ID verificable conserva la venta como incierta y permite comprobar/consultar documentos; bloquea una reemisión insegura. No afirma que la protección SQL remota esté desplegada ni que la proyección frontend sustituya RLS.

No se ejecutó SQL, despliegue, commit ni push.
