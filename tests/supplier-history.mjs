import test from 'node:test'
import assert from 'node:assert/strict'
import { createDemoClient } from '../src/lib/demo/client.js'
import { DEMO_PASSWORD } from '../src/lib/demo/seed.js'
import { loadSupplierHistory, supplierHistoryTotals, supplierPeriod } from '../src/lib/supplierHistory.js'

const store = () => { const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) } }
async function demo(email = 'admin@angietech.demo') {
  const client = createDemoClient({ storage: store(), now: () => new Date('2026-10-18T15:00:00Z'), location: { protocol: 'http:', hostname: 'localhost' } })
  assert.equal((await client.auth.signInWithPassword({ email, password: DEMO_PASSWORD })).error, null)
  return client
}
const ok = r => { assert.equal(r.error, null, r.error?.message); return r.data }

test('historial del proveedor: fecha, factura, productos, cantidades, costos, pago, saldo y responsable', async () => {
  const admin = await demo()
  const c1 = ok(await admin.rpc('registrar_compra', { p_proveedor_id: 1, p_numero_documento: 'CLARO-001', p_forma_pago: 'contado', p_metodo_pago: 'efectivo', p_fecha: '2026-08-10', p_items: [{ producto_id: 11, cantidad: 3, costo_unitario: 120000 }, { producto_id: 16, cantidad: 10, costo_unitario: 35000 }], p_request_id: 'buy-1' }))
  const c2 = ok(await admin.rpc('registrar_compra', { p_proveedor_id: 1, p_numero_documento: 'CLARO-002', p_forma_pago: 'credito', p_vence_el: '2026-11-30', p_metodo_pago: 'transferencia', p_fecha: '2026-10-05', p_items: [{ producto_id: 1, cantidad: 2, costo_unitario: 3300000 }], p_seriales: [{ producto_id: 1, serial: '356938035643809' }, { producto_id: 1, serial: '356938035643817' }], p_request_id: 'buy-2' }))
  ok(await admin.rpc('registrar_pago_proveedor', { p_compra_id: c2, p_monto: 1000000, p_metodo_pago: 'transferencia' }))
  ok(await admin.rpc('registrar_compra', { p_proveedor_id: 2, p_numero_documento: 'OTRO-1', p_forma_pago: 'contado', p_metodo_pago: 'efectivo', p_fecha: '2026-10-06', p_items: [{ producto_id: 2, cantidad: 1, costo_unitario: 1 }], p_seriales: [{ producto_id: 2, serial: 'SN-OTRO-1' }], p_request_id: 'buy-3' }))
  const before = admin.demo.snapshot().tables
  const all = await loadSupplierHistory(admin, { proveedorId: 1 })
  assert.ok(all.compras.every(c => c.proveedor_id === 1), 'solo compras del proveedor')
  const one = all.compras.find(c => c.id === c1), two = all.compras.find(c => c.id === c2)
  assert.equal(one.fecha, '2026-08-10'); assert.equal(one.numero_documento, 'CLARO-001')
  assert.deepEqual(one.lineas.map(l => [l.nombre, l.cantidad, l.costo_unitario, l.subtotal]), [['Power Bank Anker 20.000mAh', 3, 120000, 360000], ['Case MagSafe iPhone 15 Pro', 10, 35000, 350000]])
  assert.equal(one.estado_pago, 'Pagada'); assert.deepEqual(one.metodos, ['efectivo']); assert.equal(one.responsable, 'Valentina Gómez')
  assert.equal(two.saldo, 5600000); assert.equal(two.pagado, 1000000); assert.equal(two.estado_pago, 'Abonada'); assert.deepEqual(two.metodos, ['transferencia'])
  assert.deepEqual(two.lineas[0].seriales, ['356938035643809', '356938035643817'])
  assert.ok(all.productos.some(p => p.nombre === 'iPhone 15 Pro 128GB'))
  // Filtros por período y producto.
  const period = await loadSupplierHistory(admin, { proveedorId: 1, desde: '2026-08-01', hasta: '2026-08-31' })
  assert.deepEqual(period.compras.map(c => c.id), [c1])
  const byProduct = await loadSupplierHistory(admin, { proveedorId: 1, productoId: 1 })
  assert.ok(byProduct.compras.some(c => c.id === c2)); assert.ok(!byProduct.compras.some(c => c.id === c1))
  const totals = supplierHistoryTotals(byProduct.compras.filter(c => c.id === c2), 1)
  assert.deepEqual(totals, { compras: 1, unidades: 2, costo: 6600000, saldo: 5600000 })
  await assert.rejects(loadSupplierHistory(admin, { proveedorId: 1, desde: '2026-09-01', hasta: '2026-08-01' }), /posterior/)
  // Consultar no crea inventario, gastos ni pagos.
  const after = admin.demo.snapshot().tables
  for (const table of ['compras', 'compra_items', 'pagos_proveedor', 'movimientos', 'movimientos_inventario', 'unidades_serializadas', 'productos']) assert.deepEqual(after[table], before[table], table)
})

test('historial: vendedor sin permisos de compras no consulta costos', async () => {
  const seller = await demo('ana@angietech.demo')
  await assert.rejects(loadSupplierHistory(seller, { proveedorId: 1 }), /permiso/)
})

test('períodos rápidos en hora de Bogotá', () => {
  assert.deepEqual(supplierPeriod('mes', '2026-10-18'), { desde: '2026-10-01', hasta: '2026-10-18' })
  assert.deepEqual(supplierPeriod('3m', '2026-01-18'), { desde: '2025-11-01', hasta: '2026-01-18' })
  assert.deepEqual(supplierPeriod('12m', '2026-10-18'), { desde: '2025-11-01', hasta: '2026-10-18' })
  assert.deepEqual(supplierPeriod('todo', '2026-10-18'), { desde: null, hasta: null })
})
