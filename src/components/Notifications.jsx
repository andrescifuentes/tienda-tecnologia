import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from './Modal'
import { Icon } from './Icons'
import { Badge, Empty, ErrorBox, Loader } from './ui'
import { supabase, isDemoMode } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { localNotifications } from '../lib/demo/notifications'
import { subscribeDemoChanges } from '../lib/demo/useDemoRevision'
import { hoyBogota, mensajeError } from '../lib/format'
import { cargarNotificaciones, leidasDe, marcarLeidas, EVENTO_LEIDAS } from '../lib/notificaciones'
import { withDeadline, requireData, cancellableQuery } from '../lib/asyncResult'

// Incoming stock/sales/purchase notifications, with explicit loading/error/retry.
export function useNotifications(enabled=true){
 const {perfil,esAdmin,can,tienda}=useAuth(),[state,setState]=useState({owner:null,items:[],loading:false,error:''}),[tick,setTick]=useState(0)
 const owner=perfil?.id+':'+(tienda?.id??perfil?.negocio_id??'current'),inventory=can('ver_inventario'),purchases=can('registrar_compras')
 useEffect(()=>{
  if(!enabled||!perfil?.id)return
  let live=true,generation=0;const controller=new AbortController();setState({owner,items:[],loading:true,error:''})
  const load=async()=>{const token=++generation
   try{const data=await withDeadline(async signal=>{
    if(!isDemoMode){const list=await cargarNotificaciones(supabase,{esAdmin,puedeCompras:purchases,signal}),read=leidasDe(owner);return list.map(n=>({...n,read:read.has(n.id)}))}
    const query=q=>cancellableQuery(q,signal),[products,warranties,activity,reads]=await Promise.all([inventory?query(supabase.from('productos_venta').select('*')):{data:[]},esAdmin?query(supabase.from('garantias').select('*')):{data:[]},query(supabase.from('actividad').select('*').order('fecha',{ascending:false}).limit(20)),query(supabase.from('notificaciones_leidas').select('*').eq('perfil_id',perfil.id))]);const read=new Set((requireData(reads)||[]).map(r=>r.notificacion_id));return localNotifications({productos:requireData(products)||[],garantias:requireData(warranties)||[],actividad:requireData(activity)||[]},hoyBogota()).map(n=>({...n,read:read.has(n.id)}))
   },{signal:controller.signal});if(live&&token===generation)setState({owner,items:data,loading:false,error:''})}
   catch(error){if(live&&token===generation)setState({owner,items:[],loading:false,error:mensajeError(error)})}
  }
  load();const unsubscribe=isDemoMode?subscribeDemoChanges(load):()=>{},sync=()=>{if(document.visibilityState!=='hidden')void load()};window.addEventListener(EVENTO_LEIDAS,sync);window.addEventListener('storage',sync);document.addEventListener('visibilitychange',sync)
  return()=>{live=false;controller.abort();unsubscribe();window.removeEventListener(EVENTO_LEIDAS,sync);window.removeEventListener('storage',sync);document.removeEventListener('visibilitychange',sync)}
 },[enabled,perfil?.id,owner,esAdmin,inventory,purchases,tick])
 const items=state.owner===owner?state.items:[]
 async function markRead(item){if(!items.some(n=>n.id===item.id))return;if(isDemoMode){requireData(await supabase.rpc('leer_notificacion_demo',{id:item.id}))}else marcarLeidas(owner,[item.id]);setState(s=>s.owner===owner?{...s,items:s.items.map(n=>n.id===item.id?{...n,read:true}:n)}:s)}
 return {items,error:state.owner===owner?state.error:'',loading:enabled&&state.loading,markRead,retry:()=>setTick(n=>n+1)}
}
export default function Notifications({items,error,loading,markRead,onRetry,onClose}){
 const navigate=useNavigate(),[readError,setReadError]=useState(''),nuevas=items.filter(n=>!n.read)
 async function read(item){try{await markRead(item);setReadError('');return true}catch(e){setReadError(mensajeError(e));return false}}
 async function open(item){await read(item);if(item.to){onClose();navigate(item.to)}}
 return <Modal title="Notificaciones" subtitle={isDemoMode?'Notificaciones locales':'Tu negocio · últimos 7 días'} className="experience-sheet notifications-sheet" keyboardAware onClose={onClose} footer={<button type="button" className="btn full" onClick={onClose}>Cerrar notificaciones</button>}><ErrorBox text={error||readError}/>{error&&<button type="button" className="btn sec full" onClick={onRetry}>Reintentar</button>}<div className="notice-summary"><span className="premium-eyebrow">CENTRO DE NOTIFICACIONES</span><b>{nuevas.length} {nuevas.length===1?'nueva':'nuevas'}</b><p>Inventario, ventas y compras de tu negocio.</p>{nuevas.length>0&&<button type="button" className="notice-read-all" onClick={async()=>{for(const item of nuevas)if(!await read(item))break}}>Marcar todas como leídas</button>}</div>{loading?<Loader/>:<div className="notice-list">{items.length?items.map(item=><article className={'notification-card '+(item.read?'is-read':'is-new')} key={item.id}><button type="button" className={'row menu-row notification-row notification-main '+(item.read?'is-read':'is-new')} onClick={()=>open(item)}><span className={'notice-icon '+item.tone}><Icon name={item.id.startsWith('stock:')?'box':item.id.startsWith('warranty:')?'shield':/venta|factura/i.test(item.title)?'doc':/mercanc/i.test(item.title)?'truck':'chart'}/></span><span className="notice-copy"><b>{item.title}</b><span>{item.text}</span></span><span className="notice-state"><Badge tone={item.read?'':item.tone}>{item.read?'Leída':'Nueva'}</Badge><span aria-hidden="true">›</span></span></button>{!item.read&&<div className="notification-actions"><button type="button" onClick={()=>read(item)}>Marcar como leída</button></div>}</article>):!error&&<Empty text="Todo al día" description="Sin alertas de stock ni movimientos recientes."/>}</div>}</Modal>
}
