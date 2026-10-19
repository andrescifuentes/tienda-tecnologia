import { useEffect, useRef, useState } from 'react'
import AppShell, { ThemeToggle } from '../components/AppShell'
import { Brand } from '../components/TechVisuals'
import ModuleBanner from '../components/ModuleBanner'
import FacturaDetalle from '../components/FacturaDetalle'
import { SalesReportList } from '../components/SalesPeriodDetail'
import { ErrorBox, Select, Input } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { supabase, isDemoMode } from '../lib/supabase'
import { hoyBogota } from '../lib/format'
import { reportRange, loadSalesReport, loadContactReport, salesCsv, contactsCsv, downloadCsv } from '../lib/reportExports'
import '../styles/reports.css'
export default function Reportes(){
 const {perfil,esAdmin}=useAuth(),[kind,setKind]=useState('hoy'),[custom,setCustom]=useState({desde:hoyBogota().slice(0,7)+'-01',hasta:hoyBogota()}),[report,setReport]=useState(null),[contacts,setContacts]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(''),[invoice,setInvoice]=useState(null),request=useRef(null)
 useEffect(()=>()=>request.current?.abort(),[])
 const invalidate=()=>{request.current?.abort();setBusy('');setReport(null);setError('')}
 useEffect(()=>{invalidate()},[kind,custom.desde,custom.hasta])
 if(!esAdmin)return <AppShell title="Reportes"><ErrorBox text="Solo el administrador puede exportar información del negocio."/></AppShell>
 async function prepare(type){request.current?.abort();const controller=new AbortController();request.current=controller;setBusy(type);setError('');if(type==='ventas')setReport(null);else setContacts(null)
  try{const auth={esAdmin,perfilId:perfil.id};if(type==='ventas'){const range=reportRange(kind,custom),data=await loadSalesReport(supabase,{auth,range,demo:isDemoMode,signal:controller.signal});if(!controller.signal.aborted)setReport(data)}else{const rows=await loadContactReport(supabase,{auth,signal:controller.signal});if(!controller.signal.aborted)setContacts(rows)}}catch(e){if(!controller.signal.aborted)setError(e.message)}finally{if(request.current===controller)setBusy('')}
 }
 return <AppShell title="Reportes" header={<div className="inv-head"><div className="inv-head-top"><Brand compact/><ThemeToggle/></div><ModuleBanner modulo="mas" title="Reportes" sub="Exportaciones autorizadas del negocio"/></div>}><section className="card report-controls"><h2>Exportar ventas</h2><p className="report-note">CSV compatible con Excel. Una fila por factura: productos agrupados, sin duplicar importes. Fechas de Colombia.</p><Select label="Período de exportación" value={kind} onChange={e=>setKind(e.target.value)}><option value="hoy">Hoy</option><option value="semana">Esta semana</option><option value="mes">Este mes</option><option value="rango">Rango personalizado</option></Select>{kind==='rango'&&<div className="report-dates"><Input label="Desde" type="date" value={custom.desde} onChange={e=>setCustom({...custom,desde:e.target.value})}/><Input label="Hasta" type="date" value={custom.hasta} onChange={e=>setCustom({...custom,hasta:e.target.value})}/></div>}<button className="btn full" disabled={!!busy} onClick={()=>prepare('ventas')}>{busy==='ventas'?'Consultando…':'Preparar ventas'}</button>{report&&<button className="btn sec full" onClick={()=>downloadCsv(salesCsv(report),'angie-ventas-'+report.range.desde+'-'+report.range.hasta+'.csv')}>Descargar ventas CSV</button>}</section><ErrorBox text={error}/>{report&&<><p className="report-note">{report.range.desde} — {report.range.hasta}. Total documento conserva el valor original; ventas netas excluye anuladas y pendientes.</p><SalesReportList report={report} onInvoice={setInvoice}/></>}<section className="card report-controls"><h2>Exportar contactos</h2><p className="report-note">Solo datos de clientes autorizados por los permisos del negocio. El archivo contiene información personal: compártelo únicamente con personas autorizadas.</p><button className="btn sec full" disabled={!!busy} onClick={()=>prepare('contactos')}>{busy==='contactos'?'Consultando…':'Preparar contactos'}</button>{contacts&&<><p className="report-note">{contacts.length} contactos consultados.</p><button className="btn full" onClick={()=>downloadCsv(contactsCsv(contacts),'angie-contactos.csv')}>Descargar contactos CSV</button></>}</section>{invoice&&<FacturaDetalle id={invoice} onClose={()=>setInvoice(null)} onCambio={()=>{setInvoice(null);setReport(null)}}/>}</AppShell>
}
