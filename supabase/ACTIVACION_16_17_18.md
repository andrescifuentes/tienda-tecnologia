# Activación pendiente: QR de transferencia, cierre diario e IMEI

Preparado localmente. **No se ejecutó SQL remoto ni se modificó Supabase.** Revisar en staging antes de producción.

## Orden y dependencias

| Script | Requiere antes | Qué agrega |
|---|---|---|
| `16_medios_transferencia.sql` | 10 | Tabla `medios_transferencia` (nombre, logo, QR, cuenta, orden, activo), RLS, columnas `facturas.medio_transferencia_id` / `medio_transferencia` y RPC `factura_registrar_medio_transferencia`. |
| `17_cierre_caja_diario.sql` | 10, 15 y **14** (+13 si se usa) | Permiso `cerrar_caja`, tabla `caja_cierres_diarios`, RPC `caja_dia_estado`, `caja_cerrar_dia`, `caja_cierres_dia`. Redefine `caja_cerrar` para exigir el permiso. |
| `18_imei_unidades.sql` | 10 | `productos.tipo_serial`, `productos.atributos`, `unidades_serializadas.atributos`, trigger de validación IMEI, RPC `unidad_actualizar_atributos`. |

16 y 18 son independientes entre sí. 17 lee el medio de transferencia si 16 existe, pero no lo exige.
Siguen pendientes de antes: `13_datos_empresa.sql` y `14_caja.sql`. Resend/correo automático no forma parte de estos scripts.

## Comportamiento antes de activar

- **QR**: el vendedor ve «Códigos QR pendientes de activación» y puede cobrar por transferencia como hasta ahora. Configuración muestra el mismo aviso y no guarda nada.
- **Cierre diario**: la pestaña muestra «pendiente de activación». El permiso «Puede realizar cierre de caja» no se puede guardar (se avisa y **no** se borran los permisos actuales).
- **Turnos de caja**: la interfaz ya oculta «Cerrar caja» a vendedores sin el permiso; el servidor solo lo exige después de aplicar 17.
- **IMEI**: el formulario solo envía `tipo_serial`/`atributos` cuando el usuario los usa; los productos sin IMEI se guardan igual que antes.

## Notas de seguridad y datos

- QR y logo: PNG/JPG validados por tipo real (cabecera) y tamaño (QR ≤ 300 KB, logo ≤ 100 KB) en el navegador **y** en una restricción SQL. Solo el administrador escribe (RLS); vendedores con `vender` leen únicamente medios activos de su negocio.
- Un medio usado en una venta no se puede borrar (`on delete restrict`); se desactiva. La factura conserva id y nombre congelado.
- Elegir un QR no registra pagos: la venta sigue usando `emitir_factura`/`emitir_factura_segura` sin cambios de firma. El medio se anota después, una sola vez, y solo en facturas por transferencia del propio vendedor (o del administrador).
- Cierre diario: zona `America/Bogota`, centavos enteros, un cierre por día y alcance (negocio o responsable), idempotente por `request_id`, rechaza si cambió la «huella» del día o hay turnos abiertos. No modifica facturas, inventario ni Finanzas.
- `permiso_tipo` recibe un valor nuevo; el script solo lo usa dentro de funciones plpgsql para poder ejecutarse completo en el editor de Supabase.
- La función Edge `crear-empleado` no se modificó: el permiso de cierre se otorga desde la ficha del empleado, no al crearlo.
- IMEI: el trigger valida 15 dígitos + dígito verificador solo para productos marcados como IMEI y solo en unidades nuevas o seriales modificados; los seriales existentes no se revalidan. Unicidad por negocio también contra el IMEI 2.

## Verificación sugerida en staging

1. Admin crea dos medios con QR; vendedor solo ve los activos; vendedor no puede insertar/actualizar (`select * from medios_transferencia` como vendedor).
2. Venta por transferencia con QR → `facturas.medio_transferencia` con el nombre; intentar borrar ese medio debe fallar.
3. Vendedor sin `cerrar_caja`: `caja_dia_estado` y `caja_cerrar` devuelven 42501. Con el permiso: solo su alcance.
4. Cierre del día con efectivo/transferencia/tarjeta conocidos; repetir el cierre debe fallar.
5. Compra con un IMEI inválido debe fallar; con IMEI válido con espacios se guarda normalizado.
