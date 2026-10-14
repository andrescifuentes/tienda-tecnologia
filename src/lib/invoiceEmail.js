import { invoiceBrand } from '../../supabase/functions/_shared/invoice-brand.js'
import { money, numFactura } from './format.js'

export function validarCorreoFactura(value) {
  const email = String(value || '').trim()
  if (!email) return 'El cliente no tiene un correo registrado. Puedes escribir uno o descargar la factura.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Revisa el correo del destinatario.'
  return ''
}

export function crearBorradorCorreoFactura({ invoice, correo = '', detalle = '', tienda } ) {
  const destino = String(correo || '').trim()
  const number = numFactura(invoice)
  const nombre = invoice.clientes?.nombre?.trim().split(/\s+/)[0]
  const brand = invoiceBrand(invoice.tienda_snapshot || tienda)
  const asunto = 'Factura ' + number + ' - ' + brand
  const cuerpo = [
    nombre ? 'Hola ' + nombre + ',' : 'Hola,', '',
    'Gracias por tu compra en ' + brand + '.',
    'Te compartimos la factura ' + number + ' correspondiente a tu compra por ' + money(invoice.total) + '.', '',
    detalle ? detalle.replace(/\*/g, '') + '\n' : '',
    'Si tienes alguna pregunta sobre tu compra, estaremos encantados de ayudarte.', '',
    'Saludos,', brand,
  ].join('\n')
  const url = validarCorreoFactura(destino) ? '' : 'mailto:' + encodeURIComponent(destino) + '?subject=' + encodeURIComponent(asunto) + '&body=' + encodeURIComponent(cuerpo)
  return { canal: 'correo', destino, asunto, cuerpo, adjuntoManual: true, url }
}

// An OS protocol hand-off does not acknowledge opening an app or sending mail.
// Keep the caller's page and its fallback visible; never create another window.
export function abrirCorreoFactura(envio, navigate = globalThis.window?.location?.assign.bind(globalThis.window.location)) {
  const invalid = validarCorreoFactura(envio?.destino)
  if (invalid) throw new Error(invalid)
  if (!envio?.url?.startsWith('mailto:')) throw new Error('Prepara el mensaje antes de abrir tu correo.')
  if (!navigate) return 'unavailable'
  try { navigate(envio.url); return 'requested' }
  catch { return 'unavailable' }
}

export const EMAIL_PROVIDER_KEY = 'angie:email-provider'
export const EMAIL_PROVIDERS = Object.freeze([
  { id: 'gmail', label: 'Gmail', detail: 'Compositor web de Gmail' },
  { id: 'outlook', label: 'Outlook', detail: 'Compositor web de Outlook' },
  { id: 'system', label: 'Aplicación del sistema', detail: 'La aplicación de correo configurada en tu dispositivo' },
])
export const esProveedorCorreo = provider => EMAIL_PROVIDERS.some(p => p.id === provider)
export function leerProveedorCorreo(storage) {
  try { const value = (storage ?? globalThis.localStorage)?.getItem(EMAIL_PROVIDER_KEY); return esProveedorCorreo(value) ? value : null } catch { return null }
}
export function guardarProveedorCorreo(provider, storage) {
  if (!esProveedorCorreo(provider)) throw new Error('Elige un proveedor de correo válido.')
  try { (storage ?? globalThis.localStorage).setItem(EMAIL_PROVIDER_KEY, provider); return true } catch { return false }
}
// iPadOS can identify as a desktop Mac; touch support distinguishes it from macOS.
export function esIOSCorreo(navigator = globalThis.navigator) {
  return /iPhone|iPad|iPod/i.test(navigator?.userAgent || '') || (/Mac/i.test(navigator?.platform || navigator?.userAgent || '') && navigator?.maxTouchPoints > 1)
}
export function enlaceCompositorCorreo(draft, provider, { ios = esIOSCorreo(), gmailWeb = false } = {}) {
  const invalid = validarCorreoFactura(draft?.destino)
  if (invalid) throw new Error(invalid)
  if (!esProveedorCorreo(provider)) throw new Error('Elige un proveedor de correo.')
  const encoded = value => encodeURIComponent(String(value || ''))
  if (provider === 'system') return 'mailto:' + encoded(draft.destino) + '?subject=' + encoded(draft.asunto) + '&body=' + encoded(draft.cuerpo)
  if (provider === 'gmail' && ios && !gmailWeb) return 'googlegmail:///co?to=' + encoded(draft.destino) + '&subject=' + encoded(draft.asunto) + '&body=' + encoded(draft.cuerpo)
  if (provider === 'gmail') return 'https://mail.google.com/mail/?view=cm&fs=1&to=' + encoded(draft.destino) + '&su=' + encoded(draft.asunto) + '&body=' + encoded(draft.cuerpo)
  return 'https://outlook.live.com/mail/0/deeplink/compose?to=' + encoded(draft.destino) + '&subject=' + encoded(draft.asunto) + '&body=' + encoded(draft.cuerpo)
}
export function abrirCompositorCorreo(draft, provider, { open = globalThis.window?.open?.bind(globalThis.window), navigate, ios = esIOSCorreo(), gmailWeb = false } = {}) {
  const url = enlaceCompositorCorreo(draft, provider, { ios, gmailWeb })
  if (provider === 'system') return abrirCorreoFactura({ ...draft, url }, navigate)
  if (provider === 'gmail' && ios && !gmailWeb) {
    const handoff = navigate === undefined ? globalThis.window?.location?.assign.bind(globalThis.window.location) : navigate
    if (!handoff) return 'unavailable'
    try { handoff(url); return 'attempted' } catch { return 'unavailable' }
  }
  if (!open) return 'unavailable'
  try {
    // One user gesture, one complete compose URL. Never reserve an empty tab.
    const popup = open(url, '_blank')
    if (!popup) return 'unavailable'
    try { popup.opener = null } catch { /* COOP may sever an already-opened provider window. */ }
    return 'requested'
  } catch { return 'unavailable' }
}

// A visible Safari page after the attempt suggests offering alternatives, not
// proof that Gmail is absent. Stop observing when the page actually backgrounds.
export function vigilarAperturaGmailIOS(onFallback, { window = globalThis.window, document = globalThis.document, timeoutMs = 1800 } = {}) {
  let stopped = false, timer
  function stop() {
    stopped = true; clearTimeout(timer)
    document?.removeEventListener('visibilitychange', visibility)
    window?.removeEventListener('pagehide', stop)
  }
  function visibility() { if (document?.visibilityState === 'hidden') stop() }
  document?.addEventListener('visibilitychange', visibility)
  window?.addEventListener('pagehide', stop)
  timer = setTimeout(() => { if (!stopped) { const visible = document?.visibilityState !== 'hidden'; stop(); if (visible) onFallback() } }, timeoutMs)
  return stop
}

// Clipboard can be absent on LAN HTTP, denied, or stall. None may block delivery.
export async function copiarTextoFactura(text, { navigator = globalThis.navigator, document = globalThis.document, timeoutMs = 2000 } = {}) {
  if (!String(text || '').trim()) return 'manual'
  if (navigator?.clipboard?.writeText) {
    let timer
    try {
      await Promise.race([
        navigator.clipboard.writeText(String(text)),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Clipboard unavailable')), timeoutMs) }),
      ])
      return 'copied'
    } catch { /* Use the local selection fallback, including on HTTP LAN. */ }
    finally { clearTimeout(timer) }
  }
  let field
  const previous = document?.activeElement
  try {
    if (!document?.execCommand) return 'manual'
    field = document.createElement('textarea')
    field.value = String(text); field.readOnly = true
    field.setAttribute('inputmode', 'none'); field.setAttribute('aria-hidden', 'true'); field.tabIndex = -1
    Object.assign(field.style, { position: 'fixed', top: '0', left: '0', width: '1px', height: '1px', opacity: '0' })
    // A textarea appended under #root would be inert while the invoice dialog is open.
    const dialogs = document.querySelectorAll?.('[data-app-dialog]')
    ;(dialogs?.[dialogs.length - 1] || document.body).append(field)
    field.focus({ preventScroll: true }); field.select(); field.setSelectionRange(0, field.value.length)
    return document.execCommand('copy') ? 'copied' : 'manual'
  } catch { return 'manual' }
  finally {
    field?.remove()
    if (previous?.isConnected && !previous.matches?.('input,textarea,select')) previous.focus?.({ preventScroll: true })
  }
}

export function puedeCompartirFactura(file, navigator = globalThis.navigator) {
  try { return !!(file && navigator?.share && navigator.canShare?.({ files: [file] })) } catch { return false }
}
export async function compartirFacturaPorSistema(file, navigator = globalThis.navigator, { title = file?.name, text = 'Te compartimos tu factura de Angie Tech.' } = {}) {
  if (!puedeCompartirFactura(file, navigator)) return 'unavailable'
  try { await navigator.share({ files: [file], title, text }); return 'shared' }
  catch (error) { return error?.name === 'AbortError' ? 'cancelled' : 'unavailable' }
}
