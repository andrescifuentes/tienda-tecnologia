import { useEffect, useState } from 'react'
import AppShell from '../components/AppShell'
import ActivityTimeline from '../components/ActivityTimeline'
import { Empty, ErrorBox, Loader } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { useDemoRevision } from '../lib/demo/useDemoRevision'
import { loadActivity } from '../lib/activityPresentation'
import '../styles/team-observations.css'
export default function Actividad(){
 const {perfil,esAdmin}=useAuth(),revision=useDemoRevision(),[items,setItems]=useState(null),[error,setError]=useState(''),[kind,setKind]=useState('todos'),[retry,setRetry]=useState(0)
 useEffect(()=>{let live=true;const controller=new AbortController();setItems(null);setError('');loadActivity(supabase,{perfilId:perfil.id,esAdmin,signal:controller.signal,limit:100}).then(data=>{if(live)setItems(data)}).catch(()=>{if(live)setError('No se pudo cargar la actividad. Reintenta la conexión.')});return()=>{live=false;controller.abort()}},[perfil.id,esAdmin,revision,retry])
 const visible=items?.filter(item=>kind==='todos'||item.kind===kind)
 return <AppShell title="Actividad" sub={esAdmin?'Auditoría del negocio':'Mi actividad'}><section className="activity-intro"><span className="premium-eyebrow">HISTORIAL DEL NEGOCIO</span><h2>Actividad y seguimiento</h2><p>Movimientos registrados y quién los realizó. Las ventas se consultan en Facturas.</p></section><div className="sales-periods" role="group" aria-label="Tipo de actividad">{[['todos','Todas'],['ventas','Ventas'],['equipo','Equipo'],['inventario','Inventario']].map(([value,label])=><button type="button" key={value} aria-pressed={kind===value} onClick={()=>setKind(value)}>{label}</button>)}</div><ErrorBox text={error}/>{error?<button type="button" className="btn sec full" onClick={()=>setRetry(n=>n+1)}>Reintentar actividad</button>:!items?<Loader/>:<ActivityTimeline items={visible}/>}</AppShell>
}
