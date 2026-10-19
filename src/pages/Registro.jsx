import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { mensajeError } from '../lib/format'
import { toast } from '../lib/toast'
import { Brand } from '../components/TechVisuals'
import { Icon } from '../components/Icons'
import { completarRegistro, faltaScript10 } from '../lib/registro'
import '../styles/login-cinematic.css'

const correoValido = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
// Registro de administradores:
// - Negocio nuevo: con el código de alta (lo entrega el dueño de la plataforma).
// - Unirme a un negocio: con el código de registro de ese negocio (Más › Configuración).
export default function Registro() {
  const navigate = useNavigate()
  const { recargarPerfil } = useAuth()
  const [modo, setModo] = useState('nuevo')
  const [f, setF] = useState({ nombre: '', negocio: '', correo: '', telefono: '', clave: '', repetir: '', codigo: '' })
  const [ver, setVer] = useState(false), [err, setErr] = useState(''), [busy, setBusy] = useState(false), [confirmar, setConfirmar] = useState('')
  const set = k => e => setF({ ...f, [k]: e.target.value })
  const nuevo = modo === 'nuevo'
  async function crear(e) {
    e.preventDefault(); setErr('')
    const correo = f.correo.trim().toLowerCase()
    if (!f.nombre.trim()) return setErr('Escribe tu nombre.')
    if (nuevo && f.negocio.trim().length < 2) return setErr('Escribe el nombre de tu negocio.')
    if (!correoValido(correo)) return setErr('Escribe un correo válido.')
    if (f.clave.length < 8) return setErr('La contraseña debe tener al menos 8 caracteres.')
    if (f.clave !== f.repetir) return setErr('Las contraseñas no coinciden.')
    if (!f.codigo.trim()) return setErr(nuevo ? 'Escribe el código de alta.' : 'Escribe el código de registro del negocio.')
    setBusy(true)
    try {
      const v = await supabase.rpc(nuevo ? 'validar_codigo_alta' : 'validar_codigo_registro', { p_codigo: f.codigo })
      if (v.error) throw faltaScript10(v.error) ? new Error('Falta activar los negocios: ejecuta el script 10 en Supabase.') : v.error
      if (!v.data) throw new Error(nuevo ? 'El código de alta no es correcto.' : 'El código de registro no es correcto. Pídeselo al administrador del negocio.')
      const datos = { nombre: f.nombre.trim(), telefono: f.telefono.trim(), modo, ...(nuevo ? { negocio: f.negocio.trim() } : {}) }
      const s = await supabase.auth.signUp({ email: correo, password: f.clave, options: { data: datos, emailRedirectTo: window.location.origin + '/login' } })
      if (s.error) throw /registered|exists/i.test(s.error.message || '') ? new Error('Ese correo ya tiene una cuenta. Entra como administrador o usa «¿Olvidaste tu contraseña?».') : s.error
      if (s.data.user && !s.data.user.identities?.length) throw new Error('Ese correo ya tiene una cuenta. Entra como administrador o usa «¿Olvidaste tu contraseña?».')
      if (!s.data.session) { setConfirmar(correo); return }
      await completarRegistro({ modo, ...f })
      try { localStorage.setItem('angie:login-tipo', 'admin') } catch { /* preferencia opcional */ }
      await recargarPerfil(); toast(nuevo ? 'Negocio creado' : 'Cuenta de administrador creada'); navigate('/', { replace: true })
    } catch (e2) { setErr(e2?.message && !e2.code ? e2.message : mensajeError(e2)) }
    finally { setBusy(false) }
  }
  const campo = (k, icon, props) => <div className="login-input"><Icon name={icon} /><input className="inp" value={f[k]} onChange={set(k)} {...props} /></div>
  const cambiarModo = m => { setModo(m); setErr(''); setF({ ...f, codigo: '' }) }
  return <main className="login-screen login-cinematic register-screen"><div className="login-layout">
    <div className="register-top"><button type="button" className="login-theme" aria-label="Volver" onClick={() => navigate('/login')}><Icon name="back" /></button><Brand compact /></div>
    {confirmar ? <section className="login-form">
      <div className="login-heading"><div><span className="premium-eyebrow">CASI LISTO</span><h2>Confirma tu correo</h2></div></div>
      <p className="register-note">Te enviamos un enlace a <b>{confirmar}</b>. Ábrelo, luego entra como <b>Administrador</b> y escribe otra vez el código para terminar.</p>
      <button type="button" className="btn full login-submit" onClick={() => navigate('/login')}><span>Ir a iniciar sesión</span><Icon name="arrow" className="w-4 h-4" /></button>
    </section> : <form className="login-form" onSubmit={crear} noValidate>
      <div className="login-role" role="tablist" aria-label="Tipo de registro">
        <button type="button" role="tab" aria-selected={nuevo} className={nuevo ? 'on' : ''} onClick={() => cambiarModo('nuevo')}><Icon name="home" />Negocio nuevo</button>
        <button type="button" role="tab" aria-selected={!nuevo} className={!nuevo ? 'on' : ''} onClick={() => cambiarModo('unirme')}><Icon name="users" />Unirme a uno</button>
      </div>
      <div className="login-heading"><div><span className="premium-eyebrow">{nuevo ? 'NEGOCIO NUEVO' : 'NUEVO ADMINISTRADOR'}</span><h2>{nuevo ? 'Crea tu negocio' : 'Crea tu cuenta'}</h2></div></div>
      <p className="register-note">{nuevo
        ? <>Tendrás tu propio inventario, clientes y facturas, separados de otros negocios. Necesitas el <b>código de alta</b>.</>
        : <>Para administradores de un negocio que ya existe. Pide el <b>código de registro</b> a quien lo administra. Los vendedores los crea el administrador desde <b>Empleados</b>.</>}</p>
      {err && <div role="alert" className="bg-badbg text-bad rounded-xl p-3 text-sm mb-3">{err}</div>}
      {nuevo && campo('negocio', 'home', { placeholder: 'Nombre del negocio', autoComplete: 'organization' })}
      {campo('nombre', 'users', { placeholder: 'Tu nombre completo', autoComplete: 'name' })}
      {campo('correo', 'mail', { type: 'email', placeholder: 'Correo electrónico', autoComplete: 'username', autoCapitalize: 'none' })}
      {campo('telefono', 'phone', { type: 'tel', inputMode: 'tel', placeholder: 'Teléfono (opcional)', autoComplete: 'tel' })}
      <div className="login-input password-field"><Icon name="lock" /><input className="inp" type={ver ? 'text' : 'password'} placeholder="Contraseña (mínimo 8)" autoComplete="new-password" value={f.clave} onChange={set('clave')} /><button type="button" aria-label={ver ? 'Ocultar contraseña' : 'Mostrar contraseña'} onClick={() => setVer(!ver)}><Icon name="eye" /></button></div>
      {campo('repetir', 'lock', { type: ver ? 'text' : 'password', placeholder: 'Repite la contraseña', autoComplete: 'new-password' })}
      {campo('codigo', 'shield', { placeholder: nuevo ? 'Código de alta' : 'Código de registro del negocio', autoComplete: 'off', autoCapitalize: 'characters' })}
      <button className="btn full login-submit" disabled={busy}><span>{busy ? 'Creando…' : nuevo ? 'Crear negocio' : 'Crear cuenta'}</span><Icon name="arrow" className="w-4 h-4" /></button>
      <button type="button" className="login-register" onClick={() => navigate('/login')}>¿Ya tienes cuenta? <b>Inicia sesión</b></button>
    </form>}
  </div></main>
}
