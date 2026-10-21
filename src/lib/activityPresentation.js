import { fechaHora, numFactura } from './format.js'
import { withDeadline, requireData, cancellableQuery } from './asyncResult.js'
import { consultarFacturasVisibles } from './sellerHome.js'
export function activityPresentation(row, { invoices = [], actor = '' } = {}) {
 const a=String(row.accion||'').toLowerCase(),entity=String(row.entidad||'').toLowerCase()
 let title='Actividad registrada',description='Se registró un cambio en el negocio.',icon='chart',kind='otros',tone=''
 if(/acceso_restablecido|restablec|password|contrase/.test(a)){title='Acceso restablecido';description='Se actualizó el acceso de un empleado.';icon='shield';kind='equipo'}
 else if(/factura|venta/.test(a)){kind='ventas';icon='doc';title=/anulad|cancel/.test(a)?'Factura anulada':/devol/.test(a)?'Devolución registrada':/pendiente/.test(a)?'Factura pendiente':'Factura emitida';description=/anulad|cancel/.test(a)?'La factura fue anulada.':/devol/.test(a)?'Se registró una devolución.':'Venta registrada';tone=/anulad|cancel/.test(a)?'bad':''}
 else if(/perfil|emplead|usuario/.test(a+' '+entity)){title=/cread|insert|create/.test(a)?'Empleado creado':'Empleado actualizado';description='Se actualizaron datos del equipo.';icon='users';kind='equipo'}
 else if(/compra|mercanc/.test(a+' '+entity)){title=/anulad/.test(a)?'Compra anulada':'Compra registrada';description='Movimiento de mercancía registrado.';icon='truck';kind='inventario'}
 else if(/producto|inventario|stock/.test(a+' '+entity)){title=/ajust/.test(a)?'Inventario ajustado':'Producto actualizado';description='Se actualizó el inventario del negocio.';icon='box';kind='inventario'}
 else if(/garanti/.test(a+' '+entity)){title='Garantía actualizada';description='Se registró un seguimiento de garantía.';icon='shield'}
 else if(/^[\p{L} ]{3,60}$/u.test(String(row.accion||'')))title=row.accion
 const id=String(row.entidad_id||''),invoice=/factura/.test(entity)?invoices.find(f=>String(f.id)===id):null
 const reference=invoice?numFactura(invoice):/^[a-z0-9]{1,12}-\d+$/i.test(row.detalle?.numero||'')?row.detalle.numero:''
 const to=/factura/.test(entity)&&/^[1-9]\d*$/.test(id)?'/facturas?factura='+id:/compra/.test(entity)&&/^[1-9]\d*$/.test(id)?'/proveedores?compra='+id:/producto/.test(entity)&&/^[1-9]\d*$/.test(id)?'/inventario?producto='+id:null
 return {id:row.id,title,description:reference?reference+' · '+description:description,reference,icon,kind,tone,to,fecha:row.fecha,date:row.fecha?fechaHora(row.fecha):'Fecha no disponible',actor:row.perfiles?.nombre||actor,estado:tone==='bad'?'Anulada':title==='Factura pendiente'?'Pendiente':'Registrado'}
}
export async function loadActivity(client,{perfilId,esAdmin=false,signal,limit=80}) {
 if(!perfilId)throw Error('No se pudo identificar al usuario.')
 return withDeadline(async abort=>{
  let q=client.from('actividad').select('id,accion,entidad,entidad_id,detalle,fecha,perfil_id').order('fecha',{ascending:false}).limit(limit)
  if(!esAdmin)q=q.eq('perfil_id',perfilId)
  const rows=requireData(await cancellableQuery(q,abort))||[]
  const safe=esAdmin?rows:rows.filter(a=>a.perfil_id===perfilId)
  const ids=[...new Set(safe.map(a=>a.perfil_id).filter(Boolean))]
  const related=[...new Set(safe.filter(a=>/factura/.test(a.entidad||'')&&/^[1-9]\d*$/.test(String(a.entidad_id))).map(a=>a.entidad_id))]
  const [actors,invoices]=await Promise.all([ids.length?cancellableQuery(client.from('perfiles').select('id,nombre').in('id',ids),abort):{data:[]},related.length?cancellableQuery(consultarFacturasVisibles(client,{esAdmin,perfilId},'id,prefijo,numero').in('id',related),abort):{data:[]}])
  if(actors.error||invoices.error)throw actors.error||invoices.error
  return safe.filter(a=>esAdmin||!/factura/.test(a.entidad||'')||(invoices.data||[]).some(f=>String(f.id)===String(a.entidad_id))).map(a=>activityPresentation(a,{invoices:invoices.data||[],actor:actors.data?.find(p=>p.id===a.perfil_id)?.nombre||''}))
 },{signal})
}
export function noticeReadKey(profile,host='local'){return 'angie:notice-read:'+host+':'+profile}
export function readNoticeIds(storage,key){try{return new Set(JSON.parse(storage.getItem(key)||'[]').filter(v=>typeof v==='string').slice(-200))}catch{return new Set()}}
export function saveNoticeRead(storage,key,id){const read=readNoticeIds(storage,key);read.add(id);storage.setItem(key,JSON.stringify([...read].slice(-200)))}
