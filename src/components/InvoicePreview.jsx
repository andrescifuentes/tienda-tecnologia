import { money, fechaHora, numFactura } from '../lib/format'

export default function InvoicePreview({ invoice, items, tienda }) {
  return <article className="print-invoice" data-print-invoice>
    <h2>{tienda?.nombre || 'ANGIE TECH'}</h2>{tienda?.nit && <p>NIT {tienda.nit}</p>}
    <h3>Factura {numFactura(invoice)}</h3><p>{fechaHora(invoice.fecha)} · {invoice.estado}</p>
    <p>Cliente: {invoice.clientes?.nombre || 'Consumidor final'}</p>
    <p>Método de pago: {invoice.metodo_pago}</p>
    <div className="invoice-table-scroll"><table><thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead><tbody>{items.map(i=><tr key={i.id}><td>{i.nombre}</td><td>{i.cantidad}</td><td>{money(i.precio_unitario)}</td><td>{money(i.cantidad*i.precio_unitario)}</td></tr>)}</tbody></table></div>
    <p>Subtotal: {money(invoice.subtotal)}</p>{invoice.descuento>0&&<p>Descuento: −{money(invoice.descuento)}</p>}
    <p className="invoice-print-total">Total: {money(invoice.total)}</p><p>{tienda?.factura_pie || 'Gracias por tu compra.'}</p>
    <p className="text-xs">Demostración local · no constituye una factura fiscal.</p>
  </article>
}
