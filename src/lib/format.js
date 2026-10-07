// Fechas en hora de Bogotá (UTC-5, sin horario de verano)
const TZ = 'America/Bogota'
export const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO')
export const num = (n) => (Number(n) || 0).toLocaleString('es-CO')
export function hoyBogota() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
}
export function fechaHora(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('es-CO', { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
export function fecha(d) {
  if (!d) return ''
  const [y, m, dd] = String(d).slice(0, 10).split('-')
  return `${dd}/${m}/${y}`
}
export function rangoMes(offset = 0) {
  const [y, m] = hoyBogota().split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + offset, 1))
  const ini = d.toISOString().slice(0, 10)
  const fin = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10)
  const label = d.toLocaleDateString('es-CO', { timeZone: 'UTC', month: 'long', year: 'numeric' })
  return { ini, fin, label }
}
export const numFactura = (f) => `${f.prefijo}-${String(f.numero).padStart(4, '0')}`
export function limpiarBusqueda(q) {
  return String(q || '').trim().replace(/[%,()*]/g, ' ')
}
export function mensajeError(e) {
  const m = e?.message || String(e || '')
  if (/Invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.'
  if (/duplicate key.*codigo_barras/i.test(m)) return 'Ese código de barras ya existe.'
  if (/duplicate key.*codigo/i.test(m)) return 'Ese código de producto ya existe.'
  if (/duplicate key.*serial/i.test(m)) return 'Ese serial ya está registrado.'
  if (/duplicate key/i.test(m)) return 'Ya existe un registro con esos datos.'
  if (/row-level security|permission denied/i.test(m)) return 'No tienes permiso para esta acción.'
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Sin conexión. Revisa tu internet.'
  return m
}
