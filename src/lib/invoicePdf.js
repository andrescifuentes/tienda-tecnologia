import {preserveNativeShareContext} from './nativeShareContext'
import { jsPDF } from 'jspdf'
import { renderInvoicePdf } from '../../supabase/functions/_shared/invoice-pdf-core.js'
import logoUrl from '../assets/brand/angie-tech-logo-gold.png'

// Logo precargado como dataURL para incrustarlo en el PDF (si aún no carga, se usa solo el texto)
let LOGO = null
export const logoListo = (typeof fetch === 'function' ? fetch(logoUrl).then(r => r.blob()).then(b => new Promise(res => { const fr = new FileReader(); fr.onload = () => { LOGO = fr.result; res(LOGO) }; fr.readAsDataURL(b) })) : Promise.resolve(null)).catch(() => null)

// Factura premium: banda negra con logo dorado, tarjetas de cliente y vendedor, tabla fina y total destacado.
export function createInvoicePdf(invoice, items, tienda, demo = false) {
  return renderInvoicePdf(invoice, items, tienda, { jsPDF, logo: LOGO, demo })
}

export function invoicePdfFile(pdf) {
  return new File([pdf.blob], pdf.filename, { type: 'application/pdf' })
}

export function canSharePdf(file) {
  try { return !!(navigator.share && navigator.canShare?.({ files: [file] })) } catch { return false }
}

export async function saveInvoicePdf(pdf, share = false) {
  const file = invoicePdfFile(pdf)
  // iPadOS can identify itself as a Mac. A touch-capable Windows PC must still download.
  const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  if ((share || mobile) && canSharePdf(file)) {
    const restore=preserveNativeShareContext()
    try { await navigator.share({ files: [file], title: pdf.filename }); return 'shared' }
    catch (error) { if (error.name === 'AbortError') return 'cancelled' }
    finally { restore() }
  }
  const url = URL.createObjectURL(pdf.blob)
  if (mobile) {
    const opened = window.open(url, '_blank')
    if (opened) { setTimeout(() => URL.revokeObjectURL(url), 60000); return 'opened' }
  }
  const link = document.createElement('a')
  link.href = url; link.download = pdf.filename; link.rel = 'noopener'; document.body.append(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
  return 'downloaded'
}
