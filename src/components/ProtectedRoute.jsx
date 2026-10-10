import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Loader, PageSkeleton } from './ui'

export default function ProtectedRoute({ children, soloAdmin = false, permiso }) {
  const { session, loading, perfil, sinPerfil, activo, esAdmin, can, salir } = useAuth()
  if (loading) return <PageSkeleton />
  if (!session) return <Navigate to="/login" replace />
  if (sinPerfil || (perfil && !activo)) {
    return (
      <main className="min-h-screen grid place-items-center p-6">
        <div className="card max-w-sm text-center">
          <h2 className="text-lg font-bold mt-0">Acceso no disponible</h2>
          <p className="text-muted text-sm">{sinPerfil ? 'Tu usuario no tiene un perfil en la tienda.' : 'Tu usuario está desactivado.'} Habla con el administrador.</p>
          <button className="btn sec" onClick={salir}>Cerrar sesión</button>
        </div>
      </main>
    )
  }
  if (!perfil) return <PageSkeleton />
  if (soloAdmin && !esAdmin) return <Navigate to="/" replace />
  if (permiso && !can(permiso)) return <Navigate to="/" replace />
  return children
}
