import { useState } from 'react'
import AppShell, { ThemeToggle } from '../components/AppShell'
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
  const { salir,esAdmin,tienda,recargarPerfil }=useAuth()
  const [business,setBusiness]=useState({nombre:tienda?.nombre||'',nit:tienda?.nit||'',telefono:tienda?.telefono||'',direccion:tienda?.direccion||'',factura_pie:tienda?.factura_pie||''})
  const set=key=>event=>setBusiness({...business,[key]:event.target.value})
  const [save,busy]=useAction(async()=>{
    if(!business.nombre.trim())return setError('El nombre del negocio es obligatorio.')
    const result=await supabase.from('tienda').update({...business,nombre:business.nombre.trim()}).eq('id',1)
    if(result.error)return setError(mensajeError(result.error))
    setError('');await recargarPerfil();toast('Datos del negocio guardados')
  })
  async function reset() {
    // Commit first: a quota failure must not delete photos referenced by current data.
    supabase.demo.reset()
    for(const key of Object.keys(sessionStorage))if(key.startsWith('angie:cart:'))sessionStorage.removeItem(key)
    await clearImages()
    toast('Datos demo restablecidos')
  }
  return <AppShell title="Configuración" sub="Tu espacio de trabajo">
    <section className="card mb-3"><h2 className="section-heading">Apariencia</h2><div className="row"><span className="flex-1">Tema claro / oscuro</span><ThemeToggle /></div></section>
    {isDemoMode&&esAdmin&&<section className="card mb-3"><h2 className="section-heading">Datos del negocio</h2><ErrorBox text={error}/><Input label="Nombre del negocio" required value={business.nombre} onChange={set('nombre')}/><Input label="NIT del negocio" value={business.nit} onChange={set('nit')}/><Input label="Teléfono del negocio" type="tel" value={business.telefono} onChange={set('telefono')}/><Input label="Dirección del negocio" value={business.direccion} onChange={set('direccion')}/><Input label="Pie de factura" value={business.factura_pie} onChange={set('factura_pie')}/><p className="text-xs text-muted">Moneda COP · America/Bogota. El consecutivo se conserva automáticamente.</p><button className="btn full" disabled={busy} onClick={save}>{busy?'Guardando…':'Guardar negocio'}</button></section>}
    <section className="card mb-3"><h2 className="section-heading">{isDemoMode?'Demo local':'Conexión real'}</h2>{isDemoMode?<><p className="text-sm">Datos ficticios guardados en este navegador. Las facturas se previsualizan localmente; WhatsApp y correo se abren solo si tú lo solicitas.</p><p className="text-sm">Administrador: <b>admin@angietech.demo</b><br/>Contraseña: <b>{DEMO_PASSWORD}</b></p><p className="text-xs text-muted">Restablecer elimina cambios y fotos subidas, recupera los ejemplos iniciales y cierra la sesión. Conserva tu tema.</p>{esAdmin&&<button className="btn sec full" onClick={()=>setConfirm(true)}>Restablecer datos demo</button>}</>:<p className="text-sm">Estás usando la conexión configurada para tu tienda.</p>}</section>
    <button className="btn sec full" onClick={salir}>Cerrar sesión</button>
    {confirm&&<ConfirmAction title="Restablecer demo" label="Restablecer y cerrar sesión" onClose={()=>setConfirm(false)} onConfirm={reset}>Se eliminarán los cambios ficticios y fotos locales de este navegador. No afecta datos remotos.</ConfirmAction>}
  </AppShell>
}
