import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from './Modal'
import { Icon } from './Icons'
import { Badge, Empty, ErrorBox, Loader } from './ui'
import { supabase, isDemoMode } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { subscribeDemoChanges } from '../lib/demo/useDemoRevision'
import { hoyBogota, fechaHora } from '../lib/format'
import { loadActivity, noticeReadKey, readNoticeIds, saveNoticeRead } from '../lib/activityPresentation'
import { withDeadline, requireData, cancellableQuery } from '../lib/asyncResult'
import '../styles/team-observations.css'
export function useNotifications() {
 const {perfil,esAdmin,can}=useAuth(),inventory=can('ver_inventario')
 const [state,setState]=useState({owner:null,items:[],error:'',loading:true}),[tick,setTick]=useState(0)
 const key=noticeReadKey(perfil.id,window.location.hostname)
 useEffect(()=>{
  let live=true,version=0;const controller=new AbortController();setState({owner:perfil.id,items:[],loading:true,error:''})
  const load=async()=>{const token=++version
   try{
    const [products,warranties,events,demoRead]=await Promise.all([
     inventory?withDeadline(async s=>requireData(await cancellableQuery(supabase.from('productos_venta').select('id,codigo,nombre,stock,stock_min'),s)),{signal:controller.signal}):[],
     esAdmin?withDeadline(async s=>requireData(await cancellableQuery(supabase.from('garantias').select('id,estado,fin,producto_id,factura_item_id'),s)),{signal:controller.signal}).catch(()=>[]):[],
     loadActivity(supabase,{perfilId:perfil.id,esAdmin,signal:controller.signal,limit:25}),
     isDemoMode?supabase.from('notificaciones_leidas').select('*').eq('perfil_id',perfil.id):{data:[]},
    ])
    const read=readNoticeIds(localStorage,key);for(const r of demoRead.data||[])read.add(r.notificacion_id)
    const items=[];for(const p of products.filter(p=>p.activo!==false&&p.stock<=p.stock_min))items.push({id:'stock:'+p.id+':'+p.stock,title:p.stock===0?'Producto agotado':'Stock bajo',text:p.nombre+' · '+p.stock+' unidades',icon:'box',type:'Inventario',date:'Estado actual',to:'/inventario?producto='+p.id,tone:p.stock===0?'bad':'warn'})
    const today=hoyBogota(),expiring=warranties.filter(g=>g.estado==='vigente'&&g.fin>=today&&(Date.parse(g.fin)-Date.parse(today))/86400000<=30)
    const warrantyItems=expiring.length?await withDeadline(async s=>requireData(await cancellableQuery(supabase.from('factura_items').select('id,factura_id').in('id',expiring.map(g=>g.factura_item_id).filter(Boolean)),s)),{signal:controller.signal}):[]
    for(const g of expiring)items.push({id:'warranty:'+g.id+':'+g.fin,title:'Garantía por vencer',text:(products.find(p=>p.id===g.producto_id)?.nombre||'Garantía')+' · Vence '+g.fin,icon:'shield',type:'Garantías',date:g.fin,to:warrantyItems.find(i=>i.id===g.factura_item_id)?.factura_id?'/facturas?factura='+warrantyItems.find(i=>i.id===g.factura_item_id).factura_id:null,tone:'warn'})
    for(const a of events)items.push({id:'activity:'+a.id,title:a.title,text:a.description,icon:a.icon,type:a.kind==='ventas'?'Ventas':a.kind==='equipo'?'Equipo':a.kind==='inventario'?'Inventario':'Actividad',date:a.date,to:a.to,tone:a.tone})
    if(live&&token===version)setState({owner:perfil.id,items:items.map(n=>({...n,read:read.has(n.id)})),loading:false,error:''})
   }catch{if(live&&token===version)setState({owner:perfil.id,items:[],loading:false,error:'No se pudieron cargar las notificaciones. Reintenta la conexión.'})}
  }
  load();const unsubscribe=isDemoMode?subscribeDemoChanges(load):()=>{}
  const sync=event=>{if(!event.key||event.key===key)void load()};window.addEventListener('storage',sync)
  return()=>{live=false;controller.abort();unsubscribe();window.removeEventListener('storage',sync)}
 },[perfil.id,esAdmin,inventory,tick,key])
 const items=state.owner===perfil.id?state.items:[]
 async function markRead(item){if(!items.some(n=>n.id===item.id))return
  if(isDemoMode){const r=await supabase.rpc('leer_notificacion_demo',{id:item.id});if(r.error)throw Error('No se pudo marcar como leída.')}
  else saveNoticeRead(localStorage,key,item.id)
  setState(s=>s.owner===perfil.id?{...s,items:s.items.map(n=>n.id===item.id?{...n,read:true}:n)}:s)
 }
 return {items,error:state.owner===perfil.id?state.error:'',loading:state.loading,markRead,retry:()=>setTick(n=>n+1)}
}
export default function Notifications({items,error,loading,markRead,onRetry,onClose}) {
 const navigate=useNavigate(),[readError,setReadError]=useState('')
 async function read(item){try{await markRead(item);setReadError('')}catch{setReadError('No se pudo guardar la lectura. La notificación sigue disponible.')}}
 async function open(item){await read(item);if(item.to){onClose();navigate(item.to)}}
 return <Modal title="Notificaciones" subtitle={isDemoMode?'Actividad demo local':'Actividad del negocio · lectura en este dispositivo'} className="experience-sheet notifications-sheet" keyboardAware onClose={onClose} footer={<button type="button" className="btn full" onClick={onClose}>Cerrar notificaciones</button>}><ErrorBox text={error||readError}/>{error&&<button type="button" className="btn sec full" onClick={onRetry}>Reintentar</button>}<div className="notice-summary"><span className="premium-eyebrow">CENTRO DE NOTIFICACIONES</span><b>{items.filter(n=>!n.read).length} nuevas</b><p>Alertas y movimientos a los que tienes acceso.</p></div>{loading?<Loader/>:<div className="notice-list">{items.length?items.map(item=><article className={'notification-card '+(item.read?'is-read':'is-new')} key={item.id}><button type="button" className="notification-main" disabled={!item.to} onClick={()=>open(item)}><span className={'notice-icon '+item.tone}><Icon name={item.icon}/></span><span className="notice-copy"><small>{item.type}</small><b>{item.title}</b><span>{item.text}</span><small>{item.date}</small></span><span aria-hidden="true">{item.to?'›':''}</span></button><div className="notification-actions"><Badge tone={item.read?'':item.tone}>{item.read?'Leída':'Nueva'}</Badge>{!item.read&&<button type="button" onClick={()=>read(item)}>Marcar como leída</button>}</div></article>):!error&&<Empty text="Todo al día" description="Sin notificaciones disponibles."/>}</div>}</Modal>
}
