import assert from 'node:assert/strict'
import { createDemoClient } from '../src/lib/demo/client.js'
import { DEMO_KEY, DEMO_PASSWORD } from '../src/lib/demo/seed.js'
import { monetaryAmount, monetaryError, MONEY_LIMIT } from '../src/lib/money.js'
import { mkdir, writeFile } from 'node:fs/promises'

let cases=0
const results=[]
const check=(name,action)=>{action();results.push({name,status:'PASS'});cases++}
for(const value of ['9007199254740992','9007199254740993',Infinity,NaN,-1,1.5])check(`Reject ${value}`,()=>assert.ok(monetaryError(value)))
check('Maximum integer preserves exact digits',()=>assert.equal(monetaryAmount('9007199254740991'),MONEY_LIMIT))
const map=new Map(),storage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)}
const client=createDemoClient({storage,now:()=>new Date('2026-10-08T17:00:00Z'),location:{hostname:'localhost',protocol:'http:'}})
const ok=async operation=>{const r=await operation;assert.equal(r.error,null,JSON.stringify(r.error));return r.data}
const rejected=async(name,operation)=>{const before=map.get(DEMO_KEY),r=await operation;assert.ok(r.error,name);assert.match(r.error.message,/demasiado grande/);assert.equal(map.get(DEMO_KEY),before,'No partial writes');results.push({name,status:'PASS'});cases++}
await ok(client.auth.signInWithPassword({email:'admin@angietech.demo',password:DEMO_PASSWORD}))
for(const value of ['9007199254740992','9007199254740993']){
  for(const field of ['precio_compra','precio_venta'])await rejected(`Product ${field} ${value}`,client.rpc('crear_producto_demo',{producto:{codigo:'UNSAFE-'+field,nombre:'Unsafe',precio_compra:0,precio_venta:0,[field]:value},stock:1}))
  await rejected(`Movement ${value}`,client.from('movimientos').insert({tipo:'ingreso',categoria:'Servicio',monto:value,fecha:'2026-10-08'}))
  await rejected(`Purchase ${value}`,client.rpc('registrar_compra',{p_proveedor_id:1,p_forma_pago:'contado',p_metodo_pago:'efectivo',p_items:[{producto_id:8,cantidad:1,costo_unitario:value}]}))
  await rejected(`Sale discount ${value}`,client.rpc('emitir_factura',{p_metodo_pago:'efectivo',p_items:[{producto_id:8,cantidad:1}],p_descuento:value}))
  await rejected(`Line discount ${value}`,client.rpc('emitir_factura',{p_metodo_pago:'efectivo',p_items:[{producto_id:8,cantidad:1,descuento:value}]}))
}
const product=await ok(client.rpc('crear_producto_demo',{producto:{codigo:'MAX-SAFE',nombre:'Safe maximum',precio_compra:0,precio_venta:String(MONEY_LIMIT)},stock:3}))
check('Product accepts exact maximum',()=>assert.equal(product.precio_venta,MONEY_LIMIT))
await ok(client.from('movimientos').insert({tipo:'ingreso',categoria:'Servicio',monto:String(MONEY_LIMIT),fecha:'2026-10-08'}));check('Movement accepts maximum',()=>assert.equal(client.demo.snapshot().tables.movimientos.at(-1).monto,MONEY_LIMIT))
await rejected('Purchase total overflow',client.rpc('registrar_compra',{p_proveedor_id:1,p_forma_pago:'contado',p_metodo_pago:'efectivo',p_items:[{producto_id:product.id,cantidad:2,costo_unitario:MONEY_LIMIT}]}))
await rejected('Sale subtotal overflow',client.rpc('emitir_factura',{p_metodo_pago:'efectivo',p_items:[{producto_id:product.id,cantidad:2}]}))
const id=await ok(client.rpc('emitir_factura',{p_metodo_pago:'efectivo',p_items:[{producto_id:product.id,cantidad:1}]}))
check('Sale accepts exact maximum',()=>assert.equal(client.demo.snapshot().tables.facturas.find(f=>f.id===id).total,MONEY_LIMIT))
const purchase=await ok(client.rpc('registrar_compra',{p_proveedor_id:1,p_forma_pago:'credito',p_vence_el:'2026-10-30',p_items:[{producto_id:product.id,cantidad:1,costo_unitario:String(MONEY_LIMIT)}]}))
check('Purchase accepts exact maximum',()=>assert.equal(client.demo.snapshot().tables.compras.find(c=>c.id===purchase).total,MONEY_LIMIT))
await ok(client.rpc('registrar_pago_proveedor',{p_compra_id:purchase,p_monto:MONEY_LIMIT,p_metodo_pago:'efectivo'}));check('Supplier payment accepts maximum',()=>assert.equal(client.demo.snapshot().tables.pagos_proveedor.at(-1).monto,MONEY_LIMIT))
await rejected('Update rejects unsafe product price',client.from('productos').update({precio_venta:'9007199254740993'}).eq('id',product.id))
await mkdir('artifacts/audit-fixes',{recursive:true});await writeFile('artifacts/audit-fixes/money.json',JSON.stringify({status:'PASS',cases,results},null,2))
console.log(`PASS ${cases} monetary boundary / atomic rejection checks`)
