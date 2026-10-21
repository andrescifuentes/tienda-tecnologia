
// Locales (sedes) del negocio. Catálogo, precios, proveedores y clientes son compartidos;
// el stock, las ventas y la caja van por local. Si la base de datos todavía no tiene
// locales (script 16 sin ejecutar) todo funciona como antes, con un solo local.
export const EVENTO_LOCALES = 'locales-cambio'
export const TODOS = 'todos'
const CLAVE_SELECCION = 'angie:local-seleccion'

let cache = null, pendiente = null, dueno = null
export function limpiarCacheLocales() { cache = null; pendiente = null }
export const cacheLocales = () => cache
export function duenoLocales(id) { if (dueno !== id) { limpiarCacheLocales(); dueno = id } }

export async function cargarLocales(client, { forzar = false } = {}) {
  if (cache && !forzar) return cache
  if (pendiente && !forzar) return pendiente
  pendiente = (async () => {
    try {
      const { data, error } = await client.from('locales').select('*').order('id')
      if (error) throw error
      cache = { habilitado: true, todos: data || [] }
    } catch { cache = { habilitado: false, todos: [] } }
    pendiente = null
    return cache
  })()
  return pendiente
}

export function avisarCambioLocales() {
  limpiarCacheLocales()
  window.dispatchEvent(new Event(EVENTO_LOCALES))
}

export function leerSeleccion() {
  try { return localStorage.getItem(CLAVE_SELECCION) || TODOS } catch { return TODOS }
}
export function guardarSeleccion(valor) {
  try { localStorage.setItem(CLAVE_SELECCION, String(valor)) } catch { /* preferencia opcional */ }
  window.dispatchEvent(new Event(EVENTO_LOCALES))
}

// Stock de cada producto por local: { [producto_id]: { [local_id]: n } }
export async function cargarStockLocales(client, ids) {
  let q = client.from('stock_local').select('producto_id,local_id,stock')
  if (ids?.length) q = q.in('producto_id', ids)
  const { data, error } = await q
  if (error) return null
  const mapa = {}
  for (const r of data || []) (mapa[r.producto_id] ||= {})[r.local_id] = Number(r.stock) || 0
  return mapa
}

export const nombreLocal = (locales, id) => locales.find(l => String(l.id) === String(id))?.nombre || 'Local'

// Factura: dirección y teléfono del local que vendió (si el local los tiene)
export function tiendaConLocal(tienda, local, { mostrarNombre = true } = {}) {
  if (!local) return tienda
  const t = { ...(tienda || {}) }
  if (local.direccion?.trim()) t.direccion = local.direccion
  if (local.numero?.trim()) t.local = local.numero
  if (local.telefono?.trim()) t.telefono = local.telefono
  if (mostrarNombre) t.sede = local.nombre
  return t
}
