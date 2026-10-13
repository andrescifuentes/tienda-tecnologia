export class DeadlineError extends Error {
  constructor(message = 'La operación tardó demasiado. Comprueba la conexión e intenta de nuevo.') {
    super(message); this.name = 'DeadlineError'; this.code = 'TIMEOUT'
  }
}
export async function withDeadline(action, { timeoutMs = 10000, signal, message } = {}) {
  const controller = new AbortController()
  let timer, cancel
  const stopped = new Promise((_, reject) => {
    cancel = () => { controller.abort(); reject(new DOMException('Operación cancelada', 'AbortError')) }
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) cancel()
    timer = setTimeout(() => { reject(new DeadlineError(message)); controller.abort() }, timeoutMs)
  })
  try { return await Promise.race([Promise.resolve().then(() => { if (controller.signal.aborted) throw new DOMException('Operación cancelada', 'AbortError'); return action(controller.signal) }), stopped]) }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel) }
}
export const cancellableQuery = (query, signal) => query.abortSignal ? query.abortSignal(signal) : query
export function requireData(result) {
  if (result?.error) throw Object.assign(new Error(result.error.message || 'No se pudo completar la consulta.'), result.error)
  if (!result) throw new Error('El servidor no devolvió una respuesta válida.')
  return result.data
}
