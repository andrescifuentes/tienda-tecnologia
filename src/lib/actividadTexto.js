import { money } from './format.js'

// Convierte un registro técnico de «actividad» en una frase clara para el administrador.
const PERMISOS = { vender: 'Vender', ver_inventario: 'Ver inventario', editar_inventario: 'Editar inventario', editar_precios: 'Cambiar precios y descuentos', ver_costos: 'Ver costos', crear_clientes: 'Crear clientes', hacer_devoluciones: 'Hacer devoluciones', anular_facturas: 'Anular facturas', registrar_compras: 'Registrar compras', ver_finanzas: 'Ver finanzas' }
const TABLAS = { productos: ['Producto', 'box'], perfiles: ['Empleado', 'users'], clientes: ['Cliente', 'users'], proveedores: ['Proveedor', 'truck'], movimientos: ['Movimiento de caja', 'cash'] }
const AJUSTES = { ajuste_entrada: 'Entrada', ajuste_salida: 'Salida', devolucion_proveedor: 'Devolución a proveedor' }
const numero = n => { const m = /^([A-Za-z]+)-?(\d+)$/.exec(String(n || '')); return m ? `${m[1]}-${m[2].padStart(4, '0')}` : String(n || '') }

export function describirActividad(a) {
  const d = a?.detalle || {}
  const [accion, tipo] = String(a?.accion || '').split('.')
  switch (a?.accion) {
    case 'factura.emitida': return { titulo: `Venta ${numero(d.numero)}`, detalle: [d.total != null ? money(d.total) : '', d.local].filter(Boolean).join(' · '), icono: 'cart', tono: 'good', to: '/facturas?factura=' + a.entidad_id }
    case 'factura.anulada': return { titulo: `Factura anulada ${numero(d.numero)}`, detalle: d.motivo || '', icono: 'doc', tono: 'bad', to: '/facturas?factura=' + a.entidad_id }
    case 'factura.devolucion': return { titulo: `Devolución en ${numero(d.factura)}`, detalle: d.total_devuelto != null ? money(d.total_devuelto) : '', icono: 'back', tono: 'warn' }
    case 'factura.otro_local': return { titulo: `Venta ${numero(d.numero)} con stock de otro local`, detalle: (d.items || []).map(i => `${i.cantidad} × ${i.producto} desde ${i.local}`).join(' · '), icono: 'cart', tono: 'warn', to: '/facturas?factura=' + a.entidad_id }
    case 'inventario.traslado': return { titulo: 'Traslado entre locales', detalle: [d.cantidad != null ? `${d.cantidad} × ${d.producto || 'producto'}` : d.producto, d.origen && d.destino ? `${d.origen} → ${d.destino}` : '', d.motivo].filter(Boolean).join(' · '), icono: 'truck', tono: '' }
    case 'compra.registrada': return { titulo: 'Ingreso de mercancía', detalle: d.total != null ? money(d.total) : '', icono: 'truck', tono: '', to: '/proveedores?compra=' + a.entidad_id }
    case 'compra.pago': return { titulo: 'Pago a proveedor', detalle: d.monto != null ? money(d.monto) : '', icono: 'cash', tono: '' }
    case 'inventario.ajuste': return { titulo: 'Ajuste de inventario', detalle: [AJUSTES[d.tipo] || 'Ajuste', d.cantidad != null ? d.cantidad + (Number(d.cantidad) === 1 ? ' unidad' : ' unidades') : '', d.motivo].filter(Boolean).join(' · '), icono: 'box', tono: 'warn' }
    case 'empleado.acceso_restablecido': return { titulo: 'Restableció el acceso de un vendedor', detalle: [d.correo_cambiado && 'correo nuevo', d.clave_cambiada && 'contraseña nueva'].filter(Boolean).join(' y '), icono: 'lock', tono: '' }
    case 'registro.administrador': return { titulo: 'Se registró como administrador', detalle: d.correo || '', icono: 'shield', tono: '' }
    case 'registro.negocio': return { titulo: 'Creó el negocio', detalle: d.negocio || '', icono: 'home', tono: 'good' }
    case 'registro.codigo_cambiado': return { titulo: 'Cambió el código de registro', detalle: '', icono: 'shield', tono: '' }
    case 'permiso.otorgado': return { titulo: 'Permiso otorgado', detalle: PERMISOS[d.permiso] || d.permiso || '', icono: 'shield', tono: 'good' }
    case 'permiso.retirado': return { titulo: 'Permiso retirado', detalle: PERMISOS[d.permiso] || d.permiso || '', icono: 'shield', tono: 'bad' }
  }
  const tabla = TABLAS[accion]
  if (tabla && ['insert', 'update', 'delete'].includes(tipo)) {
    const fila = d.despues || d.antes || {}
    const verbo = tipo === 'insert' ? (accion === 'movimientos' ? 'registrado' : 'creado') : tipo === 'update' ? 'actualizado' : 'eliminado'
    const nombre = accion === 'movimientos' ? [fila.tipo === 'gasto' ? 'Gasto' : fila.tipo === 'ingreso' ? 'Ingreso' : '', fila.categoria, fila.monto != null ? money(fila.monto) : ''].filter(Boolean).join(' · ') : fila.nombre || ''
    const cambios = tipo === 'update' && d.antes && d.despues ? cambiosDe(d.antes, d.despues) : ''
    return { titulo: `${tabla[0]} ${verbo}`, detalle: [nombre, cambios].filter(Boolean).join(' · '), icono: tabla[1], tono: tipo === 'delete' ? 'bad' : '' }
  }
  const legible = String(a?.accion || 'Actividad').replace(/[._]/g, ' ')
  return { titulo: legible.charAt(0).toUpperCase() + legible.slice(1), detalle: '', icono: 'chart', tono: '' }
}

const CAMPOS = { nombre: 'nombre', telefono: 'teléfono', correo: 'correo', activo: 'estado', rol: 'rol', precio_venta: 'precio', precio_compra: 'costo', stock_min: 'stock mínimo', categoria_id: 'categoría', marca: 'marca', direccion: 'dirección', documento: 'documento', foto_url: 'foto' }
function cambiosDe(antes, despues) {
  const lista = Object.keys(CAMPOS).filter(k => k in despues && JSON.stringify(antes[k]) !== JSON.stringify(despues[k]))
  if (lista.includes('activo')) return despues.activo ? 'activado' : 'desactivado'
  return lista.length ? 'cambió ' + lista.slice(0, 3).map(k => CAMPOS[k]).join(', ') : ''
}
