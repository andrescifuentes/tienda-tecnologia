import { jsPDF } from 'jspdf'
import { money, fechaHora, numFactura } from './format.js'
import { invoiceBusiness, invoiceIdentity } from './invoiceSnapshot.js'
import logoUrl from '../assets/brand/angie-tech-logo-gold.png'

// Logo precargado como dataURL para incrustarlo en el PDF (si aún no carga, se usa solo el texto)
let LOGO = null
export const logoListo = (typeof fetch === 'function' ? fetch(logoUrl).then(r => r.blob()).then(b => new Promise(res => { const fr = new FileReader(); fr.onload = () => { LOGO = fr.result; res(LOGO) }; fr.readAsDataURL(b) })) : Promise.resolve(null)).catch(() => null)

// Factura premium: banda negra con logo dorado, tarjetas de cliente y vendedor, tabla fina y total destacado.
export function createInvoicePdf(invoice, items, tienda, demo = false) {
  invoice = invoiceIdentity(invoice)
  tienda = invoiceBusiness(invoice, tienda) || {}
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const number = numFactura(invoice)
  const filename = `ANGIE-TECH-${number.replace(/[^a-zA-Z0-9-]/g, '')}.pdf`
  const marca = !tienda.nombre || /^techstore$/i.test(tienda.nombre) ? 'ANGIE TECH' : tienda.nombre.toUpperCase()
  doc.setProperties({ title: `${marca} · ${number}`, subject: 'Factura de venta', creator: marca })
  const W = 210, M = 16, R = W - M
  const GOLD = [196, 152, 76], GOLD_L = [233, 205, 146], INK = [24, 22, 19], MUTED = [120, 112, 100], CREAM = [249, 245, 236], LINE = [228, 220, 204]
  const T = (value, x, y, { size = 9.5, bold = false, color = INK, align, font = 'helvetica', style } = {}) => {
    doc.setFont(font, style || (bold ? 'bold' : 'normal')).setFontSize(size).setTextColor(...color)
    const limpio = t => String(t ?? '').replace(/[\u202f\u00a0\u2009]/g, ' ').replace(/[\u2212\u2013]/g, '-')
    doc.text(Array.isArray(value) ? value.map(limpio) : limpio(value), x, y, align ? { align } : undefined)
  }
  const fecha = new Date(invoice.fecha)
  const fechaTxt = fecha.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' })
  const horaTxt = fecha.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' })

  // 1. Banda negra superior
  doc.setFillColor(14, 13, 11).rect(0, 0, W, 50, 'F')
  doc.setFillColor(...GOLD).rect(0, 50, W, 1.1, 'F')
  if (LOGO) { try { doc.addImage(LOGO, 'PNG', M, 10.5, 42, 29.1) } catch { /* sin logo */ } }
  else T(marca, M, 28, { size: 22, bold: true, color: GOLD_L })
  T('FACTURA DE VENTA', R, 16, { size: 8, bold: true, color: GOLD, align: 'right' })
  doc.setDrawColor(...GOLD).setLineWidth(.3).line(R - 34, 18.5, R, 18.5)
  T(number, R, 31, { size: 24, bold: true, color: [255, 255, 255], align: 'right' })
  T(`${fechaTxt} · ${horaTxt}`, R, 39, { size: 8.5, color: [205, 196, 178], align: 'right' })
  const anulada = invoice.estado === 'anulada'
  doc.setFillColor(...(anulada ? [120, 28, 28] : [44, 38, 28])).roundedRect(R - 24, 42, 24, 5.5, 2.7, 2.7, 'F')
  T(anulada ? 'ANULADA' : 'EMITIDA', R - 12, 45.8, { size: 6.5, bold: true, color: anulada ? [255, 210, 210] : GOLD_L, align: 'center' })

  // 2. Datos de la tienda
  let y = 60
  const tiendaDatos = [tienda.nit && `NIT ${tienda.nit}`, tienda.direccion, tienda.telefono && `Tel. ${tienda.telefono}`, tienda.correo].filter(Boolean)
  T(marca, M, y, { size: 10, bold: true }); T(tiendaDatos.length ? tiendaDatos.join('   ·   ') : 'Tecnología, celulares y accesorios', M, y + 5, { size: 8, color: MUTED })
  y += 13

  // 3. Panel Cliente | Atendido por (rótulo arriba, valor abajo)
  const c = invoice.clientes || {}, v = invoice.perfiles || {}
  const colW = (R - M - 20) / 2, x1 = M + 7, x2 = M + 7 + colW + 6
  const lado = (x, titulo, nombre, datos, vacio) => {
    T(titulo, x, y + 8, { size: 7, bold: true, color: GOLD })
    const nom = doc.splitTextToSize(nombre, colW)
    T(nom.slice(0, 2), x, y + 15, { size: 12, bold: true })
    let ly = y + 15 + nom.slice(0, 2).length * 5 + 2
    const lista = datos.filter(d => d[1])
    if (!lista.length && vacio) { T(vacio, x, ly, { size: 8, color: MUTED }); return ly + 4 }
    for (const [k, val] of lista) {
      T(k.toUpperCase(), x, ly, { size: 6.2, color: [150, 140, 125] })
      const vl = doc.splitTextToSize(String(val), colW)
      T(vl.slice(0, 2), x, ly + 4, { size: 8.8 }); ly += 4 + vl.slice(0, 2).length * 4 + 3
    }
    return ly
  }
  // medir alto con una pasada "en seco" usando las mismas reglas
  const datosC = [['Documento', c.documento && `${c.tipo_documento || 'CC'} ${c.documento}`], ['Teléfono', c.telefono], ['Correo', c.correo], ['Dirección', c.direccion]]
  const datosV = [['Correo', v.correo], ['Teléfono', v.telefono], ['Método de pago', invoice.metodo_pago && invoice.metodo_pago.charAt(0).toUpperCase() + invoice.metodo_pago.slice(1)]]
  const alto = l => 24 + Math.max(1, l.filter(d => d[1]).length) * 11
  const panelH = Math.max(alto(datosC), alto(datosV), 34)
  doc.setFillColor(...CREAM).setDrawColor(...LINE).setLineWidth(.25).roundedRect(M, y, R - M, panelH, 3, 3, 'FD')
  doc.setDrawColor(...GOLD).setLineWidth(.35).line(M + 7 + colW + 2, y + 6, M + 7 + colW + 2, y + panelH - 6)
  lado(x1, 'CLIENTE', c.nombre || 'Consumidor final', c.nombre ? datosC : [], 'Venta de mostrador · sin datos de contacto')
  lado(x2, 'ATENDIDO POR', v.nombre || 'Vendedor', datosV)
  y += panelH + 10

  // 4. Tabla de productos
  const cols = { n: M + 3, prod: M + 12, cant: 130, precio: 160, total: R - 3 }
  const header = () => {
    doc.setFillColor(...INK).roundedRect(M, y - 5.5, R - M, 9, 2, 2, 'F')
    T('#', cols.n, y, { size: 7.5, bold: true, color: GOLD_L }); T('DESCRIPCIÓN', cols.prod, y, { size: 7.5, bold: true, color: GOLD_L })
    T('CANT.', cols.cant, y, { size: 7.5, bold: true, color: GOLD_L, align: 'right' }); T('PRECIO', cols.precio, y, { size: 7.5, bold: true, color: GOLD_L, align: 'right' })
    T('TOTAL', cols.total, y, { size: 7.5, bold: true, color: GOLD_L, align: 'right' }); y += 9
  }
  const nuevaPagina = () => { doc.addPage(); doc.setFillColor(14, 13, 11).rect(0, 0, W, 14, 'F'); T(marca, M, 9, { size: 9, bold: true, color: GOLD_L }); T(number, R, 9, { size: 9, color: [230, 230, 230], align: 'right' }); y = 26; header() }
  header()
  items.forEach((it, i) => {
    const lines = doc.splitTextToSize(String(it.nombre || 'Producto'), cols.cant - cols.prod - 18)
    const rowH = Math.max(10, lines.length * 4.6 + 5.5)
    if (y + rowH > 250) nuevaPagina()
    if (i % 2 === 1) doc.setFillColor(252, 250, 245).rect(M, y - 5.5, R - M, rowH, 'F')
    T(String(i + 1).padStart(2, '0'), cols.n, y, { size: 8, color: MUTED })
    T(lines, cols.prod, y, { size: 9.5, bold: true })
    T(`${it.codigo ? 'REF. ' + it.codigo + '   ·   ' : ''}${it.cantidad} x ${money(it.precio_unitario)}`, cols.prod, y + lines.length * 4.6, { size: 7, color: MUTED })
    T(String(it.cantidad), cols.cant, y, { size: 9.5, align: 'right' })
    T(money(it.precio_unitario), cols.precio, y, { size: 9.5, align: 'right' })
    T(money(it.cantidad * it.precio_unitario - (Number(it.descuento) || 0)), cols.total, y, { size: 9.5, bold: true, align: 'right' })
    y += rowH
    doc.setDrawColor(...LINE).setLineWidth(.2).line(M, y - 5.5, R, y - 5.5)
  })

  // 5. Totales
  if (y + 46 > 262) nuevaPagina()
  y += 4
  const tx = 122
  const fila = (k, val, color = INK) => { T(k, tx, y, { size: 9, color: MUTED }); T(val, cols.total, y, { size: 9.5, align: 'right', color }); y += 6.5 }
  const unidades = items.reduce((a, i) => a + Number(i.cantidad || 0), 0)
  T(`${items.length} ${items.length === 1 ? 'producto' : 'productos'} · ${unidades} ${unidades === 1 ? 'unidad' : 'unidades'}`, M, y, { size: 8.5, color: MUTED })
  if (invoice.notas) T(doc.splitTextToSize('Notas: ' + invoice.notas, 95), M, y + 6, { size: 8.5, color: MUTED })
  fila('Subtotal', money(invoice.subtotal))
  if (Number(invoice.descuento) > 0) fila('Descuento', '-' + money(invoice.descuento), [170, 60, 50])
  y += 1
  doc.setFillColor(14, 13, 11).roundedRect(tx - 4, y - 6, R - tx + 4, 16, 3, 3, 'F')
  doc.setFillColor(...GOLD).rect(tx - 4, y - 6, 1.4, 16, 'F')
  T('TOTAL', tx + 1, y + 1, { size: 8, bold: true, color: GOLD })
  T('COP', tx + 1, y + 5.5, { size: 6.5, color: [170, 160, 140] })
  T(money(invoice.total), cols.total, y + 4, { size: 16, bold: true, color: GOLD_L, align: 'right' })
  y += 20

  // 6. Agradecimiento
  if (y + 24 > 268) nuevaPagina()
  doc.setDrawColor(...GOLD).setLineWidth(.4).line(W / 2 - 20, y, W / 2 + 20, y)
  T('Gracias por tu compra', W / 2, y + 9, { size: 15, font: 'times', style: 'italic', color: INK, align: 'center' })
  T(doc.splitTextToSize(tienda.factura_pie || 'Conserva este documento para cambios y soporte.', 150), W / 2, y + 15, { size: 8.5, color: MUTED, align: 'center' })

  // 7. Pie en todas las páginas
  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page)
    doc.setFillColor(...GOLD).rect(0, 287, W, .8, 'F')
    T(`${marca} · Documento de venta interno${demo ? ' · Demostración local' : ''}`, M, 283, { size: 7, color: MUTED })
    T(`Página ${page} de ${pages}`, R, 283, { size: 7, color: MUTED, align: 'right' })
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
