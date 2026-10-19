# Datos de la empresa — activación pendiente

El editor funciona con persistencia demo local por navegador/origen. En modo conectado consulta la tienda actual; si falta el RPC informa que no se guardó, sin fingir sincronización.

Revisar y autorizar 13_datos_empresa.sql para el esquema de tienda única id=1 antes de aplicar. Añade campos empresariales, RPC de guardado exclusiva de administrador activo y snapshot para facturas futuras; no modifica RLS, importes, transacciones ni documentos existentes. La lectura opcional empresa_factura_snapshot verifica usuario activo y factura propia o administrador. No requiere Storage: el logo se normaliza y guarda PNG/JPEG hasta 256 KB, sin URL externa ni SVG.

Las facturas con snapshot conservan los datos y logo congelados. Facturas antiguas sin snapshot no permiten reconstruir la identidad pasada: se usa información disponible con aviso. En vistas antiguas de vendedor, la lectura segura del snapshot requiere activar este SQL. No altera la plantilla vigente de mensajes ni los consecutivos.

No activa facturación electrónica DIAN ni Resend. No se ejecutó SQL, deploy ni cambios remotos en esta fase.
