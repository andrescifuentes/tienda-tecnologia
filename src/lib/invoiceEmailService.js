const safeMessages={PREVIEW_CHANGED:'El mensaje cambió. Revisa la nueva vista previa y confirma otra vez.',BACKEND_OUTDATED:'Falta actualizar el servicio de correo para confirmar la plantilla vigente. Usa Compartir PDF.',MISSING_CONFIG:'Falta configurar el servicio de correo de la tienda.',MIGRATION_REQUIRED:'Falta activar el envío de correo en el servidor.',FORBIDDEN:'No tienes permiso para enviar esta factura.',INVALID_EMAIL:'Revisa el correo del destinatario.',UNAUTHENTICATED:'Inicia sesión para enviar la factura.',RATE_LIMIT:'Alcanzaste el límite de envíos. Espera antes de reintentar.',SEND_IN_PROGRESS:'El envío está en proceso. Espera y vuelve a comprobar.',MANUAL_REVIEW_REQUIRED:'El envío anterior requiere revisión antes de repetirlo.',RESULT_UNKNOWN:'No se pudo confirmar la respuesta. Reintenta para comprobar el mismo envío.',PROVIDER_REJECTED:'El proveedor rechazó el envío. Puedes reintentar de forma segura.',ATTACHMENT_TOO_LARGE:'El PDF supera el tamaño permitido.',PDF_FAILED:'No se pudo preparar el PDF.',DATABASE_FAILED:'No se pudo registrar el envío.',INVOICE_NOT_ISSUED:'Solo se pueden enviar facturas emitidas.',INVOICE_NOT_FOUND:'La factura no está disponible.'}
export function validateInvoiceRecipient(email) {return typeof email==='string'&&email.trim().length<=254&&/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(email.trim())}
export async function requestInvoiceEmail(client,{action,facturaId,destinatario,version},signal) {
 let timer
 try{
  if(action==='send'&&!validateInvoiceRecipient(destinatario))throw Error(safeMessages.INVALID_EMAIL)
  if(!client?.functions?.invoke)throw Error(safeMessages.MISSING_CONFIG)
  const controller=new AbortController(),cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel()
  let result
  try{result=await Promise.race([client.functions.invoke('enviar-factura-correo',{body:{action,facturaId,destinatario,...(version?{version}:{})},signal:controller.signal}),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error(safeMessages.RESULT_UNKNOWN))},30000)})])}finally{signal?.removeEventListener('abort',cancel)}
  let data=result.data
  if(result.error){try{data=await result.error.context?.json()}catch{}throw Object.assign(Error(safeMessages[data?.code]||'El servicio de correo no está disponible. Tu factura sigue guardada; usa Más opciones.'),{code:data?.code,...(data?.code==='PREVIEW_CHANGED'&&typeof data.preview?.asunto==='string'&&typeof data.preview?.mensaje==='string'&&/^[a-f0-9]{64}$/.test(data.preview?.version||'')?{preview:data.preview}:{})})}
  if(!data?.ok)throw Error(safeMessages[data?.code]||'No se pudo completar el envío.')
  if(action==='send'&&!(data.accepted===true&&data.estado==='aceptado'&&typeof data.proveedorId==='string'&&data.proveedorId))throw Error(safeMessages.RESULT_UNKNOWN)
  return data
 }catch(error){if(Object.values(safeMessages).includes(error?.message)||error?.message?.startsWith('El servicio de correo')||error?.message==='No se pudo completar el envío.')throw error;throw Error('El servicio de correo no está disponible. Tu factura sigue guardada; usa Más opciones.')}finally{clearTimeout(timer)}
}
