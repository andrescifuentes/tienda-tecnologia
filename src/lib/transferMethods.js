// Medios de transferencia con código QR cargado por el administrador.
// La misma validación se usa en la demo, en la interfaz y se replica en SQL 16.
import { withDeadline, cancellableQuery, requireData } from './asyncResult.js'

export const TRANSFER_LIMITS = Object.freeze({ nombre: 60, titular: 100, numero_cuenta: 60, detalle: 200, qrBytes: 300 * 1024, logoBytes: 100 * 1024, medios: 30 })
export const TRANSFER_FIELDS = 'id,nombre,titular,numero_cuenta,detalle,logo_data_url,qr_data_url,activo,orden'
const PREFIX = { png: 'iVBORw0KGgo', jpeg: '/9j/' }

function decodedBytes(base64) {
  return Math.floor(base64.length * 3 / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0)
}
export function validateImageDataUrl(value, { maxBytes, label, required = false }) {
  const text = String(value ?? '')
  if (!text) { if (required) throw Error(label + ' es obligatorio.'); return '' }
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(text)
  const limit = Math.round(maxBytes / 1024) + ' KB'
  if (!match || match[2].length % 4 !== 0 || !match[2].startsWith(PREFIX[match[1]])) throw Error(label + ' debe ser una imagen PNG o JPG.')
  if (decodedBytes(match[2]) > maxBytes) throw Error(label + ' supera el tamaño permitido (' + limit + ').')
  return text
}
function cleanText(value, max, label, required = false) {
  const text = String(value ?? '').trim()
  if (required && !text) throw Error(label + ' es obligatorio.')
  if (text.length > max) throw Error(label + ' admite máximo ' + max + ' caracteres.')
  if (/[\u0000-\u001f\u007f]/.test(text)) throw Error(label + ' no admite saltos de línea ni caracteres de control.')
  return text
}
// Devuelve una fila lista para guardar. Campos vacíos quedan en null.
export function validateTransferMethod(input = {}) {
  const orden = input.orden == null || input.orden === '' ? 0 : Number(input.orden)
  if (!Number.isInteger(orden) || orden < 0 || orden > 9999) throw Error('El orden debe ser un número entre 0 y 9999.')
  return {
    nombre: cleanText(input.nombre, TRANSFER_LIMITS.nombre, 'El nombre del medio', true),
    titular: cleanText(input.titular, TRANSFER_LIMITS.titular, 'El titular') || null,
    numero_cuenta: cleanText(input.numero_cuenta, TRANSFER_LIMITS.numero_cuenta, 'El número de cuenta') || null,
    detalle: cleanText(input.detalle, TRANSFER_LIMITS.detalle, 'El detalle') || null,
    logo_data_url: validateImageDataUrl(input.logo_data_url, { maxBytes: TRANSFER_LIMITS.logoBytes, label: 'El logo' }) || null,
    qr_data_url: validateImageDataUrl(input.qr_data_url, { maxBytes: TRANSFER_LIMITS.qrBytes, label: 'El código QR', required: true }),
    activo: input.activo !== false,
    orden,
  }
}
export const transferSchemaMissing = error => /PGRST20[245]|42P01|42703|42883/.test(String(error?.code || '')) || /medios_transferencia|schema cache/i.test(String(error?.message || ''))
export const sortTransferMethods = rows => [...rows].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || String(a.nombre).localeCompare(String(b.nombre), 'es') || a.id - b.id)

export async function loadTransferMethods(client, { soloActivos = true, signal } = {}) {
  return withDeadline(async abort => {
    let query = client.from('medios_transferencia').select(TRANSFER_FIELDS)
    if (soloActivos) query = query.eq('activo', true)
    const rows = requireData(await cancellableQuery(query.order('orden').order('id'), abort))
    if (!Array.isArray(rows)) throw Error('No se pudieron consultar los medios de transferencia.')
    return sortTransferMethods(rows)
  }, { signal })
}

// Registra qué medio se usó en una venta ya confirmada. No cobra ni crea facturas.
export async function registerInvoiceTransferMethod(client, invoiceId, methodId) {
  const { data, error } = await client.rpc('factura_registrar_medio_transferencia', { p_factura_id: invoiceId, p_medio_id: methodId })
  if (error) throw Object.assign(Error(error.message || 'No se pudo registrar el medio de transferencia.'), { code: error.code })
  return data
}

// JPG no tiene transparencia: se aplana sobre blanco para no oscurecer logos ni QR.
function jpegOnWhite(canvas) {
  const flat = document.createElement('canvas'), ctx = flat.getContext('2d')
  flat.width = canvas.width; flat.height = canvas.height
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, flat.width, flat.height); ctx.drawImage(canvas, 0, 0)
  return flat.toDataURL('image/jpeg', 0.92)
}

// Reduce la imagen elegida a PNG/JPG dentro del límite. El QR se dibuja sobre blanco
// para que siga siendo legible en modo oscuro; nunca se genera un código nuevo.
export async function readTransferImage(file, kind = 'qr') {
  const qr = kind === 'qr', maxBytes = qr ? TRANSFER_LIMITS.qrBytes : TRANSFER_LIMITS.logoBytes, label = qr ? 'El código QR' : 'El logo'
  if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw Error('Elige una imagen PNG, JPG o WebP.')
  if (file.size > 8 * 1024 * 1024) throw Error('La imagen debe pesar menos de 8 MB.')
  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(Error('No se pudo leer la imagen. Si es HEIC, guárdala como JPG.')); img.src = url })
    if (!image.naturalWidth || !image.naturalHeight) throw Error('La imagen no tiene un tamaño válido.')
    if (qr && Math.min(image.naturalWidth, image.naturalHeight) < 120) throw Error('El código QR es muy pequeño para leerse. Usa una imagen de mejor resolución.')
    for (let side = qr ? 960 : 256; side >= (qr ? 360 : 96); side = Math.round(side * 0.8)) {
      const scale = Math.min(1, side / Math.max(image.naturalWidth, image.naturalHeight)), canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) throw Error('No se pudo preparar la imagen.')
      if (qr) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.imageSmoothingEnabled = false }
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
      for (const data of [canvas.toDataURL('image/png'), jpegOnWhite(canvas)]) {
        try { return validateImageDataUrl(data, { maxBytes, label }) } catch { /* Try a lighter encoding or a smaller size. */ }
      }
    }
    throw Error(label + ' es demasiado pesado incluso reducido. Recórtalo y vuelve a intentarlo.')
  } finally { URL.revokeObjectURL(url) }
}

// Comprobación opcional: si el navegador sabe leer QR, avisa cuando no encuentra uno.
export async function looksLikeQr(dataUrl) {
  try {
    if (!globalThis.BarcodeDetector) return null
    const formats = await globalThis.BarcodeDetector.getSupportedFormats?.()
    if (formats && !formats.includes('qr_code')) return null
    const img = new Image(); img.src = dataUrl; await img.decode()
    const found = await new globalThis.BarcodeDetector({ formats: ['qr_code'] }).detect(img)
    return found.length > 0
  } catch { return null }
}
