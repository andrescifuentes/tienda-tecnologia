import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from './Modal'
import { Icon } from './Icons'
import { Badge, Empty, ErrorBox } from './ui'
import { supabase, isDemoMode } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { localNotifications } from '../lib/demo/notifications'
import { subscribeDemoChanges } from '../lib/demo/useDemoRevision'
import { hoyBogota, mensajeError } from '../lib/format'

export function useNotifications() {
  const { perfil, esAdmin } = useAuth()
  const [items, setItems] = useState([])
  useEffect(() => {
    if (!isDemoMode) return
    let live = true
    const load = async () => {
      const [p,g,a,r] = await Promise.all([supabase.from('productos_venta').select('*'), esAdmin ? supabase.from('garantias').select('*') : Promise.resolve({data:[]}), supabase.from('actividad').select('*').order('fecha',{ascending:false}).limit(20), supabase.from('notificaciones_leidas').select('*').eq('perfil_id',perfil.id)])
      const read = new Set((r.data || []).map(row => row.notificacion_id))
      if (live) setItems(localNotifications({productos:p.data||[],garantias:g.data||[],actividad:a.data||[]},hoyBogota()).map(n=>({...n,read:read.has(n.id)})))
    }
    load(); const unsubscribe = subscribeDemoChanges(load)
    return () => { live=false; unsubscribe() }
  }, [perfil.id, esAdmin])
  return items
}
export default function Notifications({ items, onClose }) {
  const navigate = useNavigate(), { perfil } = useAuth(), [error,setError] = useState('')
  async function open(item) {
    if (!item.read) {
      const result = await supabase.rpc('leer_notificacion_demo',{id:item.id})
      if (result.error) return setError(mensajeError(result.error))
    }
    onClose(); navigate(item.to)
  }
  return <Modal title="Tu actividad" subtitle="Notificaciones locales" className="experience-sheet notifications-sheet" keyboardAware onClose={onClose}><ErrorBox text={error}/><div className="notice-summary"><span className="premium-eyebrow">CENTRO DE NOTIFICACIONES</span><b>{items.filter(item=>!item.read).length} nuevas</b><p>Inventario, ventas y garantías de tu negocio.</p></div><div className="notice-list">{items.length ? items.map(item=><button className={'row menu-row notification-row '+(item.read?'is-read':'is-new')} key={item.id} onClick={()=>open(item)}><span className={'notice-icon '+item.tone}><Icon name={item.id.startsWith('stock:')?'box':item.id.startsWith('warranty:')?'shield':/venta|factura/i.test(item.title)?'doc':/mercanc/i.test(item.title)?'truck':'chart'}/></span><span className="notice-copy"><b>{item.title}</b><span>{item.text}</span></span><span className="notice-state"><Badge tone={item.read?'':item.tone}>{item.read?'Leída':'Nueva'}</Badge><span aria-hidden="true">›</span></span></button>) : <Empty text="Todo al día" description="Sin alertas de stock, garantías ni actividad importante." />}</div></Modal>
}
