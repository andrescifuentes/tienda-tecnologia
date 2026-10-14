import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useState } from 'react'
import { Loader, PageSkeleton } from './ui'
import { supabase, isDemoMode } from '../lib/supabase'
import { mensajeError } from '../lib/format'

// Cuenta de administrador recién creada (o confirmada por correo) que aún no tiene perfil
function CompletarRegistro({ salir, recargarPerfil, session }) {
  const [nombre, setNombre] = useState(session?.user?.user_metadata?.nombre || ''), [codigo, setCodigo] = useState('')
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  async function enviar(e) {
    e.preventDefault(); setErr('')
    if (!nombre.trim() || !codigo.trim()) return setErr('Escribe tu nombre y el código de registro.')
    setBusy(true)
    const { error } = await supabase.rpc('registrar_administrador', { p_nombre: nombre.trim(), p_codigo: codigo })
    setBusy(false)
    if (error) return setErr(error.code === 'PGRST202' ? 'Falta activar el registro: ejecuta el script 09 en Supabase.' : mensajeError(error))
    await recargarPerfil()
  }
  return <form onSubmit={enviar} className="grid gap-3 text-left">
    <p className="text-muted text-sm m-0">Si eres administrador, termina tu registro con el código de la tienda. Si eres vendedor, pídele al administrador que cree tu cuenta.</p>
    {err && <div role="alert" className="bg-badbg text-bad rounded-xl p-3 text-sm">{err}</div>}
    <input className="inp" placeholder="Tu nombre completo" value={nombre} onChange={e => setNombre(e.target.value)} />
    <input className="inp" placeholder="Código de registro" autoComplete="off" value={codigo} onChange={e => setCodigo(e.target.value)} />
    <button className="btn full" disabled={busy}>{busy ? 'Guardando…' : 'Terminar registro'}</button>
    <button type="button" className="btn sec full" onClick={salir}>Cerrar sesión</button>
  </form>
}

export default function ProtectedRoute({ children, soloAdmin = false, permiso }) {
  const { session, loading, perfil, sinPerfil, activo, esAdmin, can, salir, authError, reintentarSesion, recargarPerfil } = useAuth()
  if (loading) return <PageSkeleton />
  if (authError) return <main className="min-h-screen grid place-items-center p-6"><div className="card max-w-sm"><h2>Conexión de sesión</h2><p role="alert">{authError}</p><button type="button" className="btn full" onClick={reintentarSesion}>Reintentar conexión</button><button type="button" className="btn sec full mt-2" onClick={salir}>Cerrar sesión</button></div></main>
  if (!session) return <Navigate to="/login" replace />
  if (sinPerfil || (perfil && !activo)) {
    return (
      <main className="min-h-screen grid place-items-center p-6">
        <div className="card max-w-sm text-center">
          <h2 className="text-lg font-bold mt-0">{sinPerfil && !isDemoMode ? 'Termina tu registro' : 'Acceso no disponible'}</h2>
          {sinPerfil && !isDemoMode ? <CompletarRegistro salir={salir} recargarPerfil={recargarPerfil} session={session} /> : <>
            <p className="text-muted text-sm">{sinPerfil ? 'Tu usuario no tiene un perfil en la tienda.' : 'Tu usuario está desactivado.'} Habla con el administrador.</p>
            <button className="btn sec" onClick={salir}>Cerrar sesión</button>
          </>}
        </div>
      </main>
    )
  }
  if (!perfil) return <PageSkeleton />
  if (soloAdmin && !esAdmin) return <Navigate to="/" replace />
  if (permiso && !can(permiso)) return <Navigate to="/" replace />
  return children
}
