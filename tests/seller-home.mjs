import test from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { periodoVendedor, cargarInicioVendedor, consultarFacturasVisibles } from '../src/lib/sellerHome.js'
import { createDemoClient } from '../src/lib/demo/client.js'
import { DEMO_PASSWORD } from '../src/lib/demo/seed.js'

const date = iso => new Date(iso)
const ranges = [
  ['hoy', '2026-10-12T04:59:59Z', ['2026-10-11','2026-10-11','2026-10-10','2026-10-10']],
  ['hoy', '2026-10-12T05:00:00Z', ['2026-10-12','2026-10-12','2026-10-11','2026-10-11']],
  ['semana', '2026-10-11T17:00:00Z', ['2026-10-05','2026-10-11','2026-09-28','2026-10-04']],
  ['semana', '2026-10-12T17:00:00Z', ['2026-10-12','2026-10-12','2026-10-05','2026-10-05']],
  ['semana', '2026-01-01T17:00:00Z', ['2025-12-29','2026-01-01','2025-12-22','2025-12-25']],
  ['mes', '2026-10-11T17:00:00Z', ['2026-10-01','2026-10-11','2026-09-01','2026-09-11']],
  ['mes', '2026-03-31T17:00:00Z', ['2026-03-01','2026-03-31','2026-02-01','2026-02-28']],
  ['mes', '2024-03-31T17:00:00Z', ['2024-03-01','2024-03-31','2024-02-01','2024-02-29']],
  ['mes', '2026-01-01T17:00:00Z', ['2026-01-01','2026-01-01','2025-12-01','2025-12-01']],
]
for (const [period, now, expected] of ranges) test(period + ' / ' + now, () => {
  const r = periodoVendedor(period, date(now))
  assert.deepEqual([r.desde,r.hasta,r.anteriorDesde,r.anteriorHasta], expected)
})
test('Reject an unsupported period', () => assert.throws(() => periodoVendedor('otro'), /Período/))

function fixture({ total = 2500000, previous = 2000000, priorCount = 1, failAt = -1 } = {}) {
  let invocation = 0
  const calls = []
  const rows = [{ id: 1, vendedor_id: 'seller-a', total: 2500000 }, { id: 2, vendedor_id: 'seller-b', total: 9999999 }]
  const client = {
    rpc(name, args) {
      calls.push({ name, args }); const i = invocation++
      return Promise.resolve({ data: [{ vendedor_id: 'seller-b', facturas: 200, total_vendido: 9999999 }, { vendedor_id: 'seller-a', facturas: i ? priorCount : 2, total_vendido: i ? previous : total }], error: i === failAt ? { message: 'RPC failed' } : null })
    },
    from(table) {
      calls.push({ table }); const q = { select(columns) { calls.push({ columns }); return q }, eq(key,value) { calls.push({ key,value }); return q }, order() { return q }, limit() { return q }, then(resolve) { return Promise.resolve({ data: rows, error: failAt === 2 ? { message: 'Invoices failed' } : null }).then(resolve) } }
      return q
    },
  }
  return { client, calls }
}
test('Only the authenticated seller contributes, even when another seller is first', async () => {
  const { client,calls } = fixture()
  const result = await cargarInicioVendedor(client, 'seller-a', 'hoy', date('2026-10-11T17:00:00Z'))
  assert.equal(result.total, 2500000); assert.equal(result.facturas, 2); assert.equal(result.variacion, 25)
  assert.deepEqual(result.ultimas.map(f => f.id), [1])
  assert.ok(calls.some(c => c.key === 'vendedor_id' && c.value === 'seller-a'))
  assert.ok(calls.filter(c => c.columns).every(c => !/costo|comision|margen/.test(c.columns)))
})
for (const [previous,priorCount] of [[0,0],[0,1],[2000000,0]]) test('Neutral comparison without a usable base: ' + previous + '/' + priorCount, async () => {
  const { client } = fixture({ previous,priorCount })
  assert.equal((await cargarInicioVendedor(client,'seller-a','hoy')).variacion,null)
})
for (const [total,pct] of [[0,-100],[2000000,0],[3000000,50]]) test('Actual comparison for current total ' + total, async () => {
  const { client } = fixture({ total })
  assert.equal((await cargarInicioVendedor(client,'seller-a','hoy')).variacion,pct)
})
for (const failAt of [0,1,2]) test('Surface failure in query ' + failAt, async () => {
  await assert.rejects(cargarInicioVendedor(fixture({failAt}).client,'seller-a','mes'))
})
test('Missing seller cannot cause an unscoped request', async () => {
  const { client,calls } = fixture()
  await assert.rejects(cargarInicioVendedor(client,null,'hoy'),/vendedor/)
  assert.throws(() => consultarFacturasVisibles(client,{},'*'),/vendedor/)
  assert.deepEqual(calls,[])
})
test('Real SDK sends owner constraint; admin query retains existing behavior', async () => {
  const requests = []
  const client = createClient('https://local-test.invalid','public-fixture',{ auth: { persistSession:false }, global: { fetch: async url => { requests.push(new URL(url)); return new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}) } } })
  await consultarFacturasVisibles(client,{perfilId:'seller-a'},'id').eq('id',42)
  await consultarFacturasVisibles(client,{esAdmin:true,perfilId:'admin'},'id')
  assert.equal(requests[0].searchParams.get('vendedor_id'),'eq.seller-a')
  assert.equal(requests[0].searchParams.get('id'),'eq.42')
  assert.equal(requests[1].searchParams.has('vendedor_id'),false)
})
test('Demo totals equal existing net RPC and owner scope survives reload/login change', async () => {
  const values = new Map(), storage = { getItem:key=>values.get(key)||null, setItem:(key,v)=>values.set(key,v), removeItem:key=>values.delete(key) }
  const now = () => date('2026-10-11T17:00:00Z')
  const make = () => createDemoClient({ storage,now,location:{hostname:'127.0.0.1',protocol:'http:'} })
  let client = make()
  for (const [id,email] of [['demo-ana','ana@angietech.demo'],['demo-carlos','carlos@angietech.demo']]) {
    const login = await client.auth.signInWithPassword({email,password:DEMO_PASSWORD}); assert.equal(login.error,null)
    for (const period of ['hoy','semana','mes']) {
      const result = await cargarInicioVendedor(client,id,period,now())
      const expected = await client.rpc('ventas_por_empleado',{p_desde:result.rango.desde,p_hasta:result.rango.hasta})
      assert.equal(result.total,Number(expected.data.find(r=>r.vendedor_id===id)?.total_vendido)||0)
      assert.equal(result.facturas,Number(expected.data.find(r=>r.vendedor_id===id)?.facturas)||0)
      assert.ok(result.ultimas.every(f=>f.vendedor_id===id))
      client=make()
      assert.equal((await cargarInicioVendedor(client,id,period,now())).total,result.total)
    }
  }
})
