import { invoiceBrand } from '../../supabase/functions/_shared/invoice-brand.js'
import { crearBorradorCorreoFactura, validarCorreoFactura, abrirCorreoFactura, invoiceMessageBody } from './invoiceEmail.js'
import { money, numFactura } from './format.js'
import { armarMensajeFactura, plantillaFactura } from './mensajeFactura.js'
import { enlaceWhatsApp, soloDigitos } from './whatsapp.js'

export function quitarFocoEntrada() {
  const active = globalThis.document?.activeElement
  if (active?.matches?.('input,textarea,select')) active.blur()
}

// Sharing has no dependency on cancellation, administrator credentials or permissions.
export function prepararEnvioFactura({ canal, invoice, telefono, correo, pdfUrl = '', detalle = '', tienda, items=[] }) {
 if(canal==='whatsapp'){
  const destino=String(telefono||'').trim(),digits=soloDigitos(destino)
  if(!digits)throw Error('El cliente no tiene un número de WhatsApp registrado.')
  if(digits.length<10||digits.length>15)throw Error('Escribe un número de WhatsApp válido.')
  const message=invoiceMessageBody({invoice,tienda,items,pdfUrl,canal:'whatsapp'})
  return{canal,destino,asunto:message.subject,cuerpo:message.body,adjuntoManual:!message.link,url:enlaceWhatsApp(destino,message.body)}
 }
 if(canal!=='correo')throw Error('Acción de envío no válida.')
 const invalid=validarCorreoFactura(correo);if(invalid)throw Error(invalid)
 return crearBorradorCorreoFactura({invoice,correo,detalle,tienda,pdfUrl,items})
}

export async function conLimiteEnvio(action, timeoutMs = 10000) {
  let timer
  try { return await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('El enlace PDF tardó demasiado.')), timeoutMs) })]) }
  finally { clearTimeout(timer) }
}

export function abrirEnvioFactura(envio, opener = globalThis.window?.open?.bind(globalThis.window), navigate) {
  if (!envio?.url || !['whatsapp', 'correo'].includes(envio.canal)) throw new Error('No hay un mensaje preparado.')
  if (envio.canal === 'correo') return abrirCorreoFactura(envio, navigate)
  if (!opener) throw new Error('No se pudo abrir la aplicación. Puedes volver e intentarlo de nuevo.')
  const popup = opener(envio.url, '_blank')
  if (!popup) throw new Error('El navegador no abrió la aplicación. Puedes volver e intentarlo de nuevo.')
  try { popup.opener = null } catch { /* Some mobile app handoffs expose no writable WindowProxy. */ }
  return true
}
