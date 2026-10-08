import { money } from '../lib/format'
import { Icon } from './Icons'

// Present existing totals on one scale; these are category totals, not market OHLC data.
export default function BalanceChart({ ventas, ingresos, gastos, utilidad, demo, showProfit = true }) {
  const values = [
    { label:'Ventas', value:ventas, tone:'sales' },
    { label:'Otros ingresos', value:ingresos, tone:'income' },
    { label:'Gastos', value:gastos, tone:'expense' },
    ...(showProfit ? [{ label:demo?'Utilidad':'Resultado', value:utilidad, tone:utilidad<0?'expense':'profit' }] : []),
  ]
  const high = Math.max(...values.map(item=>item.value),0)
  const low = Math.min(...values.map(item=>item.value),0)
  const scale = high-low || 1
  return <section className="card finance-chart market-balance"><div className="finance-balance-heading"><span className="document-symbol"><Icon name="chart"/></span><div><span className="premium-eyebrow">TU ACTIVIDAD FINANCIERA</span><h2>Balance del mes</h2></div><span className="finance-currency">COP</span></div>
    <p className="balance-caption">Totales del período · escala común</p>
    <svg className="balance-candles" viewBox="0 0 320 166" role="img" aria-label={values.map(item=>`${item.label}: ${money(item.value)}`).join('; ')}>
      {[24,62,100,138].map(y=><line className="balance-grid-line" key={y} x1="8" x2="312" y1={y} y2={y}/>)}
      {values.map((item,index)=>{
        const x=40+index*80, zero=16+high/scale*122, end=zero-item.value/scale*122
        return <g key={item.label} className={'balance-candle '+item.tone}><title>{item.label}: {money(item.value)}</title><line x1={x} x2={x} y1={zero} y2={end}/><line x1={x-12} x2={x+12} y1={zero} y2={zero}/><rect x={x-9} y={Math.min(zero,end)} width="18" height={Math.max(Math.abs(zero-end),1)} rx="3"/><line x1={x-14} x2={x+14} y1={end} y2={end}/></g>
      })}
    </svg>
    <div className="balance-key">{values.map(item=><div className={'chart-row balance-'+item.tone} key={item.label}><span><i/>{item.label}</span><b>{money(item.value)}</b></div>)}</div>
    <p>Ventas netas de facturas y movimientos manuales del período.{showProfit ? (demo?' Las compras de inventario se reflejan como mercancía; la utilidad descuenta el costo vendido.':' El resultado no incluye el costo de mercancía.') : ''}</p>
  </section>
}
