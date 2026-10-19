import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useState } from 'react'
import { Loader, PageSkeleton } from './ui'
import { isDemoMode } from '../lib/supabase'
import { completarRegistro } from '../lib/registro'
import { mensajeError } from '../lib/format'

// Cuenta de administrador recién creada (o confirmada por correo) que aún no tiene perfil
function CompletarRegistro({ salir, recargarPerfil, session }) {
  const meta = session?.user?.user_metadata || {}
  const [modo, setModo] = useState(meta.modo === 'nuevo' || (!meta.modo && meta.negocio) ? 'nuevo' : 'unirme')
  const [nombre, setNombre] = useState(meta.nombre || ''), [negocio, setNegocio] = useState(meta.negocio || ''), [codigo, setCodigo] = useState('')
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const nuevo = modo === 'nuevo'
  async function enviar(e) {
    e.preventDefault(); setErr('')
    if (!nombre.trim() || !codigo.trim() || (nuevo && negocio.trim().length < 2)) return setErr(nuevo ? 'Escribe tu nombre, el nombre del negocio y el código de alta.' : 'Escribe tu nombre y el código de registro.')
    setBusy(true)
    try { await completarRegistro({ modo, nombre, negocio, codigo, telefono: meta.telefono }) }
    catch (e2) { setBusy(false); return setErr(e2?.message && !e2.code ? e2.message : mensajeError(e2)) }
    setBusy(false)
    await recargarPerfil()
  }
  return <form onSubmit={enviar} className="grid gap-3 text-left">
    <p className="text-muted text-sm m-0">Si eres administrador, termina tu registro. Si eres vendedor, pídele al administrador que cree tu cuenta.</p>
    <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Tipo de registro">
      <button type="button" role="tab" aria-selected={nuevo} className={'btn' + (nuevo ? '' : ' sec')} onClick={() => { setModo('nuevo'); setErr('') }}>Negocio nuevo</button>
      <button type="button" role="tab" aria-selected={!nuevo} className={'btn' + (!nuevo ? '' : ' sec')} onClick={() => { setModo('unirme'); setErr('') }}>Unirme a uno</button>
    </div>
    {err && <div role="alert" className="bg-badbg text-bad rounded-xl p-3 text-sm">{err}</div>}
    {nuevo && <input className="inp" placeholder="Nombre del negocio" autoComplete="organization" value={negocio} onChange={e => setNegocio(e.target.value)} />}
    <input className="inp" placeholder="Tu nombre completo" value={nombre} onChange={e => setNombre(e.target.value)} />
    <input className="inp" placeholder={nuevo ? 'Código de alta' : 'Código de registro del negocio'} autoComplete="off" value={codigo} onChange={e => setCodigo(e.target.value)} />
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
            <p className="text-muted text-sm">{sinPerfil ? 'Tu usuario no tiene un perfil en el negocio.' : 'Tu usuario está desactivado.'} Habla con el administrador.</p>
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
