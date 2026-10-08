import { jsPDF } from 'jspdf'
import { money, fechaHora, numFactura } from './format.js'
import { invoiceBusiness, invoiceIdentity } from './invoiceSnapshot.js'

// Text and vector drawing only: no screenshots, HTML rendering or network requests.
export function createInvoicePdf(invoice, items, tienda, demo = false) {
  invoice = invoiceIdentity(invoice)
  tienda = invoiceBusiness(invoice, tienda)
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const number = numFactura(invoice)
  const filename = `ANGIE-TECH-${number.replace(/[^a-zA-Z0-9-]/g, '')}.pdf`
  doc.setProperties({ title: `ANGIE TECH · ${number}`, subject: 'Factura', creator: 'ANGIE TECH' })
  let y = 24
  const text = (value, x, top, size = 10, bold = false, options) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(size).setTextColor(25, 25, 25)
    doc.text(Array.isArray(value) ? value : String(value ?? ''), x, top, options)
  }
  const line = top => doc.setDrawColor(220, 216, 208).line(16, top, 194, top)
  function pageSpace(height, table = false) {
    if (y + height > 267) { doc.addPage(); text('ANGIE TECH',16,14,11,true); text(number,194,14,10,false,{align:'right'}); y = 29; if (table) tableHeader() }
  }
  function tableHeader() {
    doc.setFillColor(246, 242, 233).roundedRect(16, y - 6, 178, 12, 2, 2, 'F')
    text('Producto', 19, y, 9, true); text('Cant.', 123, y, 9, true, { align: 'right' })
    text('Precio unitario', 158, y, 9, true, { align: 'right' }); text('Subtotal', 191, y, 9, true, { align: 'right' })
    y += 12
  }
  doc.setFillColor(180,139,66).rect(16,12,12,1.3,'F')
  text('ANGIE TECH', 16, y, 23, true)
  text('FACTURA DE VENTA',194,17,8,true,{align:'right'})
  text(number,194,25,17,true,{align:'right'})
  doc.setDrawColor(180, 139, 66).setLineWidth(.8).line(16, y + 5, 194, y + 5)
  y += 14
  text(`NIT: ${tienda?.nit || 'No registrado'}`, 16, y)
  text('COP · PESOS COLOMBIANOS', 194, y, 8, false, { align: 'right' }); y += 8
  const year = new Date(invoice.fecha).toLocaleDateString('es-CO', { year: 'numeric', timeZone: 'America/Bogota' })
  text(`Fecha: ${fechaHora(invoice.fecha)} · ${year}`, 16, y)
  text(`Estado: ${invoice.estado}`, 194, y, 10, false, { align: 'right' }); y += 10
  const client = invoice.clientes || {}
  const details = [
    `Cliente: ${client.nombre || 'Consumidor final'}`,
    client.documento && `Documento: ${client.documento}`,
    client.telefono && `Teléfono: ${client.telefono}`,
    invoice.perfiles?.nombre && `Vendedor: ${invoice.perfiles.nombre}`,
    `Método de pago: ${invoice.metodo_pago || 'No registrado'}`,
  ].filter(Boolean)
  for (const detail of details) {
    const lines = doc.splitTextToSize(detail, 175)
    pageSpace(lines.length * 5 + 3); text(lines, 16, y); y += lines.length * 5 + 3
  }
  y += 5; line(y-7); tableHeader()
  for (const item of items) {
    doc.setFontSize(10)
    const lines = doc.splitTextToSize(String(item.nombre || 'Producto'), 91)
    // Split unusually long descriptions too, so a row can never paint over the footer.
    for (let offset = 0; offset < lines.length; offset += 35) {
      const segment = lines.slice(offset, offset + 35), height = Math.max(9, segment.length * 5 + 4)
      pageSpace(height, true)
      text(segment, 19, y)
      if (!offset) {
        text(item.cantidad, 123, y, 9, false, { align: 'right' })
        text(money(item.precio_unitario), 158, y, 9, false, { align: 'right' })
        text(money(item.cantidad * item.precio_unitario - (Number(item.descuento) || 0)), 191, y, 9, false, { align: 'right' })
      }
      y += height; doc.setLineWidth(.2); line(y - 3)
    }
  }
  pageSpace(38); y += 6
  text('Subtotal', 128, y); text(money(invoice.subtotal), 191, y, 10, false, { align: 'right' }); y += 8
  if (Number(invoice.descuento) > 0) {
    text('Descuento', 128, y); text(`-${money(invoice.descuento)}`, 191, y, 10, false, { align: 'right' }); y += 8
  }
  doc.setFillColor(246,242,233).roundedRect(119,y-7,75,14,2,2,'F')
  text('TOTAL COP', 123, y+2, 10, true); text(money(invoice.total), 191, y+2, 14, true, { align: 'right' })
  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page); line(278)
    text('Documento generado desde ANGIE TECH', 16, 284, 8)
    if (demo) text('Demostración local · No constituye factura fiscal.', 16, 290, 8)
    text(`${page} / ${pages}`, 194, 284, 8, false, { align: 'right' })
  }
  return { blob: doc.output('blob'), filename }
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
    try { await navigator.share({ files: [file], title: pdf.filename }); return 'shared' }
    catch (error) { if (error.name === 'AbortError') return 'cancelled' }
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
