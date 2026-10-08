// Only explicit loopback hosts, RFC1918 IPv4 addresses, or HTTPS are allowed.
// Do not infer permission from isSecureContext or an available crypto API.
export function esEntornoDemoPermitido(location = globalThis.location) {
  if (!location || typeof location.hostname !== 'string' || !location.hostname) return false
  if (location.protocol === 'https:') return true
  if (location.protocol !== 'http:') return false
  const host = location.hostname.toLowerCase()
  if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) return true
  if (!/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(host)) return false
  const octets = host.split('.').map(Number)
  if (octets.some(n => n > 255)) return false
  return octets[0] === 10 ||
    octets[0] === 192 && octets[1] === 168 ||
    octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31
}

export function exigirEntornoDemoPermitido(location = globalThis.location) {
  if (!esEntornoDemoPermitido(location)) {
    throw new Error('Para acceder a la demo usa localhost, una IP privada de tu red local o HTTPS. Los hosts HTTP públicos están bloqueados.')
  }
}
