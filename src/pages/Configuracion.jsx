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
import { useRef } from 'react'
import { MENSAJE_FACTURA_BASE, CAMPOS_MENSAJE, plantillaFactura, armarMensajeFactura } from '../lib/mensajeFactura'
import { invoiceBrand, datosEmpresa } from '../../supabase/functions/_shared/invoice-brand.js'

export default function Configuracion() {
  const [confirm,setConfirm]=useState(false),[error,setError]=useState('')
  const [editing,setEditing]=useState(null)
  const { salir,esAdmin,tienda,recargarPerfil }=useAuth()
  const [business,setBusiness]=useState({nombre:tienda?.nombre||'',nit:tienda?.nit||'',direccion:tienda?.direccion||'',local:tienda?.local||'',telefono:tienda?.telefono||'',correo:tienda?.correo||'',factura_pie:tienda?.factura_pie||'',datos_extra:Array.isArray(tienda?.datos_extra)?tienda.datos_extra:[]})
  const set=key=>event=>setBusiness({...business,[key]:event.target.value})
  const [save,busy]=useAction(async()=>{
    if(!business.nombre.trim())return setError('El nombre del negocio es obligatorio.')
    const {datos_extra=[],...resto}=business
    const limpio=Object.fromEntries(Object.entries(resto).map(([k,v])=>[k,String(v??'').trim()||null]))
    const extras=datos_extra.map(d=>({etiqueta:String(d.etiqueta||'').trim(),valor:String(d.valor||'').trim()})).filter(d=>d.valor)
    if(editing==='empresa')limpio.datos_extra=extras
    if(limpio.correo&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpio.correo))return setError('Escribe un correo válido.')
    const result=await supabase.from('tienda').update({...limpio,nombre:business.nombre.trim()}).eq('id',tienda?.id??1)
    if(result.error)return setError(/local|datos_extra/.test(result.error.message||'')?'Falta activar el número de local: ejecuta el script 15 en Supabase.':mensajeError(result.error))
    setError('');await recargarPerfil();toast('Datos del negocio guardados');setEditing(null)
  })
  const [mensaje,setMensaje]=useState(null),textoRef=useRef(null)
  const insertar=campo=>{const el=textoRef.current,t=mensaje.texto,a=el?.selectionStart??t.length,b=el?.selectionEnd??t.length;setMensaje({...mensaje,texto:t.slice(0,a)+campo+t.slice(b),error:''});requestAnimationFrame(()=>{try{el.focus();el.setSelectionRange(a+campo.length,a+campo.length)}catch{}})}
  const [guardarMensaje,guardandoMensaje]=useAction(async()=>{
    const texto=mensaje.texto.trim()
    if(texto.length>1500)return setMensaje({...mensaje,error:'El mensaje es muy largo (máximo 1.500 caracteres).'})
    const {error:e}=await supabase.from('tienda').update({mensaje_factura:texto&&texto!==MENSAJE_FACTURA_BASE?texto:null}).eq('id',tienda?.id??1)
    if(e)return setMensaje({...mensaje,error:/mensaje_factura/.test(e.message||'')?'Falta activar esta opción: ejecuta el script 12 en Supabase.':mensajeError(e)})
    await recargarPerfil();setMensaje(null);toast('Mensaje al cliente guardado')
  })
  const [codigo,setCodigo]=useState(null)
  const [guardarCodigo,guardandoCodigo]=useAction(async()=>{
    if(codigo.nuevo.trim().length<6)return setCodigo({...codigo,error:'El código debe tener al menos 6 caracteres.'})
    if(codigo.nuevo.trim()!==codigo.repetir.trim())return setCodigo({...codigo,error:'Los códigos no coinciden.'})
    const {error:e}=await supabase.rpc('definir_codigo_registro',{p_codigo:codigo.nuevo.trim()})
    if(e)return setCodigo({...codigo,error:e.code==='PGRST202'?'Falta activar el registro: ejecuta los scripts 09 y 10 en Supabase.':mensajeError(e)})
    setCodigo(null);toast('Código de registro actualizado')
  })
  async function reset() {
    // Commit first: a quota failure must not delete photos referenced by current data.
    await supabase.demo.reset()
    for(const key of Object.keys(sessionStorage))if(key.startsWith('angie:cart:'))sessionStorage.removeItem(key)
    await clearImages()
    toast('Datos demo restablecidos')
  }
  const fields={nombre:{title:'Nombre del negocio',row:'Nombre del negocio'},nit:{title:'NIT del negocio',row:'NIT'},telefono:{title:'Teléfono del negocio',row:'Teléfono',type:'tel'},direccion:{title:'Dirección del negocio',row:'Dirección'},local:{title:'Número de local',row:'Local'},correo:{title:'Correo del negocio',row:'Correo',type:'email'},factura_pie:{title:'Pie de factura',row:'Pie de factura'}}
  const open=key=>{setBusiness({nombre:tienda?.nombre||'',nit:tienda?.nit||'',direccion:tienda?.direccion||'',local:tienda?.local||'',telefono:tienda?.telefono||'',correo:tienda?.correo||'',factura_pie:tienda?.factura_pie||'',datos_extra:Array.isArray(tienda?.datos_extra)?tienda.datos_extra:[]});setError('');setEditing(key)}
  return <div className="admin-premium admin-settings"><AppShell title="Configuración" sub="Tu espacio de trabajo">
    <section className="settings-group"><h2 className="admin-group-title">Apariencia</h2><ThemeSegments/></section>
    {esAdmin&&<><section className="settings-group"><h2 className="admin-group-title">Datos de la empresa</h2><p className="admin-hint empresa-hint">Salen en todas las facturas, el PDF y la página que recibe el cliente.</p><div className="settings-panel">{['nombre','nit','direccion','local','telefono','correo'].map(key=><SettingsRow key={key} data-setting={key} label={fields[key].row} value={tienda?.[key]||'Sin registrar'} onClick={()=>open('empresa')}/>)}{(Array.isArray(tienda?.datos_extra)?tienda.datos_extra:[]).map((d,i)=><SettingsRow key={'x'+i} label={d.etiqueta||'Otro dato'} value={d.valor} onClick={()=>open('empresa')}/>)}</div><button type="button" className="empresa-edit-btn" onClick={()=>open('empresa')}>Editar datos de la empresa</button></section><section className="settings-group"><h2 className="admin-group-title">Facturación</h2><div className="settings-panel"><SettingsRow data-setting="factura_pie" label="Pie de factura" value={tienda?.factura_pie} onClick={()=>open('factura_pie')}/></div><p className="admin-hint">Moneda COP · America/Bogota. El consecutivo se conserva automáticamente.</p></section><section className="settings-group"><h2 className="admin-group-title">Mensaje al cliente</h2><div className="settings-panel"><SettingsRow label="Mensaje de la factura" value={tienda?.mensaje_factura?'Personalizado':'Por defecto'} icon="mail" onClick={()=>setMensaje({texto:plantillaFactura(tienda),error:''})}/></div><p className="admin-hint">Es el texto que reciben tus clientes con la factura por WhatsApp y correo. Los vendedores lo usan tal cual, sin poder cambiarlo.</p></section></>}
    {!isDemoMode&&esAdmin&&<section className="settings-group"><h2 className="admin-group-title">Registro de administradores</h2><div className="settings-panel"><SettingsRow label="Código de registro" value="Cambiar" icon="shield" onClick={()=>setCodigo({nuevo:'',repetir:'',error:''})}/></div><p className="admin-hint">Quien quiera ser administrador de este negocio debe escribir este código al crear su cuenta («Unirme a uno»). Compártelo solo con personas de confianza. Los vendedores los creas tú desde Empleados.</p></section>}
    <section className="settings-group"><h2 className="admin-group-title">Preferencias</h2><div className="settings-panel"><SettingsRow label="Cerrar sesión" value="Salir" icon="out" onClick={salir}/></div></section>
    <section className="settings-group"><h2 className="admin-group-title">{isDemoMode?'Demo / datos locales':'Conexión real'}</h2>{isDemoMode?<><details className="admin-local-details"><summary>Demo local · información y acceso</summary><p>Datos ficticios guardados en este navegador. WhatsApp y correo se abren solo si tú lo solicitas.</p><p>Administrador: <b>admin@angietech.demo</b><br/>Contraseña demo: <b>{DEMO_PASSWORD}</b></p></details><p className="admin-hint">Restablecer elimina cambios y fotos subidas, recupera los ejemplos y cierra la sesión. Conserva tu tema.</p>{esAdmin&&<button className="admin-reset" onClick={()=>setConfirm(true)}>Restablecer datos demo</button>}</>:<p className="admin-hint">Estás usando la conexión configurada para tu tienda.</p>}</section>
    {editing==='empresa'&&<Modal title="Datos de la empresa" subtitle="Así aparecen en tus facturas" className="admin-sheet settings-edit-sheet empresa-sheet" keyboardAware onClose={()=>setEditing(null)} footer={<button className="btn full" disabled={busy} onClick={save}>{busy?'Guardando…':'Guardar datos'}</button>}><ErrorBox text={error}/>
      <Input autoFocus label="Nombre de la empresa" required value={business.nombre} onChange={set('nombre')}/>
      <Input label="NIT" placeholder="900.123.456-7" value={business.nit} onChange={set('nit')}/>
      <Input label="Dirección" placeholder="Calle 10 # 5-20, Centro Comercial…" value={business.direccion} onChange={set('direccion')}/>
      <Input label="Número de local" placeholder="Local 104" value={business.local} onChange={set('local')}/>
      <Input label="Teléfono" type="tel" inputMode="tel" placeholder="300 123 4567" value={business.telefono} onChange={set('telefono')}/>
      <Input label="Correo (opcional)" type="email" inputMode="email" autoCapitalize="none" placeholder="ventas@miempresa.com" value={business.correo} onChange={set('correo')}/>
      <p className="msg-label">Otros datos (opcional)</p>
      <p className="admin-hint empresa-extra-hint">Por ejemplo: Instagram, horario, régimen, página web.</p>
      {business.datos_extra.map((d,i)=><div className="empresa-extra" key={i}>
        <input className="inp" aria-label={'Nombre del dato '+(i+1)} placeholder="Nombre (ej. Instagram)" maxLength={30} value={d.etiqueta} onChange={e=>setBusiness({...business,datos_extra:business.datos_extra.map((x,j)=>j===i?{...x,etiqueta:e.target.value}:x)})}/>
        <input className="inp" aria-label={'Valor del dato '+(i+1)} placeholder="Valor (ej. @angietech)" maxLength={80} value={d.valor} onChange={e=>setBusiness({...business,datos_extra:business.datos_extra.map((x,j)=>j===i?{...x,valor:e.target.value}:x)})}/>
        <button type="button" aria-label="Quitar este dato" onClick={()=>setBusiness({...business,datos_extra:business.datos_extra.filter((_,j)=>j!==i)})}>✕</button>
      </div>)}
      {business.datos_extra.length<6&&<button type="button" className="empresa-extra-add" onClick={()=>setBusiness({...business,datos_extra:[...business.datos_extra,{etiqueta:'',valor:''}]})}>+ Agregar otro dato</button>}
      <p className="msg-label">Así se verá en la factura</p>
      <div className="empresa-preview"><b>{business.nombre||'Nombre de la empresa'}</b><span>{datosEmpresa(business).join(' · ')||'Agrega NIT, dirección, local y teléfono'}</span></div>
    </Modal>}
    {editing&&editing!=='empresa'&&<Modal title={fields[editing].title} subtitle="Datos del negocio" className="admin-sheet settings-edit-sheet" keyboardAware onClose={()=>setEditing(null)} footer={<button className="btn full" disabled={busy} onClick={save}>{busy?'Guardando…':'Guardar negocio'}</button>}><ErrorBox text={error}/><Input autoFocus label={fields[editing].title} type={fields[editing].type||'text'} required={editing==='nombre'} value={business[editing]} onChange={set(editing)}/><p className="admin-hint">El cambio se aplica al guardar.</p></Modal>}
    {codigo&&<Modal title="Código de registro" subtitle="Registro de administradores" className="admin-sheet settings-edit-sheet" keyboardAware onClose={()=>setCodigo(null)} footer={<button className="btn full" disabled={guardandoCodigo} onClick={guardarCodigo}>{guardandoCodigo?'Guardando…':'Guardar código'}</button>}><ErrorBox text={codigo.error}/><Input autoFocus label="Nuevo código (mínimo 6 caracteres)" autoComplete="off" value={codigo.nuevo} onChange={e=>setCodigo({...codigo,nuevo:e.target.value,error:''})}/><Input label="Repite el código" autoComplete="off" value={codigo.repetir} onChange={e=>setCodigo({...codigo,repetir:e.target.value,error:''})}/><p className="admin-hint">El código anterior deja de funcionar al guardar. Se guarda cifrado: ni siquiera desde la base de datos se puede leer.</p></Modal>}
    {mensaje&&<Modal title="Mensaje al cliente" subtitle="WhatsApp y correo de la factura" className="admin-sheet settings-edit-sheet msg-sheet" keyboardAware onClose={()=>setMensaje(null)} footer={<button className="btn full" disabled={guardandoMensaje} onClick={guardarMensaje}>{guardandoMensaje?'Guardando…':'Guardar mensaje'}</button>}>
      <ErrorBox text={mensaje.error}/>
      <label className="msg-label" htmlFor="msg-factura">Tu mensaje</label>
      <textarea id="msg-factura" ref={textoRef} className="inp msg-text" rows={8} maxLength={1500} value={mensaje.texto} onChange={e=>setMensaje({...mensaje,texto:e.target.value,error:''})}/>
      <p className="msg-label">Toca para agregar al mensaje</p>
      <div className="msg-chips">{CAMPOS_MENSAJE.map(([campo,nombre])=><button key={campo} type="button" onClick={()=>insertar(campo)}>{nombre}</button>)}</div>
      <p className="msg-label">Así lo verá el cliente</p>
      <pre className="msg-preview">{armarMensajeFactura(mensaje.texto,{cliente:'Andrés',negocio:invoiceBrand(tienda||{}),factura:'FV-0029',total:'$2.500.000',enlace:window.location.origin+'/f/Kq7mZ2xP9wRt'})}</pre>
      {mensaje.texto.trim()!==MENSAJE_FACTURA_BASE&&<button type="button" className="msg-reset" onClick={()=>setMensaje({texto:MENSAJE_FACTURA_BASE,error:''})}>Volver al mensaje original</button>}
    </Modal>}
    {confirm&&<ConfirmAction title="Restablecer demo" label="Restablecer y cerrar sesión" onClose={()=>setConfirm(false)} onConfirm={reset}>Se eliminarán los cambios ficticios y fotos locales de este navegador. No afecta datos remotos.</ConfirmAction>}
  </AppShell></div>
}
