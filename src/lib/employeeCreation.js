import { normalizeEmployeeInput } from '../../supabase/functions/_shared/employee-input.js'

export { normalizeEmployeeInput }

export const EMPLOYEE_CREATION_TIMEOUT = 35000
export class EmployeeCreationError extends Error {
  constructor(message, { code = 'EMPLOYEE_CREATION_FAILED', stage = 'envio', status, requestId, uncertain = false } = {}) {
    super(message); this.name = 'EmployeeCreationError'
    Object.assign(this, { code, stage, status, requestId, uncertain })
  }
}

// Covers SDK token lookup and response-body parsing as well as the HTTP request.
// Abort alone cannot release a promise stalled before fetch (e.g. token refresh).
export async function withEmployeeDeadline(action, { timeoutMs = EMPLOYEE_CREATION_TIMEOUT, stage = 'envio', uncertain = false } = {}) {
  const controller = new AbortController()
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new EmployeeCreationError(
        uncertain
          ? 'La creaci\u00f3n tard\u00f3 demasiado. Actualiza la lista y comprueba el correo antes de reintentar; el servidor podr\u00eda haber terminado.'
          : 'La consulta tard\u00f3 demasiado. Comprueba la conexi\u00f3n e intenta actualizar la lista.',
        { code: 'TIMEOUT', stage, uncertain }))
      controller.abort()
    }, timeoutMs)
  })
  try { return await Promise.race([Promise.resolve().then(() => action(controller.signal)), deadline]) }
  finally { clearTimeout(timer) }
}

function friendlyFailure(payload = {}, error) {
  if (!payload || typeof payload !== 'object') payload = {}
  const raw = String(payload.error || payload.message || error?.message || '')
  const status = error?.context?.status ?? payload.status
  const safeCode = value => typeof value === 'string' && /^[A-Z0-9_]{1,48}$/.test(value) ? value : undefined
  const responseRequestId = error?.context?.headers?.get?.('sb-request-id')
  const requestId = [payload.requestId, responseRequestId].find(value => typeof value === 'string' && /^[a-f0-9-]{16,64}$/i.test(value))
  const meta = { code: safeCode(payload.code) || safeCode(error?.code) || 'BACKEND_REJECTED', stage: payload.stage || 'envio', status, requestId, uncertain: !!payload.uncertain }
  let message
  // Messages from our Edge Function are already safe, actionable and stage-specific.
  if (status === 404 || payload.code === 'NOT_FOUND' || /function.*not found/i.test(raw)) {
    meta.code = 'FUNCTION_NOT_FOUND'; meta.stage = 'gateway'
    message = 'La funci\u00f3n crear-empleado no est\u00e1 desplegada o disponible en el proyecto Supabase configurado. Revisa el proyecto y despliega esa funci\u00f3n.'
  } else if (payload.code === 'BOOT_ERROR') {
    meta.stage = 'inicio'
    message = 'La funci\u00f3n crear-empleado no pudo iniciar. Revisa sus imports y los registros de Supabase.'
  } else if (error?.name === 'FunctionsFetchError') {
    meta.code = 'FUNCTION_REQUEST_FAILED'; meta.stage = 'conexion'; meta.uncertain = true
    message = 'No se pudo enviar la solicitud a crear-empleado. Revisa la conexi\u00f3n, el despliegue y la respuesta CORS de la funci\u00f3n. Comprueba la lista antes de reintentar.'
  } else if (error?.name === 'FunctionsRelayError') {
    meta.code = 'FUNCTION_RELAY_FAILED'; meta.stage = 'gateway'
    message = 'Supabase no pudo comunicar la solicitud con crear-empleado. Revisa su despliegue y registros.'
  } else if (payload.stage && payload.error) message = payload.error
  else if (/duplicate.*document|document.*duplicate/i.test(raw)) { meta.code = 'DOCUMENT_ALREADY_EXISTS'; message = 'Ya existe un empleado con ese documento.' }
  else if (/already.*registered|email.*exists|duplicate.*correo|duplicate.*email/i.test(raw)) { meta.code = 'EMAIL_ALREADY_EXISTS'; message = 'Ese correo ya est\u00e1 registrado. Usa otro o revisa el usuario existente.' }
  else if (status === 401 || /invalid jwt|unauthenticated|jwt expired/i.test(raw)) message = 'Tu sesi\u00f3n no es v\u00e1lida. Inicia sesi\u00f3n de nuevo como administrador.'
  else if (status === 403 || /row.level.security|permission denied|no tienes permiso/i.test(raw)) message = 'No hay permisos para crear el empleado. Revisa el acceso del administrador y la configuraci\u00f3n del backend.'
  else if (/fetch|network|conexi|connection|abort|offline/i.test(raw)) {
    message = 'No se pudo confirmar la creaci\u00f3n por un fallo de conexi\u00f3n. Actualiza la lista antes de reintentar.'
    meta.uncertain = true; meta.code = 'CONNECTION_FAILED'
  } else if (/password|contrase/i.test(raw)) message = 'Auth rechaz\u00f3 la contrase\u00f1a. Revisa las reglas de seguridad del proyecto.'
  else if (/documento|correo|nombre|comisi|permiso|obligatori/i.test(raw) && status !== 500) message = raw
  else message = 'El backend rechaz\u00f3 la creaci\u00f3n del empleado. Revisa la funci\u00f3n crear-empleado y sus registros.'
  return new EmployeeCreationError(message + ' [' + meta.code + ']', meta)
}

export async function createEmployee(client, input, { demo = false, timeoutMs = EMPLOYEE_CREATION_TIMEOUT, logger = console } = {}) {
  const body = normalizeEmployeeInput(input, { demo })
  let stage = 'envio', created = false
  try {
    return await withEmployeeDeadline(async signal => {
      const { data, error } = await client.functions.invoke('crear-empleado', { body, signal, timeout: timeoutMs })
      if (error || data?.error) {
        let payload = data || {}
        if (error?.context?.json) {
          try { payload = await (error.context.clone?.() || error.context).json() }
          catch { /* HTTP status still provides useful diagnostics for a non-JSON response. */ }
        }
        throw friendlyFailure(payload, error)
      }
      if (!data || typeof data.id !== 'string' || !data.id.trim()) {
        throw new EmployeeCreationError('El servidor no confirm\u00f3 un usuario v\u00e1lido. Actualiza la lista antes de reintentar.', { code: 'INVALID_RESPONSE', uncertain: true })
      }
      created = true; stage = 'verificacion'
      let profileQuery = client.from('perfiles').select('*').eq('id', data.id).single()
      let permissionsQuery = client.from('perfil_permisos').select('permiso').eq('perfil_id', data.id)
      if (profileQuery.abortSignal) profileQuery = profileQuery.abortSignal(signal)
      if (permissionsQuery.abortSignal) permissionsQuery = permissionsQuery.abortSignal(signal)
      const [profile, permissions] = await Promise.all([profileQuery, permissionsQuery])
      const actual = (permissions.data || []).map(p => p.permiso).sort()
      const expected = [...body.permisos].sort()
      if (profile.error || permissions.error || !profile.data ||
          profile.data.correo !== body.correo || profile.data.rol !== body.rol || !profile.data.activo ||
          (body.rol === 'vendedor' && JSON.stringify(actual) !== JSON.stringify(expected))) {
        throw new EmployeeCreationError('El servidor cre\u00f3 el usuario, pero no se pudo confirmar su perfil y permisos. Revisa la lista y el backend antes de reintentar.', { code: 'VERIFICATION_FAILED', stage, uncertain: true })
      }
      return profile.data
    }, { timeoutMs, stage: 'creacion', uncertain: true })
  } catch (error) {
    const failure = error instanceof EmployeeCreationError ? error : friendlyFailure({}, error)
    if (created) { failure.uncertain = true; failure.stage = stage }
    // Never log the submitted form, email, password, tokens or raw backend errors.
    logger.error('[crear-empleado]', { code: failure.code, stage: failure.stage, status: failure.status, requestId: failure.requestId, uncertain: failure.uncertain })
    throw failure
  }
}

export async function loadEmployees(client, { timeoutMs = 15000 } = {}) {
  return withEmployeeDeadline(async signal => {
    let query = client.from('perfiles').select('*').order('nombre')
    if (query.abortSignal) query = query.abortSignal(signal)
    const { data, error } = await query
    if (error) throw new EmployeeCreationError('No se pudo actualizar la lista de empleados. Comprueba la conexi\u00f3n y los permisos e intenta de nuevo.', { code: error.code || 'LIST_FAILED', stage: 'lista' })
    return data || []
  }, { timeoutMs, stage: 'lista' })
}
