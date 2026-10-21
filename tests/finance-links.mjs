import test from 'node:test'
import assert from 'node:assert/strict'
import { financeDetails, financePurchaseRows, incomeBreakdown, invoiceCustomerName } from '../src/lib/financeDetails.js'

const period = { ini:'2026-10-01', fin:'2026-10-31' }
const invoice = (extra = {}) => ({ id:30, prefijo:'FV', numero:30, cliente_id:7, clientes:{ nombre:'Luisa' }, estado:'emitida', fecha:'2026-10-15T15:00:00Z', total:50000, total_neto:37000, ...extra })
const movement = (extra = {}) => ({ id:1, tipo:'gasto', monto:12500, fecha:'2026-10-15', categoria:'Otros', descripcion:'Movimiento registrado', ...extra })

test('FV-0030 conserva el cliente Luisa y el vínculo de la factura', () => {
  const f = invoice()
  const [row] = financeDetails({ invoices:[f], period }).ingreso
  assert.equal(invoiceCustomerName(f), 'Luisa')
  assert.equal(row.concept, 'Venta · Luisa')
  assert.equal(row.reference, 'FV-0030')
  assert.equal(row.invoiceId, 30)
  assert.equal(row.amount, 37000)
})

test('La identidad histórica prevalece sobre el nombre actual del cliente', () => {
  const f = invoice({ cliente_snapshot:{ nombre:'Luisa histórica' }, clientes:{ nombre:'Cliente renombrado' } })
  assert.equal(invoiceCustomerName(f), 'Luisa histórica')
  assert.equal(financeDetails({ invoices:[f], period }).ingreso[0].concept, 'Venta · Luisa histórica')
})

test('Los nombres válidos de otras facturas no se reemplazan por Consumidor final', () => {
  for (const nombre of ['Andrés Cifuentes', 'Marcela SAS', 'José María', 'Luisa']) {
    assert.equal(invoiceCustomerName(invoice({ clientes:{ nombre } })), nombre)
  }
})

test('Consumidor final corresponde a ventas sin cliente identificado', () => {
  assert.equal(invoiceCustomerName(invoice({ cliente_id:null, clientes:null })), 'Consumidor final')
  assert.equal(invoiceCustomerName(invoice({ cliente_id:null, cliente_snapshot:null, clientes:null })), 'Consumidor final')
})

test('Snapshot nulo de facturas antiguas no oculta el cliente vinculado Luisa', () => {
  const f = invoice({ cliente_snapshot:null })
  assert.equal(invoiceCustomerName(f), 'Luisa')
  assert.equal(financeDetails({ invoices:[f], period }).ingreso[0].concept, 'Venta · Luisa')
})

test('Una factura vinculada sin nombre disponible no se hace pasar por venta sin cliente', () => {
  assert.equal(invoiceCustomerName(invoice({ clientes:null })), 'Cliente no disponible')
  assert.equal(invoiceCustomerName(invoice({ clientes:{ nombre:'' } })), 'Cliente no disponible')
})

test('Movimientos usan sus IDs explícitos y preservan el registro original', () => {
  const linkedInvoice = movement({ id:1, tipo:'ingreso', factura_id:30 })
  const linkedPurchase = movement({ id:2, compra_id:91 })
  const unlinked = movement({ id:3, descripcion:'Compra #91 · FV-0030 · Luisa' })
  const rows = financeDetails({ invoices:[invoice()], movements:[linkedInvoice, linkedPurchase, unlinked], period, demo:false })
  const sale = rows.ingreso.find(row => row.id === 'movement-1')
  const purchase = rows.gasto.find(row => row.id === 'movement-2')
  const manual = rows.gasto.find(row => row.id === 'movement-3')
  assert.equal(sale.invoiceId, 30)
  assert.equal(sale.reference, 'FV-0030')
  assert.equal(purchase.purchaseId, 91)
  assert.deepEqual(sale.movement, linkedInvoice)
  assert.deepEqual(purchase.movement, linkedPurchase)
  assert.deepEqual(manual.movement, unlinked)
  assert.ok(manual.invoiceId == null)
  assert.ok(manual.purchaseId == null)
})

test('Compras de Gastos conservan proveedor, referencia, importe y vínculo real', () => {
  const purchases = [
    { id:81, fecha:'2026-10-14', total:20000000, numero_documento:'CL-2026-10', forma_pago:'credito', proveedores:{ nombre:'Claro SAS' } },
    { id:82, fecha:'2026-10-15', total:'12500', numero_documento:'QA-001', forma_pago:'contado', proveedores:{ nombre:'QA Proveedor Pruebas' } },
  ]
  const rows = financePurchaseRows(purchases)
  assert.equal(rows.reduce((sum,row) => sum + row.amount, 0), 20012500)
  assert.equal(rows.find(row => row.purchaseId === 81).concept, 'Compra de mercancía · Claro SAS')
  assert.equal(rows.find(row => row.purchaseId === 81).reference, 'CL-2026-10')
  assert.equal(rows.find(row => row.purchaseId === 82).reference, 'QA-001')
  assert.ok(rows.every(row => row.type === 'gasto'))
})

test('El vínculo de compras no se deduce de la referencia ni del proveedor', () => {
  const [row] = financePurchaseRows([{ id:101, fecha:'2026-10-15', total:12500, numero_documento:'Compra #999 / FV-0030', forma_pago:'contado', proveedores:{ nombre:'Claro SAS' } }])
  assert.equal(row.purchaseId, 101)
  assert.ok(row.invoiceId == null)
  assert.equal(row.reference, 'Compra #999 / FV-0030')
})

test('La navegación no cambia la conciliación neta de octubre ni incluye anuladas', () => {
  const issued = Array.from({ length:22 }, (_,index) => invoice({ id:index+1, numero:index+1, total:1000, total_neto:1000 }))
  issued.push(invoice({ total:99971000, total_neto:99958000 }))
  const cancelled = Array.from({ length:7 }, (_,index) => invoice({ id:index+31, numero:index+31, estado:'anulada', total:5000, total_neto:5000 }))
  const invoices = [...issued,...cancelled]
  const breakdown = incomeBreakdown({ invoices, period })
  assert.equal(breakdown.grossSales, 99993000)
  assert.equal(breakdown.returns, 13000)
  assert.equal(breakdown.netSales, 99980000)
  assert.equal(breakdown.total, 99980000)
  assert.equal(breakdown.issuedCount, 23)
  assert.equal(breakdown.cancelledCount, 7)
  const rows = financeDetails({ invoices, period }).ingreso
  assert.equal(rows.length, 23)
  assert.equal(rows.reduce((sum,row) => sum + row.amount, 0), 99980000)
  assert.equal(financeDetails({ invoices, period:{ ini:'2026-09-01', fin:'2026-09-30' } }).ingreso.length, 0)
})

test('Las transformaciones no alteran facturas, compras ni movimientos de origen', () => {
  const inputs = {
    invoices:[invoice({ cliente_snapshot:{ nombre:'Luisa histórica' } })],
    movements:[movement({ compra_id:82 }), movement({ id:2, tipo:'ingreso', factura_id:30 })],
    purchases:[{ id:82, fecha:'2026-10-15', total:12500, forma_pago:'contado', proveedores:{ nombre:'QA Proveedor Pruebas' } }],
  }
  const before = structuredClone(inputs)
  financeDetails({ ...inputs, period, demo:false })
  financePurchaseRows(inputs.purchases)
  incomeBreakdown({ ...inputs, period, demo:false })
  assert.deepEqual(inputs, before)
})
