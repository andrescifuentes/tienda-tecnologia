// Historial de mercancía comprada a un proveedor. Solo lee compras reales existentes:
// no crea entradas de inventario, gastos ni pagos. Lo que no está registrado se omite.
import { withDeadline, cancellableQuery, requireData } from './asyncResult.js'

export const SUPPLIER_HISTORY_LIMIT = 200
const optional = async (query, signal) => { try { const rows = requireData(await cancellableQuery(query, signal)); return Array.isArray(rows) ? rows : [] } catch { return [] } }

export function supplierPeriod(kind, today) {
  const [y, m] = today.split('-').map(Number), iso = d => d.toISOString().slice(0, 10)
  if (kind === 'mes') return { desde: today.slice(0, 8) + '01', hasta: today }
  if (kind === '3m') return { desde: iso(new Date(Date.UTC(y, m - 3, 1))), hasta: today }
  if (kind === '12m') return { desde: iso(new Date(Date.UTC(y, m - 12, 1))), hasta: today }
  return { desde: null, hasta: null }
}

export async function loadSupplierHistory(client, { proveedorId, desde = null, hasta = null, productoId = null, signal } = {}) {
  if (desde && hasta && desde > hasta) throw Error('La fecha inicial no puede ser posterior a la final.')
  return withDeadline(async abort => {
    let q = client.from('compras_saldo').select('*').eq('proveedor_id', proveedorId)
    if (desde) q = q.gte('fecha', desde)
    if (hasta) q = q.lte('fecha', hasta)
    const compras = requireData(await cancellableQuery(q.order('fecha', { ascending: false }).order('id', { ascending: false }).limit(SUPPLIER_HISTORY_LIMIT), abort))
    if (!Array.isArray(compras)) throw Error('No se pudo consultar el historial de compras.')
    if (!compras.length) return { compras: [], productos: [], limitado: false }
    const ids = compras.map(c => c.id)
    const [items, pagos] = await Promise.all([
      cancellableQuery(client.from('compra_items').select('*').in('compra_id', ids), abort).then(requireData),
      cancellableQuery(client.from('pagos_proveedor').select('*').in('compra_id', ids).order('fecha', { ascending: true }), abort).then(requireData),
    ])
    if (!Array.isArray(items) || !Array.isArray(pagos)) throw Error('No se pudo consultar el detalle de las compras.')
    const productIds = [...new Set(items.map(i => i.producto_id))], itemIds = items.map(i => i.id)
    const people = [...new Set(compras.map(c => c.registrado_por ?? c.creado_por).filter(Boolean))]
    // Datos complementarios: si el rol no puede leerlos, se muestran como no disponibles.
    const [productos, perfiles, unidades] = await Promise.all([
      productIds.length ? optional(client.from('productos').select('id,nombre,codigo,maneja_serial').in('id', productIds), abort) : [],
      people.length ? optional(client.from('perfiles').select('id,nombre').in('id', people), abort) : [],
      itemIds.length ? optional(client.from('unidades_serializadas').select('id,serial,estado,compra_item_id').in('compra_item_id', itemIds), abort) : [],
    ])
    const productName = id => productos.find(p => String(p.id) === String(id))?.nombre || 'Producto #' + id
    const rows = compras.map(c => {
      const lineas = items.filter(i => String(i.compra_id) === String(c.id)).map(i => ({ id: i.id, producto_id: i.producto_id, nombre: productName(i.producto_id), cantidad: Number(i.cantidad), costo_unitario: Number(i.costo_unitario), subtotal: Number(i.cantidad) * Number(i.costo_unitario), seriales: unidades.filter(u => String(u.compra_item_id) === String(i.id)).map(u => u.serial) }))
      const abonos = pagos.filter(p => String(p.compra_id) === String(c.id)), pagado = abonos.reduce((n, p) => n + Number(p.monto || 0), 0)
      const saldo = c.saldo == null || c.saldo === '' || !Number.isFinite(Number(c.saldo)) ? null : Number(c.saldo)
      const responsableId = c.registrado_por ?? c.creado_por ?? null
      return { ...c, saldo, lineas, pagos: abonos, pagado, metodos: [...new Set(abonos.map(p => p.metodo_pago).filter(Boolean))],
        estado_pago: c.estado === 'anulada' ? 'Anulada' : saldo == null ? 'Saldo no disponible' : saldo <= 0 ? 'Pagada' : pagado > 0 ? 'Abonada' : 'Pendiente',
        responsable: responsableId ? perfiles.find(p => p.id === responsableId)?.nombre || null : null }
    })
    const productosComprados = productIds.map(id => ({ id, nombre: productName(id) })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    const filtradas = productoId ? rows.filter(c => c.lineas.some(l => String(l.producto_id) === String(productoId))) : rows
    return { compras: filtradas, productos: productosComprados, limitado: compras.length >= SUPPLIER_HISTORY_LIMIT }
  }, { signal })
}

export function supplierHistoryTotals(compras, productoId = null) {
  const vigentes = compras.filter(c => c.estado !== 'anulada'), lineas = vigentes.flatMap(c => c.lineas).filter(l => !productoId || String(l.producto_id) === String(productoId))
  return { compras: vigentes.length, unidades: lineas.reduce((n, l) => n + l.cantidad, 0), costo: lineas.reduce((n, l) => n + l.subtotal, 0), saldo: vigentes.reduce((n, c) => n + Math.max(0, c.saldo || 0), 0) }
}
