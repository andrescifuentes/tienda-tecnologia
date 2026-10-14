import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { createAuthSession, emptyAuthState } from '../lib/authSession'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [state, setState] = useState(emptyAuthState)
  const service = useRef(null)
  useEffect(() => {
    const manager = createAuthSession(supabase, setState)
    service.current = manager
    void manager.start()
    return () => { manager.stop(); if (service.current === manager) service.current = null }
  }, [])
  const value = useMemo(() => ({
    ...state,
    esAdmin: state.perfil?.rol === 'admin',
    activo: !!state.perfil?.activo,
    can: permission => !!state.perfil?.activo && (state.perfil.rol === 'admin' || (permission !== 'ver_costos' && state.permisos.includes(permission))),
    reintentarSesion: () => service.current?.retry(),
    recargarPerfil: () => service.current?.refresh(),
    entrar: (correo, clave) => service.current.signIn(correo, clave),
    salir: () => service.current?.signOut(),
  }), [state])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
export const useAuth = () => useContext(AuthContext)
