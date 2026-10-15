import FacturaDetalle from './FacturaDetalle'
import CompraDetalle from './CompraDetalle'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Modal from './Modal'
import { Empty, ErrorBox, Loader, SearchBar } from './ui'
import { fecha, money } from '../lib/format'
import '../styles/profile-finance.css'

export default function FinanceDetail({ type, rows, total, breakdown, period, month, onMonth, loading, error, onClose, onChanged }) {
  const [query,setQuery]=useState(''),[selected,setSelected]=useState(null)
  const position=useRef(null),restorePosition=useRef(false)
  useEffect(()=>{setQuery('');setSelected(null);position.current=null},[period.ini,type])
  const openRow=(row,event)=>{const body=event.currentTarget.closest('.sheet-body');position.current=body?{body,top:body.scrollTop,left:body.scrollLeft}:null;setSelected(row)}
  const closeRow=()=>{restorePosition.current=true;setSelected(null)}
  useLayoutEffect(()=>{if(selected||loading||!restorePosition.current)return;const saved=position.current;if(saved?.body.isConnected){saved.body.scrollTop=saved.top;saved.body.scrollLeft=saved.left}restorePosition.current=false},[selected,loading,rows])
  const validId=id=>Number.isSafeInteger(Number(id))&&Number(id)>0

  const label = type==='ingreso'?'Ingresos':'Gastos'
  const sum = rows.reduce((n,row)=>n+row.amount,0)
  const mismatch = !loading && !error && sum !== total
  const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es')
  const visible = rows.filter(row=>normalize([row.concept,row.origin,row.reference].join(' ')).includes(normalize(query.trim())))
  return <><Modal title={`Detalle de ${label.toLowerCase()}`} subtitle="Los movimientos detrás de tu resumen mensual" className="premium-account-sheet finance-detail-sheet" keyboardAware onClose={onClose} footer={<div className="finance-detail-total"><span>Total del período · COP</span><strong>{loading?'…':money(total)}</strong></div>}>
    <div className="finance-detail-period"><button className="btn sec sm" aria-label="Mes anterior del detalle" onClick={()=>onMonth(month-1)}>‹</button><b>{period.label}</b><button className="btn sec sm" aria-label="Mes siguiente del detalle" disabled={month>=0} onClick={()=>onMonth(month+1)}>›</button></div>
    {loading?<Loader/>:<><ErrorBox text={error || (mismatch?'No se pudo conciliar el detalle con el resumen. Vuelve a abrirlo.':'')}/>
      {!error&&!mismatch&&<><section className="finance-detail-hero"><p>{label} del período</p><strong>{money(total)}</strong><small>{rows.length} {rows.length===1?'registro':'registros'}{type==='ingreso'?' · Ventas netas y otros ingresos':' · Movimientos manuales'}</small></section>
      {breakdown&&<section className="finance-reconciliation" aria-label="Conciliación de ingresos"><h4>Cómo se obtiene este total</h4><dl><div><dt>Ventas emitidas ({breakdown.issuedCount})</dt><dd>{money(breakdown.grossSales)}</dd></div><div><dt>Devoluciones descontadas</dt><dd>−{money(breakdown.returns)}</dd></div><div><dt>Ventas netas</dt><dd>{money(breakdown.netSales)}</dd></div><div><dt>Otros ingresos</dt><dd>{money(breakdown.otherIncome)}</dd></div><div><dt>Ingresos conciliados</dt><dd>{money(breakdown.total)}</dd></div></dl><p>{breakdown.cancelledCount} facturas anuladas excluidas · {money(breakdown.cancelledTotal)}. Las devoluciones se descuentan de la venta original, como en el resumen.</p></section>}
      {rows.length>0&&<><SearchBar value={query} onChange={setQuery} placeholder="Filtrar por concepto o referencia"/>{query.trim()&&<p className="finance-detail-filter-summary" role="status">{visible.length} resultados · {money(visible.reduce((n,row)=>n+row.amount,0))} en esta búsqueda</p>}</>}
      {rows.length===0?<Empty text={`Sin ${label.toLowerCase()} este mes`}/>:visible.length===0?<Empty text="Sin coincidencias"/>:<div className="finance-detail-list">{visible.map(row=><button type="button" key={row.id} className={'finance-detail-row '+type} data-amount={row.amount} onClick={event=>openRow(row,event)} aria-label={row.invoiceId?'Ver factura '+row.reference:row.purchaseId?'Ver compra '+row.reference:'Ver movimiento '+row.concept}><span className="detail-symbol" aria-hidden="true">{type==='ingreso'?'↗':'↙'}</span><div><h4>{row.concept}</h4><p>{row.origin}</p><footer><small>{fecha(row.date)}{row.reference?' · '+row.reference:''}</small><b>{money(row.amount)}</b></footer></div></button>)}</div>}</>}
    </>}
  </Modal>
  {selected&&(validId(selected.invoiceId)?<FacturaDetalle id={Number(selected.invoiceId)} onClose={closeRow} onCambio={onChanged}/>:validId(selected.purchaseId)?<CompraDetalle id={Number(selected.purchaseId)} onClose={closeRow}/>:<Modal title="Detalle del movimiento" subtitle="Datos registrados" className="premium-account-sheet finance-movement-detail" onClose={closeRow}><section className="finance-reconciliation"><h4>{selected.concept}</h4><dl><div><dt>Fecha</dt><dd>{fecha(selected.date)}</dd></div><div><dt>Tipo</dt><dd>{selected.type==='gasto'?'Gasto':'Ingreso'}</dd></div><div><dt>Origen</dt><dd>{selected.origin}</dd></div>{selected.reference&&<div><dt>Referencia</dt><dd>{selected.reference}</dd></div>}{selected.movement?.metodo_pago&&<div><dt>Medio de pago</dt><dd>{selected.movement.metodo_pago}</dd></div>}{selected.movement?.estado&&<div><dt>Estado registrado</dt><dd>{selected.movement.estado}</dd></div>}<div><dt>Importe registrado</dt><dd>{money(selected.amount)}</dd></div></dl><p>Este movimiento no tiene una compra o factura vinculada. Solo se muestran los datos disponibles.</p></section></Modal>)}
  </>
}
