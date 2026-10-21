import { withDeadline, requireData, cancellableQuery } from './asyncResult.js'
import { invoiceTable } from './invoiceQueries.js'
// Iterate until an empty page, even when the server caps pages below our requested size.
export async function readFinancialRows(makeQuery,signal){
 return withDeadline(async abort=>{
 const rows=[],seen=new Set();let offset=0
 for(let page=0;page<1000;page++){
  let query=makeQuery();const paged=typeof query.range==='function';if(paged)query=query.range(offset,offset+199)
  const batch=requireData(await cancellableQuery(query,abort));if(!Array.isArray(batch))throw Error('Respuesta financiera incompleta.')
  if(!batch.length)return rows
  for(const row of batch){if(row.id!=null){if(seen.has(row.id))throw Error('La consulta financiera repitió registros.');seen.add(row.id)}rows.push(row)}
  offset+=batch.length;if(!paged)return rows
 }
 throw Error('El período supera el límite de consulta completa. Reduce el rango.')
 },{signal})
}

const invoiceFields='id,prefijo,numero,cliente_id,vendedor_id,fecha,total,estado'
// The deployed base view deliberately has no prefijo, numero or total.
const netFields='id,fecha,estado,vendedor_id,cliente_id,total_neto'
const missingSchema=error=>['42P01','42703','PGRST204','PGRST205'].includes(error?.code)
function financeFailure(source,error){return Object.assign(new Error(error?.message||'No se pudo completar la consulta financiera.'),{code:error?.code||'QUERY_FAILED',financeSource:source,status:error?.status})}
async function operation(source,run){try{return await run()}catch(error){throw error?.financeSource?error:financeFailure(source,error)}}
const finiteAmount=value=>value!==null&&value!==undefined&&Number.isFinite(Number(value))
export function financeErrorMessage(error){
 const source=error?.financeSource||'consulta financiera',code=/^[A-Z0-9_]{1,32}$/.test(error?.code||'')?error.code:'QUERY_FAILED'
 const reason=code==='42501'||error?.status===403?'Permiso denegado.':missingSchema(error)?'El esquema no ofrece los campos requeridos.':code==='NET_RECONCILIATION_FAILED'?'Los registros no coinciden con el resumen neto.':code==='TIMEOUT'?'La consulta tardó demasiado.':'No se pudo completar la consulta.'
 return reason+' Origen: '+source+' · '+code+'. Reintenta la consulta.'
}
async function withInvoiceCustomers(client,invoices,signal){
 const needsName=f=>!f.cliente_snapshot?.nombre?.trim()&&!f.clientes?.nombre?.trim()&&f.cliente_id!=null
 const ids=[...new Set(invoices.filter(needsName).map(f=>f.cliente_id))],customers=new Map()
 for(let offset=0;offset<ids.length;offset+=100){const batch=ids.slice(offset,offset+100),rows=await operation('clientes',()=>readFinancialRows(()=>client.from('clientes').select('id,nombre').in('id',batch).order('id'),signal));for(const customer of rows)customers.set(String(customer.id),customer)}
 return invoices.map(f=>needsName(f)?{...f,clientes:customers.get(String(f.cliente_id))||null}:f)
}
export async function loadNetInvoices(client,{period,auth,signal,local=null}){
 const baseTable=invoiceTable(client,auth,false),netTable=invoiceTable(client,auth,true)
 const range=query=>(local!=null?query.eq('local_id',local):query),range0=query=>range(!auth.esAdmin&&auth.perfilId?query.eq('vendedor_id',auth.perfilId):query).gte('fecha',period.ini+'T00:00:00-05:00').lte('fecha',period.fin+'T23:59:59.999999-05:00').order('id')
 const [baseResult,netResult]=await Promise.allSettled([
  operation(baseTable,()=>readFinancialRows(()=>range0(client.from(baseTable).select(auth.esAdmin?'*':invoiceFields)),signal)),
  operation(netTable,()=>readFinancialRows(()=>range0(client.from(netTable).select(netFields)),signal)),
 ])
 if(baseResult.status==='rejected')throw baseResult.reason
 // Read snapshots when present without requiring a column absent in older deployments.
 // Seller projections remain cost-free; only administrators request the full base row.
 const invoices=baseResult.value.map(f=>({...Object.fromEntries(invoiceFields.split(',').map(key=>[key,f[key]])),...(Object.hasOwn(f,'cliente_snapshot')?{cliente_snapshot:f.cliente_snapshot}:{}),...(f.clientes?{clientes:f.clientes}:{})}))
 if(invoices.some(f=>!finiteAmount(f.total)))throw financeFailure(baseTable,{code:'INVALID_AMOUNT',message:'La factura no tiene un total válido.'})
 if(netResult.status==='fulfilled'){
  const net=new Map(netResult.value.map(row=>[String(row.id),row]))
  if(net.size!==invoices.length||invoices.some(f=>!net.has(String(f.id))))throw financeFailure(netTable,{code:'INCOMPLETE_INVOICES',message:'Las fuentes de facturas no contienen los mismos registros.'})
  const combined=invoices.map(f=>{const row=net.get(String(f.id));if(!finiteAmount(row.total_neto)||row.estado!==f.estado)throw financeFailure(netTable,{code:'INVALID_NET_AMOUNT',message:'No se pudo consultar el importe neto de las facturas.'});return{...f,total_neto:Number(row.total_neto)}})
  return withInvoiceCustomers(client,combined,signal)
 }
 // Compatibility only for a missing view/column. Never bypass a permission error.
 if(!missingSchema(netResult.reason))throw netResult.reason
 const refunds=[]
 for(let offset=0;offset<invoices.length;offset+=100){const ids=invoices.slice(offset,offset+100).map(f=>f.id);refunds.push(...await operation('devoluciones',()=>readFinancialRows(()=>client.from('devoluciones').select('id,factura_id,total_devuelto').in('factura_id',ids).order('id'),signal)))}
 const invoiceIds=new Set(invoices.map(f=>String(f.id))),totals=new Map()
 for(const refund of refunds){if(!invoiceIds.has(String(refund.factura_id))||!finiteAmount(refund.total_devuelto))throw financeFailure('devoluciones',{code:'INVALID_REFUND',message:'La devolución no se pudo relacionar con su factura.'});totals.set(String(refund.factura_id),(totals.get(String(refund.factura_id))||0)+Number(refund.total_devuelto))}
 return withInvoiceCustomers(client,invoices.map(f=>({...f,total_neto:Number(f.total)-(totals.get(String(f.id))||0)})),signal)
}
export async function loadFinancePeriod(client,{period,demo=false,auth={},signal,local=null}){
 const porLocal=query=>local!=null?query.eq('local_id',local):query
 return withDeadline(async abort=>{
  const detailPromise=loadNetInvoices(client,{period,auth,signal:abort,local}).then(invoices=>({invoices,invoiceError:null}),invoiceError=>({invoices:[],invoiceError}))
  const [movements,team,summary,purchases,detail]=await Promise.all([
   operation('movimientos',()=>readFinancialRows(()=>porLocal(client.from('movimientos').select('*')).gte('fecha',period.ini).lte('fecha',period.fin).order('fecha',{ascending:false}).order('id',{ascending:false}),abort)),
   operation('ventas_por_empleado',async()=>requireData(await cancellableQuery(client.rpc('ventas_por_empleado',{p_desde:period.ini,p_hasta:period.fin,...(local!=null?{p_local_id:local}:{})}),abort))),
   demo?operation('resumen_dashboard',async()=>requireData(await cancellableQuery(client.rpc('resumen_dashboard',{p_desde:period.ini,p_hasta:period.fin,...(local!=null?{p_local_id:local}:{})}),abort))):null,
   operation('compras',()=>readFinancialRows(()=>porLocal(client.from('compras').select('id,fecha,total,numero_documento,forma_pago,estado,proveedores(nombre)')).eq('estado','recibida').gte('fecha',period.ini).lte('fecha',period.fin).order('fecha',{ascending:false}).order('id'),abort)),
   detailPromise,
  ])
  if(!Array.isArray(team)||team.some(r=>!finiteAmount(r.total_vendido))||movements.some(m=>!finiteAmount(m.monto))||purchases.some(p=>!finiteAmount(p.total)))throw financeFailure('resumen financiero',{code:'INVALID_AMOUNT',message:'El servidor no devolvió importes válidos.'})
  if(!detail.invoiceError){const expected=team.reduce((n,r)=>n+Number(r.total_vendido),0),actual=detail.invoices.filter(f=>f.estado==='emitida').reduce((n,f)=>n+f.total_neto,0);if(expected!==actual)detail.invoiceError=financeFailure('facturas netas',{code:'NET_RECONCILIATION_FAILED',message:'El detalle neto no concuerda con ventas_por_empleado.'})}
  return{movements,team,purchases,summary,...detail}
 },{signal})
}
