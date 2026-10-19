import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { mensajeError } from '../lib/format'
import { toast } from '../lib/toast'
import { Brand } from '../components/TechVisuals'

// Llega aquí desde el enlace del correo «Recuperar acceso».
export default function Restablecer() {
  const navigate = useNavigate()
  const [listo, setListo] = useState(null)
  const [clave, setClave] = useState(''), [repetir, setRepetir] = useState('')
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => {
    let vivo = true
    // Supabase devuelve el error en la dirección cuando el enlace venció o ya se usó
    const h = new URLSearchParams(window.location.hash.slice(1) || window.location.search.slice(1))
    if (h.get('error') || h.get('error_code')) { setListo(false); return () => {} }
    const { data: sub } = supabase.auth.onAuthStateChange((evento, sesion) => { if (vivo && sesion && (evento === 'PASSWORD_RECOVERY' || evento === 'SIGNED_IN')) setListo(true) })
    supabase.auth.getSession().then(({ data }) => { if (vivo && data.session) setListo(true) })
    const t = setTimeout(() => { if (vivo) setListo(v => v ?? false) }, 4000)
    return () => { vivo = false; clearTimeout(t); sub.subscription.unsubscribe() }
  }, [])
  async function guardar(e) {
    e.preventDefault(); setError('')
    if (clave.length < 8) return setError('La contraseña debe tener al menos 8 caracteres.')
    if (clave !== repetir) return setError('Las contraseñas no coinciden.')
    setBusy(true)
    const { error: err } = await supabase.auth.updateUser({ password: clave })
    setBusy(false)
    if (err) return setError(mensajeError(err))
    await supabase.auth.signOut({ scope: 'others' }).catch(() => {})
    toast('Contraseña actualizada'); navigate('/', { replace: true })
  }
  return <main className="min-h-screen grid place-items-center p-6">
    <div className="card max-w-sm w-full">
      <Brand compact />
      <h2 className="text-lg font-bold">Crea tu nueva contraseña</h2>
      {listo === null ? <p className="text-sm text-muted">Verificando el enlace…</p>
        : listo === false ? <><p className="text-sm">El enlace no es válido o ya venció. Pide uno nuevo desde «¿Olvidaste tu contraseña?».</p><button className="btn full" onClick={() => navigate('/login', { replace: true })}>Ir a iniciar sesión</button></>
        : <form onSubmit={guardar} className="grid gap-3">
          {error && <div role="alert" className="bg-badbg text-bad rounded-xl p-3 text-sm">{error}</div>}
          <input className="inp" type="password" autoComplete="new-password" placeholder="Nueva contraseña (mínimo 8)" value={clave} onChange={e => setClave(e.target.value)} required />
          <input className="inp" type="password" autoComplete="new-password" placeholder="Repite la contraseña" value={repetir} onChange={e => setRepetir(e.target.value)} required />
          <button className="btn full" disabled={busy}>{busy ? 'Guardando…' : 'Guardar contraseña'}</button>
        </form>}
    </div>
  </main>
}
