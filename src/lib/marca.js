import { invoiceBrand, isAngieBrand } from '../../supabase/functions/_shared/invoice-brand.js'

// Marca del negocio que inició sesión, o del último negocio usado en este equipo (pantalla de entrada)
const CLAVE = 'angie:negocio'
export const nombreNegocio = tienda => invoiceBrand(tienda || {})
export const esMarcaAngie = tienda => isAngieBrand(tienda || {})
export function recordarNegocio(tienda) {
  if (!tienda?.id) return
  try { localStorage.setItem(CLAVE, JSON.stringify({ id: tienda.id, nombre: nombreNegocio(tienda), logo_url: tienda.logo_url || null })) } catch { /* preferencia opcional */ }
}
export function negocioRecordado() {
  try { const t = JSON.parse(localStorage.getItem(CLAVE) || 'null'); return t?.nombre ? t : null } catch { return null }
}
