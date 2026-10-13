import { invoiceBrand } from '../_shared/invoice-brand.js'
const cors = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods':'POST, OPTIONS' }
const number = f => f.prefijo + '-' + String(f.numero).padStart(4,'0')
const validEmail = value => typeof value==='string' && value.length<=254 && /^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(value)
const escape = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
export function emailTemplate(document) {
 const f=document.invoice, brand=invoiceBrand(document.tienda), name=(f.clientes?.nombre||'').trim().split(/\s+/)[0]
 const amount='$'+Math.round(Number(f.total)).toLocaleString('es-CO')+' COP', invoice=number(f)
 const text=[name?'Hola, '+name+'.':'Hola.','', 'Gracias por tu compra en '+brand+'.','Adjuntamos la factura '+invoice+' correspondiente a tu compra.','', 'Total de la compra: '+amount+'.','Puedes consultar el detalle completo en el archivo PDF adjunto.','', 'Gracias por confiar en nosotros.','', 'Atentamente,','Equipo '+brand].join('\n')
 const html='<html><body style="margin:0;background:#f4f1eb;font-family:Arial,sans-serif;color:#24211c"><div style="max-width:580px;margin:24px auto;background:#fff;border-radius:16px;overflow:hidden"><div style="background:#11100e;padding:28px;color:#e9cd92"><b style="font-size:22px">'+escape(brand)+'</b><p>Factura '+escape(invoice)+'</p></div><div style="padding:28px;line-height:1.65"><p>'+escape(name?'Hola, '+name+'.':'Hola.')+'</p><p>Gracias por tu compra en '+escape(brand)+'.</p><p>Adjuntamos la factura <b>'+escape(invoice)+'</b> correspondiente a tu compra.</p><div style="background:#f8f4eb;padding:18px;border-radius:10px">Total de la compra<br><b style="font-size:24px">'+escape(amount)+'</b></div><p>Puedes consultar el detalle completo en el archivo PDF adjunto.</p><p>Gracias por confiar en nosotros.</p><p>Atentamente,<br>Equipo '+escape(brand)+'</p></div></div></body></html>'
 return {subject:'Factura '+invoice+' | '+brand,text,html}
}
const messages={UNAUTHENTICATED:'Inicia sesión para enviar la factura.',FORBIDDEN:'No tienes permiso para enviar esta factura.',INVOICE_NOT_FOUND:'La factura no está disponible.',INVOICE_NOT_ISSUED:'Solo se pueden enviar facturas emitidas.',INVALID_EMAIL:'Revisa el correo del destinatario.',MISSING_CONFIG:'Falta configurar el servicio de correo de la tienda.',MIGRATION_REQUIRED:'Falta activar el servicio de correo en el servidor.',RATE_LIMIT:'Alcanzaste el límite de envíos. Espera antes de reintentar.',SEND_IN_PROGRESS:'Esta factura se está enviando. Espera y vuelve a comprobar.',MANUAL_REVIEW_REQUIRED:'El resultado anterior requiere revisión antes de otro envío.',ATTACHMENT_TOO_LARGE:'El PDF supera el tamaño permitido.',PROVIDER_REJECTED:'El proveedor rechazó el envío. Puedes reintentar sin duplicar la factura.',RESULT_UNKNOWN:'No se pudo confirmar el envío. Reintenta para consultar el mismo intento.',PDF_FAILED:'No se pudo preparar el PDF. La factura sigue disponible.',DATABASE_FAILED:'No se pudo registrar el envío. Inténtalo de nuevo.',INVALID_REQUEST:'Revisa los datos del envío.'}
class MailFailure extends Error { constructor(code,status=400){super(messages[code]||messages.DATABASE_FAILED);this.code=code;this.status=status} }
export function createInvoiceEmailHandler({ authenticate,rpc,renderPdf,env,fetchImpl=fetch,logger=console }) {
 return async req => {
  const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}})
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
  if(req.method!=='POST')return response({code:'METHOD',error:'Método no permitido.'},405)
  const trace=crypto.randomUUID();let record=null,providerStarted=false
  const call=async(name,args)=>{const result=await rpc(name,args);if(result.error){const raw=String(result.error.message||'');const code=Object.keys(messages).find(c=>raw.includes(c))||(/does not exist|schema cache|PGRST202/i.test(raw+' '+result.error.code)?'MIGRATION_REQUIRED':'DATABASE_FAILED');throw new MailFailure(code,code==='FORBIDDEN'?403:code==='RATE_LIMIT'?429:code==='SEND_IN_PROGRESS'?409:code==='MANUAL_REVIEW_REQUIRED'?409:500)}return result.data}
  const finish=async(state,id=null,code=null)=>{await call('correo_factura_finalizar',{p_envio:record.id,p_lock:record.lock_token,p_estado:state,p_proveedor:id,p_codigo:code})}
  try {
   let actor;try{actor=await authenticate(req)}catch{throw new MailFailure('UNAUTHENTICATED',401)}
   if(!actor)throw new MailFailure('UNAUTHENTICATED',401)
   let body;try{const raw=await req.text();if(raw.length>2048)throw Error();body=JSON.parse(raw)}catch{throw new MailFailure('INVALID_REQUEST')}
   if(!Number.isSafeInteger(body.facturaId)||body.facturaId<1||!['preview','send'].includes(body.action))throw new MailFailure('INVALID_REQUEST')
   const document=await call('correo_factura_documento',{p_actor:actor,p_factura:body.facturaId})
   const f=document?.invoice
   if(!f||!Array.isArray(document.items)||!document.items.length||!Number.isFinite(Number(f.total)))throw new MailFailure('PDF_FAILED',500)
   const from=env('INVOICE_EMAIL_FROM')?.trim(),key=env('RESEND_API_KEY')?.trim()
   const configured=!!(from&&key)
   const meta={numero:number(f),total:f.total,destinatario:f.clientes?.correo||'',nombreComercial:invoiceBrand(document.tienda),pdf:'Factura-'+number(f).replace(/[^a-zA-Z0-9-]/g,'')+'-Angie-Tech.pdf',identidadHistorica:document.identidad_historica!==false}
   if(body.action==='preview')return response({ok:true,...meta,configured})
   if(!configured)throw new MailFailure('MISSING_CONFIG',503)
   const recipient=String(body.destinatario||'').trim().toLowerCase()
   if(!validEmail(recipient))throw new MailFailure('INVALID_EMAIL')
   const reserved=await call('correo_factura_reservar',{p_actor:actor,p_factura:body.facturaId,p_destino:recipient})
   if(reserved.estado==='aceptado'&&reserved.proveedor_id)return response({ok:true,estado:'aceptado',accepted:true,envioId:reserved.id,proveedorId:reserved.proveedor_id,alreadyAccepted:true})
   record=await call('correo_factura_tomar',{p_actor:actor,p_envio:reserved.id})
   if(record.estado==='aceptado'&&record.proveedor_id)return response({ok:true,estado:'aceptado',accepted:true,envioId:record.id,proveedorId:record.proveedor_id,alreadyAccepted:true})
   let payload=record.payload
   if(!payload){
    let pdf;try{pdf=await renderPdf(document)}catch{throw new MailFailure('PDF_FAILED',500)}
    if(!pdf?.bytes||pdf.bytes.length>3*1024*1024)throw new MailFailure('ATTACHMENT_TOO_LARGE',413)
    if(new TextDecoder().decode(pdf.bytes.slice(0,5))!=='%PDF-')throw new MailFailure('PDF_FAILED',500)
    let binary='';for(let i=0;i<pdf.bytes.length;i+=8192)binary+=String.fromCharCode(...pdf.bytes.slice(i,i+8192))
    payload={from,to:[recipient],...emailTemplate(document),attachments:[{filename:meta.pdf,content:btoa(binary)}]}
    payload=await call('correo_factura_payload',{p_envio:record.id,p_lock:record.lock_token,p_payload:payload})
   }
   await call('correo_factura_iniciar',{p_envio:record.id,p_lock:record.lock_token});providerStarted=true
   const reply=await fetchImpl('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','Idempotency-Key':'angie-invoice/'+record.id},body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)})
   const data=await reply.json().catch(()=>null)
   if(!reply.ok){const uncertain=reply.status>=500||reply.status===409;await finish(uncertain?'incierto':'error',null,uncertain?'RESULT_UNKNOWN':'PROVIDER_REJECTED');record=null;throw new MailFailure(uncertain?'RESULT_UNKNOWN':'PROVIDER_REJECTED',502)}
   if(typeof data?.id!=='string'||!data.id.trim())throw new MailFailure('RESULT_UNKNOWN',502)
   let registroPendiente=false;try{await finish('aceptado',data.id)}catch{registroPendiente=true;logger.error({trace,code:'ACCEPTED_LOG_PENDING',envioId:record.id})}
   return response({ok:true,estado:'aceptado',accepted:true,envioId:record.id,proveedorId:data.id,registroPendiente})
  } catch(error) {
   const failure=error instanceof MailFailure?error:new MailFailure(providerStarted?'RESULT_UNKNOWN':'DATABASE_FAILED',502)
   if(record?.lock_token){try{await finish(providerStarted?'incierto':'error',null,failure.code)}catch{logger.error({trace,code:'SEND_LOG_PENDING',envioId:record.id})}}
   logger.error({trace,code:failure.code})
   return response({ok:false,accepted:false,code:failure.code,error:failure.message,trace},failure.status)
  }
 }
}
