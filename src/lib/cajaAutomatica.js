import { cashRequest, cashSchemaMissing } from './cashRegister.js'

// Caja automática: al entrar en un día laboral nuevo se abre sola, siempre que la del día
// anterior esté cerrada. La base es el efectivo contado en el último cierre.
const diaBogota = fecha => new Date(fecha).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
export const hoyCaja = (ahora = new Date()) => diaBogota(ahora)
export const esCajaAutomatica = caja => String(caja?.request_id || '').startsWith('auto-')
// Mismo identificador para todo el local: si dos personas entran a la vez, se abre una sola caja
export const idCajaAutomatica = (local, dia) => `auto-${dia}-local-${local ?? 'principal'}`.slice(0, 100)

export function decidirCaja(estado, perfilId, hoy) {
  if (!estado) return { accion: 'nada' }
  const activa = estado.active
  if (activa) return diaBogota(activa.apertura_en) < hoy ? { accion: 'cerrar_pendiente', caja: activa } : { accion: 'nada', caja: activa }
  // Caja por local: cuenta la última caja del local (no importa quién la abrió)
  const delLocal = c => estado.local_id == null || c.local_id == null || String(c.local_id) === String(estado.local_id)
  const mias = (estado.history || []).filter(delLocal).sort((a, b) => Number(b.id) - Number(a.id))
  const ultima = mias[0]
  // Si hoy ya abrió y cerró su caja, no se vuelve a abrir sola
  if (ultima && diaBogota(ultima.apertura_en) === hoy) return { accion: 'nada' }
  // Base: la que se eligió al cerrar («dejar base»); en cierres antiguos, lo contado
  const base = ultima?.base_siguiente_cent ?? ultima?.contado_cent
  return { accion: 'abrir', inicial: Math.max(0, Number(base) || 0), anterior: ultima || null }
}

const clave = (perfilId, dia, local) => `angie:caja-auto:${perfilId}:${local ?? 'p'}:${dia}`
let enCurso = null

export async function abrirCajaDelDia(client, perfil, { local = null, ahora = new Date(), storage = globalThis.localStorage } = {}) {
  if (!client || !perfil?.id) return { accion: 'nada' }
  const hoy = hoyCaja(ahora)
  // 'angie:caja-auto:off' desactiva la apertura automática en este dispositivo (pruebas de apertura manual)
  try { if (storage?.getItem('angie:caja-auto:off') === '1' || storage?.getItem(clave(perfil.id, hoy, local)) === 'ok') return { accion: 'nada' } } catch { /* opcional */ }
  if (enCurso) return enCurso
  enCurso = (async () => {
    try {
      const estado = await cashRequest(client, 'caja_estado', local != null ? { p_local_id: local } : {})
      const d = decidirCaja(estado, perfil.id, hoy)
      if (d.accion === 'abrir') {
        d.id = await cashRequest(client, 'caja_abrir', { p_request_id: idCajaAutomatica(estado.local_id ?? local, hoy), p_inicial_cent: d.inicial, ...(local != null ? { p_local_id: local } : {}) })
      }
      if (d.accion !== 'cerrar_pendiente') { try { storage?.setItem(clave(perfil.id, hoy, local), 'ok') } catch { /* opcional */ } }
      return d
    } catch (e) {
      return { accion: cashSchemaMissing(e) ? 'sin_caja' : 'error', error: e }
    } finally { enCurso = null }
  })()
  return enCurso
}
