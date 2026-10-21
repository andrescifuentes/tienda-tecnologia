import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Modal from './Modal'
import FacturaDetalle from './FacturaDetalle'
import { ErrorBox, Loader, Empty, SearchBar } from './ui'
import { useAuth } from '../context/AuthContext'
import { supabase, isDemoMode } from '../lib/supabase'
import { loadSalesReport, reportCents } from '../lib/reportExports'
import { fechaHora, money, numFactura } from '../lib/format'
import '../styles/reports.css'
export function SalesReportList({report,onInvoice}){
 const [query,setQuery]=useState('')
 const rows=report.invoices.filter(f=>[numFactura(f),f.cliente,f.vendedor,f.metodo_pago,...f.items.map(i=>i.nombre)].join(' ').toLocaleLowerCase('es').includes(query.trim().toLocaleLowerCase('es')))
 return <><div className="report-summary"><div><small>Ventas netas</small><strong>{money(report.summary.net)}</strong></div><div><small>Emitidas</small><b>{report.summary.issued}</b></div></div><p className="report-note">Brutas emitidas {money(report.summary.gross)} − devoluciones {money(report.summary.returns)}. {report.summary.cancelledCount} anuladas ({money(report.summary.cancelled)}) excluidas; {report.summary.pending} pendientes excluidas.</p><SearchBar value={query} onChange={setQuery} placeholder="Buscar factura, cliente o producto"/><div className="report-invoices">{rows.length?rows.map(f=><article className="card report-invoice" key={f.id}><button type="button" className="report-invoice-open" aria-label={'Abrir factura '+numFactura(f)} onClick={e=>onInvoice(f.id,e)}><div><b>{numFactura(f)}</b><small>{fechaHora(f.fecha)} · {f.estado}</small><span>{f.cliente}</span><small>{f.vendedor} · {f.metodo_pago}</small></div><strong>{money(f.estado==='emitida'?f.total_neto:0)}<small>{f.estado!=='emitida'?'Excluida':Number(f.total_neto)!==Number(f.total)?'Neto con devolución':'Neto'}</small></strong></button><p className="report-note">{f.items.map(i=>i.nombre+' × '+i.cantidad).join(' · ')||'Sin líneas disponibles'}{Number(f.descuento)>0?' · Descuento general: '+money(f.descuento):''}</p></article>):<Empty text="Sin ventas para esta búsqueda"/>}</div></>
}
export default function SalesPeriodDetail({range,expectedTotal,onClose,local=null}){
 const {perfil,esAdmin}=useAuth(),[report,setReport]=useState(null),[error,setError]=useState(''),[invoice,setInvoice]=useState(null),[retry,setRetry]=useState(0),position=useRef(null),restore=useRef(false)
 useEffect(()=>{let live=true;const controller=new AbortController();setReport(null);setError('');loadSalesReport(supabase,{auth:{perfilId:perfil.id,esAdmin},range,demo:isDemoMode,signal:controller.signal,local}).then(value=>{if(live)setReport(value)}).catch(e=>{if(live)setError(e.message)});return()=>{live=false;controller.abort()}},[range.desde,range.hasta,perfil.id,esAdmin,retry])
 useLayoutEffect(()=>{if(!invoice&&report&&restore.current){if(position.current?.body.isConnected)position.current.body.scrollTop=position.current.top;restore.current=false}},[invoice,report])
 const open=(id,e)=>{const body=e.currentTarget.closest('.sheet-body');position.current=body?{body,top:body.scrollTop}:null;setInvoice(id)}
 return <><Modal title="Movimientos de ventas" subtitle={range.desde+' — '+range.hasta+' · Colombia'} className="experience-sheet sales-report-sheet" keyboardAware restoreInputFocus={false} onClose={onClose} footer={<button type="button" className="btn full" onClick={onClose}>Volver al resumen</button>}><ErrorBox text={error}/>{error&&<button className="btn sec full" onClick={()=>setRetry(n=>n+1)}>Reintentar ventas</button>}{!error&&!report&&<Loader/>}{report&&<>{expectedTotal!=null&&reportCents(report.summary.net)!==reportCents(expectedTotal)&&<ErrorBox text="El detalle consultado cambió respecto al resumen. Actualiza el resumen para verificar la conciliación; no se presentan ambos totales como equivalentes."/>}<SalesReportList report={report} onInvoice={open}/></>}</Modal>{invoice&&<FacturaDetalle id={invoice} onCambio={()=>setRetry(n=>n+1)} onClose={()=>{restore.current=true;setInvoice(null)}}/>}</>
}
