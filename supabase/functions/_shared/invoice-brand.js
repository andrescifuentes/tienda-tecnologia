// Normalize only legacy store branding; never apply this to products or third parties.
export function invoiceBrand(store = {}) {
  const name = String(store?.nombre || '').trim()
  return !name || /^angie tech$/i.test(name) || (!store?.nombre_personalizado && /^(techstore|techzone)$/i.test(name)) ? 'Angie Tech' : name
}
// El logo dorado es solo de Angie Tech; los demás negocios muestran su nombre
export const isAngieBrand = (store = {}) => invoiceBrand(store) === 'Angie Tech'
export const brandSlug = (store = {}) => invoiceBrand(store).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'FACTURA'
