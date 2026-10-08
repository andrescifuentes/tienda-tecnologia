import { Badge, Empty } from './ui'
import { Icon } from './Icons'
import { money, fechaHora, numFactura } from '../lib/format'

export default function SalesMetricDetail({ total, invoices, onOpen, period }) {
  return <div className="sales-metric-content">
    <div className="metric-summary">
      <span className="premium-eyebrow">{period === 'day' ? 'RESUMEN DE HOY' : 'RESUMEN DEL MES'}</span>
      <p>Total de ventas</p><strong>{money(total)}</strong>
      <div><span className="metric-summary-dot" />{invoices.length} {invoices.length === 1 ? 'factura emitida' : 'facturas emitidas'}</div>
    </div>
    <div className="premium-section-heading"><h4>Facturas del período</h4><span>Toca para ver el detalle</span></div>
    {invoices.length ? <div className="metric-invoices">{invoices.map(invoice => <button className="row menu-row metric-invoice" key={invoice.id} onClick={() => onOpen(invoice.id)}>
      <span className="document-symbol"><Icon name="doc" /></span>
      <span className="metric-invoice-main"><b>{numFactura(invoice)}</b><small>{fechaHora(invoice.fecha)}</small><Badge tone="good">Emitida</Badge></span>
      <span className="metric-invoice-value"><small>Total factura</small><b>{money(invoice.total)}</b><Icon name="back" className="metric-row-arrow" /></span>
    </button>)}</div> : <Empty text="Sin ventas en este período" description="Las facturas emitidas aparecerán aquí cuando registres una venta." />}
  </div>
}
