import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from './Modal'
import { Icon } from './Icons'
import { Badge, Empty, ErrorBox } from './ui'
import { supabase, isDemoMode } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { localNotifications } from '../lib/demo/notifications'
import { subscribeDemoChanges } from '../lib/demo/useDemoRevision'
import { hoyBogota, mensajeError } from '../lib/format'
import { cargarNotificaciones, leidasDe, marcarLeidas, EVENTO_LEIDAS } from '../lib/notificaciones'

// Avisos de la campana. Demo: datos locales. Real: stock bajo, ventas y compras recientes de tu negocio.
export function useNotifications(enabled = true) {
  const { perfil, esAdmin, can } = useAuth()
  const [items, setItems] = useState([])
  const [leidas, setLeidas] = useState(() => leidasDe(perfil?.id))
  useEffect(() => {
    if (!enabled || !perfil?.id) return
    let live = true
    if (isDemoMode) {
      const load = async () => {
        const [p,g,a,r] = await Promise.all([supabase.from('productos_venta').select('*'), esAdmin ? supabase.from('garantias').select('*') : Promise.resolve({data:[]}), supabase.from('actividad').select('*').order('fecha',{ascending:false}).limit(20), supabase.from('notificaciones_leidas').select('*').eq('perfil_id',perfil.id)])
        const read = new Set((r.data || []).map(row => row.notificacion_id))
        if (live) setItems(localNotifications({productos:p.data||[],garantias:g.data||[],actividad:a.data||[]},hoyBogota()).map(n=>({...n,read:read.has(n.id)})))
      }
      load(); const unsubscribe = subscribeDemoChanges(load)
      return () => { live=false; unsubscribe() }
    }
    const load = () => cargarNotificaciones(supabase, { esAdmin, puedeCompras: can('registrar_compras') }).then(list => { if (live) setItems(list) }).catch(() => {})
    const sync = () => setLeidas(leidasDe(perfil.id))
    const onFocus = () => { if (document.visibilityState !== 'hidden') load() }
    load()
    window.addEventListener(EVENTO_LEIDAS, sync); document.addEventListener('visibilitychange', onFocus)
    return () => { live = false; window.removeEventListener(EVENTO_LEIDAS, sync); document.removeEventListener('visibilitychange', onFocus) }
  }, [enabled, perfil?.id, esAdmin])  // eslint-disable-line react-hooks/exhaustive-deps
  return isDemoMode ? items : items.map(n => ({ ...n, read: leidas.has(n.id) }))
}

export default function Notifications({ items, onClose }) {
  const navigate = useNavigate(), { perfil } = useAuth(), [error,setError] = useState('')
  const nuevas = items.filter(item => !item.read)
  const open = useCallback(async item => {
    if (!item.read) {
      if (isDemoMode) {
        const result = await supabase.rpc('leer_notificacion_demo',{id:item.id})
        if (result.error) return setError(mensajeError(result.error))
      } else marcarLeidas(perfil?.id, [item.id])
    }
    onClose(); navigate(item.to)
  }, [perfil?.id, onClose, navigate])
  return <Modal title="Notificaciones" subtitle={isDemoMode ? 'Notificaciones locales' : 'Tu negocio · últimos 7 días'} className="experience-sheet notifications-sheet" keyboardAware onClose={onClose}>
    <ErrorBox text={error}/>
    <div className="notice-summary">
      <span className="premium-eyebrow">CENTRO DE NOTIFICACIONES</span>
      <b>{nuevas.length} {nuevas.length === 1 ? 'nueva' : 'nuevas'}</b>
      <p>Inventario, ventas y compras de tu negocio.</p>
      {!isDemoMode && nuevas.length > 0 && <button type="button" className="notice-read-all" onClick={() => marcarLeidas(perfil?.id, nuevas.map(n => n.id))}>Marcar todas como leídas</button>}
    </div>
    <div className="notice-list">{items.length ? items.map(item=><button className={'row menu-row notification-row '+(item.read?'is-read':'is-new')} key={item.id} onClick={()=>open(item)}><span className={'notice-icon '+item.tone}><Icon name={item.id.startsWith('stock:')?'box':item.id.startsWith('warranty:')?'shield':/venta|factura/i.test(item.title)?'doc':/mercanc/i.test(item.title)?'truck':'chart'}/></span><span className="notice-copy"><b>{item.title}</b><span>{item.text}</span></span><span className="notice-state"><Badge tone={item.read?'':item.tone}>{item.read?'Leída':'Nueva'}</Badge><span aria-hidden="true">›</span></span></button>) : <Empty text="Todo al día" description="Sin alertas de stock ni movimientos recientes." />}</div>
  </Modal>
}
