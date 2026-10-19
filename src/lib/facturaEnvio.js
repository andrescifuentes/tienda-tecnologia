import { supabase } from './supabase'
import { createInvoicePdf, logoListo } from './invoicePdf'
import { money, numFactura } from './format'
import { nombreNegocio } from './marca'

// Dirección pública de la app para los enlaces que recibe el cliente. Si se está probando en el
// computador (localhost o 192.168…), el enlace igual apunta a la app publicada, que es la que el
// cliente puede abrir y la que WhatsApp usa para mostrar la vista previa.
const PUBLICA = 'https://angie-tech.vercel.app'
export function urlPublica(loc = globalThis.location) {
  const env = import.meta.env?.VITE_PUBLIC_URL
  if (env) return String(env).replace(/\/+$/, '')
  const host = loc?.hostname || ''
  const local = !host || host === 'localhost' || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host.endsWith('.local')
  return local ? PUBLICA : loc.origin
}

// Enlace corto y bonito para el cliente (script 11): https://<app>/f/<código>
// Si el script 11 aún no se ejecutó, se usa el enlace del PDF de antes.
export async function enlaceFactura(f, items, tienda) {
  const { data, error } = await supabase.rpc('crear_enlace_factura', { p_factura: f.id })
  if (!error && data) return `${urlPublica()}/f/${data}`
  if (error && error.code !== 'PGRST202' && !/Could not find the function/i.test(error.message || '')) throw error
  return subirFacturaPdf(f, items, tienda)
}

// Sube el PDF de la factura al bucket "facturas" y devuelve un enlace para el cliente.
export async function subirFacturaPdf(f, items, tienda) {
  await logoListo
  const pdf = createInvoicePdf(f, items, tienda, false)
  const año = new Date(f.fecha || Date.now()).getFullYear()
  const id = (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36))
  // Cada negocio guarda sus facturas en su propia carpeta (script 10)
  const ruta = `negocio-${f.negocio_id ?? tienda?.id ?? 1}/${año}/${id}-${pdf.filename}`
  const { error } = await supabase.storage.from('facturas').upload(ruta, pdf.blob, { contentType: 'application/pdf', upsert: false })
  if (error) {
    if (/bucket not found/i.test(error.message || '')) throw new Error('Falta configurar el envío de facturas: ejecuta supabase/04_facturas_envio.sql.')
    throw error
  }
  // Enlace firmado que vence en un año (el espacio de facturas es privado desde el script 05).
  // Si el script 08 aún no se ejecutó, se usa el enlace público anterior.
  const firmado = await supabase.storage.from('facturas').createSignedUrl(ruta, 60 * 60 * 24 * 365)
  if (!firmado.error && firmado.data?.signedUrl) return firmado.data.signedUrl
  return supabase.storage.from('facturas').getPublicUrl(ruta).data.publicUrl
}

const primerNombre = (n) => String(n || '').trim().split(/\s+/)[0] || ''

export function mensajeWhatsApp(f, url, tienda) {
  const nombre = primerNombre(f.clientes?.nombre)
  return [
    `Hola${nombre ? ' ' + nombre : ''} 👋`,
    '',
    `Gracias por tu compra en *${nombreNegocio(tienda).toUpperCase()}*.`,
    `Te compartimos tu factura *${numFactura(f)}* por *${money(f.total)}*.`,
    '',
    `📄 Descárgala aquí:`,
    url,
    '',
    '¡Quedamos atentos a lo que necesites!',
  ].join('\n')
}

export function correoFactura(f, url, tienda) {
  const marca = nombreNegocio(tienda).toUpperCase()
  const nombre = primerNombre(f.clientes?.nombre)
  const asunto = `Tu factura ${numFactura(f)} · ${marca}`
  const cuerpo = [
    `Hola${nombre ? ' ' + nombre : ''},`,
    '',
    `Gracias por tu compra en ${marca}.`,
    `Adjuntamos el enlace a tu factura ${numFactura(f)} por ${money(f.total)}:`,
    '',
    url,
    '',
    'Si tienes alguna pregunta, responde a este correo.',
    '',
    'Saludos,',
    marca,
  ].join('\n')
  // Devuelve la parte de consulta del mailto (?subject=...&body=...)
  return `?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`
}
