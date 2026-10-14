// Normalize only legacy store branding; never apply this to products or third parties.
export function invoiceBrand(store = {}) {
  const name = String(store?.nombre || '').trim()
  return !name || /^angie tech$/i.test(name) || (!store?.nombre_personalizado && /^(techstore|techzone)$/i.test(name)) ? 'Angie Tech' : name
}
