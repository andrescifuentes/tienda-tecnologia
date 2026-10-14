import test from 'node:test'
import assert from 'node:assert/strict'
import { createDemoClient } from '../src/lib/demo/client.js'
import { createInvoicePdf } from '../src/lib/invoicePdf.js'
import { DEMO_PASSWORD } from '../src/lib/demo/seed.js'

// Phase 1 regressions. Medium findings remain explicitly skipped until their phase is authorized.
// Every test uses an isolated in-memory store; no production access or persistent test data.
async function client(email = 'ana@angietech.demo') {
  const records = new Map()
  const c = createDemoClient({ storage: { getItem: key => records.get(key) || null, setItem: (key, value) => records.set(key, value) }, location: { hostname: 'localhost', protocol: 'http:' } })
  const login = await c.auth.signInWithPassword({ email, password: DEMO_PASSWORD })
  assert.equal(login.error, null)
  return c
}
async function ok(query) { const result = await query; assert.equal(result.error, null); return result.data }

test('AUD-01: seller cannot read lines belonging to another seller invoice', async () => {
  const c = await client()
  const own = new Set((await ok(c.from('facturas').select('*'))).map(f => f.id))
  const lines = await ok(c.from('factura_items').select('*'))
  assert.equal(lines.filter(line => !own.has(line.factura_id)).length, 0, 'Direct queries must apply invoice ownership to child records')
})

test.skip('AUD-02: seller without administrative purchase permission cannot query suppliers', async () => {
  const c = await client()
  const result = await c.from('proveedores').select('*')
  assert.ok(result.error || result.data.length === 0, 'Supplier data must follow the same permission boundary as its route')
})

test.skip('AUD-03: cancelling a sale records its resulting warranty state in history', async () => {
  const c = await client('admin@angietech.demo')
  const product = await ok(c.rpc('crear_producto_demo', { producto: { codigo: 'AUDIT-WARRANTY', nombre: 'Audit warranty', precio_compra: 10, precio_venta: 20, garantia_meses: 12 }, stock: 1 }))
  const sale = await ok(c.rpc('emitir_factura', { p_metodo_pago: 'efectivo', p_items: [{ producto_id: product.id, cantidad: 1 }] }))
  const line = (await ok(c.from('factura_items').select('*').eq('factura_id', sale)))[0]
  const warranty = (await ok(c.from('garantias').select('*').eq('factura_item_id', line.id)))[0]
  await ok(c.rpc('actualizar_garantia_demo', { id: warranty.id, estado: 'vigente', nota: 'Audit history' }))
  await ok(c.rpc('anular_factura', { p_factura_id: sale, p_motivo: 'Audit cancelled sale' }))
  const after = await ok(c.from('garantias').select('*').eq('id', warranty.id).single())
  assert.equal(after.historial.at(-1)?.estado, after.estado, 'Warranty history must contain the automatic cancellation transition')
})


test('AUD-16: product form demo query supports the non-null brand filter', async () => {
  const c = await client('admin@angietech.demo')
  const brands = c.from('productos').select('marca')
  assert.equal(typeof brands.not, 'function', 'ProductoForm currently calls not(marca, is, null) on mount')
  await ok(brands.not('marca', 'is', null))
})


test.skip('AUD-17: invoice PDF retains the serial of the sold device', async () => {
  const c = await client('admin@angietech.demo')
  const unit = (await ok(c.from('unidades_serializadas').select('*'))).find(u => u.estado === 'disponible')
  const sale = await ok(c.rpc('emitir_factura', { p_metodo_pago: 'efectivo', p_items: [{ producto_id: unit.producto_id, unidad_id: unit.id, cantidad: 1 }] }))
  const invoice = await ok(c.from('facturas').select('*').eq('id', sale).single())
  const lines = await ok(c.from('factura_items').select('*').eq('factura_id', sale))
  assert.equal(lines[0].unidad_id, unit.id)
  const pdf = createInvoicePdf(invoice, lines.map(line => ({ ...line, serial: unit.serial })), c.demo.snapshot().tables.tienda[0], true)
  const source = Buffer.from(await pdf.blob.arrayBuffer()).toString('latin1')
  assert.ok(source.includes(unit.serial), 'The PDF renderer omits the serial even when the line contains it')
})
