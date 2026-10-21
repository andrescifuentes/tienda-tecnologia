import { useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { toast } from '../lib/toast'
import { abrirCajaDelDia } from '../lib/cajaAutomatica'
import { useLocales } from '../lib/locales'
import { cashInteger } from '../lib/cashRegister'

const cop = cents => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(cashInteger(cents) / 100)

// Al entrar el primer día laboral: abre la caja de quien vende si la de ayer quedó cerrada.
export default function CajaAutomatica() {
  const { perfil, can } = useAuth()
  const loc = useLocales(perfil)
  // La caja que se abre sola es la del local donde trabaja la persona.
  // Un administrador sin local (con varios locales) la abre a mano en Caja.
  const local = loc.habilitado ? (loc.miLocal ?? (loc.locales.length === 1 ? loc.locales[0].id : undefined)) : null
  const puede = !!perfil?.activo && can('vender') && local !== undefined
  useEffect(() => {
    if (!puede) return
    let vivo = true
    abrirCajaDelDia(supabase, perfil, { local }).then(r => {
      if (!vivo) return
      if (r.accion === 'abrir' && r.id) toast(`Caja del día abierta${local != null && loc.multi ? ' en ' + loc.nombre(local) : ''} · base ${cop(r.inicial)}`)
      if (r.accion === 'cerrar_pendiente') toast('La caja de un día anterior sigue abierta. Ciérrala en Más › Caja para abrir la de hoy.')
    })
    return () => { vivo = false }
  }, [puede, perfil?.id, local]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}
