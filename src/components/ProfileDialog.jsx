import { useState } from 'react'
import Modal from './Modal'
import { Input, ErrorBox } from './ui'
import { useAuth } from '../context/AuthContext'
import { supabase, isDemoMode } from '../lib/supabase'
import { getTheme, setTheme } from '../lib/theme'
import { useAction } from '../lib/useAction'
import { mensajeError } from '../lib/format'
import { toast } from '../lib/toast'
import { Icon } from './Icons'
import '../styles/profile-finance.css'

export default function ProfileDialog({ onClose }) {
  const { perfil, recargarPerfil, salir } = useAuth()
  const [name,setName]=useState(perfil.nombre),[phone,setPhone]=useState(perfil.telefono||''),[error,setError]=useState(''),[theme,setLocalTheme]=useState(getTheme())
  const [save,busy]=useAction(async()=>{
    if(!name.trim())return setError('El nombre es obligatorio.')
    const result=await supabase.rpc('actualizar_perfil_demo',{nombre:name.trim(),telefono:phone.trim()})
    if(result.error)return setError(mensajeError(result.error))
    await recargarPerfil();toast('Perfil guardado');onClose()
  })
  return <Modal title="Mi perfil" subtitle="Tu espacio personal en ANGIE TECH" className="profile-sheet premium-account-sheet" keyboardAware onClose={onClose} footer={isDemoMode&&<button className="btn full" disabled={busy} onClick={save}>{busy?'Guardando…':'Guardar perfil'}</button>}>
    <ErrorBox text={error} />
    <section className="profile-identity">
      <span className="profile-avatar" aria-hidden="true">{(perfil.nombre.trim()[0] || 'A').toUpperCase()}</span>
      <div><span className="premium-eyebrow">TU CUENTA</span><h2>{perfil.nombre}</h2><p>{perfil.correo}</p><span className="profile-role"><Icon name="shield"/>{perfil.rol === 'admin' ? 'Administrador' : perfil.rol}</span></div>
    </section>
    <section className="profile-section"><header><span>01</span><div><h2>Información personal</h2><p>Así te identifica tu equipo.</p></div></header>
      <div className="profile-field"><Icon name="users"/><Input label="Nombre del usuario" required autoComplete="name" value={name} onChange={e=>setName(e.target.value)} disabled={!isDemoMode}/></div>
      <div className="profile-field"><Icon name="phone"/><Input label="Teléfono" type="tel" autoComplete="tel" value={phone} onChange={e=>setPhone(e.target.value)} disabled={!isDemoMode}/></div>
    </section>
    <section className="profile-section"><header><span>02</span><div><h2>Preferencias</h2><p>Un espacio a tu manera.</p></div></header>
      <div className="profile-theme" role="group" aria-label="Tema de la aplicación">{['dark','light'].map(t=><button key={t} type="button" aria-pressed={theme===t} onClick={()=>{setTheme(t);setLocalTheme(t)}}><Icon name={t==='dark'?'moon':'sun'}/>{t==='dark'?'Oscuro':'Claro'}</button>)}</div>
      <div className="profile-security"><Icon name="lock"/><div><b>Seguridad de tu cuenta</b><p>El cambio de contraseña requiere el servicio de autenticación de producción; no se simula un envío.</p></div></div>
    </section>
    <button className="profile-logout" aria-label="Cerrar sesión" onClick={salir}><Icon name="out"/><span>Cerrar sesión</span><span aria-hidden="true">›</span></button>
  </Modal>
}
