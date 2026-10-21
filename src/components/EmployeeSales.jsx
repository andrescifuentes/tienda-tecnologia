import { useEffect, useState } from 'react'
import Modal from './Modal'
import FacturaDetalle from './FacturaDetalle'
import FitAmount from './FitAmount'
import { Loader, ErrorBox, Empty, Badge } from './ui'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { employeeRange, loadEmployeeSales, invoiceNetCommission } from '../lib/employeeSales'
import { hoyBogota, money, numFactura, fechaHora } from '../lib/format'
import '../styles/team-observations.css'
export default function EmployeeSales({employee,onClose,embedded=false,onChange}){
 const {perfil,esAdmin}=useAuth(),[period,setPeriod]=useState('mes'),[custom,setCustom]=useState({desde:hoyBogota().slice(0,7)+'-01',hasta:hoyBogota()}),[data,setData]=useState(null),[error,setError]=useState(''),[invoice,setInvoice]=useState(null),[retry,setRetry]=useState(0)
 const allowed=esAdmin||employee.vendedor_id===perfil.id
 useEffect(()=>{if(!allowed)return;let live=true;const controller=new AbortController();setData(null);setError('');let range
  try{range=employeeRange(period,custom)}catch(e){setError(e.message);return}
  loadEmployeeSales(supabase,{perfilId:perfil.id,esAdmin,vendedorId:employee.vendedor_id,range,signal:controller.signal}).then(result=>{if(live)setData(result)}).catch(e=>{if(live)setError(e.message)});return()=>{live=false;controller.abort()}
 },[employee.vendedor_id,perfil.id,esAdmin,period,custom.desde,custom.hasta,retry,allowed])
 if(!allowed)return embedded?<ErrorBox text="No tienes permiso para consultar otro empleado."/>:<Modal title="Mis ventas" onClose={onClose}><ErrorBox text="No tienes permiso para consultar otro empleado."/></Modal>
 const range=(()=>{try{return employeeRange(period,custom)}catch{return null}})()
 const body=<>
  <div className="sales-periods" role="group" aria-label="Período de ventas">{[['hoy','Hoy'],['semana','Esta semana'],['mes','Este mes'],['rango','Rango']].map(([value,label])=><button type="button" key={value} aria-pressed={period===value} onClick={()=>setPeriod(value)}>{label}</button>)}</div>
  {period==='rango'&&<div className="sales-date-range"><label>Desde<input aria-label="Ventas desde" type="date" value={custom.desde} onChange={e=>setCustom(s=>({...s,desde:e.target.value}))}/></label><label>Hasta<input aria-label="Ventas hasta" type="date" value={custom.hasta} onChange={e=>setCustom(s=>({...s,hasta:e.target.value}))}/></label></div>}
  {range&&<p className="sales-period-caption">{range.desde} — {range.hasta}</p>}
  <ErrorBox text={error}/>{error&&<button type="button" className="btn sec full" onClick={()=>setRetry(n=>n+1)}>Reintentar ventas</button>}
  {!data&&!error?<Loader/>:data&&<><div className="employee-sales-summary"><div><small>Ventas netas</small><strong><FitAmount>{money(data.total)}</FitAmount></strong></div><div><small>Facturas emitidas</small><strong>{data.count}</strong></div><div className="employee-sales-commission"><small>Comisión neta del período</small><strong><FitAmount>{money(data.commission)}</FitAmount></strong></div></div><p className="sales-period-caption">Las anulaciones no suman. Las devoluciones se descuentan según el cálculo existente.</p><div className="employee-sales-list">{data.invoices.length?data.invoices.map(f=><article className={'employee-sale '+f.estado} key={f.id}><button type="button" className="employee-sale-open" data-factura-id={f.id} onClick={()=>setInvoice(f.id)}><div><b>{numFactura(f)}</b><small>{fechaHora(f.fecha)} · {f.metodo_pago}</small></div><div><strong><FitAmount>{money(f.estado==='emitida'?f.total_neto??f.total:f.total)}</FitAmount></strong><Badge tone={f.estado==='anulada'?'bad':f.estado==='emitida'?'good':'warn'}>{f.estado==='anulada'?'Anulada':f.estado==='emitida'?'Emitida':'Pendiente'}</Badge></div></button><div className="employee-sale-commission"><span>Comisión neta</span><b><FitAmount>{money(invoiceNetCommission(f))}</FitAmount></b></div><ul className="employee-sale-products">{data.items.filter(i=>i.factura_id===f.id).map(i=><li key={i.id}><div><b>{i.nombre}</b><small>{i.cantidad} × {money(i.precio_unitario)}{i.serial&&' · Serial/IMEI: '+i.serial}</small>{i.devueltas>0&&<small className="warn">Devueltas: {i.devueltas} · Vigentes: {Math.max(0,i.cantidad-i.devueltas)}</small>}</div><span>{money(i.cantidad*i.precio_unitario-Number(i.descuento||0))}</span></li>)}</ul><p className="sales-line-note">Importes de líneas antes del descuento general de la factura.</p></article>):<Empty text="Sin ventas en este período"/>}</div></>}
 </>
 return <>{embedded?<section className="employee-sales-embedded" aria-label={"Ventas y comisiones de "+employee.nombre}>{body}</section>:<Modal title={employee.nombre||perfil.nombre} subtitle="Detalle de ventas · importes netos" className="experience-sheet employee-sales-sheet" keyboardAware validateFooter={false} restoreInputFocus={false} onClose={onClose} footer={<button type="button" className="btn full" onClick={onClose}>Volver al resumen</button>}>{body}</Modal>}{invoice&&<FacturaDetalle id={invoice} onCambio={()=>{setRetry(n=>n+1);onChange?.()}} onClose={()=>setInvoice(null)}/>}</>
}
