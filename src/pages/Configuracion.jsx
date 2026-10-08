import { useState } from 'react'
import AppShell from '../components/AppShell'
import Modal from '../components/Modal'
import { SettingsRow, ThemeSegments } from '../components/AdminPrimitives'
import ConfirmAction from '../components/ConfirmAction'
import { Input, ErrorBox } from '../components/ui'
import { supabase, isDemoMode } from '../lib/supabase'
import { DEMO_PASSWORD } from '../lib/demo/seed'
import { clearImages } from '../lib/demo/images'
import { useAuth } from '../context/AuthContext'
import { useAction } from '../lib/useAction'
import { mensajeError } from '../lib/format'
import { toast } from '../lib/toast'

export default function Configuracion() {
  const [confirm,setConfirm]=useState(false),[error,setError]=useState('')
  const [editing,setEditing]=useState(null)
  const { salir,esAdmin,tienda,recargarPerfil }=useAuth()
  const [business,setBusiness]=useState({nombre:tienda?.nombre||'',nit:tienda?.nit||'',telefono:tienda?.telefono||'',direccion:tienda?.direccion||'',factura_pie:tienda?.factura_pie||''})
  const set=key=>event=>setBusiness({...business,[key]:event.target.value})
  const [save,busy]=useAction(async()=>{
    if(!business.nombre.trim())return setError('El nombre del negocio es obligatorio.')
    const result=await supabase.from('tienda').update({...business,nombre:business.nombre.trim()}).eq('id',1)
    if(result.error)return setError(mensajeError(result.error))
    setError('');await recargarPerfil();toast('Datos del negocio guardados');setEditing(null)
  })
  async function reset() {
    // Commit first: a quota failure must not delete photos referenced by current data.
    await supabase.demo.reset()
    for(const key of Object.keys(sessionStorage))if(key.startsWith('angie:cart:'))sessionStorage.removeItem(key)
    await clearImages()
    toast('Datos demo restablecidos')
  }
  const fields={nombre:{title:'Nombre del negocio',row:'Nombre del negocio'},nit:{title:'NIT del negocio',row:'NIT'},telefono:{title:'Teléfono del negocio',row:'Teléfono',type:'tel'},direccion:{title:'Dirección del negocio',row:'Dirección'},factura_pie:{title:'Pie de factura',row:'Pie de factura'}}
  const open=key=>{setBusiness({nombre:tienda?.nombre||'',nit:tienda?.nit||'',telefono:tienda?.telefono||'',direccion:tienda?.direccion||'',factura_pie:tienda?.factura_pie||''});setError('');setEditing(key)}
  return <div className="admin-premium admin-settings"><AppShell title="Configuración" sub="Tu espacio de trabajo">
    <section className="settings-group"><h2 className="admin-group-title">Apariencia</h2><ThemeSegments/></section>
    {isDemoMode&&esAdmin&&<><section className="settings-group"><h2 className="admin-group-title">Datos del negocio</h2><div className="settings-panel">{['nombre','nit','telefono','direccion'].map(key=><SettingsRow key={key} data-setting={key} label={fields[key].row} value={tienda?.[key]} onClick={()=>open(key)}/>)}</div></section><section className="settings-group"><h2 className="admin-group-title">Facturación</h2><div className="settings-panel"><SettingsRow data-setting="factura_pie" label="Pie de factura" value={tienda?.factura_pie} onClick={()=>open('factura_pie')}/></div><p className="admin-hint">Moneda COP · America/Bogota. El consecutivo se conserva automáticamente.</p></section></>}
    <section className="settings-group"><h2 className="admin-group-title">Preferencias</h2><div className="settings-panel"><SettingsRow label="Cerrar sesión" value="Salir" icon="out" onClick={salir}/></div></section>
    <section className="settings-group"><h2 className="admin-group-title">{isDemoMode?'Demo / datos locales':'Conexión real'}</h2>{isDemoMode?<><details className="admin-local-details"><summary>Demo local · información y acceso</summary><p>Datos ficticios guardados en este navegador. WhatsApp y correo se abren solo si tú lo solicitas.</p><p>Administrador: <b>admin@angietech.demo</b><br/>Contraseña demo: <b>{DEMO_PASSWORD}</b></p></details><p className="admin-hint">Restablecer elimina cambios y fotos subidas, recupera los ejemplos y cierra la sesión. Conserva tu tema.</p>{esAdmin&&<button className="admin-reset" onClick={()=>setConfirm(true)}>Restablecer datos demo</button>}</>:<p className="admin-hint">Estás usando la conexión configurada para tu tienda.</p>}</section>
    {editing&&<Modal title={fields[editing].title} subtitle="Datos del negocio" className="admin-sheet settings-edit-sheet" keyboardAware onClose={()=>setEditing(null)} footer={<button className="btn full" disabled={busy} onClick={save}>{busy?'Guardando…':'Guardar negocio'}</button>}><ErrorBox text={error}/><Input autoFocus label={fields[editing].title} type={fields[editing].type||'text'} required={editing==='nombre'} value={business[editing]} onChange={set(editing)}/><p className="admin-hint">El cambio se aplica al guardar.</p></Modal>}
    {confirm&&<ConfirmAction title="Restablecer demo" label="Restablecer y cerrar sesión" onClose={()=>setConfirm(false)} onConfirm={reset}>Se eliminarán los cambios ficticios y fotos locales de este navegador. No afecta datos remotos.</ConfirmAction>}
  </AppShell></div>
}
