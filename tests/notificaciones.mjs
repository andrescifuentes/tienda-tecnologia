import test from 'node:test'
import assert from 'node:assert/strict'
import { cargarNotificaciones } from '../src/lib/notificaciones.js'

const datos = {
  productos: [{ id: 1, codigo: 'A1', nombre: 'Funda', stock: 0, stock_min: 3 }, { id: 2, codigo: 'B2', nombre: 'Cable', stock: 2, stock_min: 3 }, { id: 3, codigo: 'C3', nombre: 'Cargador', stock: 9, stock_min: 3 }],
  facturas: [{ id: 10, prefijo: 'FV', numero: 28, total: 55000, estado: 'emitida', fecha: '2026-10-14T02:00:00Z', clientes: { nombre: 'Ana' } }, { id: 9, prefijo: 'FV', numero: 27, total: 9000, estado: 'anulada', fecha: '2026-10-13T02:00:00Z', anulada_en: '2026-10-13T05:00:00Z', clientes: null }],
  compras: [{ id: 4, total: 120000, estado: 'recibida', creado_en: '2026-10-13T10:00:00Z', proveedores: { nombre: 'Prov' } }],
}
const cliente = (pedidas = []) => ({ from(t) { pedidas.push(t); const q = { select: () => q, eq: () => q, gte: () => q, order: () => q, limit: () => q, then: (a, b) => Promise.resolve({ data: datos[t === 'productos_venta' ? 'productos' : t], error: null }).then(a, b) }; return q } })

test('La campana muestra stock bajo y lo último del negocio', async () => {
  const pedidas = []
  const n = await cargarNotificaciones(cliente(pedidas), { esAdmin: true, puedeCompras: true, ahora: Date.parse('2026-10-14T12:00:00Z') })
  assert.deepEqual(n.map(x => x.title), ['Producto agotado', 'Stock bajo', 'Venta FV-0028', 'Ingreso de mercancía', 'Factura anulada FV-0027'])
  assert.equal(n[2].to, '/facturas?factura=10')
  assert.ok(n[2].text.includes('Ana') && n[2].text.includes('$55.000'))
  assert.deepEqual(pedidas, ['productos', 'facturas', 'compras'])
})

test('El vendedor no consulta costos ni compras', async () => {
  const pedidas = []
  await cargarNotificaciones(cliente(pedidas), { esAdmin: false, puedeCompras: false })
  assert.deepEqual(pedidas, ['productos_venta', 'facturas'])
})
