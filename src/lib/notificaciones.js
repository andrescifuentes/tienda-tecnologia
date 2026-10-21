import { money, numFactura } from './format.js'

// Avisos de la campana (modo real). Las leídas se guardan en este celular, por usuario.
export const EVENTO_LEIDAS = 'notificaciones-leidas'
const numeroCorto = n => { const m = /^([A-Za-z]+)-?(\d+)$/.exec(String(n || '')); return m ? `${m[1]}-${m[2].padStart(4, '0')}` : String(n || '') }
const clave = perfilId => 'angie:notif-leidas:' + perfilId
const DIAS = 7

export function leidasDe(perfilId) {
  if (!perfilId) return new Set()
  try { return new Set(JSON.parse(localStorage.getItem(clave(perfilId)) || '[]')) } catch { return new Set() }
}

export function marcarLeidas(perfilId, ids) {
  if (!perfilId || !ids?.length) return
  const todas = [...leidasDe(perfilId), ...ids].slice(-400)
  try { localStorage.setItem(clave(perfilId), JSON.stringify([...new Set(todas)])) } catch { /* preferencia opcional */ }
  window.dispatchEvent(new Event(EVENTO_LEIDAS))
}

// Lo que ve cada uno lo decide la base de datos: el vendedor solo recibe sus ventas.
export async function cargarNotificaciones(client, { esAdmin, puedeCompras, ahora = Date.now(), signal }) {
  const desde = new Date(ahora - DIAS * 864e5).toISOString()
  const read = query => signal && query.abortSignal ? query.abortSignal(signal) : query
  const [prods, facts, comps, otros] = await Promise.all([
    esAdmin
      ? read(client.from('productos').select('id,codigo,nombre,stock,stock_min').eq('activo', true))
      : read(client.from('productos_venta').select('id,codigo,nombre,stock,stock_min')),
    read(client.from('facturas').select('id,prefijo,numero,total,estado,fecha,anulada_en,clientes(nombre)').gte('fecha', desde).order('fecha', { ascending: false }).limit(10)),
    puedeCompras
      ? read(client.from('compras').select('id,total,estado,creado_en,proveedores(nombre)').gte('creado_en', desde).order('creado_en', { ascending: false }).limit(5))
      : Promise.resolve({ data: [] }),
    // Ventas con productos de otro local (para coordinar la entrega)
    esAdmin
      ? read(client.from('actividad').select('id,accion,entidad_id,detalle,fecha').eq('accion', 'factura.otro_local').gte('fecha', desde).order('fecha', { ascending: false }).limit(10)).then(r => r, () => ({ data: [] }))
      : Promise.resolve({ data: [] }),
  ])
  const error = prods.error || facts.error || comps.error
  if (error) throw error
  const stock = (prods.data || []).filter(p => p.stock <= p.stock_min)
    .sort((a, b) => a.stock - b.stock)
    .map(p => ({ id: `stock:${p.id}:${p.stock}`, title: p.stock === 0 ? 'Producto agotado' : 'Stock bajo', text: `${p.nombre} · ${p.stock} ${p.stock === 1 ? 'unidad' : 'unidades'}`, to: '/inventario?q=' + encodeURIComponent(p.codigo), tone: p.stock === 0 ? 'bad' : 'warn', fecha: '' }))
  const movimientos = [
    ...(facts.data || []).map(f => f.estado === 'anulada'
      ? { id: `anulada:${f.id}`, title: `Factura anulada ${numFactura(f)}`, text: `${f.clientes?.nombre || 'Consumidor final'} · ${money(f.total)}`, to: '/facturas?factura=' + f.id, tone: 'bad', fecha: f.anulada_en || f.fecha }
      : { id: `venta:${f.id}`, title: `Venta ${numFactura(f)}`, text: `${f.clientes?.nombre || 'Consumidor final'} · ${money(f.total)}`, to: '/facturas?factura=' + f.id, tone: 'good', fecha: f.fecha }),
    ...(otros?.error ? [] : otros?.data || []).map(a => ({ id: `otro-local:${a.id}`, title: `Venta ${numeroCorto(a.detalle?.numero)} con stock de otro local`, text: (a.detalle?.items || []).map(i => `${i.cantidad} × ${i.producto} desde ${i.local}`).join(' · ') + (a.detalle?.local ? ` · vendida en ${a.detalle.local}` : ''), to: '/facturas?factura=' + a.entidad_id, tone: 'warn', fecha: a.fecha })),
    ...(comps.data || []).filter(c => c.estado !== 'anulada').map(c => ({ id: `compra:${c.id}`, title: 'Ingreso de mercancía', text: `${c.proveedores?.nombre || 'Proveedor'} · ${money(c.total)}`, to: '/proveedores?compra=' + c.id, tone: '', fecha: c.creado_en })),
  ].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).slice(0, 12)
  return [...stock, ...movimientos]
}
