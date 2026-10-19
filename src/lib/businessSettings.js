import { withDeadline, cancellableQuery, requireData } from './asyncResult.js'
import { businessDraft, validateBusinessSettings } from '../../supabase/functions/_shared/business-settings.js'
export { BUSINESS_FIELDS, BUSINESS_LIMITS, businessDraft, validateBusinessSettings, validateBusinessLogo } from '../../supabase/functions/_shared/business-settings.js'
export async function loadBusinessSettings(client,signal){return withDeadline(async abort=>{const store=requireData(await cancellableQuery(client.from('tienda').select('*').eq('id',1).maybeSingle(),abort));if(!store)throw Error('No se pudieron consultar los datos de la empresa.');return{store,draft:businessDraft(store),available:['razon_social','nit_dv','ciudad','whatsapp','logo_data_url'].every(key=>Object.hasOwn(store,key))}},{signal})}
export async function saveBusinessSettings(client,input,{esAdmin=false,signal}={}){
 if(!esAdmin)throw Error('Solo el administrador puede modificar los datos de la empresa.')
 const value=validateBusinessSettings(input)
 try{return await withDeadline(async abort=>requireData(await cancellableQuery(client.rpc('guardar_datos_empresa',{p_datos:value}),abort)),{signal})}
 catch(error){if(/PGRST20[24]|42703|42883|does not exist|schema cache/i.test(String(error.code)+' '+error.message))throw Error('Datos de empresa pendientes de activación en Supabase (SQL 13). Tus cambios no se guardaron.');throw error}
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
 catch(error){if(/PGRST20[24]|42703|42883|does not exist|schema cache/i.test(String(error.code)+' '+error.message))return{snapshot:null,notice:notice+' Activación de historial empresarial pendiente (SQL 13).'};throw error}
}
