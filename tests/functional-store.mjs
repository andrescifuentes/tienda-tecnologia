import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createDemoClient } from '../src/lib/demo/client.js'
import { DEMO_PASSWORD, DEMO_KEY } from '../src/lib/demo/seed.js'
import { localNotifications } from '../src/lib/demo/notifications.js'

const memory=new Map(),storage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)}
const options={storage,now:()=>new Date('2026-10-07T17:00:00Z'),location:{hostname:'192.168.0.16',protocol:'http:'}}
let client=createDemoClient(options)
const checks=[]
globalThis.fetch=()=>{throw Error('No remote calls allowed')}
const ok=async promise=>{const result=await promise;assert.equal(result.error,null,JSON.stringify(result.error));return result.data}
const reject=async(promise,label)=>{const before=memory.get(DEMO_KEY),result=await promise;assert.ok(result.error,label);assert.equal(memory.get(DEMO_KEY),before,'Atomic failure: '+label);checks.push(label)}
const check=(name,action)=>{action();checks.push(name)}
const tables=()=>client.demo.snapshot().tables
const rpc=(name,args)=>ok(client.rpc(name,args))
await ok(client.auth.signInWithPassword({email:'admin@angietech.demo',password:DEMO_PASSWORD}))
check('Existing seed upgraded without losing its 18 products or 16 invoices',()=>{assert.equal(tables().productos.length,18);assert.equal(tables().facturas.length,16);for(const name of ['Smartphones','Audio','Accesorios','Cómputo','Wearables','Tablets','Otros'])assert.ok(tables().categorias.some(c=>c.nombre===name))})
const c=await ok(client.from('clientes').insert({nombre:'Cliente sin documento',correo:null,telefono:null,notas:'Compra de prueba'}).select().single())
check('Optional customer document/contact and notes persist',()=>assert.equal(c.notas,'Compra de prueba'))
await reject(client.from('clientes').insert({nombre:'Correo malo',correo:'bad'}),'Invalid customer email rejected')
const provider=await ok(client.from('proveedores').insert({nombre:'Proveedor funcional',notas:'Entregas locales'}).select().single())
const p=await rpc('crear_producto_demo',{producto:{codigo:'TEST-S26',nombre:'Samsung Galaxy S26',categoria_id:1,marca:'Samsung',precio_compra:2500000,precio_venta:3200000,stock_min:2,garantia_meses:0,descripcion:'Prueba funcional'},stock:5})
await reject(client.rpc('crear_producto_demo',{producto:{...p,id:undefined},stock:0}),'Duplicate SKU rejected')
await reject(client.rpc('crear_producto_demo',{producto:{...p,id:undefined,codigo:'NEGATIVE',precio_venta:-1},stock:0}),'Negative price rejected')
await reject(client.from('productos').update({stock:10}).eq('id',p.id),'Silent stock mutation rejected')
const profit=(await rpc('resumen_dashboard'))[0].utilidad_mes
const purchaseArgs={p_proveedor_id:provider.id,p_forma_pago:'contado',p_metodo_pago:'efectivo',p_fecha:'2026-10-07',p_notas:'Recepción completa',p_request_id:'purchase-one',p_items:[{producto_id:p.id,cantidad:10,costo_unitario:2500000}]}
const purchase=await rpc('registrar_compra',purchaseArgs),samePurchase=await rpc('registrar_compra',purchaseArgs)
check('Purchase idempotency, date, notes, supplier, stock and expense',()=>{assert.equal(purchase,samePurchase);assert.equal(tables().productos.find(x=>x.id===p.id).stock,15);assert.equal(tables().compras.find(x=>x.id===purchase).notas,'Recepción completa');assert.equal(tables().movimientos.filter(m=>m.compra_id===purchase).length,1)})
check('Inventory purchase does not double-subtract operating profit',()=>{})
assert.equal((await rpc('resumen_dashboard'))[0].utilidad_mes,profit)
const args={p_cliente_id:c.id,p_vendedor_id:'demo-ana',p_request_id:'sale-one',p_metodo_pago:'transferencia',p_items:[{producto_id:p.id,cantidad:2}]}
const sale=await rpc('emitir_factura',args),again=await rpc('emitir_factura',args),f=tables().facturas.find(x=>x.id===sale)
check('Admin assigns active seller, 3 percent historical commission and double-submit protection',()=>{assert.equal(sale,again);assert.equal(f.total,6400000);assert.equal(f.comision,192000);assert.equal(f.vendedor_id,'demo-ana');assert.equal(tables().productos.find(x=>x.id===p.id).stock,13);assert.equal(tables().movimientos.filter(m=>m.factura_id===sale&&m.origen==='venta').length,1)})
await rpc('guardar_empleado_demo',{id:'demo-ana',datos:{nombre:'Ana actualizada',rol:'vendedor',comision_pct:4},permisos:['vender','ver_inventario','crear_clientes']})
check('Changing future employee commission preserves historical sale snapshot',()=>assert.equal(tables().facturas.find(x=>x.id===sale).comision,192000))
const item=tables().factura_items.find(i=>i.factura_id===sale)
const warranty=await rpc('crear_garantia_demo',{factura_item_id:item.id,inicio:'2026-10-07',fin:'2027-10-07',motivo:'Cobertura comercial',descripcion:'Equipo nuevo'})
check('Manual warranty on sold product without automatic coverage includes linked invoice and dates',()=>assert.equal(tables().garantias.find(g=>g.id===warranty).fin,'2027-10-07'))
await rpc('actualizar_garantia_demo',{id:warranty,estado:'vigente',nota:'Recepción confirmada'})
const claim=await rpc('abrir_reclamo_demo',{id:warranty,descripcion:'Pantalla con falla'})
await rpc('resolver_reclamo_demo',{id:claim,estado:'en_revision',nota:'Diagnóstico iniciado'})
await rpc('resolver_reclamo_demo',{id:claim,estado:'resuelto',nota:'Equipo entregado'})
check('Atomic warranty lifecycle and persistent notes/history',()=>{assert.equal(tables().garantias.find(g=>g.id===warranty).estado,'resuelta');assert.equal(tables().garantia_eventos.filter(e=>e.garantia_id===warranty).length,5)})
await reject(client.rpc('resolver_reclamo_demo',{id:claim,estado:'en_revision'}),'Final claim cannot reopen silently')
await rpc('registrar_devolucion',{p_factura_id:sale,p_items:[{factura_item_id:item.id,cantidad:1}],p_motivo:'Equipo dañado',p_reintegra_stock:false})
check('Damaged return records movement without increasing available stock',()=>{assert.equal(tables().productos.find(x=>x.id===p.id).stock,13);assert.ok(tables().movimientos_inventario.some(m=>m.producto_id===p.id&&m.tipo==='devolucion_danada'&&m.cantidad===0))})
await rpc('anular_factura',{p_factura_id:sale,p_motivo:'Cancelar unidad restante'})
check('Cancellation after damaged return restores only remaining stock, finance and commission',()=>{assert.equal(tables().productos.find(x=>x.id===p.id).stock,14);assert.equal(tables().facturas.find(x=>x.id===sale).estado,'anulada');assert.equal(tables().movimientos.filter(m=>m.factura_id===sale&&m.tipo==='gasto').reduce((n,m)=>n+m.monto,0),6400000)})
await reject(client.rpc('anular_factura',{p_factura_id:sale,p_motivo:'Segundo toque'}),'Double cancellation rejected atomically')
await rpc('ajustar_stock_fisico_demo',{id:p.id,stock:12,motivo:'Daño / pérdida'})
check('Physical stock reconciliation records delta and reason',()=>{assert.equal(tables().productos.find(x=>x.id===p.id).stock,12);assert.equal(tables().movimientos_inventario.at(-1).cantidad,-2);assert.equal(tables().movimientos_inventario.at(-1).motivo,'Daño / pérdida')})
for(const [table,id] of [['productos',p.id],['clientes',c.id],['proveedores',provider.id]]){
  await rpc('desactivar_registro_demo',{tabla:table,id,desactivar:true})
  check(table+' soft delete retains records and historical relations',()=>assert.equal(tables()[table].find(x=>x.id===id).activo,false))
  await rpc('desactivar_registro_demo',{tabla:table,id,desactivar:false})
}
await reject(client.from('facturas').delete().eq('id',sale),'Historical invoice deletion blocked')
await reject(client.from('perfiles').update({activo:false}).eq('id','demo-admin'),'Last administrator protected')
await rpc('actualizar_perfil_demo',{nombre:'Administradora demo',telefono:'3000009999'})
check('Current user can edit their local name and phone',()=>assert.equal(tables().perfiles.find(p=>p.id==='demo-admin').nombre,'Administradora demo'))
const notices=localNotifications(tables(),'2026-10-07')
check('Local notifications cover out of stock, low stock and operational activities',()=>{assert.ok(notices.some(n=>n.title==='Producto agotado'));assert.ok(notices.some(n=>n.title==='Stock bajo'));assert.ok(notices.some(n=>n.id.startsWith('activity:')))})
await rpc('leer_notificacion_demo',{id:notices[0].id});await rpc('leer_notificacion_demo',{id:notices[0].id})
check('Read notification identity persists without duplication',()=>assert.equal(tables().notificaciones_leidas.filter(n=>n.notificacion_id===notices[0].id).length,1))
const saved=client.demo.snapshot();client=createDemoClient(options)
check('Reopened client preserves all transactions, notes, session and sequences',()=>assert.deepEqual(client.demo.snapshot(),saved))
await ok(client.auth.signInWithPassword({email:'ana@angietech.demo',password:DEMO_PASSWORD}))
await reject(client.rpc('emitir_factura',{...args,p_request_id:'illegal-assignment',p_vendedor_id:'demo-carlos'}),'Seller cannot assign another seller')
assert.throws(()=>client.demo.reset(),/permiso/);checks.push('Seller cannot reset demo')
await ok(client.auth.signInWithPassword({email:'admin@angietech.demo',password:DEMO_PASSWORD}))
client.demo.reset()
check('Reset restores seed and signs out, with no remote calls',()=>{assert.equal(tables().productos.length,18);assert.equal(tables().clientes.length,10);assert.equal(client.demo.snapshot().session,null);assert.ok(!tables().productos.some(p=>p.codigo==='TEST-S26'))})
mkdirSync('artifacts/functional-store',{recursive:true});writeFileSync('artifacts/functional-store/results.json',JSON.stringify({status:'PASS',cases:checks.length,checks,remoteCalls:0},null,2));console.log('PASS '+checks.length+' functional domain checks')
