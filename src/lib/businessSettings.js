import { withDeadline, cancellableQuery, requireData } from './asyncResult.js'
import { businessDraft, validateBusinessSettings } from '../../supabase/functions/_shared/business-settings.js'
export { BUSINESS_FIELDS, BUSINESS_LIMITS, businessDraft, validateBusinessSettings, validateBusinessLogo } from '../../supabase/functions/_shared/business-settings.js'
export async function loadBusinessSettings(client,signal,{negocioId}={}){return withDeadline(async abort=>{let query=client.from('tienda').select('*');if(negocioId!=null)query=query.eq('id',negocioId);const store=requireData(await cancellableQuery(query.maybeSingle(),abort));if(!store)throw Error('No se pudieron consultar los datos de la empresa.');return{store,draft:businessDraft(store),available:['razon_social','nit_dv','ciudad','whatsapp','logo_data_url','local','datos_extra'].every(key=>Object.hasOwn(store,key))}},{signal})}
export async function saveBusinessSettings(client,input,{esAdmin=false,signal,store}={}){
 if(!esAdmin)throw Error('Solo el administrador puede modificar los datos de la empresa.')
 const value=validateBusinessSettings(input)
 try{return await withDeadline(async abort=>requireData(await cancellableQuery(client.rpc('guardar_datos_empresa',{p_datos:value}),abort)),{signal})}
 catch(error){
  const missing=/PGRST20[24]|42703|42883|does not exist|schema cache/i.test(String(error.code)+' '+error.message),pending='Datos de empresa pendientes de activación en Supabase (SQL 13 posterior a SQL 10 y 15). Tus cambios no se guardaron.'
  if(!missing)throw error
  // Preserve Andres' deployed editor through its existing administrator/business RLS.
  if(!store?.id)throw Error(pending)
  const payload={}
  for(const[key,data]of Object.entries(value)){if(Object.hasOwn(store,key))payload[key]=data;else if(key!=='nit_dv'&&(Array.isArray(data)?data.length:!!data))throw Error(pending)}
  if(!Object.hasOwn(store,'nit_dv')&&value.nit_dv)payload.nit=value.nit+'-'+value.nit_dv
  if(!Object.hasOwn(payload,'nombre'))throw Error(pending)
  return withDeadline(async abort=>{const saved=requireData(await cancellableQuery(client.from('tienda').update(payload).eq('id',store.id).select('id').single(),abort));if(saved?.id!==store.id)throw Error('No se pudo confirmar el guardado de la empresa.');return saved},{signal})
 }
}
export async function readBusinessLogo(file){
 if(!file||!['image/png','image/jpeg'].includes(file.type)||file.size>5*1024*1024)throw Error('Elige un PNG o JPG de hasta 5 MB.')
 const url=URL.createObjectURL(file)
 try{const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('No se pudo leer la imagen. Elige otro PNG o JPG.'));img.src=url});if(!image.naturalWidth||!image.naturalHeight)throw Error('La imagen no tiene un tamaño válido.');const scale=Math.min(1,512/Math.max(image.naturalWidth,image.naturalHeight)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));const ctx=canvas.getContext('2d');if(!ctx)throw Error('No se pudo preparar el logo.');ctx.drawImage(image,0,0,canvas.width,canvas.height);let data=canvas.toDataURL('image/png');if(data.length>350000)data=canvas.toDataURL('image/jpeg',0.85);return validateBusinessSettings({...businessDraft({nombre:'Logo'}),logo_data_url:data}).logo_data_url}finally{URL.revokeObjectURL(url)}
}

export async function loadInvoiceBusinessSnapshot(client,invoice,signal){
 if(invoice?.tienda_snapshot&&typeof invoice.tienda_snapshot==='object'&&!Array.isArray(invoice.tienda_snapshot))return{snapshot:invoice.tienda_snapshot,notice:''}
 const notice='Factura sin identidad histórica del negocio disponible: se muestran los datos actuales. No se puede reconstruir la información original.'
 try{const snapshot=await withDeadline(async abort=>requireData(await cancellableQuery(client.rpc('empresa_factura_snapshot',{p_factura_id:invoice?.id}),abort)),{signal});if(snapshot!==null&&(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)))throw Error('El servidor devolvió una identidad de empresa no válida.');return{snapshot,notice:snapshot?'':notice}}
 catch(error){if(/PGRST20[24]|42703|42883|does not exist|schema cache/i.test(String(error.code)+' '+error.message))return{snapshot:null,notice:notice+' Activación de historial empresarial pendiente (SQL 13 posterior a SQL 10 y 15).'};throw error}
}
