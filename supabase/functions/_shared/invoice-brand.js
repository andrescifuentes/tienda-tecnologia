// Normalize only legacy store branding; never apply this to products or third parties.
export function invoiceBrand(store = {}) {
  const name = String(store?.nombre || '').trim()
  return !name || /^angie tech$/i.test(name) || (!store?.nombre_personalizado && /^(techstore|techzone)$/i.test(name)) ? 'Angie Tech' : name
}
// El logo dorado es solo de Angie Tech; los demás negocios muestran su nombre
// Datos de la empresa que salen en la factura (Configuración › Datos de la empresa)
export const datosEmpresa = (store = {}) => [
  store?.nit && `NIT ${store.nit}`,
  [store?.direccion, store?.local].filter(Boolean).join(', ') || null,
  store?.telefono && `Tel. ${store.telefono}`,
  store?.correo,
  ...(Array.isArray(store?.datos_extra) ? store.datos_extra.filter(d => d?.valor).map(d => d.etiqueta ? `${d.etiqueta}: ${d.valor}` : d.valor) : []),
].filter(Boolean)
// Los mismos datos como [rótulo, valor] para mostrarlos ordenados en la factura
const conLocal = l => { const t = String(l || '').trim(); return !t ? '' : /^\d/.test(t) ? 'Local ' + t : t }
export const camposEmpresa = (store = {}) => [
  ['NIT', store?.nit],
  ['Dirección', [store?.direccion, conLocal(store?.local)].filter(Boolean).join(' · ')],
  ['Teléfono', store?.telefono],
  ['Correo', store?.correo],
  ...(Array.isArray(store?.datos_extra) ? store.datos_extra.filter(d => d?.valor).map(d => [d.etiqueta || 'Dato', d.valor]) : []),
].filter(([, v]) => v && String(v).trim())
export const isAngieBrand = (store = {}) => invoiceBrand(store) === 'Angie Tech'
export const brandSlug = (store = {}) => invoiceBrand(store).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'FACTURA'
