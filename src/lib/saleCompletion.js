import { withDeadline, requireData, cancellableQuery } from './asyncResult.js'
import { invoiceTable } from './invoiceQueries.js'

export const SALE_TIMEOUT = 15000
export const SALE_VERIFY_TIMEOUT = 10000
export const saleJournalKey = actorId => 'angie:sale:' + actorId
export function readSaleAttempt(storage, actorId) {
  try { const saved = JSON.parse(storage.getItem(saleJournalKey(actorId)) || 'null'); return saved?.actorId === actorId && saved.id && saved.args ? saved : null } catch { return null }
}
export function saveSaleAttempt(storage, attempt) { storage.setItem(saleJournalKey(attempt.actorId), JSON.stringify(attempt)) }
export function clearSaleAttempt(storage, actorId, id) {
  if (readSaleAttempt(storage, actorId)?.id === id) storage.removeItem(saleJournalKey(actorId))
}
export function createSaleAttempt({ id, actorId, admin = false, mode = 'legacy', args, total }) {
  if (!id || !actorId) throw new Error('No se pudo identificar esta venta.')
  return { id, actorId, admin, mode, args: structuredClone(args), total, status: 'pending', startedAt: new Date().toISOString() }
}
const responseId = data => { const value = typeof data === 'object' && data ? data.id ?? data.factura_id : data; return (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) || (typeof value === 'string' && /^[1-9][0-9]*$/.test(value)) ? value : null }
const retryMessage = 'No se encontró una factura registrada. Puedes reintentar esta misma venta sin duplicarla.'
const unknownMessage = 'No se pudo confirmar la venta. Comprueba su estado antes de volver a cobrar.'
export function definiteSaleFailure(error) {
  if (error?.code === 'TIMEOUT' || error?.name === 'AbortError' || /fetch|network|connection|offline|conexi/i.test(error?.message || '')) return false
  const status = Number(error?.status || error?.context?.status || (/^[0-9]{3}$/.test(error?.code || '') ? error.code : 0))
  if (status >= 500) return false
  return [400,401,403,404,409,422].includes(status) || /^(P0001|22|23|42501|PGRST)/.test(error?.code || '') || /stock|serial|permiso|descuento|cantidad|producto|cliente|precio|total confirmado|método|obligatori/i.test(error?.message || '')
}
async function lookup(client, attempt, { timeoutMs = SALE_VERIFY_TIMEOUT } = {}) {
  return withDeadline(async signal => {
    const fields = 'id,estado,total,cliente_id,vendedor_id,metodo_pago' + (attempt.mode !== 'legacy' ? ',request_id' : '')
    let q = client.from(invoiceTable(client, { esAdmin: attempt.admin })).select(fields)
    if (attempt.invoiceId) q = q.eq('id', attempt.invoiceId)
    else q = q.eq('request_id', attempt.id)
    if (attempt.mode === 'demo') q = q.eq('creado_por', attempt.actorId)
    else q = q.eq('vendedor_id', attempt.actorId)
    const rows = requireData(await cancellableQuery(q, signal))
    if (!Array.isArray(rows)) throw new Error('No se pudo comprobar la factura.')
    return rows
  }, { timeoutMs })
}
export async function reconcileSale(client, attempt, options = {}) {
  if (attempt.mode === 'legacy' && !attempt.invoiceId) return { status: 'uncertain', message: unknownMessage + ' Esta conexión no permite identificar automáticamente una respuesta perdida. Revisa Facturas; no se enviará otro cobro.' }
  try {
    const rows = await lookup(client, attempt, options)
    if (rows.length === 0) return attempt.mode === 'legacy' ? { status: 'uncertain', message: unknownMessage } : { status: 'retryable', message: retryMessage }
    if (rows.length !== 1) return { status: 'uncertain', message: 'Se encontraron resultados ambiguos. Revisa Facturas antes de cobrar.' }
    const f = rows[0], expectedSeller = attempt.mode === 'demo' ? attempt.args.p_vendedor_id || attempt.actorId : attempt.actorId
    if (f.vendedor_id !== expectedSeller || (attempt.mode !== 'legacy' && f.request_id !== attempt.id) || Number(f.total) !== Number(attempt.total) || String(f.cliente_id ?? '') !== String(attempt.args.p_cliente_id ?? '') || f.metodo_pago !== attempt.args.p_metodo_pago)
      return { status: 'uncertain', message: 'Existe una factura con datos distintos. Revisa el documento antes de continuar.', invoiceId: f.id }
    if (!['emitida','anulada'].includes(f.estado)) return { status: 'uncertain', message: 'La factura existe, pero aún no tiene un estado confirmado. Revisa Facturas.', invoiceId: f.id }
    return { status: 'persisted', invoiceId: f.id, invoiceState: f.estado }
  } catch { return { status: 'uncertain', message: unknownMessage } }
}
export async function submitSale(client, attempt, { timeoutMs = SALE_TIMEOUT, verifyTimeoutMs = SALE_VERIFY_TIMEOUT, onReceipt = () => {} } = {}) {
  if (attempt.mode === 'legacy' && attempt.sent) return reconcileSale(client, attempt, { timeoutMs: verifyTimeoutMs })
  let result, dispatched = false
  try {
    result = await withDeadline(async signal => {
      if (client.auth?.getSession) {
        const session = await client.auth.getSession()
        if (session.error || session.data?.session?.user?.id !== attempt.actorId) return { data: null, error: { code: '401', message: 'La sesión cambió. Revisa el acceso antes de cobrar.' } }
      }
      if (signal.aborted) throw new DOMException('Operación cancelada', 'AbortError')
      const args = attempt.mode === 'legacy' ? attempt.args : { ...attempt.args, p_request_id: attempt.id, p_actor_id: attempt.actorId }
      attempt.sent = true; onReceipt(attempt); dispatched = true
      const rpc = client.rpc(attempt.mode === 'secure' ? 'emitir_factura_segura' : 'emitir_factura', args)
      const response = await cancellableQuery(rpc, signal)
      const id = responseId(response?.data)
      if (id) { attempt.invoiceId = id; onReceipt(attempt) }
      return response
    }, { timeoutMs, message: unknownMessage })
    if (result?.error) throw Object.assign(new Error(result.error.message || unknownMessage), result.error)
    if (!responseId(result?.data)) throw new Error('La respuesta de la venta no confirmó una factura.')
  } catch (error) {
    const checked = await reconcileSale(client, attempt, { timeoutMs: verifyTimeoutMs })
    if (checked.status === 'persisted') return checked
    if (!dispatched) return { status: 'failed', message: 'No se pudo comprobar la sesión antes de cobrar. Reintenta la conexión; no se envió la venta.', error }
    if (result?.error && definiteSaleFailure(error) && !attempt.invoiceId) return { status: 'failed', message: error.message, error }
    return { ...checked, message: checked.status === 'retryable' ? retryMessage : unknownMessage }
  }
  return reconcileSale(client, attempt, { timeoutMs: verifyTimeoutMs })
}
