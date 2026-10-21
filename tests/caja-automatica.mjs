import test from 'node:test'
import assert from 'node:assert/strict'
import { decidirCaja, abrirCajaDelDia, idCajaAutomatica } from '../src/lib/cajaAutomatica.js'

const yo = 'u1', hoy = '2026-10-21'
test('Sin cajas: abre con base 0', () => assert.deepEqual(decidirCaja({ active: null, history: [] }, yo, hoy), { accion: 'abrir', inicial: 0, anterior: null }))
test('Ayer cerrada (por cualquiera del local): abre con lo contado al cierre', () => {
  const d = decidirCaja({ local_id: 1, active: null, history: [{ id: 3, local_id: 1, responsable_id: 'otro', apertura_en: '2026-10-20T14:00:00Z', estado: 'cerrada', contado_cent: 25000000 }, { id: 4, local_id: 2, responsable_id: yo, apertura_en: '2026-10-21T13:00:00Z' }] }, yo, hoy)
  assert.equal(d.accion, 'abrir'); assert.equal(d.inicial, 25000000)
})
test('Ayer sigue abierta: no abre, pide cerrarla', () => assert.equal(decidirCaja({ active: { id: 3, apertura_en: '2026-10-20T14:00:00Z' }, history: [] }, yo, hoy).accion, 'cerrar_pendiente'))
test('Hoy ya abierta: nada', () => assert.equal(decidirCaja({ active: { id: 5, apertura_en: '2026-10-21T13:00:00Z' }, history: [] }, yo, hoy).accion, 'nada'))
test('Hoy ya cerrada: no se reabre sola', () => assert.equal(decidirCaja({ active: null, history: [{ id: 5, responsable_id: yo, apertura_en: '2026-10-21T13:00:00Z', contado_cent: 1 }] }, yo, hoy).accion, 'nada'))
test('Hora Colombia: 11 pm del 20 sigue siendo el 20', () => assert.equal(decidirCaja({ active: { id: 3, apertura_en: '2026-10-21T04:30:00Z' }, history: [] }, yo, hoy).accion, 'cerrar_pendiente'))
test('Abre una sola vez por día (identificador fijo y memoria del día)', async () => {
  const calls = [], mem = new Map(), storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) }
  const client = { rpc: async (n, a) => { calls.push([n, a]); return n === 'caja_estado' ? { data: { active: null, history: [] }, error: null } : { data: 9, error: null } } }
  const ahora = new Date('2026-10-21T14:00:00Z')
  const r = await abrirCajaDelDia(client, { id: 'abc-123' }, { ahora, storage })
  assert.equal(r.id, 9); assert.equal(calls[1][1].p_request_id, idCajaAutomatica(null, hoy)); assert.match(calls[1][1].p_request_id, /^[A-Za-z0-9-]{8,100}$/)
  await abrirCajaDelDia(client, { id: 'abc-123' }, { ahora, storage }); assert.equal(calls.length, 2)
})

test('Base elegida al cerrar: abre con esa base (no con lo contado)', () => {
  const d = decidirCaja({ local_id: 1, active: null, history: [{ id: 7, local_id: 1, apertura_en: '2026-10-20T14:00:00Z', estado: 'cerrada', contado_cent: 900000, base_siguiente_cent: 200000 }] }, 'u1', '2026-10-21')
  assert.equal(d.inicial, 200000)
  assert.equal(decidirCaja({ local_id: 1, active: null, history: [{ id: 8, local_id: 1, apertura_en: '2026-10-20T14:00:00Z', estado: 'cerrada', contado_cent: 900000, base_siguiente_cent: 0 }] }, 'u1', '2026-10-21').inicial, 0)
})
