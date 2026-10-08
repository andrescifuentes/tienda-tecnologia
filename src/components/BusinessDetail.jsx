import { Icon } from './Icons'
import { Badge, Empty } from './ui'
import { money, fechaHora, numFactura } from '../lib/format'
import '../styles/business-detail.css'

function Metric({ label, value, note, icon = 'chart', variant = '' }) {
  return <div className={'stat-card executive-metric ' + variant}>
    <div className="stat-heading"><p>{label}</p><span className="executive-icon"><Icon name={icon}/></span></div>
    <p className="stat-value">{value}</p>
    {note && <small>{note}</small>}
    {variant === 'headline' && <svg className="executive-pattern" viewBox="0 0 160 120" aria-hidden="true"><circle cx="140" cy="100" r="90"/><circle cx="140" cy="100" r="65"/><circle cx="140" cy="100" r="40"/></svg>}
  </div>
}

function Section({ number, title, subtitle, children }) {
  return <section className="executive-section"><header><span>{number}</span><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div></header>{children}</section>
}

// Presentation only: values and records come from the existing dashboard queries.
export default function BusinessDetail({ data: d, costos, agotados, empleados, bajo, facturas }) {
  const balance = [{ label:'Ingresos del mes', value:d.ingresos_mes, tone:'income' }, { label:'Gastos del mes', value:d.gastos_mes, tone:'expense' }, ...(costos ? [{ label:'Utilidad del mes', value:d.utilidad_mes, tone:d.utilidad_mes < 0 ? 'expense' : 'profit' }] : [])]
  const scale = Math.max(...balance.map(item => Math.abs(item.value)), 1)
  const teamScale = Math.max(...empleados.map(e => e.total_vendido), 1)
  return <div className="business-detail">
    <Section number="01" title="Resumen ejecutivo" subtitle="Tu negocio, en una mirada">
      <Metric label="Ventas del mes" value={money(d.ventas_mes)} note="Acumulado del mes en curso · COP" icon="chart" variant="headline"/>
      <div className="executive-grid">
        <Metric label="Ingresos del mes" value={money(d.ingresos_mes)} note="Facturas e ingresos registrados" icon="cash" variant="income"/>
        {costos && <Metric label="Utilidad del mes" value={money(d.utilidad_mes)} note="Resultado neto del mes" icon="chart" variant={d.utilidad_mes < 0 ? 'negative' : 'profit'}/>}
      </div>
    </Section>
    <Section number="02" title="Rendimiento comercial" subtitle="La operación de hoy y el balance del mes">
      <div className="executive-today"><Metric label="Ventas de hoy" value={money(d.ventas_hoy)} icon="cash"/><Metric label="Facturas del día" value={d.facturas_hoy} note="Documentos emitidos" icon="doc" variant="count"/></div>
      <div className="executive-balance" role="img" aria-label={'Balance del mes. ' + balance.map(item => item.label + ': ' + money(item.value)).join('; ')}>
        <div className="executive-chart-heading"><span>COMPOSICIÓN DEL MES</span><small>COP</small></div>
        {balance.map(item => <div key={item.label} className={'executive-bar ' + item.tone}><div><span>{item.label}</span><b>{money(item.value)}</b></div><div className="executive-track"><span style={{width:Math.abs(item.value)/scale*100+'%'}}/></div></div>)}
        <p>Importes comparados en una misma escala. No representa una tendencia.</p>
      </div>
      <Metric label="Gastos del mes" value={money(d.gastos_mes)} note="Egresos registrados en el período" icon="cash" variant="expense"/>
    </Section>
    <Section number="03" title="Inventario" subtitle="Capital en productos y alertas de reposición">
      {costos && <Metric label="Valor inventario" value={money(d.valor_inventario)} note="Valoración actual de las existencias" icon="box" variant="inventory-value"/>}
      <div className="executive-grid"><Metric label="Stock bajo" value={d.productos_stock_bajo} note="Productos por reponer" icon="box" variant="stock"/><Metric label="Agotados" value={agotados} note="Productos sin existencias" icon="box" variant="stock empty-stock"/></div>
      <div className="executive-records"><h3>Prioridad de reposición</h3>{bajo.length ? bajo.map(p => <div className="executive-stock-row" key={p.id}><span className="executive-stock-dot" data-empty={p.stock===0}/><div><b>{p.nombre}</b><small>{p.codigo}</small></div><Badge tone={p.stock===0?'bad':'warn'}>{p.stock} / mín {p.stock_min}</Badge></div>) : <Empty text="Todo el inventario está en orden"/>}</div>
    </Section>
    <Section number="04" title="Ventas por empleado (mes)" subtitle="Barras relativas a la mayor venta del equipo">
      <div className="executive-team">{empleados.length ? empleados.map(e => <div className="executive-person" key={e.vendedor_id}><div className="executive-person-top"><span className="executive-avatar" aria-hidden="true">{e.nombre?.trim().slice(0,1)}</span><div><b>{e.nombre}</b><small>{e.facturas} facturas</small></div></div><div className="executive-person-total"><span>Ventas del mes</span><strong>{money(e.total_vendido)}</strong></div><div className="sales-track"><span style={{width:Math.max(3,e.total_vendido/teamScale*100)+'%'}}/></div><div className="executive-commission"><span>Comisión</span><b>{money(e.comision)}</b></div></div>) : <Empty text="Sin ventas este mes"/>}</div>
    </Section>
    <Section number="05" title="Últimas facturas" subtitle="Los movimientos más recientes">
      <div className="executive-invoices">{facturas.slice(0,6).map(f => <div className="executive-invoice" key={f.id}><span className="executive-invoice-icon"><Icon name="doc"/></span><div><b>{numFactura(f)}</b><small>{fechaHora(f.fecha)}</small><small>{f.perfiles?.nombre}</small></div><div><strong>{money(f.total)}</strong>{f.estado==='anulada' && <Badge tone="bad">Anulada</Badge>}</div></div>)}</div>
    </Section>
  </div>
}
