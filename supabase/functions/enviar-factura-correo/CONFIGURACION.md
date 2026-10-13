# Activación pendiente (sin deploy ni SQL remoto realizado)

Proyecto revisado: baowsvrfihsimnptxuxi. Solo existe crear-empleado. No se detectaron RESEND_API_KEY ni INVOICE_EMAIL_FROM en los nombres de secrets.

1. Crear o reutilizar una cuenta Resend, verificar un dominio propio con sus DNS y elegir un remitente de ese dominio. La app no inventa un dominio/remitente verificado.
2. Revisar y autorizar supabase/07_correo_facturas.sql. Agrega registros de correo privados, RPC exclusivas de service_role y snapshots para futuras facturas. No modifica las políticas existentes ni recalcula ventas. Los contactos/negocio originales de facturas antiguas sin snapshot no se pueden recuperar: el preview lo advierte.
3. Configurar exclusivamente en Supabase Secrets: RESEND_API_KEY e INVOICE_EMAIL_FROM (remitente verificado). SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya aparecen entre los nombres del proyecto. Nunca usar VITE_ ni guardar keys en frontend.
4. Tras autorización, desplegar únicamente enviar-factura-correo. El handler verifica el JWT con Auth además de la validación de la plataforma.
5. En modo real, abrir una factura propia emitida, confirmar un destinatario autorizado para la prueba y comprobar la aceptación en Resend y el PDF recibido. Revisar spam. Probar doble clic y reintento: deben recuperar el mismo envioId/proveedorId.

Límites: PDF 3 MiB, 5 intentos/minuto y 30/día por actor, 3 destinatarios distintos/factura/día. Un envío aceptado no se repite para el mismo destinatario. Reintentos ambiguos usan el mismo payload y clave Resend; los intentos al proveedor sin aceptaci?n, despu?s de 23 horas, exigen revisión manual, evitando duplicar un correo cuando caduque la clave del proveedor. No se implementan webhooks de entrega: aceptado no significa entregado.

PDF: renderizador compartido con el frontend y logo oficial incrustado. Ningún PDF, precio, total, plantilla o remitente procede del navegador. El frontend solo envía ID y destinatario. El modo demo muestra alternativas y nunca informa un envío real exitoso.
