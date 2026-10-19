// Operational cash ledger. Money is stored and added as integer centavos.
export const CASH_METHODS = ['efectivo', 'tarjeta', 'transferencia']
const LIMIT = BigInt(Number.MAX_SAFE_INTEGER)
export function cashCentavos(value) {
  const text = String(value ?? '').trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error('Ingresa un importe válido con máximo dos decimales.')
  const [whole, fraction = ''] = text.split('.')
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  if (result > LIMIT) throw new Error('El importe supera el límite seguro de caja.')
  return Number(result)
}
export function cashInteger(value) {
  if (!/^-?\d+$/.test(String(value))) throw new Error('Importe de caja no válido.')
  const n = BigInt(String(value))
  if (n < -LIMIT || n > LIMIT) throw new Error('El importe supera el límite seguro de caja.')
  return Number(n)
}
export function cashSum(values) {
  const sum = values.reduce((n, value) => n + BigInt(cashInteger(value)), 0n)
  if (sum < -LIMIT || sum > LIMIT) throw new Error('El total supera el límite seguro de caja.')
  return Number(sum)
}
export function cashSummary(session, events) {
  const own = events.filter(e => String(e.caja_id) === String(session.id))
  const ventas = Object.fromEntries(CASH_METHODS.map(method => [method, cashSum(own.filter(e => e.tipo === 'venta' && e.metodo === method).map(e => e.monto_cent))]))
  const ajustes = cashSum(own.filter(e => ['devolucion', 'anulacion'].includes(e.tipo)).map(e => e.monto_cent))
  const pendientes = own.filter(e => ['devolucion', 'anulacion'].includes(e.tipo) && !own.some(p => String(p.ajuste_id) === String(e.id)))
  return { ventas, ajustes_cent: ajustes, vendido_bruto_cent: cashSum(Object.values(ventas)), efectivo_esperado_cent: cashSum([session.inicial_cent, ...own.map(e => e.efectivo_cent)]), eventos: own.length, reembolsos_por_confirmar: pendientes.length }
}
export function cashSchemaMissing(error) {
  return ['PGRST202', 'PGRST205', '42P01', '42883'].includes(error?.code)
}
export async function cashRequest(client, name, args = {}) {
  let timer
  try {
    const result = await Promise.race([client.rpc(name, args), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('La consulta de caja tardó demasiado. Reintenta para confirmar su estado; no se repite automáticamente.')), 12000) })])
    if (result.error) throw Object.assign(new Error(result.error.message || 'No se pudo consultar caja.'), { code: result.error.code })
    return result.data
  } finally { clearTimeout(timer) }
}
export const newCashRequest = () => globalThis.crypto?.randomUUID?.() || 'caja-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
function checkedActor(state, context) {
  const actor = state.tables.perfiles.find(p => p.id === state.session?.user?.id)
  if (!actor?.activo || !(actor.rol === 'admin' || state.tables.perfil_permisos.some(p => p.perfil_id === actor.id && p.permiso === 'vender'))) throw new Error('No tienes permiso para operar caja.')
  return actor
}
const demoBusiness=row=>row?.negocio_id??1
function ownedSession(state, id, actor) {
  const session = state.tables.caja_sesiones.find(s => String(s.id) === String(id))
  if (!session || demoBusiness(session)!==demoBusiness(actor) || (session.responsable_id !== actor.id && actor.rol !== 'admin')) throw new Error('No tienes permiso para esta caja.')
  return session
}
function requestId(id) { if (typeof id !== 'string' || !/^[A-Za-z0-9-]{8,100}$/.test(id)) throw new Error('Identificador de operación inválido.'); return id }
function text(value, label, max = 500) { const result = String(value ?? '').trim(); if (!result || result.length > max) throw new Error(label + ' obligatorio (máximo ' + max + ' caracteres).'); return result }
export function demoCashAction(state, name, args, context) {
  const actor = checkedActor(state, context), tables = state.tables
  tables.caja_sesiones ||= []; tables.caja_eventos ||= []
  if (name === 'caja_estado') {
    const allowed = tables.caja_sesiones.filter(s => demoBusiness(s)===demoBusiness(actor)&&(actor.rol === 'admin' || s.responsable_id === actor.id)).sort((a, b) => b.id - a.id)
    const active = allowed.find(s => s.responsable_id === actor.id && s.estado === 'abierta') || null
    const selected = args.p_caja_id != null ? ownedSession(state, args.p_caja_id, actor) : active
    const page = args.p_antes_id == null ? allowed : allowed.filter(s=>s.id < cashInteger(args.p_antes_id))
    return { version: 1, active, session: selected, history: page.slice(0, 30), history_limited: page.length > 30, summary: selected ? selected.resumen_cierre || cashSummary(selected, tables.caja_eventos) : null, pending_adjustments: selected ? tables.caja_eventos.filter(e=>e.caja_id===selected.id&&['devolucion','anulacion'].includes(e.tipo)&&!tables.caja_eventos.some(p=>p.ajuste_id===e.id)).slice(0,100) : [], events: selected ? tables.caja_eventos.filter(e => e.caja_id === selected.id).slice(-100).reverse() : [], events_limited: selected ? tables.caja_eventos.filter(e => e.caja_id === selected.id).length > 100 : false }
  }
  const req = requestId(args.p_request_id)
  if (name === 'caja_abrir') {
    const previous = tables.caja_sesiones.find(s => demoBusiness(s)===demoBusiness(actor)&&s.request_id === req && s.responsable_id === actor.id)
    if (previous) return previous.id
    if (tables.caja_sesiones.some(s => demoBusiness(s)===demoBusiness(actor)&&s.responsable_id === actor.id && s.estado === 'abierta')) throw new Error('Ya tienes una caja abierta. Actualiza la consulta.')
    const initial = cashInteger(args.p_inicial_cent)
    if (initial < 0) throw new Error('El saldo inicial no puede ser negativo.')
    const row = context.add(state, 'caja_sesiones', { negocio_id:demoBusiness(actor),responsable_id: actor.id, responsable_nombre: actor.nombre, apertura_en: context.now().toISOString(), estado: 'abierta', inicial_cent: initial, revision: 0, request_id: req })
    context.activity(state, 'Caja abierta', 'caja', row.id, { inicial_cent: initial })
    return row.id
  }
  const session = ownedSession(state, args.p_caja_id, actor)
  if (name === 'caja_cerrar' && session.cierre_request_id === req) return session.id
  if (name === 'caja_movimiento') { const previous = tables.caja_eventos.find(e => e.caja_id === session.id && e.request_id === req); if (previous) return previous.id }
  if (session.estado !== 'abierta') throw new Error('La caja está cerrada. No se puede modificar.')
  if (name === 'caja_cerrar') {
    // SQL 17: closing requires admin or the per-employee «cerrar_caja» permission.
    if (actor.rol !== 'admin' && !tables.perfil_permisos.some(p => p.perfil_id === actor.id && p.permiso === 'cerrar_caja')) throw new Error('No tienes permiso para cerrar caja. Pide autorización al administrador.')
    if (cashInteger(args.p_revision) !== session.revision) throw new Error('La caja recibió movimientos nuevos. Actualiza y revisa el efectivo antes de cerrar.')
    const counted = cashInteger(args.p_contado_cent), notes = String(args.p_observaciones || '').trim()
    if (counted < 0 || notes.length > 1000) throw new Error('Efectivo contado u observaciones inválidos.')
    const summary = cashSummary(session, tables.caja_eventos), difference = cashSum([counted, -summary.efectivo_esperado_cent])
    if (difference !== 0 && !notes) throw new Error('Explica el sobrante o faltante en observaciones.')
    Object.assign(session, { estado: 'cerrada', cierre_en: context.now().toISOString(), cerrado_por: actor.id, cerrado_nombre: actor.nombre, contado_cent: counted, diferencia_cent: difference, observaciones: notes, resumen_cierre: summary, cierre_request_id: req })
    context.activity(state, 'Caja cerrada', 'caja', session.id, { contado_cent: counted, diferencia_cent: difference })
    return session.id
  }
  if (name !== 'caja_movimiento') throw new Error('Operación de caja desconocida.')
  if (!['entrada', 'salida', 'gasto', 'pago_proveedor', 'reembolso'].includes(args.p_tipo)) throw new Error('Tipo de movimiento inválido.')
  const value = cashInteger(args.p_monto_cent), method = args.p_metodo || 'efectivo'
  if (value <= 0 || !CASH_METHODS.includes(method) || args.p_tipo !== 'reembolso' && method !== 'efectivo') throw new Error('Importe o medio de pago inválido.')
  const description = text(args.p_descripcion, 'Motivo'), reference = text(args.p_referencia, 'Referencia', 120)
  let adjustment = null
  if (args.p_tipo === 'reembolso') {
    adjustment = tables.caja_eventos.find(e => String(e.id) === String(args.p_ajuste_id) && e.caja_id === session.id && ['devolucion', 'anulacion'].includes(e.tipo))
    if (!adjustment || Math.abs(adjustment.monto_cent) !== value || tables.caja_eventos.some(e => e.ajuste_id === adjustment.id)) throw new Error('Selecciona un ajuste pendiente y su importe exacto; no puede pagarse dos veces.')
  }
  const signed = args.p_tipo === 'entrada' ? value : -value
  const event = context.add(state, 'caja_eventos', { negocio_id:demoBusiness(session),caja_id: session.id, tipo: args.p_tipo, metodo: method, monto_cent: signed, efectivo_cent: method === 'efectivo' ? signed : 0, descripcion: description, referencia: reference, ajuste_id: adjustment?.id || null, creado_por: actor.id, fecha: context.now().toISOString(), request_id: req })
  session.revision++
  cashSummary(session, tables.caja_eventos) // Validate safe aggregate before committing.
  context.activity(state, 'Movimiento de caja', 'caja', session.id, { evento_id: event.id, tipo: event.tipo })
  return event.id
}
export function recordDemoCash(state, { actorId, tipo, metodo, valor, origenId, referencia }, context) {
  const actor=state.tables.perfiles.find(p=>p.id===actorId)
  const session = state.tables.caja_sesiones?.find(s => demoBusiness(s)===demoBusiness(actor)&&s.responsable_id === actorId && s.estado === 'abierta')
  if (!session || !valor) return
  const source = tipo + ':' + origenId
  if (state.tables.caja_eventos.some(e => demoBusiness(e)===demoBusiness(session)&&e.origen === source)) return
  const value = cashCentavos(valor), signed = tipo === 'venta' ? value : -value
  context.add(state, 'caja_eventos', { negocio_id:demoBusiness(session),caja_id: session.id, tipo, metodo, monto_cent: signed, efectivo_cent: tipo === 'venta' && metodo === 'efectivo' ? value : 0, descripcion: tipo === 'venta' ? 'Venta confirmada' : 'Ajuste comercial; confirma el reembolso realizado', referencia, origen: source, origen_id: origenId, creado_por: actorId, fecha: context.now().toISOString() })
  session.revision++
  cashSummary(session, state.tables.caja_eventos)
}
function csvCell(value) { let s = String(value ?? ''); if (/^[\s]*[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replaceAll('"', '""') + '"' }
export function cashReportCsv(session, summary) {
  const rows = [['Reporte operativo de caja', session.id], ['Responsable', session.responsable_nombre], ['Apertura', session.apertura_en], ['Cierre', session.cierre_en || 'Abierta'], ['Estado', session.estado], ['Unidad monetaria', 'Centavos COP enteros'], ['Saldo inicial', session.inicial_cent], ...CASH_METHODS.map(m => ['Ventas brutas ' + m, summary.ventas[m]]), ['Ajustes comerciales', summary.ajustes_cent], ['Efectivo esperado', summary.efectivo_esperado_cent], ['Efectivo contado', session.contado_cent ?? 'Sin cierre'], ['Diferencia', session.diferencia_cent ?? 'Sin cierre'], ['Reembolsos sin confirmar', summary.reembolsos_por_confirmar], ['Eventos registrados', summary.eventos], ['Observaciones', session.observaciones || ''], ['Nota', 'Libro operativo separado. Cerrar caja no modifica facturas ni Finanzas. Ajustes comerciales no descuentan efectivo sin confirmar pago.']]
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(';')).join('\r\n')
}
