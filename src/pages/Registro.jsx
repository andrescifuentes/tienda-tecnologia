import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { mensajeError } from '../lib/format'
import { toast } from '../lib/toast'
import { Brand } from '../components/TechVisuals'
import { Icon } from '../components/Icons'
import '../styles/login-cinematic.css'

const correoValido = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
export const faltaScript06 = e => e?.code === 'PGRST202' || /Could not find the function/i.test(e?.message || '')

// Registro de administradores: solo con el código de registro de la tienda.
export default function Registro() {
  const navigate = useNavigate()
  const { recargarPerfil } = useAuth()
  const [f, setF] = useState({ nombre: '', correo: '', telefono: '', clave: '', repetir: '', codigo: '' })
  const [ver, setVer] = useState(false), [err, setErr] = useState(''), [busy, setBusy] = useState(false), [confirmar, setConfirmar] = useState('')
  const set = k => e => setF({ ...f, [k]: e.target.value })
  async function crear(e) {
    e.preventDefault(); setErr('')
    const correo = f.correo.trim().toLowerCase()
    if (!f.nombre.trim()) return setErr('Escribe tu nombre.')
    if (!correoValido(correo)) return setErr('Escribe un correo válido.')
    if (f.clave.length < 8) return setErr('La contraseña debe tener al menos 8 caracteres.')
    if (f.clave !== f.repetir) return setErr('Las contraseñas no coinciden.')
    if (!f.codigo.trim()) return setErr('Escribe el código de registro de la tienda.')
    setBusy(true)
    try {
      const v = await supabase.rpc('validar_codigo_registro', { p_codigo: f.codigo })
      if (v.error) throw faltaScript06(v.error) ? new Error('Falta activar el registro: ejecuta el script 09 en Supabase.') : v.error
      if (!v.data) throw new Error('El código de registro no es correcto. Pídeselo al dueño de la tienda.')
      const s = await supabase.auth.signUp({ email: correo, password: f.clave, options: { data: { nombre: f.nombre.trim() }, emailRedirectTo: window.location.origin + '/login' } })
      if (s.error) throw /registered|exists/i.test(s.error.message || '') ? new Error('Ese correo ya tiene una cuenta. Entra como administrador o usa «¿Olvidaste tu contraseña?».') : s.error
      if (s.data.user && !s.data.user.identities?.length) throw new Error('Ese correo ya tiene una cuenta. Entra como administrador o usa «¿Olvidaste tu contraseña?».')
      if (!s.data.session) { setConfirmar(correo); return }
      const r = await supabase.rpc('registrar_administrador', { p_nombre: f.nombre.trim(), p_codigo: f.codigo, p_telefono: f.telefono.trim() || null })
      if (r.error) throw r.error
      try { localStorage.setItem('angie:login-tipo', 'admin') } catch { /* preferencia opcional */ }
      await recargarPerfil(); toast('Cuenta de administrador creada'); navigate('/', { replace: true })
    } catch (e2) { setErr(e2?.message && !e2.code ? e2.message : mensajeError(e2)) }
    finally { setBusy(false) }
  }
  const campo = (k, icon, props) => <div className="login-input"><Icon name={icon} /><input className="inp" value={f[k]} onChange={set(k)} {...props} /></div>
  return <main className="login-screen login-cinematic register-screen"><div className="login-layout">
    <div className="register-top"><button type="button" className="login-theme" aria-label="Volver" onClick={() => navigate('/login')}><Icon name="back" /></button><Brand compact /></div>
    {confirmar ? <section className="login-form">
      <div className="login-heading"><div><span className="premium-eyebrow">CASI LISTO</span><h2>Confirma tu correo</h2></div></div>
      <p className="register-note">Te enviamos un enlace a <b>{confirmar}</b>. Ábrelo, luego entra como <b>Administrador</b> y escribe otra vez el código de registro para terminar.</p>
      <button type="button" className="btn full login-submit" onClick={() => navigate('/login')}><span>Ir a iniciar sesión</span><Icon name="arrow" className="w-4 h-4" /></button>
    </section> : <form className="login-form" onSubmit={crear} noValidate>
      <div className="login-heading"><div><span className="premium-eyebrow">NUEVO ADMINISTRADOR</span><h2>Crea tu cuenta</h2></div></div>
      <p className="register-note">Solo para administradores. Los vendedores los crea el administrador desde <b>Empleados</b>.</p>
      {err && <div role="alert" className="bg-badbg text-bad rounded-xl p-3 text-sm mb-3">{err}</div>}
      {campo('nombre', 'users', { placeholder: 'Nombre completo', autoComplete: 'name' })}
      {campo('correo', 'mail', { type: 'email', placeholder: 'Correo electrónico', autoComplete: 'username', autoCapitalize: 'none' })}
      {campo('telefono', 'phone', { type: 'tel', inputMode: 'tel', placeholder: 'Teléfono (opcional)', autoComplete: 'tel' })}
      <div className="login-input password-field"><Icon name="lock" /><input className="inp" type={ver ? 'text' : 'password'} placeholder="Contraseña (mínimo 8)" autoComplete="new-password" value={f.clave} onChange={set('clave')} /><button type="button" aria-label={ver ? 'Ocultar contraseña' : 'Mostrar contraseña'} onClick={() => setVer(!ver)}><Icon name="eye" /></button></div>
      {campo('repetir', 'lock', { type: ver ? 'text' : 'password', placeholder: 'Repite la contraseña', autoComplete: 'new-password' })}
      {campo('codigo', 'shield', { placeholder: 'Código de registro de la tienda', autoComplete: 'off', autoCapitalize: 'characters' })}
      <button className="btn full login-submit" disabled={busy}><span>{busy ? 'Creando…' : 'Crear cuenta'}</span><Icon name="arrow" className="w-4 h-4" /></button>
      <button type="button" className="login-register" onClick={() => navigate('/login')}>¿Ya tienes cuenta? <b>Inicia sesión</b></button>
    </form>}
  </div></main>
}
