import { supabase } from './supabase'
import { createInvoicePdf, logoListo } from './invoicePdf'
import { money, numFactura } from './format'

// Sube el PDF de la factura al bucket "facturas" y devuelve un enlace público.
export async function subirFacturaPdf(f, items, tienda) {
  await logoListo
  const pdf = createInvoicePdf(f, items, tienda, false)
  const año = new Date(f.fecha || Date.now()).getFullYear()
  const id = (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36))
  const ruta = `${año}/${id}-${pdf.filename}`
  const { error } = await supabase.storage.from('facturas').upload(ruta, pdf.blob, { contentType: 'application/pdf', upsert: false })
  if (error) {
    if (/bucket not found/i.test(error.message || '')) throw new Error('Falta configurar el envío de facturas: ejecuta supabase/04_facturas_envio.sql.')
    throw error
  }
  return supabase.storage.from('facturas').getPublicUrl(ruta).data.publicUrl
}

const primerNombre = (n) => String(n || '').trim().split(/\s+/)[0] || ''

export function mensajeWhatsApp(f, url) {
  const nombre = primerNombre(f.clientes?.nombre)
  return [
    `Hola${nombre ? ' ' + nombre : ''} 👋`,
    '',
    `Gracias por tu compra en *ANGIE TECH*.`,
    `Te compartimos tu factura *${numFactura(f)}* por *${money(f.total)}*.`,
    '',
    `📄 Descárgala aquí:`,
    url,
    '',
    '¡Quedamos atentos a lo que necesites!',
  ].join('\n')
}

export function correoFactura(f, url) {
  const nombre = primerNombre(f.clientes?.nombre)
  const asunto = `Tu factura ${numFactura(f)} · ANGIE TECH`
  const cuerpo = [
    `Hola${nombre ? ' ' + nombre : ''},`,
    '',
    `Gracias por tu compra en ANGIE TECH.`,
    `Adjuntamos el enlace a tu factura ${numFactura(f)} por ${money(f.total)}:`,
    '',
    url,
    '',
    'Si tienes alguna pregunta, responde a este correo.',
    '',
    'Saludos,',
    'ANGIE TECH',
  ].join('\n')
  // Devuelve la parte de consulta del mailto (?subject=...&body=...)
  return `?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`
}
