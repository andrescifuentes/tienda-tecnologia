import test from 'node:test'
import assert from 'node:assert/strict'
import { createDemoClient } from '../src/lib/demo/client.js'
import { DEMO_PASSWORD } from '../src/lib/demo/seed.js'
import { createAuthSession } from '../src/lib/authSession.js'
import { loadCustomers } from '../src/lib/customerQueries.js'
import { createSaleAttempt, submitSale, reconcileSale, saveSaleAttempt, readSaleAttempt } from '../src/lib/saleCompletion.js'
import { invoiceFields, invoiceItemFields, invoiceTable } from '../src/lib/invoiceQueries.js'
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function demo(email = 'admin@angietech.demo') {
  const records = new Map(), storage = { getItem: k => records.get(k) || null, setItem: (k,v) => records.set(k,v), removeItem:k=>records.delete(k) }
  const client = createDemoClient({ storage, location: { hostname:'localhost', protocol:'http:' } })
  assert.equal((await client.auth.signInWithPassword({email,password:DEMO_PASSWORD})).error,null)
  return {client,storage}
}
async function ok(query) { const r = await query; assert.equal(r.error,null,JSON.stringify(r.error)); return r.data }

for (const email of ['ana@angietech.demo','carlos@angietech.demo']) test('AUD-01: all invoice children are isolated for '+email,async()=>{
  const {client:c}=await demo(email),own=new Set((await ok(c.from('facturas').select('*'))).map(f=>f.id))
  for(const table of ['factura_items','factura_envios','devoluciones'])assert.ok((await ok(c.from(table).select('*'))).every(row=>own.has(row.factura_id)),table)
  const lines=new Set((await ok(c.from('factura_items').select('*'))).map(i=>i.id))
  const refunds=new Set((await ok(c.from('devoluciones').select('*'))).map(i=>i.id))
  assert.ok((await ok(c.from('devolucion_items').select('*'))).every(i=>lines.has(i.factura_item_id)&&refunds.has(i.devolucion_id)))
  assert.ok((await ok(c.from('garantias').select('*'))).every(g=>lines.has(g.factura_item_id)))
  assert.ok((await ok(c.from('unidades_serializadas').select('*'))).every(u=>u.estado==='disponible'||lines.has(u.factura_item_id)))
  const raw=c.demo.snapshot().tables.factura_items.find(i=>!own.has(i.factura_id));assert.deepEqual(await ok(c.from('factura_items').select('*').eq('id',raw.id)),[])
})
test('AUD-01: administrator retains all lines and costs',async()=>{const {client:c}=await demo();const rows=await ok(c.from('factura_items').select('*'));assert.equal(rows.length,c.demo.snapshot().tables.factura_items.length);assert.ok(rows.every(i=>Number.isFinite(i.costo_unitario)))})
test('AUD-16: null filters and SKU wildcard matching are correct',async()=>{const {client:c}=await demo();const p=(await ok(c.from('productos').select('*')))[0];await ok(c.from('productos').update({color:'Audit',codigo:'AUD.X+P'}).eq('id',p.id));assert.ok((await ok(c.from('productos').select('color').not('color','is',null))).every(p=>p.color!=null));assert.equal((await ok(c.from('productos').select('codigo').ilike('codigo','aud.x+p%')))[0].id,p.id);assert.equal((await ok(c.from('productos').select('codigo').ilike('codigo','AUD_X%'))).length,1);assert.throws(()=>c.from('productos').not('color','eq','x'),/no soportado/)})

function authFixture({session={user:{id:'one'},access_token:'token'},getSession,profileDelay=0,profileError=false}={}) {
  let listener;const c={auth:{getSession:getSession||(async()=>({data:{session},error:null})),onAuthStateChange:fn=>{listener=fn;return{data:{subscription:{unsubscribe(){listener=undefined}}}}},signInWithPassword:async()=>({data:{session},error:null}),signOut:async()=>({error:null})},from(table){let id;const q={select(){return q},eq(k,v){if(k==='id')id=v;return q},maybeSingle(){return q},then(a,b){return (profileDelay ? delay(profileDelay) : Promise.resolve()).then(()=>({data:table==='perfiles'?{id,nombre:id,rol:id==='one'?'admin':'vendedor',activo:true}:table==='perfil_permisos'?[{permiso:'vender'}]:{id:1,nombre:'Test'},error:profileError?{message:'Denied'}:null})).then(a,b)}};return q}};return{c,event:(e,s)=>listener?.(e,s)}
}
test('AUD-09: no session is a successful unauthenticated state',async()=>{const {c}=authFixture({session:null});let state;const a=createAuthSession(c,s=>state=s,{timeoutMs:40});await a.start();assert.equal(state.loading,false);assert.equal(state.authError,'');assert.equal(state.session,null);a.stop()})
test('AUD-09: rejected initialization reports error and retry recovers',async()=>{let fail=true;const {c}=authFixture({getSession:async()=>{if(fail)throw Error('Offline');return{data:{session:{user:{id:'one'}}}}}});let state;const a=createAuthSession(c,s=>state=s,{timeoutMs:40});await a.start();assert.equal(state.loading,false);assert.match(state.authError,/comprobar/);fail=false;await a.retry();assert.equal(state.perfil.id,'one');assert.equal(state.authError,'');a.stop()})
test('AUD-09: hung initialization times out and valid login event recovers',async()=>{const f=authFixture({getSession:()=>new Promise(()=>{})});let state;const a=createAuthSession(f.c,s=>state=s,{timeoutMs:20});await a.start();assert.match(state.authError,/tardó/);f.event('SIGNED_IN',{user:{id:'two'}});await delay(10);assert.equal(state.perfil.id,'two');assert.equal(state.loading,false);a.stop()})
test('AUD-06/09: logout cancels late administrator profile results',async()=>{const f=authFixture({profileDelay:30});let state;const a=createAuthSession(f.c,s=>state=s,{timeoutMs:80});const init=a.start();await delay(5);f.event('SIGNED_OUT',null);await init;await delay(40);assert.equal(state.session,null);assert.equal(state.perfil,null);assert.deepEqual(state.permisos,[]);assert.equal(state.tienda,null);assert.equal(state.loading,false);a.stop()})
test('AUD-06/09: changing user never publishes a previous admin role',async()=>{const f=authFixture({profileDelay:25});const states=[];const a=createAuthSession(f.c,s=>states.push(s),{timeoutMs:90});const init=a.start();await delay(5);f.event('SIGNED_IN',{user:{id:'two'}});await init;await delay(40);assert.equal(states.at(-1).perfil.id,'two');assert.ok(states.every(s=>!s.perfil||s.perfil.id===s.session.user.id));a.stop()})
test('AUD-09: profile query errors are recovery states, not absent profile',async()=>{const {c}=authFixture({profileError:true});let state;const a=createAuthSession(c,s=>state=s,{timeoutMs:30});await a.start();assert.equal(state.sinPerfil,false);assert.equal(state.loading,false);assert.ok(state.authError);assert.equal(state.perfil,null);a.stop()})
test('AUD-09: token refresh does not unmount a valid session',async()=>{const f=authFixture();const states=[];const a=createAuthSession(f.c,s=>states.push(s),{timeoutMs:40});await a.start();const count=states.length;f.event('TOKEN_REFRESHED',{user:{id:'one'},access_token:'new'});assert.equal(states.length,count+1);assert.equal(states.at(-1).loading,false);assert.equal(states.at(-1).perfil.rol,'admin');a.stop()})
for(const code of [401,403,404,500])test('AUD-08: customer HTTP '+code+' never becomes successful empty data',async()=>{const q={select(){return q},order(){return q},limit(){return q},then(a,b){return Promise.resolve({data:null,error:{message:'HTTP '+code,code:String(code)}}).then(a,b)}};await assert.rejects(loadCustomers({from:()=>q},{timeoutMs:30}),new RegExp(String(code)))})
test('AUD-08: empty customer response is distinct from timeout',async()=>{const q={select(){return q},order(){return q},limit(){return q},then(a,b){return Promise.resolve({data:[],error:null}).then(a,b)}};assert.deepEqual(await loadCustomers({from:()=>q}),[]);q.then=()=>new Promise(()=>{});await assert.rejects(loadCustomers({from:()=>q},{timeoutMs:15}),e=>e.code==='TIMEOUT')})

async function attemptFixture(){const {client:c,storage}=await demo('ana@angietech.demo');const p=(await ok(c.from('productos_venta').select('*'))).find(p=>!p.maneja_serial&&p.stock>2);const attempt=createSaleAttempt({id:'audit-idempotent-'+p.id,actorId:'demo-ana',mode:'demo',total:p.precio_venta,args:{p_cliente_id:1,p_metodo_pago:'efectivo',p_items:[{producto_id:p.id,cantidad:1}],p_total_confirmado:p.precio_venta}});return{c,storage,p,attempt}}
test('AUD-10: duplicate confirmation produces one invoice and one stock decrement',async()=>{const {c,p,attempt}=await attemptFixture(),before=c.demo.snapshot().tables.facturas.length;const r=await Promise.all([submitSale(c,attempt),submitSale(c,attempt)]);assert.ok(r.every(x=>x.status==='persisted'));assert.equal(r[0].invoiceId,r[1].invoiceId);assert.equal(c.demo.snapshot().tables.facturas.length,before+1);assert.equal((await ok(c.from('productos_venta').select('*').eq('id',p.id).single())).stock,p.stock-1)})
test('AUD-10: committed sale with lost response is recovered without another RPC',async()=>{const {c,attempt}=await attemptFixture();const original=c.rpc.bind(c);let calls=0;c.rpc=async(...args)=>{calls++;await original(...args);throw new TypeError('Failed to fetch')};const r=await submitSale(c,attempt,{timeoutMs:30,verifyTimeoutMs:30});assert.equal(r.status,'persisted');assert.equal(calls,1)})
test('AUD-10: timeout releases and permits only same-key idempotent retry',async()=>{const {c,attempt}=await attemptFixture(),rpc=c.rpc.bind(c);c.rpc=()=>new Promise(()=>{});saveSaleAttempt(new MapStorage(),attempt);const r=await submitSale(c,attempt,{timeoutMs:15,verifyTimeoutMs:30});assert.equal(r.status,'retryable');c.rpc=rpc;assert.equal((await submitSale(c,attempt)).status,'persisted');assert.equal((await submitSale(c,attempt)).status,'persisted');assert.equal(c.demo.snapshot().tables.facturas.filter(f=>f.request_id===attempt.id).length,1)})
test('AUD-10: legacy uncertain response never automatically retries',async()=>{const {c,attempt}=await attemptFixture();attempt.mode='legacy';let calls=0;c.rpc=async()=>{calls++;throw new TypeError('Failed to fetch')};assert.equal((await submitSale(c,attempt,{timeoutMs:30})).status,'uncertain');assert.equal((await reconcileSale(c,attempt)).status,'uncertain');assert.equal(calls,1)})
test('AUD-10: pending invoice is not falsely finalized',async()=>{const {c,attempt}=await attemptFixture();const r=await submitSale(c,attempt);const raw=c.demo.snapshot();raw.tables.facturas.find(f=>f.id===r.invoiceId).estado='pendiente';const map=c;map.from=(()=>{const original=c.from.bind(c);return table=>{const q=original(table);if(table==='facturas'){const then=q.then.bind(q);q.then=(a,b)=>then(r=>a({...r,data:r.data?.map(f=>({...f,estado:'pendiente'}))}),b)}return q}})();assert.equal((await reconcileSale(c,attempt)).status,'uncertain')})
class MapStorage{constructor(){this.m=new Map()}getItem(k){return this.m.get(k)||null}setItem(k,v){this.m.set(k,v)}removeItem(k){this.m.delete(k)}}
test('AUD-10: recovery journal persists per actor',()=>{const s=new MapStorage(),a=createSaleAttempt({id:'sale-one',actorId:'one',args:{p_items:[]},total:1});saveSaleAttempt(s,a);assert.equal(readSaleAttempt(s,'one').id,'sale-one');assert.equal(readSaleAttempt(s,'two'),null)})
test('AUD-11: seller queries omit costs; admin queries retain access',()=>{for(const fields of [invoiceFields(false),invoiceItemFields(false)])assert.doesNotMatch(fields,/costo|precio_compra|utilidad|margen/);assert.equal(invoiceFields(true),'*');assert.equal(invoiceItemsTableForTest(), 'facturas_venta');function invoiceItemsTableForTest(){return invoiceTable({secureInvoiceViews:true},{esAdmin:false})}})


test('AUD-10: a changed session blocks dispatch and charges nothing', async()=>{
  const {c,attempt}=await attemptFixture();let calls=0;c.auth.getSession=async()=>({data:{session:{user:{id:'demo-carlos'}}},error:null});c.rpc=async()=>{calls++;return{data:99,error:null}};
  const result=await submitSale(c,attempt,{timeoutMs:40,verifyTimeoutMs:40});assert.equal(result.status,'failed');assert.equal(calls,0);
});
test('AUD-10: a late session lookup after timeout cannot dispatch a sale', async()=>{
  const {c,attempt}=await attemptFixture();let calls=0;c.auth.getSession=async()=>{await delay(50);return{data:{session:{user:{id:attempt.actorId}}},error:null}};c.rpc=async()=>{calls++;return{data:99,error:null}};
  assert.equal((await submitSale(c,attempt,{timeoutMs:10,verifyTimeoutMs:20})).status,'failed');await delay(65);assert.equal(calls,0);
});
test('Regression: consumer-final sale retains stock, invoice and financial relations',async()=>{
  const {c,p,attempt}=await attemptFixture();attempt.args.p_cliente_id=null;
  const r=await submitSale(c,attempt);assert.equal(r.status,'persisted');const f=await ok(c.from('facturas').select('*').eq('id',r.invoiceId).single());assert.equal(f.cliente_id,null);
  assert.equal((await ok(c.from('productos_venta').select('*').eq('id',p.id).single())).stock,p.stock-1);
  assert.ok(c.demo.snapshot().tables.movimientos.some(m=>m.factura_id===f.id));
});
test('AUD-01/11: explicit cost/finance grants never expose another seller invoice relations',async()=>{
  const {client:admin,storage}=await demo();const seed=admin.demo.snapshot();seed.tables.perfil_permisos.push({perfil_id:'demo-ana',permiso:'ver_costos'},{perfil_id:'demo-ana',permiso:'ver_finanzas'});storage.setItem('angie-tech:demo:v1',JSON.stringify(seed));
  await ok(admin.auth.signInWithPassword({email:'ana@angietech.demo',password:DEMO_PASSWORD}));const own=new Set((await ok(admin.from('facturas').select('*'))).map(f=>f.id));
  const costs=['precio_compra','costo_unitario','costo_total','costo_neto'];
  for(const table of ['facturas','factura_items','facturas_netas','productos']){for(const row of await ok(admin.from(table).select('*')))for(const key of costs)assert.equal(Object.hasOwn(row,key),false,table+':'+key);}
  assert.ok((await ok(admin.from('movimientos').select('*'))).every(m=>m.factura_id==null||own.has(m.factura_id)));
  assert.ok((await ok(admin.from('movimientos_inventario').select('*'))).every(m=>!['factura','anulacion'].includes(m.referencia_tipo)||own.has(Number(m.referencia_id))));
});
