import { withDeadline, requireData, cancellableQuery } from './asyncResult.js'
import { DEFAULT_INVOICE_MESSAGES, validateInvoiceMessages } from '../../supabase/functions/_shared/invoice-messages.js'
export { DEFAULT_INVOICE_MESSAGES, MESSAGE_VARIABLES, validateInvoiceMessages, renderInvoiceMessages } from '../../supabase/functions/_shared/invoice-messages.js'
export async function loadInvoiceMessageStore(client,signal){
 return withDeadline(async abort=>{const row=requireData(await cancellableQuery(client.from('tienda').select('*').eq('id',1).maybeSingle(),abort));if(!row)throw Error('No se pudo consultar la configuración de mensajes.');return {...row,plantillas_factura:validateInvoiceMessages(row.plantillas_factura||DEFAULT_INVOICE_MESSAGES)}},{signal})
}
export async function saveInvoiceMessages(client,messages,{esAdmin=false,signal}={}){
 if(!esAdmin)throw Error('Solo el administrador puede modificar las plantillas.')
 const value=validateInvoiceMessages(messages)
 try{const saved=await withDeadline(async abort=>{const saved=requireData(await cancellableQuery(client.rpc('guardar_plantillas_factura',{p_plantillas:value}),abort));return validateInvoiceMessages(saved)},{signal});globalThis.window?.dispatchEvent(new Event('invoice-message-templates-change'));return saved}
 catch(error){if(/PGRST20[24]|42703|42883|does not exist|schema cache/i.test(String(error.code)+' '+error.message))throw Error('La configuración de plantillas aún no está activada en el servidor. Tus cambios no se guardaron.');throw error}
}
