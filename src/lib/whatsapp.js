export function soloDigitos(t) { return String(t || '').replace(/\D/g, '') }
export function enlaceWhatsApp(telefono, texto) {
  let d = soloDigitos(telefono)
  if (d.length === 10) d = '57' + d // Colombia
  return `https://wa.me/${d}?text=${encodeURIComponent(texto)}`
}
