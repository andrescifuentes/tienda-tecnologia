import { useState } from 'react'
import Modal from './Modal'
import { Input, ErrorBox } from './ui'
import { useAuth } from '../context/AuthContext'
import { supabase, isDemoMode } from '../lib/supabase'
import { getTheme, setTheme } from '../lib/theme'
import { useAction } from '../lib/useAction'
import { mensajeError } from '../lib/format'
import { toast } from '../lib/toast'

export default function ProfileDialog({ onClose }) {
  const { perfil, recargarPerfil, salir } = useAuth()
  const [name,setName]=useState(perfil.nombre),[phone,setPhone]=useState(perfil.telefono||''),[error,setError]=useState(''),[theme,setLocalTheme]=useState(getTheme())
  const [save,busy]=useAction(async()=>{
    if(!name.trim())return setError('El nombre es obligatorio.')
    const result=await supabase.rpc('actualizar_perfil_demo',{nombre:name.trim(),telefono:phone.trim()})
    if(result.error)return setError(mensajeError(result.error))
    await recargarPerfil();toast('Perfil guardado');onClose()
  })
  return <Modal title="Mi perfil" onClose={onClose} footer={isDemoMode&&<button className="btn full" disabled={busy} onClick={save}>{busy?'Guardando…':'Guardar perfil'}</button>}><ErrorBox text={error} /><p className="text-sm text-muted">{perfil.correo} · {perfil.rol}</p><Input label="Nombre del usuario" required value={name} onChange={e=>setName(e.target.value)} disabled={!isDemoMode}/><Input label="Teléfono" type="tel" value={phone} onChange={e=>setPhone(e.target.value)} disabled={!isDemoMode}/><button className="btn sec full" onClick={()=>{const next=theme==='dark'?'light':'dark';setTheme(next);setLocalTheme(next)}}>Tema: {theme==='dark'?'oscuro':'claro'} · Cambiar</button><p className="text-xs text-muted">El cambio de contraseña requiere el servicio de autenticación de producción; no se simula un envío.</p><button className="btn sec full" onClick={salir}>Cerrar sesión</button></Modal>
}
