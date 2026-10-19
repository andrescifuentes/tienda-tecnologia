// Vista previa premium del enlace de la factura en WhatsApp (/f/<código>).
// WhatsApp no ejecuta la app: lee las etiquetas <meta> de la página. Esta función
// devuelve la misma app con el título, la descripción y la imagen de ESA factura.
import { invoiceBrand, isAngieBrand } from '../supabase/functions/_shared/invoice-brand.js'

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const money = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO')
const numero = f => `${f.prefijo}-${String(f.numero).padStart(4, '0')}`

export async function datosVistaPrevia(token, { url, key, fetchImpl = fetch } = {}) {
  const base = { titulo: 'Tu factura', descripcion: 'Toca para ver y descargar tu factura en PDF.', imagen: '/og-factura.jpg', marca: '' }
  if (!/^[A-Za-z0-9_-]{12}$/.test(token || '') || !url || !key) return base
  try {
    const r = await fetchImpl(url + '/rest/v1/rpc/factura_publica', {
      method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_token: token }),
    })
    const d = r.ok ? await r.json() : null
    if (!d?.factura) return base
    const marca = invoiceBrand(d.tienda || {})
    const total = Number(d.factura.total) - (Number(d.factura.devuelto) || 0)
    return {
      titulo: `${marca} · Factura ${numero(d.factura)}`,
      descripcion: `Total ${money(total)} · Toca para ver y descargar tu factura.`,
      imagen: isAngieBrand(d.tienda || {}) ? '/og-angie.jpg' : '/og-factura.jpg',
      marca,
    }
  } catch { return base }
}

export function conMeta(html, { titulo, descripcion, imagen, marca }, origin, ruta) {
  const img = origin + imagen
  const meta = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${esc(marca || 'Tu factura')}">`,
    `<meta property="og:title" content="${esc(titulo)}">`,
    `<meta property="og:description" content="${esc(descripcion)}">`,
    `<meta property="og:image" content="${esc(img)}">`,
    `<meta property="og:image:secure_url" content="${esc(img)}">`,
    `<meta property="og:image:type" content="image/jpeg">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:url" content="${esc(origin + ruta)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="description" content="${esc(descripcion)}">`,
    `<meta name="robots" content="noindex">`,
  ].join('\n    ')
  return html
    .replace(/<meta (property|name)="(og:[^"]+|twitter:[^"]+|description)"[^>]*>\s*/g, '')
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(titulo)}</title>\n    ${meta}`)
}

export default async function handler(req, res) {
  const token = String(req.query?.token || '')
  const host = req.headers['x-forwarded-host'] || req.headers.host
  const origin = (req.headers['x-forwarded-proto'] || 'https') + '://' + host
  let html
  try { html = await (await fetch(origin + '/index.html')).text() }
  catch { res.statusCode = 302; res.setHeader('Location', '/'); return res.end() }
  const datos = await datosVistaPrevia(token, { url: process.env.VITE_SUPABASE_URL, key: process.env.VITE_SUPABASE_ANON_KEY })
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=600')
  res.statusCode = 200
  res.end(conMeta(html, datos, origin, '/f/' + encodeURIComponent(token)))
}
