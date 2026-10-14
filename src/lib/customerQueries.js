import { withDeadline, requireData, cancellableQuery } from './asyncResult.js'
import { limpiarBusqueda } from './format.js'

export async function loadCustomers(client, { search = '', limit = 200, activeOnly = false, signal, timeoutMs = 10000 } = {}) {
  return withDeadline(async requestSignal => {
    let query = client.from('clientes').select('*').order('nombre').limit(limit)
    if (activeOnly) query = query.eq('activo', true)
    const text = limpiarBusqueda(search)
    if (text) query = query.or('nombre.ilike.%' + text + '%,documento.ilike.%' + text + '%,telefono.ilike.%' + text + '%,correo.ilike.%' + text + '%')
    const rows = requireData(await cancellableQuery(query, requestSignal))
    if (!Array.isArray(rows)) throw new Error('No se recibió una lista de clientes válida.')
    return rows
  }, { timeoutMs, signal })
}
