import test from 'node:test'
import assert from 'node:assert/strict'
import { armarMensajeFactura, plantillaFactura, MENSAJE_FACTURA_BASE } from '../src/lib/mensajeFactura.js'
import { prepararEnvioFactura } from '../src/lib/invoiceDelivery.js'
import { crearBorradorCorreoFactura } from '../src/lib/invoiceEmail.js'

const datos = { cliente: 'Ana', negocio: 'Angie Tech', factura: 'FV-0029', total: '$2.500.000', enlace: 'https://x.test/f/abc' }
test('El mensaje por defecto lleva cliente, factura, total y enlace', () => {
  const m = armarMensajeFactura(MENSAJE_FACTURA_BASE, datos)
  for (const v of ['Hola Ana,', 'Angie Tech', 'FV-0029', '$2.500.000', 'https://x.test/f/abc']) assert.ok(m.includes(v), v)
})
test('Sin enlace se quita su línea; sin nombre queda «Hola,»', () => {
  const m = armarMensajeFactura(MENSAJE_FACTURA_BASE, { ...datos, enlace: '', cliente: '' })
  assert.ok(!m.includes('{enlace}') && !m.includes('https://'))
  assert.ok(m.startsWith('Hola,'))
})
test('El mensaje del administrador se usa en WhatsApp y correo', () => {
  const tienda = { nombre: 'Angie Tech', mensaje_factura: 'Hola {cliente}! Tu factura {factura}: {enlace}' }
  assert.equal(plantillaFactura({}), MENSAJE_FACTURA_BASE)
  const invoice = { prefijo: 'FV', numero: 29, total: 2500000, clientes: { nombre: 'Ana Ruiz' } }
  const wa = prepararEnvioFactura({ canal: 'whatsapp', invoice, telefono: '3001234567', pdfUrl: 'https://x.test/f/abc', tienda })
  assert.equal(wa.cuerpo, 'Hola Ana! Tu factura FV-0029: https://x.test/f/abc')
  const mail = crearBorradorCorreoFactura({ invoice, correo: 'ana@x.co', tienda, pdfUrl: 'https://x.test/f/abc' })
  assert.equal(mail.cuerpo, 'Hola Ana! Tu factura FV-0029: https://x.test/f/abc')
  assert.equal(mail.adjuntoManual, false)
})
