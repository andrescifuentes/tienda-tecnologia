import { normalizeEmployeeInput } from '../_shared/employee-input.js'

export const EMPLOYEE_FUNCTION_VERSION = 'crear-empleado-diagnostics-2026-10-11'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'x-angie-function-version, x-angie-request-id',
  'x-angie-function-version': EMPLOYEE_FUNCTION_VERSION,
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify({ ...(body as Record<string, unknown>), functionVersion: EMPLOYEE_FUNCTION_VERSION }), { status, headers: { ...cors, 'Content-Type': 'application/json', 'x-angie-request-id': String((body as Record<string, unknown>).requestId || '') } })

class CreationFailure extends Error {
  code: string
  status: number
  uncertain: boolean
  missingSecrets?: string[]
  constructor(message: string, code: string, status = 400, uncertain = false) {
    super(message); this.code = code; this.status = status; this.uncertain = uncertain
  }
}

function failureFor(error: any, stage: string) {
  if (error instanceof CreationFailure) return error
  const raw = String(error?.message || '')
  if (stage === 'sesion' && (error?.status === 401 || /invalid.*jwt|session.*missing|unauth|token.*expired/i.test(raw))) return new CreationFailure('Tu sesi\u00f3n no es v\u00e1lida. Inicia sesi\u00f3n como administrador.', 'UNAUTHENTICATED', 401)
  if (/already.*registered|duplicate.*correo|email.*exists/i.test(raw))
    return new CreationFailure('Ese correo ya est\u00e1 registrado. Revisa el usuario existente o usa otro.', 'EMAIL_ALREADY_EXISTS', 409)
  if (/document.*duplicate|duplicate.*document/i.test(raw))
    return new CreationFailure('Ya existe un empleado con ese documento.', 'DOCUMENT_ALREADY_EXISTS', 409)
  if (error?.code === '42501' || /row.level.security|permission denied/i.test(raw))
    return new CreationFailure('El backend no tiene permisos para guardar el perfil o sus permisos. Revisa la configuraci\u00f3n del servidor.', 'RLS_DENIED', 500)
  if (error?.code === '23503')
    return new CreationFailure('Una relaci\u00f3n del perfil o sus permisos no existe en el backend. Revisa la clave for\u00e1nea indicada en los registros.', 'FOREIGN_KEY_VIOLATION', 500)
  if (stage === 'auth' && /password/i.test(raw))
    return new CreationFailure('Auth rechaz\u00f3 la contrase\u00f1a. Revisa las reglas de seguridad del proyecto.', 'AUTH_PASSWORD')
  if (/fetch|network|connection|abort/i.test(raw))
    return new CreationFailure('Fall\u00f3 la conexi\u00f3n con Supabase. Comprueba el estado de la creaci\u00f3n antes de reintentar.', 'CONNECTION_FAILED', 503, stage === 'auth')
  const messages: Record<string, string> = {
    sesion: 'No se pudo validar tu sesi\u00f3n. Inicia sesi\u00f3n de nuevo.',
    autorizacion: 'No se pudo comprobar el perfil del administrador. Revisa el backend.',
    auth: 'Auth no pudo crear el usuario. Revisa sus registros y la configuraci\u00f3n del proyecto.',
    perfil: 'No se pudo guardar el perfil del vendedor. Revisa las tablas, relaciones y triggers del backend.',
    permisos: 'No se pudieron asignar los permisos del vendedor. Revisa el backend.',
  }
  const codes: Record<string, string> = { sesion: 'SESSION_CHECK_FAILED', autorizacion: 'ADMIN_PROFILE_CHECK_FAILED', auth: 'AUTH_CREATE_FAILED', perfil: 'PROFILE_INSERT_FAILED', permisos: 'ROLE_ASSIGN_FAILED' }
  return new CreationFailure(messages[stage] || 'No se pudo completar la creaci\u00f3n del vendedor.', codes[stage] || 'BACKEND_FAILED', 500)
}

// Uses the existing Auth -> perfiles -> perfil_permisos flow, with checked
// compensation. No SQL migration, new RPC or browser-side Auth signup.
export function createEmployeeHandler({
  createClient, env, logger = console, fetchImpl = fetch,
  stageTimeoutMs = 10000, totalTimeoutMs = 25000, cleanupTimeoutMs = 5000,
}: {
  createClient: (...args: any[]) => any
  env: (key: string) => string | undefined
  logger?: Pick<Console, 'error'>
  fetchImpl?: typeof fetch
  stageTimeoutMs?: number
  totalTimeoutMs?: number
  cleanupTimeoutMs?: number
}) {
  return async (req: Request) => {
    const requestId = crypto.randomUUID()
    const reply = (body: Record<string, unknown>, status = 200) => json({ ...body, requestId }, status)
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
    if (req.method !== 'POST') return reply({ error: 'M\u00e9todo no permitido', code: 'METHOD', stage: 'entrada' }, 405)
    let stage = 'configuracion', id: string | undefined
    const controller = new AbortController()
    const started = Date.now()
    const bounded = async <T>(action: () => PromiseLike<T> | T, ms: number) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        return await Promise.race([
          Promise.resolve().then(action),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              reject(new CreationFailure('Supabase tard\u00f3 demasiado. Comprueba el estado del usuario antes de reintentar.', 'TIMEOUT', 504, true))
              controller.abort()
            }, Math.max(1, ms))
          }),
        ])
      } finally { clearTimeout(timer) }
    }
    const run = async (nextStage: string, action: () => any) => {
      stage = nextStage
      const result = await bounded<any>(action, Math.min(stageTimeoutMs, totalTimeoutMs - (Date.now() - started)))
      if (result?.error) throw result.error
      return result?.data
    }
    const clientOptions = (signal: AbortSignal) => ({
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (url: any, init?: RequestInit) => fetchImpl(url, {
        ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal,
      }) },
    })
    let admin: any, url: string | undefined, service: string | undefined
    try {
      url = env('SUPABASE_URL')
      const anon = env('SUPABASE_ANON_KEY')
      service = env('SUPABASE_SERVICE_ROLE_KEY')
      const missingSecrets = Object.entries({ SUPABASE_URL: url, SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_ROLE_KEY: service }).filter(([, value]) => !value).map(([name]) => name)
      if (missingSecrets.length) {
        const failure = new CreationFailure('Faltan variables de servidor para crear empleados: ' + missingSecrets.join(', ') + '.', 'MISSING_SECRET', 500)
        failure.missingSecrets = missingSecrets
        throw failure
      }
      stage = 'entrada'
      let body
      try { body = normalizeEmployeeInput(await bounded(() => req.json(), stageTimeoutMs)) }
      catch (error) {
        if (error instanceof CreationFailure) throw error
        throw new CreationFailure(error instanceof SyntaxError ? 'El formulario no contiene JSON v\u00e1lido.' : (error as Error).message, 'VALIDATION')
      }
      const options = clientOptions(controller.signal)
      const caller = createClient(url, anon, {
        ...options, global: { ...options.global, headers: { Authorization: req.headers.get('Authorization') ?? '' } },
      })
      const auth = await run('sesion', () => caller.auth.getUser())
      if (!auth?.user) throw new CreationFailure('Inicia sesi\u00f3n como administrador para crear vendedores.', 'UNAUTHENTICATED', 401)
      admin = createClient(url, service, options)
      const callerProfile = await run('autorizacion', () => admin.from('perfiles').select('rol, activo').eq('id', auth.user.id).single())
      if (callerProfile?.rol !== 'admin' || !callerProfile.activo)
        throw new CreationFailure('Solo un administrador activo puede crear empleados.', 'FORBIDDEN', 403)
      const created = await run('auth', () => admin.auth.admin.createUser({
        email: body.correo, password: body.password, email_confirm: true,
      }))
      if (typeof created?.user?.id !== 'string' || !created.user.id) throw new CreationFailure('Auth no confirm\u00f3 el nuevo usuario. Revisa sus registros antes de reintentar.', 'AUTH_INVALID_RESPONSE', 502, true)
      id = created.user.id
      const { password: _password, permisos, ...profile } = body
      await run('perfil', () => admin.from('perfiles').insert({ ...profile, id, creado_por: auth.user.id }))
      if (body.rol === 'vendedor') {
        // Replace trigger defaults even when the requested permission set is empty.
        await run('permisos', () => admin.from('perfil_permisos').delete().eq('perfil_id', id))
        if (permisos.length) await run('permisos', () => admin.from('perfil_permisos').insert(permisos.map((permiso: string) => ({ perfil_id: id, permiso }))))
      }
      return reply({ id, correo: body.correo })
    } catch (error) {
      const failure = failureFor(error, stage)
      // Only safe diagnostics. No raw error (may contain emails/SQL), credentials or form.
      const backendCode = /^[a-zA-Z0-9_]{1,48}$/.test(String((error as any)?.code || '')) ? (error as any).code : undefined
      logger.error('[crear-empleado]', { requestId, functionVersion: EMPLOYEE_FUNCTION_VERSION, stage, code: failure.code, backendCode, missingSecrets: failure.missingSecrets, status: failure.status, uncertain: failure.uncertain })
      let rolledBack = false
      if (id && url && service) {
        const cleanupController = new AbortController()
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          const cleanupClient = createClient(url, service, clientOptions(cleanupController.signal))
          const cleanup = await Promise.race([
            cleanupClient.auth.admin.deleteUser(id),
            new Promise<never>((_, reject) => { timer = setTimeout(() => { reject(new Error('Cleanup timeout')); cleanupController.abort() }, cleanupTimeoutMs) }),
          ])
          if (cleanup.error) throw cleanup.error
          // Schema: Auth deletion cascades perfiles and perfil_permisos.
          rolledBack = true
        } catch {
          logger.error('[crear-empleado]', { requestId, stage: 'rollback', code: 'ROLLBACK_FAILED', createdId: id })
          return reply({
            error: 'La creaci\u00f3n qued\u00f3 incompleta y no pudo limpiarse autom\u00e1ticamente. Un administrador debe revisar Auth, perfil y permisos antes de reintentar.',
            code: 'ROLLBACK_FAILED', stage, uncertain: true,
          }, 500)
        } finally { clearTimeout(timer) }
      }
      return reply({
        error: failure.message, code: failure.code, stage, missingSecrets: failure.missingSecrets,
        uncertain: rolledBack ? false : failure.uncertain,
        rolledBack,
      }, failure.status)
    } finally { controller.abort() }
  }
}
