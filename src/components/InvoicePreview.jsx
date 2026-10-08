import { money, fechaHora, numFactura } from '../lib/format'
import { invoiceBusiness, invoiceIdentity } from '../lib/invoiceSnapshot'

export default function InvoicePreview({ invoice, items, tienda, demo = false }) {
  invoice = invoiceIdentity(invoice)
  tienda = invoiceBusiness(invoice, tienda)
  return <article className="print-invoice" data-print-invoice>
    <header className="invoice-paper-header"><div><span className="invoice-paper-mark" aria-hidden="true" /><h2>ANGIE TECH</h2><p>{tienda?.nit ? 'NIT '+tienda.nit : 'Tecnología y accesorios'}</p></div><div className="invoice-paper-reference"><small>FACTURA DE VENTA</small><h3>{numFactura(invoice)}</h3><span>{invoice.estado}</span></div></header>
    <p className="invoice-paper-date">Fecha de emisión · {fechaHora(invoice.fecha)} · {new Date(invoice.fecha).toLocaleDateString('es-CO',{year:'numeric',timeZone:'America/Bogota'})}</p>
    <div className="invoice-paper-parties"><section><small>FACTURADO A</small><b>{invoice.clientes?.nombre || 'Consumidor final'}</b>{invoice.clientes?.documento && <p>Documento: {invoice.clientes.documento}</p>}{invoice.clientes?.telefono && <p>Teléfono: {invoice.clientes.telefono}</p>}</section><section><small>INFORMACIÓN DE PAGO</small><b>{invoice.metodo_pago}</b>{invoice.perfiles?.nombre && <p>Vendedor: {invoice.perfiles.nombre}</p>}</section></div>
    <div className="invoice-table-scroll"><table><thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead><tbody>{items.map(i=><tr key={i.id}><td>{i.nombre}</td><td>{i.cantidad}</td><td>{money(i.precio_unitario)}</td><td>{money(i.cantidad*i.precio_unitario - (Number(i.descuento) || 0))}</td></tr>)}</tbody></table></div>
    <div className="invoice-paper-totals"><p><span>Subtotal</span><b>{money(invoice.subtotal)}</b></p>{invoice.descuento>0&&<p><span>Descuento</span><b>−{money(invoice.descuento)}</b></p>}<p className="invoice-print-total"><span>Total COP</span><b>{money(invoice.total)}</b></p></div>
    <footer className="invoice-paper-footer"><p>{tienda?.factura_pie || 'Gracias por tu compra.'}</p><small>Documento generado desde ANGIE TECH</small>{demo && <small>Demostración local · No constituye factura fiscal.</small>}</footer>
  </article>
}
