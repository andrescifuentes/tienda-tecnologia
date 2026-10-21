import { periodoVendedor, consultarFacturasVisibles } from './sellerHome.js'
import { invoiceItemsTable } from './invoiceQueries.js'
import { withDeadline, requireData, cancellableQuery } from './asyncResult.js'
export function employeeRange(period,custom,now=new Date()){
 if(period!=='rango')return periodoVendedor(period,now)
 const {desde,hasta}=custom||{}
 if(!/^\d{4}-\d{2}-\d{2}$/.test(desde||'')||!/^\d{4}-\d{2}-\d{2}$/.test(hasta||'')||!Number.isFinite(Date.parse(desde))||!Number.isFinite(Date.parse(hasta))||new Date(desde).toISOString().slice(0,10)!==desde||new Date(hasta).toISOString().slice(0,10)!==hasta||desde>hasta)throw Error('Revisa el rango de fechas.')
 return{desde,hasta}
}
export async function loadEmployeeSales(client,{perfilId,esAdmin=false,vendedorId,range,signal}){
 if(!perfilId||!vendedorId||(!esAdmin&&vendedorId!==perfilId))throw Error('No tienes permiso para consultar las ventas de este empleado.')
 return withDeadline(async abort=>{
  const results=await Promise.all([
   cancellableQuery(consultarFacturasVisibles(client,{esAdmin,perfilId,net:true},'id,prefijo,numero,cliente_id,vendedor_id,total,total_neto,estado,fecha,metodo_pago,comision,comision_pct,comision_neta').eq('vendedor_id',vendedorId).gte('fecha',range.desde+'T00:00:00-05:00').lte('fecha',range.hasta+'T23:59:59.999-05:00').order('fecha',{ascending:false}).limit(2000),abort),
   cancellableQuery(client.rpc('ventas_por_empleado',{p_desde:range.desde,p_hasta:range.hasta}),abort),
  ]);const invoices=requireData(results[0])||[],team=requireData(results[1])||[]
  if(invoices.length>=2000)throw Error('Reduce el rango para consultar el detalle completo.')
  const safe=invoices.filter(f=>f.vendedor_id===vendedorId),ids=safe.map(f=>f.id)
  const items=ids.length?requireData(await cancellableQuery(client.from(invoiceItemsTable(client,esAdmin)).select('id,factura_id,producto_id,unidad_id,nombre,cantidad,precio_unitario,descuento').in('factura_id',ids),abort))||[]:[]
  const refunds=ids.length?requireData(await cancellableQuery(client.from('devoluciones').select('factura_id,devolucion_items(factura_item_id,cantidad)').in('factura_id',ids),abort))||[]:[]
  const unitIds=[...new Set(items.map(i=>i.unidad_id).filter(Boolean))]
  const units=unitIds.length?requireData(await cancellableQuery(client.from('unidades_serializadas').select('id,serial').in('id',unitIds),abort))||[]:[]
  const rows=items.filter(i=>ids.includes(i.factura_id)).map(i=>({...i,serial:i.serial||units.find(u=>u.id===i.unidad_id)?.serial,devueltas:refunds.flatMap(r=>r.devolucion_items||[]).filter(r=>r.factura_item_id===i.id).reduce((sum,r)=>sum+Number(r.cantidad),0)}))
  const stat=team.find(p=>p.vendedor_id===vendedorId),issued=safe.filter(f=>f.estado==='emitida')
  return {invoices:safe,items:rows,total:Number(stat?.total_vendido)||0,count:Number(stat?.facturas)||0,commission:Number(stat?.comision)||0,netVisible:issued.reduce((sum,f)=>sum+Number(f.total_neto??f.total),0)}
 },{signal})
}

// Display the existing net commission, never recompute it from a current rate.
export function invoiceNetCommission(invoice){return invoice.estado==='emitida'?Number(invoice.comision_neta??invoice.comision)||0:0}
