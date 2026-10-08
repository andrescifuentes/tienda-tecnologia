import { money, fechaHora, numFactura } from './format'
import { invoiceBusiness } from './invoiceSnapshot'

export function textoFactura(f, items, tienda, cliente) {
  tienda = invoiceBusiness(f, tienda)
  cliente = Object.hasOwn(f,'cliente_snapshot') ? f.cliente_snapshot : cliente
  const L = []
  L.push(`*${tienda?.nombre || 'ANGIE TECH'}*`)
  if (tienda?.nit) L.push(`NIT ${tienda.nit}`)
  L.push(`Factura ${numFactura(f)} · ${fechaHora(f.fecha)}`)
  if (cliente) L.push(`Cliente: ${cliente.nombre}`)
  L.push('')
  items.forEach((i) => {
    const sub = i.precio_unitario * i.cantidad
    L.push(`• ${i.cantidad} x ${i.nombre} — ${money(sub)}`)
  })
  L.push('')
  if (f.descuento > 0) L.push(`Descuento: -${money(f.descuento)}`)
  L.push(`*Total: ${money(f.total)}* (${f.metodo_pago})`)
  if (tienda?.factura_pie) { L.push(''); L.push(tienda.factura_pie) }
  else { L.push(''); L.push('Gracias por tu compra.') }
  return L.join('\n')
}
