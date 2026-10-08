import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createDemoClient } from '../src/lib/demo/client.js'
import { DEMO_KEY, DEMO_PASSWORD } from '../src/lib/demo/seed.js'
import { createInvoicePdf } from '../src/lib/invoicePdf.js'

globalThis.fetch = () => { throw Error('Remote calls prohibited') }
const memory = new Map(), storage = { getItem:k=>memory.get(k)||null, setItem:(k,v)=>memory.set(k,v) }
const options = { storage, location:{hostname:'192.168.0.16',protocol:'http:'}, now:()=>new Date('2026-10-08T17:00:00Z') }
let client = createDemoClient(options)
const checks = []
const ok = async promise => { const r=await promise; assert.equal(r.error,null,JSON.stringify(r.error)); return r.data }
const rpc = (name,args) => ok(client.rpc(name,args))
const tables = () => client.demo.snapshot().tables
const check = (name, action) => { action(); checks.push(name) }
const reject = async (promise,label) => { const previous=memory.get(DEMO_KEY),r=await promise; assert.ok(r.error,label);assert.equal(memory.get(DEMO_KEY),previous);checks.push(label) }
await ok(client.auth.signInWithPassword({email:'admin@angietech.demo',password:DEMO_PASSWORD}))
const p=tables().productos.find(p=>p.codigo==='USBC2M'),original=p.precio_venta
await ok(client.from('productos').update({precio_venta:original+1000}).eq('id',p.id))
const args={p_cliente_id:1,p_vendedor_id:'demo-ana',p_metodo_pago:'tarjeta',p_items:[{producto_id:p.id,cantidad:2,precio_unitario:original}],p_descuento:5000,p_total_confirmado:original*2-5000,p_request_id:'frozen-checkout'}
const id=await rpc('emitir_factura',args),invoice=await ok(client.from('facturas').select('*').eq('id',id).single())
check('AT-01: authorized frozen checkout keeps displayed price and discount',()=>{assert.equal(invoice.subtotal,original*2);assert.equal(invoice.total,args.p_total_confirmado)})
check('AT-01: invoice, stock, ledger, commission and PDF agree',()=>{
  assert.equal(tables().productos.find(x=>x.id===p.id).stock,p.stock-2)
  assert.equal(tables().movimientos.find(m=>m.factura_id===id&&m.origen==='venta').monto,args.p_total_confirmado)
  assert.equal(invoice.comision,Math.round(args.p_total_confirmado*.03))
})
const items=await ok(client.from('factura_items').select('*').eq('factura_id',id))
let pdf=createInvoicePdf(invoice,items,tables().tienda[0],true)
let pdfText=Buffer.from(await pdf.blob.arrayBuffer()).toString('latin1')
check('AT-01: real PDF contains exact confirmed total',()=>assert.ok(pdfText.includes(args.p_total_confirmado.toLocaleString('es-CO'))))
assert.equal(await rpc('emitir_factura',args),id);check('AT-01: retry is idempotent',()=>assert.equal(tables().facturas.filter(f=>f.request_id===args.p_request_id).length,1))
await reject(client.rpc('emitir_factura',{...args,p_request_id:'wrong-total',p_total_confirmado:1}),'AT-01: mismatched confirmed total rejected atomically')
const originalIdentity={customer:invoice.clientes,seller:invoice.perfiles,business:invoice.tienda_snapshot,item:items[0]}
await ok(client.from('clientes').update({nombre:'Changed customer',documento:'CHANGED-DOC',telefono:'3009999999'}).eq('id',1))
await rpc('guardar_empleado_demo',{id:'demo-ana',datos:{nombre:'Changed seller'},permisos:['vender','ver_inventario','crear_clientes']})
await ok(client.from('tienda').update({nombre:'Changed store',nit:'CHANGED-NIT',factura_pie:'CHANGED-FOOTER'}).eq('id',1))
await ok(client.from('productos').update({nombre:'Changed product',codigo:'CHANGED-SKU',precio_venta:1}).eq('id',p.id))
const historical=await ok(client.from('facturas').select('*').eq('id',id).single()),historicalItems=await ok(client.from('factura_items').select('*').eq('factura_id',id))
check('AT-02: historical customer name/document/phone immutable',()=>assert.deepEqual(historical.clientes,originalIdentity.customer))
check('AT-02: historical seller name immutable',()=>assert.deepEqual(historical.perfiles,originalIdentity.seller))
check('AT-02: historical business data immutable',()=>assert.deepEqual(historical.tienda_snapshot,originalIdentity.business))
check('AT-02: item name/SKU/price immutable',()=>assert.deepEqual(historicalItems,items))
pdf=createInvoicePdf(historical,historicalItems,tables().tienda[0],true);pdfText=Buffer.from(await pdf.blob.arrayBuffer()).toString('latin1')
check('AT-02: regenerated PDF keeps original customer/seller/NIT/amount',()=>{assert.ok(pdfText.includes(originalIdentity.customer.nombre));assert.ok(pdfText.includes(originalIdentity.seller.nombre));assert.ok(!pdfText.includes('CHANGED-NIT'));assert.ok(pdfText.includes(args.p_total_confirmado.toLocaleString('es-CO')))})
const mixedPdf=createInvoicePdf({...historical,clientes:{nombre:'LIVE-CUSTOMER'},perfiles:{nombre:'LIVE-SELLER'}},historicalItems,tables().tienda[0],true)
const mixedText=Buffer.from(await mixedPdf.blob.arrayBuffer()).toString('latin1')
check('AT-02: PDF prefers snapshots even when a caller supplies current customer/seller joins',()=>{assert.ok(mixedText.includes(originalIdentity.customer.nombre));assert.ok(mixedText.includes(originalIdentity.seller.nombre));assert.ok(!mixedText.includes('LIVE-CUSTOMER'));assert.ok(!mixedText.includes('LIVE-SELLER'))})
client=createDemoClient(options)
check('AT-02: snapshots survive reopened client',()=>assert.deepEqual(client.demo.snapshot().tables.facturas.find(f=>f.id===id).tienda_snapshot,originalIdentity.business))
// Simulate pre-snapshot data, then edit through a normal coordinated transaction.
const legacy=client.demo.snapshot(),old=legacy.tables.facturas[0];delete old.cliente_snapshot;delete old.vendedor_snapshot;delete old.tienda_snapshot
memory.set(DEMO_KEY,JSON.stringify(legacy));const legacyBefore=await ok(client.from('facturas').select('*').eq('id',old.id).single())
await ok(client.from('clientes').update({nombre:'Legacy changed later'}).eq('id',old.cliente_id))
const legacyAfter=await ok(client.from('facturas').select('*').eq('id',old.id).single())
check('AT-02: additive legacy fallback freezes before editing without deleting old records',()=>assert.deepEqual(legacyAfter.clientes,legacyBefore.clientes))
const customer=await ok(client.from('clientes').insert({nombre:'31 invoice customer'}).select().single())
await rpc('ajustar_stock_fisico_demo',{id:p.id,stock:100,motivo:'Priority regression'})
const ids=[]
for(let i=0;i<35;i++)ids.push(await rpc('emitir_factura',{p_cliente_id:customer.id,p_metodo_pago:'efectivo',p_items:[{producto_id:p.id,cantidad:1}]}))
await rpc('anular_factura',{p_factura_id:ids[0],p_motivo:'Cancelled not counted'})
const returned=tables().factura_items.find(i=>i.factura_id===ids[1])
await rpc('registrar_devolucion',{p_factura_id:ids[1],p_items:[{factura_item_id:returned.id,cantidad:1}],p_motivo:'Net total regression',p_reintegra_stock:true})
const all=await ok(client.from('facturas_netas').select('*').eq('cliente_id',customer.id))
check('AT-03: all 35 invoices retained, cancelled excluded and refunds deducted once',()=>{assert.equal(all.length,35);assert.equal(all.filter(f=>f.estado==='emitida').reduce((n,f)=>n+f.total_neto,0),33)})
await ok(client.auth.signInWithPassword({email:'ana@angietech.demo',password:DEMO_PASSWORD}))
for(const table of ['productos','productos_venta','stock_bajo','factura_items','facturas','facturas_netas','garantias','movimientos_inventario']){
  const rows=await ok(client.from(table).select('*'));const json=JSON.stringify(rows)
  check('AT-08: no nested cost fields in '+table,()=>assert.ok(!/"(precio_compra|costo_unitario|costo_total|costo_neto|utilidad_mes|valor_inventario)":/.test(json)))
}
for(const table of ['compras','compra_items','compras_saldo','pagos_proveedor'])await reject(client.from(table).select('*'),'AT-08: restricted purchase table '+table)
await reject(client.rpc('resumen_dashboard'),'AT-08: financial summary denied without permission')
await reject(client.rpc('emitir_factura',{p_metodo_pago:'efectivo',p_items:[{producto_id:p.id,cantidad:1,precio_unitario:original}],p_total_confirmado:original}),'AT-01: unauthorized stale price rejected rather than charged differently')
await ok(client.auth.signInWithPassword({email:'admin@angietech.demo',password:DEMO_PASSWORD}))
check('AT-08: administrator still receives cost data',()=>assert.ok(tables().productos.find(p=>p.precio_compra>0)))
const adminProducts=await ok(client.from('productos').select('*'));check('AT-08: administrator API includes cost',()=>assert.ok(adminProducts.some(p=>p.precio_compra>0)))
await rpc('guardar_empleado_demo',{id:'demo-ana',datos:{},permisos:['vender','ver_inventario','crear_clientes','ver_finanzas']})
await ok(client.auth.signInWithPassword({email:'ana@angietech.demo',password:DEMO_PASSWORD}))
const finance=await rpc('resumen_dashboard')
check('AT-08: finance permission without cost permission does not expose profit or valuation',()=>{assert.equal(finance[0].utilidad_mes,undefined);assert.equal(finance[0].valor_inventario,undefined)})
await mkdir('artifacts/priority-fixes',{recursive:true});await writeFile('artifacts/priority-fixes/results.json',JSON.stringify({status:'PASS',cases:checks.length,checks,remoteCalls:0},null,2));console.log('PASS '+checks.length+' priority bug regression checks')
