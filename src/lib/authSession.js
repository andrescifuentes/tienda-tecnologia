import { withDeadline, requireData, cancellableQuery } from './asyncResult.js'

export const AUTH_TIMEOUT = 10000
export const emptyAuthState = () => ({ session: null, perfil: null, permisos: [], tienda: null, loading: true, sinPerfil: false, authError: '' })
const recoveryMessage = error => error?.code === 'TIMEOUT' ? 'La sesión tardó demasiado en responder. Comprueba la conexión y reintenta.' : 'No se pudo comprobar tu sesión. Comprueba la conexión y reintenta.'

export function createAuthSession(client, onState, { timeoutMs = AUTH_TIMEOUT } = {}) {
  let state = emptyAuthState(), alive = true, generation = 0, controller, subscription
  const publish = next => { if (alive) { state = { ...state, ...next }; onState(state) } }
  const begin = session => {
    generation++; controller?.abort(); controller = new AbortController()
    publish({ ...emptyAuthState(), session, loading: true })
    return { token: generation, signal: controller.signal }
  }
  const current = token => alive && token === generation
  async function profile(session, op) {
    if (!current(op.token)) return
    if (!session) { publish({ ...emptyAuthState(), loading: false }); return }
    publish({ session, loading: true })
    try {
      if (!session.user?.id) throw new Error('Invalid session')
      const [p, permissions, store] = await withDeadline(async signal => {
        const responses = await Promise.all([
          cancellableQuery(client.from('perfiles').select('*').eq('id', session.user.id).maybeSingle(), signal),
          cancellableQuery(client.from('perfil_permisos').select('permiso').eq('perfil_id', session.user.id), signal),
          cancellableQuery(client.from('tienda').select('*').eq('id', 1).maybeSingle(), signal),
        ])
        return responses.map(requireData)
      }, { timeoutMs, signal: op.signal })
      if (current(op.token)) publish({ session, perfil: p, permisos: (permissions || []).map(r => r.permiso), tienda: store, sinPerfil: !p, loading: false, authError: '' })
    } catch (error) {
      if (current(op.token)) publish({ ...emptyAuthState(), session, loading: false, authError: recoveryMessage(error) })
    }
  }
  async function initialize() {
    const op = begin(null)
    try {
      const result = await withDeadline(() => client.auth.getSession(), { timeoutMs, signal: op.signal })
      if (result?.error) throw result.error
      if (!result?.data) throw new Error('Invalid session response')
      if (current(op.token)) await profile(result.data.session, op)
    } catch (error) {
      if (current(op.token)) publish({ ...emptyAuthState(), loading: false, authError: recoveryMessage(error) })
    }
  }
  function changed(event, session) {
    if (!alive) return
    if (event === 'SESSION_ERROR') { void initialize(); return }
    if (!session) {
      generation++; controller?.abort()
      publish({ ...emptyAuthState(), loading: false })
      return
    }
    if (state.loading && !state.authError && state.session?.user?.id === session.user.id && state.session?.access_token === session.access_token && event !== 'USER_UPDATED') return
    if (state.perfil && !state.authError && state.session?.user.id === session.user.id && event !== 'USER_UPDATED') {
      publish({ session }); return
    }
    const op = begin(session)
    // Supabase's auth callback must return before issuing profile queries.
    setTimeout(() => { if (current(op.token)) void profile(session, op) }, 0)
  }
  return {
    start() { subscription = client.auth.onAuthStateChange(changed).data.subscription; return initialize() },
    retry: initialize,
    refresh() { if (!state.session) return initialize(); return profile(state.session, begin(state.session)) },
    async signIn(email, password) {
      try { return await withDeadline(() => client.auth.signInWithPassword({ email: email.trim().toLowerCase(), password }), { timeoutMs }) }
      catch (error) { return { data: null, error: { message: recoveryMessage(error), code: error?.code } } }
    },
    async signOut() {
      try {
        const result = await withDeadline(() => client.auth.signOut(), { timeoutMs })
        if (result?.error) throw result.error
        changed('SIGNED_OUT', null)
        return result
      } catch (error) {
        generation++; controller?.abort()
        publish({ ...emptyAuthState(), loading: false, authError: 'No se pudo cerrar la sesión. Comprueba la conexión y reintenta.' })
        return { error }
      }
    },
    stop() { alive = false; generation++; controller?.abort(); subscription?.unsubscribe() },
  }
}
