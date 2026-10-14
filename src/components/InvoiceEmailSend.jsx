import { useEffect, useRef, useState } from 'react'
import { I } from './InvIcons'
import { ErrorBox } from './ui'
import { supabase, isDemoMode } from '../lib/supabase'
import { requestInvoiceEmail, validateInvoiceRecipient } from '../lib/invoiceEmailService'
import { invoiceIdentity, invoiceBusiness } from '../lib/invoiceSnapshot'
import { invoiceBrand } from '../../supabase/functions/_shared/invoice-brand.js'
import { money, numFactura } from '../lib/format'
import { quitarFocoEntrada } from '../lib/invoiceDelivery'
export default function InvoiceEmailSend({invoice,tienda,onCancel,onManual,onSent}) {
 const [meta,setMeta]=useState(null),[email,setEmail]=useState(''),[phase,setPhase]=useState('preparing'),[error,setError]=useState(''),[accepted,setAccepted]=useState(null)
 const generation=useRef(0),lock=useRef(false),controller=useRef(null),heading=useRef(null)
 useEffect(()=>{
  const token=++generation.current;controller.current=new AbortController();quitarFocoEntrada();heading.current?.scrollIntoView({block:'start'})
  const doc=invoiceIdentity(invoice)
  if(isDemoMode){setMeta({numero:numFactura(doc),total:doc.total,destinatario:doc.clientes?.correo||'',nombreComercial:invoiceBrand(invoiceBusiness(doc,tienda)),configured:false,identidadHistorica:true});setEmail(doc.clientes?.correo||'');setPhase('ready')}
  else requestInvoiceEmail(supabase,{action:'preview',facturaId:invoice.id},controller.current.signal).then(data=>{if(generation.current!==token)return;setMeta(data);setEmail(data.destinatario);setPhase('ready')}).catch(e=>{if(generation.current!==token)return;setError(e.message);setPhase('error')})
  return()=>{++generation.current;controller.current?.abort();lock.current=false}
 },[invoice.id])
 async function send(){
  quitarFocoEntrada();if(lock.current||isDemoMode||!meta?.configured||accepted)return
  if(!validateInvoiceRecipient(email))return setError('Revisa el correo del destinatario.')
  lock.current=true;const token=generation.current;setPhase('sending');setError('')
  try{const data=await requestInvoiceEmail(supabase,{action:'send',facturaId:invoice.id,destinatario:email.trim()},controller.current.signal);if(generation.current!==token)return;setAccepted(data);setPhase('accepted');onSent?.()}
  catch(e){if(generation.current===token){setError(e.message);setPhase('error')}}
  finally{if(generation.current===token)lock.current=false}
 }
 return <section className="invoice-preview invoice-email-preview invoice-email-send" aria-label="Enviar factura por correo">
  <header ref={heading} className="email-preview-head"><span className="email-preview-icon"><I n="mail" /></span><div><span className="email-preview-eyebrow">{meta?.nombreComercial||'Angie Tech'}</span><h4>Enviar factura por correo</h4><p>{meta?.numero||numFactura(invoice)} · {money(meta?.total??invoice.total)} COP</p></div></header>
  <p className="email-preview-status"><I n="receipt" />PDF adjunto automáticamente</p>
  <ErrorBox text={error}/>
  {phase==='preparing'&&<p className="email-preview-info" role="status">Preparando factura…</p>}
  {phase==='sending'&&<p className="email-preview-info" role="status">Enviando correo… Puedes cerrar; al reintentar se comprueba el mismo envío.</p>}
  {phase==='accepted'&&<p className="email-preview-info" role="status">Envío aceptado por el proveedor.{accepted?.alreadyAccepted?' Esta factura ya había sido aceptada.':''} La aceptación no confirma la entrega en la bandeja.{accepted?.registroPendiente?' El registro local del envío está pendiente de comprobación.':''}</p>}
  {meta&&<div className="email-preview-recipient"><label htmlFor="invoice-email-send-recipient">Destinatario</label><input id="invoice-email-send-recipient" type="email" inputMode="email" autoCapitalize="none" autoComplete="email" value={email} disabled={phase==='sending'||phase==='accepted'} onChange={e=>{setEmail(e.target.value);setError('')}} placeholder="cliente@correo.com"/><small>Se utiliza solo para este envío; no modifica al cliente.</small></div>}
  {isDemoMode&&<p className="email-preview-info">Modo demo local: no se envían correos reales. Puedes compartir o descargar el PDF desde Más opciones.</p>}
  {!isDemoMode&&meta&&!meta.configured&&<p className="email-preview-info">Falta configurar el servicio de correo de la tienda. Usa Más opciones mientras se activa.</p>}
  {meta?.identidadHistorica===false&&<p className="email-preview-info">Factura anterior al historial de identidad: importes y productos conservados; los datos de contacto y negocio disponibles son los actuales.</p>}
  <div className="email-preview-actions"><button type="button" className="btn email-confirm-send" disabled={phase==='preparing'||phase==='sending'||phase==='accepted'||!meta?.configured||isDemoMode} onClick={send}>{phase==='sending'?'Enviando…':phase==='error'?'Reintentar envío':'Confirmar envío'}</button><button type="button" className="btn sec" onClick={()=>{quitarFocoEntrada();onManual()}}>Más opciones</button><button type="button" className="email-preview-cancel" onClick={()=>{quitarFocoEntrada();onCancel()}}>{phase==='accepted'?'Cerrar':'Cancelar'}</button></div>
 </section>
}
