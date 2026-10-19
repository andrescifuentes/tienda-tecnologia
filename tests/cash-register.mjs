import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {createDemoClient} from '../src/lib/demo/client.js'
import {DEMO_PASSWORD} from '../src/lib/demo/seed.js'
import {cashCentavos,cashSum,cashSummary,cashReportCsv,cashSchemaMissing} from '../src/lib/cashRegister.js'
const admin='00000000-0000-0000-0000-000000000001',seller='00000000-0000-0000-0000-000000000002',other='00000000-0000-0000-0000-000000000003'
const store=()=>{let value;return{getItem:()=>value??null,setItem:(k,v)=>{value=v},removeItem:()=>{value=null}}}
async function demo(email='ana@angietech.demo',storage=store()){
 const client=createDemoClient({storage,now:()=>new Date('2026-10-18T15:00:00Z'),location:{protocol:'http:',hostname:'localhost'}})
 const signed=await client.auth.signInWithPassword({email,password:DEMO_PASSWORD});assert.equal(signed.error,null)
 return {client,storage}
}
async function rpc(client,name,args={}){const result=await client.rpc(name,args);assert.equal(result.error,null,result.error?.message);return result.data}
const req=suffix=>'caja-request-'+suffix

test('centavos exactos sin float; rechaza entradas ambiguas y desbordamientos',()=>{
 assert.equal(cashCentavos('0.29'),29);assert.equal(cashCentavos('1234567.01'),123456701);assert.equal(cashSum([29,1,-10]),20)
 for(const input of ['1e3','NaN','-1','1.005','1,2',''])assert.throws(()=>cashCentavos(input))
 assert.throws(()=>cashCentavos('90071992547409.92'));assert.throws(()=>cashSum([Number.MAX_SAFE_INTEGER,1]))
})
test('tarjetas/transferencias y ajustes comerciales no se presumen efectivo fisico',()=>{
 const s={id:1,inicial_cent:10000},events=[{id:1,caja_id:1,tipo:'venta',metodo:'efectivo',monto_cent:20000,efectivo_cent:20000},{id:2,caja_id:1,tipo:'venta',metodo:'tarjeta',monto_cent:50000,efectivo_cent:0},{id:3,caja_id:1,tipo:'venta',metodo:'transferencia',monto_cent:70000,efectivo_cent:0},{id:4,caja_id:1,tipo:'devolucion',metodo:'efectivo',monto_cent:-5000,efectivo_cent:0}]
 const sum=cashSummary(s,events);assert.equal(sum.efectivo_esperado_cent,30000);assert.deepEqual(sum.ventas,{efectivo:20000,tarjeta:50000,transferencia:70000});assert.equal(sum.reembolsos_por_confirmar,1)
 events.push({id:5,caja_id:1,tipo:'reembolso',ajuste_id:4,metodo:'efectivo',monto_cent:-5000,efectivo_cent:-5000});assert.equal(cashSummary(s,events).efectivo_esperado_cent,25000);assert.equal(cashSummary(s,events).reembolsos_por_confirmar,0)
})
test('CSV seguro declara centavos sin datos innecesarios',()=>{
 const csv=cashReportCsv({id:1,responsable_nombre:'=HYPERLINK("bad")',apertura_en:'2026-10-18',estado:'abierta',inicial_cent:0},{ventas:{efectivo:100,tarjeta:0,transferencia:0},ajustes_cent:0,efectivo_esperado_cent:100,eventos:1,reembolsos_por_confirmar:0})
 assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes("'=HYPERLINK"));assert.ok(csv.includes('Centavos COP enteros'));assert.ok(!csv.includes('access_token'))
})
test('demo apertura tres medios, cierre idempotente y persistencia sin duplicar Finanzas',async()=>{
 const {client,storage}=await demo();const before=client.demo.snapshot()
 const id=await rpc(client,'caja_abrir',{p_inicial_cent:1000000,p_request_id:req('open')});assert.equal(await rpc(client,'caja_abrir',{p_inicial_cent:1000000,p_request_id:req('open')}),id)
 assert.ok((await client.rpc('caja_abrir',{p_inicial_cent:0,p_request_id:req('duplicate')})).error)
 let invoiceId
 for(const method of ['efectivo','tarjeta','transferencia'])invoiceId=await rpc(client,'emitir_factura',{p_items:[{producto_id:14,cantidad:1}],p_metodo_pago:method,p_request_id:'sale-request-'+method})
 const state=await rpc(client,'caja_estado');assert.equal(state.events.length,3);assert.equal(state.summary.efectivo_esperado_cent,4990000);assert.equal(state.summary.ventas.tarjeta,3990000)
 const after=client.demo.snapshot();assert.equal(after.tables.movimientos.length-before.tables.movimientos.length,3)
 await rpc(client,'caja_movimiento',{p_caja_id:id,p_request_id:req('expense'),p_tipo:'gasto',p_monto_cent:125000,p_metodo:'efectivo',p_descripcion:'Transporte pagado',p_referencia:'Soporte 100'})
 assert.equal(client.demo.snapshot().tables.movimientos.length,after.tables.movimientos.length)
 assert.ok((await client.rpc('caja_cerrar',{p_caja_id:id,p_request_id:req('close'),p_contado_cent:0,p_revision:state.session.revision,p_observaciones:'Conteo'})).error)
 const current=await rpc(client,'caja_estado'),expected=current.summary.efectivo_esperado_cent
 assert.ok((await client.rpc('caja_cerrar',{p_caja_id:id,p_request_id:req('close'),p_contado_cent:expected-100,p_revision:current.session.revision})).error)
 await rpc(client,'caja_cerrar',{p_caja_id:id,p_request_id:req('close'),p_contado_cent:expected,p_revision:current.session.revision,p_observaciones:'Sin diferencia'})
 await rpc(client,'caja_cerrar',{p_caja_id:id,p_request_id:req('close'),p_contado_cent:expected,p_revision:current.session.revision})
 assert.ok((await client.rpc('caja_movimiento',{p_caja_id:id,p_request_id:req('late'),p_tipo:'entrada',p_monto_cent:10,p_metodo:'efectivo',p_descripcion:'No',p_referencia:'No'})).error)
 const reloaded=(await demo('ana@angietech.demo',storage)).client,history=await rpc(reloaded,'caja_estado',{p_caja_id:id})
 assert.equal(history.session.estado,'cerrada');assert.equal(history.session.diferencia_cent,0);assert.equal(history.summary.efectivo_esperado_cent,expected)
 const final=client.demo.snapshot();assert.equal(final.tables.facturas.length,after.tables.facturas.length);assert.equal(final.tables.facturas.find(f=>f.id===invoiceId).estado,'emitida')
})
test('demo devolucion explicita y anulacion restante no duplican reembolso',async()=>{
 const {client}=await demo('admin@angietech.demo'),id=await rpc(client,'caja_abrir',{p_inicial_cent:0,p_request_id:req('refund-open')})
 const invoice=await rpc(client,'emitir_factura',{p_items:[{producto_id:14,cantidad:2}],p_metodo_pago:'efectivo',p_request_id:'sale-request-refund'})
 const line=client.demo.snapshot().tables.factura_items.find(i=>i.factura_id===invoice)
 await rpc(client,'registrar_devolucion',{p_factura_id:invoice,p_items:[{factura_item_id:line.id,cantidad:1}],p_motivo:'Cambio solicitado',p_reintegra_stock:true})
 let state=await rpc(client,'caja_estado'),adjustment=state.events.find(e=>e.tipo==='devolucion');assert.equal(state.summary.efectivo_esperado_cent,7980000)
 const args={p_caja_id:id,p_request_id:req('payout'),p_tipo:'reembolso',p_monto_cent:3990000,p_metodo:'efectivo',p_descripcion:'Devuelto al cliente',p_referencia:'Comprobante 123',p_ajuste_id:adjustment.id}
 await rpc(client,'caja_movimiento',args);await rpc(client,'caja_movimiento',args)
 assert.ok((await client.rpc('caja_movimiento',{...args,p_request_id:req('payout-duplicate')})).error)
 await rpc(client,'anular_factura',{p_factura_id:invoice,p_motivo:'Cancelar resto'})
 state=await rpc(client,'caja_estado');assert.equal(state.summary.ajustes_cent,-7980000);assert.equal(state.summary.efectivo_esperado_cent,3990000);assert.equal(state.summary.reembolsos_por_confirmar,1)
})
test('demo permisos propios/admin y prohibicion de escrituras directas',async()=>{
 const {client}=await demo();const id=await rpc(client,'caja_abrir',{p_inicial_cent:0,p_request_id:req('roles')})
 await client.auth.signInWithPassword({email:'carlos@angietech.demo',password:DEMO_PASSWORD})
 assert.equal((await rpc(client,'caja_estado')).history.length,0);assert.ok((await client.rpc('caja_estado',{p_caja_id:id})).error)
 assert.ok((await client.rpc('caja_cerrar',{p_caja_id:id,p_request_id:req('other'),p_revision:0,p_contado_cent:0})).error)
 await client.auth.signInWithPassword({email:'admin@angietech.demo',password:DEMO_PASSWORD})
 assert.equal((await rpc(client,'caja_estado',{p_caja_id:id})).session.id,id)
 assert.ok((await client.from('caja_sesiones').update({estado:'cerrada'}).eq('id',id)).error)
})
test('demo historial paginado permite consultar cajas anteriores a las primeras 30',async()=>{
 const {client}=await demo()
 for(let i=0;i<32;i++){const id=await rpc(client,'caja_abrir',{p_inicial_cent:0,p_request_id:req('history-'+i)});await rpc(client,'caja_cerrar',{p_caja_id:id,p_revision:0,p_contado_cent:0,p_request_id:req('close-'+i)})}
 const first=await rpc(client,'caja_estado');assert.equal(first.history.length,30);assert.equal(first.history_limited,true)
 const second=await rpc(client,'caja_estado',{p_antes_id:first.history.at(-1).id});assert.equal(second.history.length,2);assert.equal(second.history_limited,false)
 const old=await rpc(client,'caja_estado',{p_caja_id:second.history.at(-1).id});assert.equal(old.session.estado,'cerrada')
})
test('consultar caja_estado no escribe ni emite transacciones de persistencia',async()=>{
 let value=null,writes=0
 const storage={getItem:()=>value,setItem:(_,next)=>{writes++;value=next},removeItem:()=>{value=null}}
 const {client}=await demo('ana@angietech.demo',storage),before=writes
 const first=await rpc(client,'caja_estado'),second=await rpc(client,'caja_estado')
 assert.deepEqual(first,second);assert.equal(writes,before)
})
test('infraestructura ausente se distingue de permiso denegado',()=>{assert.ok(cashSchemaMissing({code:'PGRST202'}));assert.ok(cashSchemaMissing({code:'42P01'}));assert.equal(cashSchemaMissing({code:'42501'}),false)})
async function sqlFixture(){
 const db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;grant usage on schema auth to authenticated;
 create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('app.uid',true),'')::uuid$$;
 create table perfiles(id uuid primary key,nombre text,rol text,activo boolean default true);
 insert into perfiles values('${admin}','Admin','admin',true),('${seller}','Ana','vendedor',true),('${other}','Carlos','vendedor',true);
 create function es_activo()returns boolean language sql stable security definer as $$select coalesce((select activo from perfiles where id=auth.uid()),false)$$;
 create function es_admin()returns boolean language sql stable security definer as $$select coalesce((select activo and rol='admin'from perfiles where id=auth.uid()),false)$$;
 create function tiene_permiso(p text)returns boolean language sql stable security definer as $$select es_activo()and(p='vender'or es_admin())$$;
 create table actividad(id bigserial primary key,accion text);
 create function registrar_actividad(p_a text,p_e text,p_id text,p_d jsonb)returns void language sql as $$insert into actividad(accion)values(p_a)$$;
 create table facturas(id bigint primary key,vendedor_id uuid references perfiles,metodo_pago text,total numeric,estado text,fecha timestamptz default now(),prefijo text default 'FV',numero int);
 create table devoluciones(id bigint primary key,factura_id bigint references facturas,total_devuelto numeric default 0,creado_por uuid,fecha timestamptz default now());grant usage on schema public to authenticated;`)
 await db.exec(readFileSync('supabase/14_caja.sql','utf8'));return db
}
const setActor=(db,id)=>db.query("select set_config('app.uid',$1,false)",[id])
const sqlRpc=async(db,name,args)=>{const placeholders=args.map((_,i)=>'$'+(i+1)).join(',');return(await db.query('select '+name+'('+placeholders+')as value',args)).rows[0].value}
test('SQL local compila, captura ventas/devoluciones y cierra con revision atomica',async()=>{
 const db=await sqlFixture();try{
 await setActor(db,seller);const id=await sqlRpc(db,'caja_abrir',[1000000,req('sql-open')]);assert.equal(await sqlRpc(db,'caja_abrir',[1000000,req('sql-open')]),id)
 await assert.rejects(()=>sqlRpc(db,'caja_abrir',[0,req('sql-another')]),/Ya tienes/)
 await db.exec(`insert into facturas(id,vendedor_id,metodo_pago,total,estado,numero)values(1,'${seller}','efectivo',0,'emitida',30);update facturas set total=39990 where id=1;update facturas set total=39990 where id=1;insert into facturas(id,vendedor_id,metodo_pago,total,estado,numero)values(2,'${seller}','tarjeta',100000,'emitida',31)`)
 let state=await sqlRpc(db,'caja_estado',[id]);assert.equal(state.events.length,2);assert.equal(state.summary.efectivo_esperado_cent,4999000);assert.equal(state.summary.ventas.tarjeta,10000000)
 const initialRevision=state.session.revision
 await db.exec(`insert into devoluciones values(1,1,0,'${seller}',now());update devoluciones set total_devuelto=10000 where id=1`)
 state=await sqlRpc(db,'caja_estado',[id]);const adj=state.events.find(e=>e.tipo==='devolucion');assert.equal(state.summary.efectivo_esperado_cent,4999000);assert.equal(state.summary.ajustes_cent,-1000000)
 await assert.rejects(()=>sqlRpc(db,'caja_cerrar',[id,req('sql-close'),initialRevision,4999000,'']),/movimientos nuevos/)
 await sqlRpc(db,'caja_movimiento',[id,req('sql-refund'),'reembolso',1000000,'efectivo','Pago real','DEV 1',adj.id])
 await assert.rejects(()=>sqlRpc(db,'caja_movimiento',[id,req('sql-refund-dupe'),'reembolso',1000000,'efectivo','Pago real','DEV 1',adj.id]),/dos veces/)
 state=await sqlRpc(db,'caja_estado',[id]);assert.equal(state.summary.efectivo_esperado_cent,3999000)
 await assert.rejects(()=>sqlRpc(db,'caja_cerrar',[id,req('sql-close'),state.session.revision,3998000,'']),/sobrante o faltante/)
 await sqlRpc(db,'caja_cerrar',[id,req('sql-close'),state.session.revision,3998000,'Faltante contado y reportado']);await sqlRpc(db,'caja_cerrar',[id,req('sql-close'),state.session.revision,3998000,''])
 state=await sqlRpc(db,'caja_estado',[id]);assert.equal(state.session.diferencia_cent,-1000);assert.equal(state.session.estado,'cerrada');assert.equal(state.summary.reembolsos_por_confirmar,0)
 assert.equal((await db.query('select count(*)::int as count from facturas')).rows[0].count,2)
 const eventsBefore=(await db.query('select count(*)::int as n from caja_eventos')).rows[0].n
 await db.exec("insert into facturas(id,vendedor_id,metodo_pago,total,estado,numero)values(3,'"+seller+"','efectivo',100,'emitida',32)")
 assert.equal((await db.query('select count(*)::int as n from caja_eventos')).rows[0].n,eventsBefore)
 await assert.rejects(()=>sqlRpc(db,'caja_movimiento',[id,req('sql-late'),'entrada',100,'efectivo','Late','REF',null]),/cerrada/)
 }finally{await db.close()}
})
test('SQL RLS y RPC cajero ajeno/admin/inactivo; helpers y escritura no publicos',async()=>{
 const db=await sqlFixture();try{
 await setActor(db,seller);const id=await sqlRpc(db,'caja_abrir',[0,req('sql-owner')]);await setActor(db,other);await db.exec('set role authenticated')
 assert.equal((await db.query('select * from caja_sesiones')).rows.length,0);await assert.rejects(()=>sqlRpc(db,'caja_estado',[id]),/permiso/)
 await assert.rejects(()=>db.exec('update caja_sesiones set inicial_cent=9'),/permission denied/);await assert.rejects(()=>db.query('select _caja_resumen($1)',[id]),/permission denied/)
 await db.exec('reset role');await setActor(db,admin);await db.exec('set role authenticated')
 assert.equal((await db.query('select * from caja_sesiones')).rows.length,1);assert.equal((await sqlRpc(db,'caja_estado',[id])).session.responsable_id,seller)
 await db.exec('reset role');await db.exec(`update perfiles set activo=false where id='${admin}'`);await assert.rejects(()=>sqlRpc(db,'caja_estado',[id]),/permiso/)
 }finally{await db.close()}
})
