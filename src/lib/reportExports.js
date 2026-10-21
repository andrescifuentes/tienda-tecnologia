import { readFinancialRows, loadNetInvoices } from './financeQueries.js'
import { invoiceFields, invoiceTable, invoiceItemsTable, SELLER_ITEM_FIELDS } from './invoiceQueries.js'
import { invoiceCustomerName } from './financeDetails.js'
import { employeeRange } from './employeeSales.js'
import { numFactura } from './format.js'

export function reportRange(kind,custom,now=new Date()) {
 const range=employeeRange(kind,custom,now)
 if((Date.parse(range.hasta)-Date.parse(range.desde))/86400000>366)throw Error('Selecciona un rango de hasta un año para el reporte completo.')
 return range
}
export function reportCents(value){
 const text=String(value??'');if(!/^-?\d+(?:\.\d{1,2})?$/.test(text))throw Error('Importe monetario inválido en el reporte.')
 const [whole,fraction='']=text.replace('-','').split('.'),amount=Number(whole)*100+Number(fraction.padEnd(2,'0'))
 if(!Number.isSafeInteger(amount))throw Error('Importe fuera del rango seguro del reporte.')
 return text.startsWith('-')?-amount:amount
}
const pesos=cents=>cents/100
export function salesSummary(invoices){
 const cents={gross:0,returns:0,net:0,cancelled:0},result={issued:0,cancelledCount:0,pending:0}
 for(const f of invoices){const total=reportCents(f.total),net=reportCents(f.total_neto)
  if(f.estado==='emitida'){result.issued++;cents.gross+=total;cents.returns+=total-net;cents.net+=net}
  else if(f.estado==='anulada'){result.cancelledCount++;cents.cancelled+=total}else result.pending++
 }
 if(Object.values(cents).some(n=>!Number.isSafeInteger(n)))throw Error('El total supera el rango seguro del reporte.')
 return {...result,...Object.fromEntries(Object.entries(cents).map(([key,n])=>[key,pesos(n)]))}
}
const chunks=ids=>Array.from({length:Math.ceil(ids.length/100)},(_,n)=>ids.slice(n*100,n*100+100))
export async function loadSalesReport(client,{auth,range,demo=false,signal,local=null}){
 if(!auth?.perfilId)throw Error('Inicia sesión para consultar ventas.')
 reportRange('rango',range)
 const period={ini:range.desde,fin:range.hasta}
 const invoices=await loadNetInvoices(client,{period,auth,signal,local})
 if(invoices.length>10000)throw Error('Hay más de 10.000 facturas. Reduce el rango del reporte.')
 if(!auth.esAdmin&&invoices.some(f=>f.vendedor_id!==auth.perfilId))throw Error('El reporte contiene ventas fuera de tus permisos.')
 const ids=invoices.map(f=>f.id),headers=[],items=[],profiles=[]
 for(const batch of chunks(ids)){
  const pair=await Promise.all([
   readFinancialRows(()=>client.from(invoiceTable(client,auth)).select(invoiceFields(auth.esAdmin,demo)).in('id',batch).order('id'),signal),
   readFinancialRows(()=>client.from(invoiceItemsTable(client,auth.esAdmin)).select(SELLER_ITEM_FIELDS).in('factura_id',batch).order('id'),signal),
  ]);headers.push(...pair[0]);items.push(...pair[1])
 }
 const headerMap=new Map(headers.map(f=>[String(f.id),f])),idSet=new Set(ids.map(String))
 if(headerMap.size!==ids.length||items.some(i=>!idSet.has(String(i.factura_id))))throw Error('No se pudo consultar el reporte completo.')
 const sellerIds=[...new Set(headers.filter(f=>!f.vendedor_snapshot?.nombre).map(f=>f.vendedor_id))]
 for(const batch of chunks(sellerIds))profiles.push(...await readFinancialRows(()=>client.from('perfiles').select('id,nombre').in('id',batch).order('id'),signal))
 const sellers=new Map(profiles.map(p=>[String(p.id),p.nombre]))
 const rows=invoices.map(f=>{
  const header=headerMap.get(String(f.id));if(['estado','cliente_id','vendedor_id','prefijo','numero'].some(key=>String(header[key]??'')!==String(f[key]??''))||Date.parse(header.fecha)!==Date.parse(f.fecha)||reportCents(header.total)!==reportCents(f.total))throw Error('Las facturas cambiaron durante la consulta. Vuelve a preparar el reporte.');if(!auth.esAdmin&&header.vendedor_id!==auth.perfilId)throw Error('No tienes permiso para consultar esta factura.')
  return {id:f.id,prefijo:f.prefijo,numero:f.numero,fecha:f.fecha,estado:f.estado,total:f.total,total_neto:f.total_neto,subtotal:header.subtotal,descuento:header.descuento,metodo_pago:header.metodo_pago,cliente:invoiceCustomerName(f),vendedor:header.vendedor_snapshot?.nombre||sellers.get(String(header.vendedor_id))||'Vendedor no disponible',items:items.filter(i=>String(i.factura_id)===String(f.id)).map(i=>({nombre:i.nombre,cantidad:i.cantidad,precio_unitario:i.precio_unitario,descuento:i.descuento}))}
 })
 return {invoices:rows.sort((a,b)=>b.fecha.localeCompare(a.fecha)||Number(b.id)-Number(a.id)),summary:salesSummary(rows),range}
}
export async function loadContactReport(client,{auth,signal}){
 if(!auth?.esAdmin||!auth.perfilId)throw Error('Solo el administrador puede exportar contactos.')
 const rows=await readFinancialRows(()=>client.from('clientes').select('*').order('id'),signal)
 if(rows.length>10000)throw Error('El reporte supera 10.000 contactos. Solicita una exportación acotada.')
 return rows.map(c=>({nombre:c.nombre,telefono:c.telefono,correo:c.correo,tipo_documento:c.tipo_documento,documento:c.documento,direccion:c.direccion,ciudad:c.ciudad,registro:c.creado_en||c.created_at||''}))
}
export function csvContent(headers,rows){
 const cell=value=>{if(typeof value==='number'&&!Number.isFinite(value))throw Error('Valor numérico inválido.');let text=String(value??'');if(typeof value!=='number'&&/^[\s\uFEFF]*[=+@-]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"'}
 return '\uFEFF'+[headers,...rows].map(row=>row.map(cell).join(';')).join('\r\n')+'\r\n'
}
export function salesCsv(report){
 const date=iso=>new Intl.DateTimeFormat('es-CO',{timeZone:'America/Bogota',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(iso))
 return csvContent(['Factura','Fecha y hora Colombia','Cliente','Vendedor','Productos y cantidades','Medio de pago','Subtotal COP','Descuento general COP','Descuentos líneas COP','Total documento COP','Estado','Ventas emitidas brutas COP','Anulaciones COP','Devoluciones emitidas COP','Ventas netas COP'],report.invoices.map(f=>[numFactura(f),date(f.fecha),f.cliente,f.vendedor,f.items.map(i=>i.nombre+' × '+i.cantidad).join(' | '),f.metodo_pago,Number(f.subtotal),Number(f.descuento),pesos(f.items.reduce((sum,i)=>sum+reportCents(i.descuento||0),0)),Number(f.total),f.estado,f.estado==='emitida'?Number(f.total):0,f.estado==='anulada'?Number(f.total):0,f.estado==='emitida'?pesos(reportCents(f.total)-reportCents(f.total_neto)):0,f.estado==='emitida'?Number(f.total_neto):0]))
}
export const contactsCsv=rows=>csvContent(['Nombre','Teléfono','Correo','Tipo de documento','Documento','Dirección','Ciudad','Fecha de registro'],rows.map(c=>[c.nombre,c.telefono,c.correo,c.tipo_documento,c.documento,c.direccion,c.ciudad,c.registro]))
export function downloadCsv(content,name){
 const url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)
}
