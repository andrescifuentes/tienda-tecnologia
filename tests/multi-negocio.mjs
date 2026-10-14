import test from 'node:test'
import assert from 'node:assert/strict'
import { renderInvoicePdf } from '../supabase/functions/_shared/invoice-pdf-core.js'
import { invoiceBrand, isAngieBrand, brandSlug } from '../supabase/functions/_shared/invoice-brand.js'
import { jsPDF } from 'jspdf'

const invoice = { prefijo: 'FV', numero: 7, fecha: '2026-10-13T17:00:00Z', estado: 'emitida', subtotal: 2000, descuento: 0, total: 2000, metodo_pago: 'efectivo', clientes: { nombre: 'Cliente B', documento: '123' }, perfiles: { nombre: 'Carlos' } }
const items = [{ nombre: 'Celular B', cantidad: 1, precio_unitario: 2000 }]

test('Cada negocio factura con su propio nombre', () => {
  assert.equal(invoiceBrand({ nombre: 'Celulares Carlos' }), 'Celulares Carlos')
  assert.ok(isAngieBrand({ nombre: 'Angie Tech' }) && isAngieBrand({}))
  assert.ok(!isAngieBrand({ nombre: 'Celulares Carlos' }))
  assert.equal(brandSlug({ nombre: 'Tecnología Ñandú & Cía' }), 'TECNOLOGIA-NANDU-CIA')
  assert.equal(brandSlug({ nombre: 'Angie Tech' }), 'ANGIE-TECH')
})

test('El PDF de otro negocio no lleva el logo de Angie Tech', async () => {
  const logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  const otro = renderInvoicePdf(invoice, items, { id: 2, nombre: 'Celulares Carlos' }, { jsPDF, logo })
  assert.equal(otro.filename, 'CELULARES-CARLOS-FV-0007.pdf')
  const angie = renderInvoicePdf(invoice, items, { id: 1, nombre: 'Angie Tech' }, { jsPDF, logo })
  assert.equal(angie.filename, 'ANGIE-TECH-FV-0007.pdf')
  const imagen = async pdf => Buffer.from(await pdf.blob.arrayBuffer()).toString('latin1').includes('/Subtype /Image')
  assert.equal(await imagen(angie), true)
  assert.equal(await imagen(otro), false)
  assert.ok(Buffer.from(await otro.blob.arrayBuffer()).toString('latin1').includes('CELULARES CARLOS'))
})
