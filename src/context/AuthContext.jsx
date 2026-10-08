import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [perfil, setPerfil] = useState(null)
  const [permisos, setPermisos] = useState([])
  const [tienda, setTienda] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sinPerfil, setSinPerfil] = useState(false)

  const cargarPerfil = useCallback(async (uid) => {
    const [p, pp, t] = await Promise.all([
      supabase.from('perfiles').select('*').eq('id', uid).maybeSingle(),
      supabase.from('perfil_permisos').select('permiso').eq('perfil_id', uid),
      supabase.from('tienda').select('*').eq('id', 1).maybeSingle(),
    ])
    if (p.error || !p.data) { setPerfil(null); setPermisos([]); setSinPerfil(true) }
    else {
      setPerfil(p.data); setPermisos((pp.data || []).map((r) => r.permiso)); setSinPerfil(false)
    }
    setTienda(t.data || null)
  }, [])

  useEffect(() => {
    let vivo = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!vivo) return
      setSession(data.session)
      if (data.session) await cargarPerfil(data.session.user.id)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      if (!s) { setPerfil(null); setPermisos([]); setSinPerfil(false) }
      else setTimeout(() => cargarPerfil(s.user.id), 0)
    })
    return () => { vivo = false; sub.subscription.unsubscribe() }
  }, [cargarPerfil])

  const value = useMemo(() => ({
    session, perfil, permisos, tienda, loading, sinPerfil,
    esAdmin: perfil?.rol === 'admin',
    activo: !!perfil?.activo,
    can: (p) => perfil?.rol === 'admin' || permisos.includes(p),
    recargarPerfil: () => session && cargarPerfil(session.user.id),
    entrar: (correo, clave) => supabase.auth.signInWithPassword({ email: correo.trim().toLowerCase(), password: clave }),
    salir: () => supabase.auth.signOut(),
  }), [session, perfil, permisos, tienda, loading, sinPerfil, cargarPerfil])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
