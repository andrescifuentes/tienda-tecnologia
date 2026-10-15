import { invoiceBrand } from './invoice-brand.js'
export const MESSAGE_VARIABLES=Object.freeze(['cliente','numero_factura','fecha','total','nombre_negocio','productos'])
export const DEFAULT_INVOICE_MESSAGES=Object.freeze({
 asunto_correo:'Factura {numero_factura} | {nombre_negocio}',
 mensaje_correo:'Hola, {cliente}.\n\nGracias por tu compra en {nombre_negocio}.\n\nAdjuntamos la factura {numero_factura}, correspondiente a tu compra por {total}.\n\nPuedes consultar los detalles en el PDF adjunto.\n\nGracias por confiar en nosotros.\n\nAtentamente,\nEquipo {nombre_negocio}',
 mensaje_whatsapp:'Hola, {cliente} 👋\n\nGracias por comprar en {nombre_negocio}.\n\n🧾 Factura: {numero_factura}\n💰 Total: {total}\n\nTe compartimos tu factura.\n\nGracias por confiar en nosotros.\n{nombre_negocio}',
})
const limits={asunto_correo:180,mensaje_correo:6000,mensaje_whatsapp:1800}
export function validateInvoiceMessages(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==3||Object.keys(input).some(k=>!Object.hasOwn(limits,k)))throw Error('Revisa las tres plantillas de mensajes.')
 const out={}
 for(const [key,max]of Object.entries(limits)){
  const value=input[key];if(typeof value!=='string'||!value.trim()||value.length>max)throw Error('Completa los mensajes y respeta el límite de caracteres.')
  if(key==='asunto_correo'&&/[\r\n\t]/.test(value))throw Error('El asunto debe estar en una sola línea.')
  const remaining=value.replace(/\{([^{}]+)\}/g,(match,name)=>{if(!MESSAGE_VARIABLES.includes(name))throw Error('Variable no admitida: '+name);return ''})
  if(/[{}]/.test(remaining))throw Error('Revisa las llaves de las variables.')
  if(/sb_secret_|\bBearer\s+|[?&]token=|\/storage\/v1\/object\/(sign|public)\/facturas/i.test(value))throw Error('No incluyas credenciales ni enlaces de Storage en las plantillas.')
  out[key]=value.trim()
 }
 return out
}
export function renderInvoiceMessages({invoice,items=[],tienda={},templates}={}){
 const t=validateInvoiceMessages(templates||DEFAULT_INVOICE_MESSAGES),business=invoice?.tienda_snapshot||tienda
 const customer=Object.hasOwn(invoice||{},'cliente_snapshot')?invoice.cliente_snapshot:invoice?.clientes
 const values={cliente:customer?.nombre?.trim()||'cliente',numero_factura:(invoice?.prefijo||'FV')+'-'+String(invoice?.numero??'').padStart(4,'0'),fecha:invoice?.fecha?new Date(invoice.fecha).toLocaleDateString('es-CO',{timeZone:'America/Bogota'}):'Fecha no disponible',total:'$'+Math.round(Number(invoice?.total)||0).toLocaleString('es-CO')+' COP',nombre_negocio:invoiceBrand(business),productos:items.length?items.map(i=>Number(i.cantidad)+' × '+i.nombre).join('\n'):'Consulta los productos en el PDF.'}
 const fill=text=>text.replace(/\{([^{}]+)\}/g,(_,name)=>String(values[name]))
 return{asunto:fill(t.asunto_correo).replace(/[\r\n\t]+/g,' ').slice(0,250),correo:fill(t.mensaje_correo),whatsapp:fill(t.mensaje_whatsapp)}
}
