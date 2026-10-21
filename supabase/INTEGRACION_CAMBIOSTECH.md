# Integración local con cambiostech

Se prioriza el modelo de Andrés: negocios separados, registro/accesos, mensaje_factura, enlaces públicos y presentación de factura. Se conservan reportes, conciliación neta, caja operativa y salidas de postventa sin anular ventas.

No se ejecutó SQL remoto ni se desplegaron servicios. Los archivos SQL son preparación para revisión; no deben ejecutarse por orden alfabético sin comprobar los requisitos.

- Mantener la secuencia de Andrés: 10_multi_negocio, 11_enlace_factura, 12_mensaje_factura, 13_precio_especial, 14_venta_sin_cliente y 15_datos_empresa.
- La extensión 13_datos_empresa.sql se revisa DESPUÉS de 10 y 15. Usa mi_negocio(), conserva local/datos_extra y añade identidad histórica de futuras facturas. El enlace público mantiene token y vencimiento y solo expone campos empresariales públicos del snapshot.
- 14_caja.sql también requiere el modelo de 10/15. Políticas, consultas y locks se limitan al negocio autenticado; un administrador de otro negocio no puede operar cajas ajenas. No se alteran las políticas de tablas existentes.
- 07_correo_facturas y 12_plantillas_mensajes permanecen pendientes de activación. La preparación de correo comprueba que actor y factura sean del mismo negocio; las plantillas anteriores solo son compatibilidad para esquemas sin mensaje_factura. El mensaje vigente de Andrés tiene prioridad, incluido restaurarlo al original.
- Los enlaces de WhatsApp usan la ruta pública /f/token por HTTPS. No se introducen URLs firmadas de Storage en los mensajes.
- El correo automático requiere su activación explícita y configuración del proveedor; esta integración no activa Resend.

La validación de SQL se realiza exclusivamente en PGlite local, con dos negocios, permisos, cierres, snapshots y rechazo de accesos cruzados. La comprobación física de Safari sigue correspondiendo al dispositivo real.
