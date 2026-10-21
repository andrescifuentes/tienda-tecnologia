import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createDemoClient } from '../src/lib/demo/client.js'
import { tiendaConLocal } from '../src/lib/localesBase.js'
import { camposEmpresa } from '../supabase/functions/_shared/invoice-brand.js'

globalThis.fetch = () => { throw new Error('Sin llamadas remotas en pruebas demo') }
const memoria = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) } }
const local = { hostname: 'localhost', protocol: 'http:' }
async function demo() {
  const client = createDemoClient({ storage: memoria(), location: local, now: () => new Date('2026-10-07T17:00:00Z') })
  const r = await client.auth.signInWithPassword({ email: 'admin@angietech.demo', password: 'AngieDemo123!' })
  assert.ifError(r.error)
  return client
}
const ok = r => { assert.ifError(r.error); return r.data }

test('La factura toma la dirección y el teléfono del local que vende', () => {
  const t = tiendaConLocal({ nombre: 'Angie Tech', direccion: 'Calle 1', telefono: '300', local: '1' }, { nombre: 'Local Centro', direccion: 'Cra 10', numero: '105', telefono: '' })
  assert.equal(t.direccion, 'Cra 10'); assert.equal(t.local, '105'); assert.equal(t.telefono, '300'); assert.equal(t.sede, 'Local Centro')
  assert.deepEqual(camposEmpresa(t).map(([k]) => k), ['Sede', 'Dirección', 'Teléfono'])
})

test('Demo: todo empieza en el Local 1 y el stock por local suma el total', async () => {
  const c = await demo()
  const locales = ok(await c.from('locales').select('*'))
  assert.equal(locales.length, 1)
  const prods = ok(await c.from('productos').select('*'))
  const sl = ok(await c.from('stock_local').select('*'))
  for (const p of prods) assert.equal(sl.filter(r => r.producto_id === p.id).reduce((n, r) => n + r.stock, 0), p.stock)
  assert.ok((await c.from('stock_local').insert({ producto_id: 1, local_id: 1, stock: 99 })).error, 'nadie escribe stock directo')
})

test('Demo: vender desde otro local descuenta de ese local y anular lo devuelve', async () => {
  const c = await demo()
  const nuevo = ok(await c.from('locales').insert({ nombre: 'Local Centro' }).select('*').single()) || ok(await c.from('locales').select('*')).find(l => l.nombre === 'Local Centro')
  const centro = nuevo?.id ?? ok(await c.from('locales').select('*')).find(l => l.nombre === 'Local Centro').id
  const prod = ok(await c.from('productos').select('*')).find(p => !p.maneja_serial && p.stock >= 3)
  const antes = ok(await c.from('stock_local').select('*')).filter(r => r.producto_id === prod.id)
  const enUno = antes.find(r => r.local_id === 1).stock
  // venta en Local Centro (sin stock allí) con el producto del Local 1
  const id = ok(await c.rpc('emitir_factura', { p_cliente_id: null, p_metodo_pago: 'efectivo', p_items: [{ producto_id: prod.id, cantidad: 2, local_id: 1 }], p_local_id: centro }))
  const f = ok(await c.from('facturas').select('*').eq('id', id).single())
  assert.equal(f.local_id, centro)
  const items = ok(await c.from('factura_items').select('*').eq('factura_id', id))
  assert.equal(items[0].local_id, 1)
  let sl = ok(await c.from('stock_local').select('*')).filter(r => r.producto_id === prod.id)
  assert.equal(sl.find(r => r.local_id === 1).stock, enUno - 2)
  // sin stock en Local Centro: debe fallar
  const sinStock = await c.rpc('emitir_factura', { p_cliente_id: null, p_metodo_pago: 'efectivo', p_items: [{ producto_id: prod.id, cantidad: 1, local_id: centro }], p_local_id: centro })
  assert.match(sinStock.error.message, /Stock insuficiente .* Local Centro/)
  // traslado y anulación
  ok(await c.rpc('trasladar_inventario', { p_producto_id: prod.id, p_origen: 1, p_destino: centro, p_cantidad: 1 }))
  sl = ok(await c.from('stock_local').select('*')).filter(r => r.producto_id === prod.id)
  assert.equal(sl.find(r => r.local_id === centro).stock, 1)
  ok(await c.rpc('anular_factura', { p_factura_id: id, p_motivo: 'prueba' }))
  sl = ok(await c.from('stock_local').select('*')).filter(r => r.producto_id === prod.id)
  assert.equal(sl.find(r => r.local_id === 1).stock, enUno - 1)
  // resumen por local
  const r = ok(await c.rpc('resumen_dashboard', { p_local_id: centro }))[0]
  assert.equal(r.facturas_mes, 0)
})

test('SQL 16: las funciones con local están y se otorgan a usuarios autenticados', () => {
  const sql = readFileSync(new URL('../supabase/16_locales.sql', import.meta.url), 'utf8')
  for (const f of ['emitir_factura', 'trasladar_inventario', 'resumen_dashboard', 'ventas_por_empleado', 'registrar_compra', 'ajustar_inventario']) assert.match(sql, new RegExp('grant execute on function ' + f + '\\('))
  assert.match(sql, /create policy stock_local_select/)
  assert.doesNotMatch(sql, /grant (insert|update|delete)[^;]*stock_local/)
})
