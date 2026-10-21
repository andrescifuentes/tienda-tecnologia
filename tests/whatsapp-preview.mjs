import test from 'node:test'
import assert from 'node:assert/strict'
import { datosVistaPrevia, conMeta } from '../api/factura.js'

const respuesta = d => async () => ({ ok: true, json: async () => d })
const html = '<html><head><title>Angie Tech</title><meta property="og:title" content="Angie Tech"></head><body><script type="module" src="/a.js"></script></body></html>'

test('El enlace de WhatsApp muestra el negocio, la factura y el total (sin datos del cliente)', async () => {
  const d = await datosVistaPrevia('dQL1BFNDDy9n', { url: 'https://x', key: 'k', fetchImpl: respuesta({ factura: { prefijo: 'FV', numero: 28, total: 55000, devuelto: 0 }, tienda: { nombre: 'Angie Tech' }, cliente: { nombre: 'Ana Ruiz' } }) })
  assert.equal(d.titulo, 'Angie Tech · Factura FV-0028')
  assert.match(d.descripcion, /\$55\.000/)
  assert.equal(d.imagen, '/og-angie.jpg')
  const out = conMeta(html, d, 'https://app.test', '/f/dQL1BFNDDy9n')
  assert.equal((out.match(/og:title/g) || []).length, 1)
  assert.ok(out.includes('<title>Angie Tech · Factura FV-0028</title>') && out.includes('https://app.test/og-angie.jpg') && out.includes('<script type="module"'))
  assert.ok(!out.includes('Ana Ruiz'))
})

test('Otro negocio usa la imagen genérica; código inválido no consulta', async () => {
  const d = await datosVistaPrevia('abcdefghijkl', { url: 'https://x', key: 'k', fetchImpl: respuesta({ factura: { prefijo: 'FV', numero: 1, total: 1000 }, tienda: { nombre: 'Celulares Carlos' } }) })
  assert.equal(d.imagen, '/og-factura.jpg'); assert.match(d.titulo, /^Celulares Carlos/)
  let llamado = false
  const malo = await datosVistaPrevia('<script>', { url: 'https://x', key: 'k', fetchImpl: async () => { llamado = true } })
  assert.equal(malo.titulo, 'Tu factura'); assert.equal(llamado, false)
})
