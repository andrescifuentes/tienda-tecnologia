import { useEffect, useMemo, useState } from 'react'
import Modal from './Modal'
import { ErrorBox, Input } from './ui'
import { useAuth } from '../context/AuthContext'
import { supabase, isDemoMode } from '../lib/supabase'
import { useAction } from '../lib/useAction'
import { toast } from '../lib/toast'
import { DEFAULT_INVOICE_MESSAGES, MESSAGE_VARIABLES, renderInvoiceMessages, saveInvoiceMessages, loadInvoiceMessageStore } from '../lib/invoiceMessageTemplates'
import '../styles/invoice-message-settings.css'
export default function InvoiceMessageSettings({onClose}){
 const {esAdmin,tienda,recargarPerfil}=useAuth(),[draft,setDraft]=useState(()=>({...DEFAULT_INVOICE_MESSAGES,...tienda?.plantillas_factura})),[tab,setTab]=useState('correo'),[error,setError]=useState('')
 const [loading,setLoading]=useState(true),[loadError,setLoadError]=useState(''),[retry,setRetry]=useState(0)
 useEffect(()=>{if(!esAdmin)return;let live=true;const controller=new AbortController();setLoading(true);setLoadError('');loadInvoiceMessageStore(supabase,controller.signal).then(store=>{if(live)setDraft({...store.plantillas_factura})}).catch(()=>{if(live)setLoadError('No se pudieron consultar las plantillas vigentes. Reintenta antes de editar.')}).finally(()=>{if(live)setLoading(false)});return()=>{live=false;controller.abort()}},[esAdmin,retry])
 const set=key=>e=>{setDraft(d=>({...d,[key]:e.target.value}));setError('')}
 const preview=useMemo(()=>{try{return renderInvoiceMessages({invoice:{prefijo:'FV',numero:28,fecha:new Date().toISOString(),total:55000,clientes:{nombre:'Andrés'}},items:[{nombre:'Cable USB-C',cantidad:2}],tienda,templates:draft})}catch(e){return{error:e.message}}},[draft,tienda])
 const [save,busy]=useAction(async()=>{setError('');try{await saveInvoiceMessages(supabase,draft,{esAdmin});toast('Plantillas de mensajes guardadas');await recargarPerfil();onClose()}catch(e){setError(e.message)}})
 if(!esAdmin)return null
 if(loading||loadError)return <Modal title="Plantillas de mensajes" className="admin-sheet invoice-message-settings" onClose={onClose}>{loading?<p role="status">Cargando plantillas vigentes…</p>:<><ErrorBox text={loadError}/><button className="btn sec full" onClick={()=>setRetry(n=>n+1)}>Reintentar</button></>}</Modal>
 return <Modal title="Plantillas de mensajes" subtitle="Facturación · comunicación con tus clientes" className="admin-sheet invoice-message-settings" keyboardAware restoreInputFocus={false} onClose={onClose} footer={<button type="button" className="btn full" disabled={busy||!!preview.error} onClick={save}>{busy?'Guardando…':'Guardar plantillas'}</button>}>
  <ErrorBox text={error}/><p className="admin-hint">Los vendedores utilizan estos mensajes. Las plantillas no cambian los importes ni el PDF de las facturas.</p>
  <p className="admin-hint template-persistence-note" role="status">{isDemoMode?'Demo local: las plantillas se guardan en este navegador y dirección. No se sincronizan con otros dispositivos.':'El guardado compartido entre administrador y vendedor requiere activar las plantillas en Supabase (SQL 12). Si el servidor rechaza el guardado, los cambios no se aplican.'}</p>
  <div className="sales-periods" role="group" aria-label="Canal de la plantilla">{[['correo','Correo'],['whatsapp','WhatsApp']].map(([key,label])=><button type="button" key={key} aria-pressed={tab===key} onClick={()=>setTab(key)}>{label}</button>)}</div>
  {tab==='correo'?<><Input label="Asunto del correo" value={draft.asunto_correo} maxLength={180} onChange={set('asunto_correo')}/><label className="lbl" htmlFor="template-email-body">Mensaje del correo</label><textarea id="template-email-body" className="inp" rows={8} maxLength={6000} value={draft.mensaje_correo} onChange={set('mensaje_correo')}/></>:<><label className="lbl" htmlFor="template-whatsapp-body">Mensaje de WhatsApp</label><textarea id="template-whatsapp-body" className="inp" rows={8} maxLength={1800} value={draft.mensaje_whatsapp} onChange={set('mensaje_whatsapp')}/></>}
  <div className="template-variables"><small>Variables disponibles</small><div>{MESSAGE_VARIABLES.map(name=><code key={name}>{'{'+name+'}'}</code>)}</div></div>
  <section className="template-preview" aria-label="Vista previa de la plantilla"><span className="premium-eyebrow">FACTURA DE EJEMPLO · NO SE ENVÍA</span>{preview.error?<ErrorBox text={preview.error}/>:<>{tab==='correo'&&<><small>Asunto</small><b>{preview.asunto}</b></>}<pre>{tab==='correo'?preview.correo:preview.whatsapp}</pre></>}</section>
  <button type="button" className="btn sec full template-restore" disabled={busy} onClick={()=>{setDraft({...DEFAULT_INVOICE_MESSAGES});setError('')}}>Restaurar plantillas predeterminadas</button><p className="admin-hint">Guarda para aplicar los cambios, incluida la restauración.</p>
 </Modal>
}
