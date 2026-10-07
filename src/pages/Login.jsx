import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { mensajeError } from '../lib/format'

export default function Login() {
  const { session, entrar, loading } = useAuth()
  const [correo, setCorreo] = useState('')
  const [clave, setClave] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  if (!loading && session) return <Navigate to="/" replace />

  async function enviar(e) {
    e.preventDefault()
    setErr(''); setBusy(true)
    const { error } = await entrar(correo, clave)
    setBusy(false)
    if (error) setErr(mensajeError(error))
  }

  return (
    <main className="min-h-screen grid place-items-center p-5">
      <form onSubmit={enviar} className="card w-full max-w-sm">
        <div className="w-14 h-14 rounded-2xl bg-brand grid place-items-center text-white text-2xl mb-3">▯</div>
        <h1 className="text-2xl font-bold m-0">TechStore</h1>
        <p className="text-muted text-sm mt-1 mb-5">Ingresa con tu correo y contraseña.</p>
        {err && <div className="bg-badbg text-bad rounded-xl p-3 text-sm mb-3">{err}</div>}
        <label className="lbl">Correo</label>
        <input className="inp mb-3" type="email" autoComplete="username" value={correo} onChange={(e) => setCorreo(e.target.value)} required />
        <label className="lbl">Contraseña</label>
        <input className="inp mb-4" type="password" autoComplete="current-password" value={clave} onChange={(e) => setClave(e.target.value)} required />
        <button className="btn full" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
        <p className="text-muted text-xs mt-4 mb-0 text-center">Si no tienes usuario, pídeselo al administrador.</p>
      </form>
    </main>
  )
}
