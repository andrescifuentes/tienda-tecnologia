import { money, numFactura } from './format.js'
import { enlaceWhatsApp, soloDigitos } from './whatsapp.js'

export function quitarFocoEntrada() {
  const active = globalThis.document?.activeElement
  if (active?.matches?.('input,textarea,select')) active.blur()
}

// Sharing has no dependency on cancellation, administrator credentials or permissions.
export function prepararEnvioFactura({ canal, invoice, telefono, correo, pdfUrl = '', detalle = '' }) {
  const number = numFactura(invoice)
  const nombre = invoice.clientes?.nombre?.trim().split(/\s+/)[0] || 'cliente'
  const asunto = 'Factura ' + number + ' de ANGIE TECH'
  const cuerpo = ['Hola ' + nombre + ',', '', 'Te compartimos tu factura ' + number + ' de ANGIE TECH por ' + money(invoice.total) + '.', '', pdfUrl ? 'Descarga tu PDF: ' + pdfUrl : 'El PDF debe adjuntarse manualmente.', detalle ? '\n' + detalle.replace(/\*/g, '') : ''].filter(Boolean).join('\n')
  if (canal === 'whatsapp') {
    const destino = String(telefono || '').trim(), digits = soloDigitos(destino)
    if (!digits) throw new Error('El cliente no tiene un número de WhatsApp registrado.')
    if (digits.length < 10 || digits.length > 15) throw new Error('Escribe un número de WhatsApp válido.')
    return { canal, destino, asunto, cuerpo, adjuntoManual: !pdfUrl, url: enlaceWhatsApp(destino, cuerpo) }
  }
  if (canal !== 'correo') throw new Error('Acción de envío no válida.')
  const destino = String(correo || '').trim()
  if (!destino) throw new Error('El cliente no tiene un correo registrado.')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destino)) throw new Error('Escribe un correo válido para el cliente.')
  return { canal, destino, asunto, cuerpo, adjuntoManual: !pdfUrl, url: 'mailto:' + encodeURIComponent(destino) + '?subject=' + encodeURIComponent(asunto) + '&body=' + encodeURIComponent(cuerpo) }
}

export async function conLimiteEnvio(action, timeoutMs = 10000) {
  let timer
  try { return await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('El enlace PDF tardó demasiado.')), timeoutMs) })]) }
  finally { clearTimeout(timer) }
}

export function abrirEnvioFactura(envio, opener = globalThis.window?.open?.bind(globalThis.window)) {
  if (!envio?.url || !['whatsapp', 'correo'].includes(envio.canal)) throw new Error('No hay un mensaje preparado.')
  if (!opener) throw new Error('No se pudo abrir la aplicación. Puedes volver e intentarlo de nuevo.')
  const popup = opener(envio.url, '_blank')
  if (!popup) throw new Error('El navegador no abrió la aplicación. Puedes volver e intentarlo de nuevo.')
  try { popup.opener = null } catch { /* Some mobile app handoffs expose no writable WindowProxy. */ }
  return true
}
