// Cierre de caja diario (America/Bogota). Consolida ventas, ajustes y efectivo de un día
// sin modificar facturas ni Finanzas. Importes en centavos enteros, como el libro de caja.
// SQL 17 replica exactamente esta fórmula (incluida la huella de concurrencia).
import { CASH_METHODS, cashCentavos, cashSum, cashInteger } from './cashRegister.js'

export const DAILY_TZ = 'America/Bogota'
export const bogotaDate = value => new Intl.DateTimeFormat('en-CA', { timeZone: DAILY_TZ }).format(new Date(value))
const cents = value => cashCentavos(String(Math.abs(Number(value) || 0)))
const byMethod = rows => Object.fromEntries(CASH_METHODS.map(m => [m, cashSum(rows.filter(r => r.metodo === m).map(r => r.cent))]))

// scopeId null = todo el negocio; un id = solo lo que hizo ese responsable.
export function dailyCashSummary({ fecha, facturas = [], devoluciones = [], sesiones = [], eventos = [], scopeId = null, responsableNombre = null }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha))) throw Error('Fecha de cierre inválida.')
  const mine = id => scopeId == null || String(id) === String(scopeId)
  const onDay = ts => !!ts && bogotaDate(ts) === fecha
  const invoices = new Map(facturas.map(f => [String(f.id), f]))
  const sold = facturas.filter(f => onDay(f.fecha) && mine(f.creado_por ?? f.vendedor_id)).map(f => ({ ...f, metodo: f.metodo_pago, cent: cents(f.total) }))
  const refunds = devoluciones.filter(d => onDay(d.fecha) && mine(d.creado_por) && Number(d.total_devuelto) > 0).map(d => ({ ...d, key: 'devolucion:' + d.id, metodo: invoices.get(String(d.factura_id))?.metodo_pago || 'efectivo', cent: cents(d.total_devuelto) }))
  const voided = facturas.filter(f => f.estado === 'anulada' && onDay(f.anulada_en) && mine(f.anulada_por)).map(f => {
    const returned = devoluciones.filter(d => String(d.factura_id) === String(f.id)).reduce((n, d) => n + Number(d.total_devuelto || 0), 0)
    return { ...f, key: 'anulacion:' + f.id, metodo: f.metodo_pago, cent: cents(Math.max(0, Number(f.total) - returned)) }
  }).filter(f => f.cent > 0)
  const sessions = sesiones.filter(s => mine(s.responsable_id))
  const sessionIds = new Set(sessions.map(s => String(s.id)))
  const events = eventos.filter(e => sessionIds.has(String(e.caja_id)) && onDay(e.fecha))
  const cashOf = types => cashSum(events.filter(e => types.includes(e.tipo)).map(e => e.efectivo_cent))
  const ventas = byMethod(sold), dev = byMethod(refunds), anu = byMethod(voided)
  const transfers = new Map()
  for (const f of sold.filter(f => f.metodo === 'transferencia')) { const name = f.medio_transferencia?.nombre || 'Sin medio registrado'; transfers.set(name, cashSum([transfers.get(name) || 0, f.cent])) }
  const efectivo = {
    inicial_cent: cashSum(sessions.filter(s => onDay(s.apertura_en)).map(s => s.inicial_cent)),
    ventas_cent: ventas.efectivo,
    entradas_cent: cashOf(['entrada']),
    salidas_cent: cashOf(['salida', 'gasto', 'pago_proveedor']),
    reembolsos_cent: cashOf(['reembolso']),
  }
  efectivo.esperado_cent = cashSum(Object.values(efectivo))
  // A refund is confirmed only when a caja «reembolso» points to its adjustment event.
  const adjustmentEvents = eventos.filter(e => ['devolucion', 'anulacion'].includes(e.tipo))
  const confirmed = new Set(adjustmentEvents.filter(a => eventos.some(r => r.tipo === 'reembolso' && String(r.ajuste_id) === String(a.id))).map(a => a.origen))
  const abiertas = sessions.filter(s => s.estado === 'abierta' && bogotaDate(s.apertura_en) <= fecha).sort((a, b) => a.id - b.id).map(s => ({ id: s.id, responsable_nombre: s.responsable_nombre }))
  const resumen = {
    fecha, alcance: scopeId == null ? 'negocio' : 'responsable', responsable_id: scopeId ?? null, responsable_nombre: scopeId == null ? null : responsableNombre,
    ventas: { cantidad: sold.length, anuladas: sold.filter(f => f.estado === 'anulada').length, bruto_cent: cashSum(Object.values(ventas)), por_metodo: ventas,
      transferencias_por_medio: [...transfers].sort((a, b) => a[0].localeCompare(b[0], 'es')).map(([nombre, cent]) => ({ nombre, cent })) },
    devoluciones: { cantidad: refunds.length, cent: cashSum(Object.values(dev)), por_metodo: dev },
    anulaciones: { cantidad: voided.length, cent: cashSum(Object.values(anu)), por_metodo: anu },
    neto_por_metodo: Object.fromEntries(CASH_METHODS.map(m => [m, cashSum([ventas[m], -dev[m], -anu[m]])])),
    efectivo,
    pendientes: { cajas_abiertas: abiertas, reembolsos_sin_confirmar: [...refunds, ...voided].filter(a => !confirmed.has(a.key)).length },
  }
  resumen.neto_cent = cashSum(Object.values(resumen.neto_por_metodo))
  resumen.huella = dailyFingerprint(resumen, events.length)
  return resumen
}
// Any new sale, adjustment, drawer movement or opened drawer changes the fingerprint.
export function dailyFingerprint(r, eventCount) {
  return [r.ventas.cantidad, r.ventas.bruto_cent, r.devoluciones.cantidad, r.devoluciones.cent, r.anulaciones.cantidad, r.anulaciones.cent, r.efectivo.esperado_cent, eventCount, r.pendientes.cajas_abiertas.length].map(v => cashInteger(v)).join('|')
}

function csvCell(value) { let s = String(value ?? ''); if (/^[\s]*[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replaceAll('"', '""') + '"' }
export function dailyReportCsv(resumen, cierre = null, facturas = []) {
  const r = resumen, label = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia' }
  const rows = [['Cierre de caja diario', r.fecha], ['Zona horaria', DAILY_TZ], ['Alcance', r.alcance === 'negocio' ? 'Todo el negocio' : 'Responsable: ' + (r.responsable_nombre || r.responsable_id)], ['Unidad monetaria', 'Centavos COP enteros'],
    ['Estado', cierre ? 'Cerrado' : 'Sin cerrar'], ['Cerrado por', cierre?.cerrado_nombre || ''], ['Fecha de cierre', cierre?.cerrado_en || ''],
    ['Cantidad de ventas', r.ventas.cantidad], ['Ventas anuladas después', r.ventas.anuladas], ['Total vendido', r.ventas.bruto_cent],
    ...CASH_METHODS.map(m => ['Vendido ' + label[m], r.ventas.por_metodo[m]]),
    ...r.ventas.transferencias_por_medio.map(t => ['Transferencia · ' + t.nombre, t.cent]),
    ['Devoluciones (' + r.devoluciones.cantidad + ')', -r.devoluciones.cent], ['Anulaciones (' + r.anulaciones.cantidad + ')', -r.anulaciones.cent],
    ...CASH_METHODS.map(m => ['Neto ' + label[m], r.neto_por_metodo[m]]), ['Total neto del día', r.neto_cent],
    ['Efectivo inicial', r.efectivo.inicial_cent], ['Ventas en efectivo', r.efectivo.ventas_cent], ['Entradas de efectivo', r.efectivo.entradas_cent], ['Salidas y pagos en efectivo', r.efectivo.salidas_cent], ['Reembolsos en efectivo confirmados', r.efectivo.reembolsos_cent], ['Efectivo esperado', r.efectivo.esperado_cent],
    ['Efectivo contado', cierre?.contado_cent ?? 'Sin cierre'], ['Diferencia', cierre?.diferencia_cent ?? 'Sin cierre'], ['Reembolsos sin confirmar', r.pendientes.reembolsos_sin_confirmar], ['Observaciones', cierre?.observaciones || ''],
    ['Nota', 'Tarjeta y transferencia no suman al efectivo físico. Cerrar el día no modifica facturas, inventario ni Finanzas.'],
    [], ['Factura', 'Hora', 'Método', 'Estado', 'Total (centavos)'], ...facturas.map(f => [f.prefijo + '-' + f.numero, f.fecha, f.metodo_pago + (f.medio_transferencia?.nombre ? ' · ' + f.medio_transferencia.nombre : ''), f.estado, cents(f.total)])]
  return '﻿' + rows.map(row => row.map(csvCell).join(';')).join('\r\n')
}

// ---------- Demo: misma regla de permisos que SQL 17 ----------
const business = row => row?.negocio_id ?? 1
export const canCloseCash = (state, actor) => !!actor?.activo && (actor.rol === 'admin' || state.tables.perfil_permisos.some(p => p.perfil_id === actor.id && p.permiso === 'cerrar_caja'))
function closer(state) {
  const actor = state.tables.perfiles.find(p => p.id === state.session?.user?.id)
  if (!canCloseCash(state, actor)) throw Error('No tienes permiso para realizar cierres de caja.')
  return actor
}
function scopeFor(state, actor, requested) {
  if (actor.rol !== 'admin') { if (requested != null && requested !== actor.id) throw Error('Solo puedes consultar tu propio cierre.'); return actor }
  if (requested == null || requested === '') return null
  const p = state.tables.perfiles.find(x => x.id === requested && business(x) === business(actor))
  if (!p) throw Error('El responsable no pertenece al negocio.')
  return p
}
function demoSummary(state, actor, fecha, scope) {
  const t = state.tables, own = row => business(row) === business(actor)
  const facturas = t.facturas.filter(own), ids = new Set(facturas.map(f => f.id))
  return { resumen: dailyCashSummary({ fecha, facturas, devoluciones: t.devoluciones.filter(d => ids.has(d.factura_id)), sesiones: (t.caja_sesiones || []).filter(own), eventos: (t.caja_eventos || []).filter(own), scopeId: scope?.id ?? null, responsableNombre: scope?.nombre }), facturas }
}
const closureKey = (c, actor, fecha, scope) => business(c) === business(actor) && c.fecha === fecha && (c.responsable_id ?? null) === (scope?.id ?? null)
export function demoDailyAction(state, name, args, context) {
  const actor = closer(state), t = state.tables
  t.caja_cierres_diarios ||= []
  const visible = c => business(c) === business(actor) && (actor.rol === 'admin' || c.responsable_id === actor.id)
  if (name === 'caja_cierres_dia') {
    const rows = t.caja_cierres_diarios.filter(visible).filter(c => args.p_antes_id == null || c.id < Number(args.p_antes_id)).sort((a, b) => b.id - a.id)
    return { cierres: rows.slice(0, 30).map(({ resumen, ...c }) => ({ ...c, neto_cent: resumen.neto_cent, vendido_cent: resumen.ventas.bruto_cent })), limitado: rows.length > 30 }
  }
  const fecha = String(args.p_fecha || ''), today = bogotaDate(context.now())
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || fecha > today) throw Error('Elige una fecha válida, hasta hoy.')
  const scope = scopeFor(state, actor, args.p_responsable ?? null)
  if (name === 'caja_dia_estado') {
    const { resumen, facturas } = demoSummary(state, actor, fecha, scope)
    const lista = facturas.filter(f => bogotaDate(f.fecha) === fecha && (scope == null || (f.creado_por ?? f.vendedor_id) === scope.id)).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).slice(0, 200).map(f => ({ id: f.id, prefijo: f.prefijo, numero: f.numero, fecha: f.fecha, total: f.total, metodo_pago: f.metodo_pago, estado: f.estado, medio_transferencia: f.medio_transferencia || null }))
    return { version: 1, resumen, cierre: t.caja_cierres_diarios.find(c => closureKey(c, actor, fecha, scope)) || null, facturas: lista, hoy: today }
  }
  if (name !== 'caja_cerrar_dia') throw Error('Operación de cierre desconocida.')
  const req = String(args.p_request_id || '')
  if (!/^[A-Za-z0-9-]{8,100}$/.test(req)) throw Error('Identificador de operación inválido.')
  const previous = t.caja_cierres_diarios.find(c => business(c) === business(actor) && c.request_id === req)
  if (previous) return previous.id
  if (t.caja_cierres_diarios.some(c => closureKey(c, actor, fecha, scope))) throw Error('Este día ya tiene un cierre confirmado para este alcance.')
  const { resumen } = demoSummary(state, actor, fecha, scope)
  if (String(args.p_huella) !== resumen.huella) throw Error('Hubo movimientos nuevos en el día. Actualiza y revisa los totales antes de cerrar.')
  if (resumen.pendientes.cajas_abiertas.length) throw Error('Cierra primero los turnos de caja abiertos: ' + resumen.pendientes.cajas_abiertas.map(c => '#' + c.id + ' ' + c.responsable_nombre).join(', ') + '.')
  const counted = cashInteger(args.p_contado_cent), notes = String(args.p_observaciones || '').trim()
  if (counted < 0 || notes.length > 1000) throw Error('Efectivo contado u observaciones inválidos.')
  const difference = cashSum([counted, -resumen.efectivo.esperado_cent])
  if (difference !== 0 && !notes) throw Error('Explica el sobrante o faltante en observaciones.')
  const row = context.add(state, 'caja_cierres_diarios', { negocio_id: business(actor), fecha, alcance: resumen.alcance, responsable_id: scope?.id ?? null, responsable_nombre: scope?.nombre ?? null, resumen, huella: resumen.huella, esperado_cent: resumen.efectivo.esperado_cent, contado_cent: counted, diferencia_cent: difference, observaciones: notes, cerrado_por: actor.id, cerrado_nombre: actor.nombre, cerrado_en: context.now().toISOString(), request_id: req })
  context.activity(state, 'Cierre de caja diario', 'caja', row.id, { fecha, alcance: resumen.alcance, diferencia_cent: difference })
  return row.id
}
