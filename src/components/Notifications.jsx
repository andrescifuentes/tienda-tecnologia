import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from './Modal'
import { Badge, Empty, ErrorBox } from './ui'
import { supabase, isDemoMode } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { localNotifications } from '../lib/demo/notifications'
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
    load(); window.addEventListener('demo-data-change',load)
    return () => { live=false; window.removeEventListener('demo-data-change',load) }
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
  return <Modal title="Notificaciones locales" onClose={onClose}><ErrorBox text={error} />{items.length ? items.map(item=><button className="row menu-row notification-row" key={item.id} onClick={()=>open(item)}><span className="flex-1"><b className="text-sm">{item.title}</b><span className="block text-xs text-muted">{item.text}</span></span><Badge tone={item.tone}>{item.read?'Leída':'Nueva'}</Badge></button>) : <Empty text="Todo al día" description="Sin alertas de stock, garantías ni actividad importante." />}</Modal>
}
