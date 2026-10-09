import { useEffect, useState } from 'react'
import Modal from './Modal'
import { Empty, ErrorBox, Loader, SearchBar } from './ui'
import { fecha, money } from '../lib/format'
import '../styles/profile-finance.css'

export default function FinanceDetail({ type, rows, total, period, month, onMonth, loading, error, onClose }) {
  const [query, setQuery] = useState('')
  useEffect(()=>setQuery(''),[period.ini,type])
  const label = type==='ingreso'?'Ingresos':'Gastos'
  const sum = rows.reduce((n,row)=>n+row.amount,0)
  const mismatch = !loading && !error && sum !== total
  const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es')
  const visible = rows.filter(row=>normalize([row.concept,row.origin,row.reference].join(' ')).includes(normalize(query.trim())))
  return <Modal title={`Detalle de ${label.toLowerCase()}`} subtitle="Los movimientos detrás de tu resumen mensual" className="premium-account-sheet finance-detail-sheet" keyboardAware onClose={onClose} footer={<div className="finance-detail-total"><span>Total del período · COP</span><strong>{loading?'…':money(total)}</strong></div>}>
    <div className="finance-detail-period"><button className="btn sec sm" aria-label="Mes anterior del detalle" onClick={()=>onMonth(month-1)}>‹</button><b>{period.label}</b><button className="btn sec sm" aria-label="Mes siguiente del detalle" disabled={month>=0} onClick={()=>onMonth(month+1)}>›</button></div>
    {loading?<Loader/>:<><ErrorBox text={error || (mismatch?'No se pudo conciliar el detalle con el resumen. Vuelve a abrirlo.':'')}/>
      {!error&&!mismatch&&<><section className="finance-detail-hero"><p>{label} del período</p><strong>{money(total)}</strong><small>{rows.length} {rows.length===1?'registro':'registros'}{type==='ingreso'?' · Ventas netas y otros ingresos':' · Movimientos manuales'}</small></section>
      {rows.length>0&&<><SearchBar value={query} onChange={setQuery} placeholder="Filtrar por concepto o referencia"/>{query.trim()&&<p className="finance-detail-filter-summary" role="status">{visible.length} resultados · {money(visible.reduce((n,row)=>n+row.amount,0))} en esta búsqueda</p>}</>}
      {rows.length===0?<Empty text={`Sin ${label.toLowerCase()} este mes`}/>:visible.length===0?<Empty text="Sin coincidencias"/>:<div className="finance-detail-list">{visible.map(row=><article key={row.id} className={'finance-detail-row '+type} data-amount={row.amount}><span className="detail-symbol" aria-hidden="true">{type==='ingreso'?'↗':'↙'}</span><div><h4>{row.concept}</h4><p>{row.origin}</p><footer><small>{fecha(row.date)}{row.reference?' · '+row.reference:''}</small><b>{money(row.amount)}</b></footer></div></article>)}</div>}</>}
    </>}
  </Modal>
}
