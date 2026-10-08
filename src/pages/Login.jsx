import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAction } from '../lib/useAction'
import { useAuth } from '../context/AuthContext'
import { mensajeError } from '../lib/format'
import { Brand } from '../components/TechVisuals'
import { Icon } from '../components/Icons'
import Modal from '../components/Modal'
import photo from '../assets/photography/login.jpg'
import { isDemoMode } from '../lib/supabase'
import { DEMO_PASSWORD, DEMO_ACCOUNTS } from '../lib/demo/seed'

function rememberedEmail() { try { return localStorage.getItem('angie:remember-email') || '' } catch { return '' } }
export default function Login() {
  const { session, entrar, loading } = useAuth()
  const [correo, setCorreo] = useState(isDemoMode ? 'admin@angietech.demo' : rememberedEmail())
  const [clave, setClave] = useState(isDemoMode ? DEMO_PASSWORD : '')
  const [visible, setVisible] = useState(false)
  const [remember, setRemember] = useState(Boolean(rememberedEmail()))
  const [roles, setRoles] = useState(false)
  const [help, setHelp] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [acceder] = useAction(accederImpl, () => setBusy(false))
  if (!loading && session) return <Navigate to="/" replace />
  async function accederImpl(email = correo, password = clave) {
    setErr(''); setBusy(true)
    const { error } = await entrar(email, password)
    setBusy(false)
    if (error) return setErr(mensajeError(error))
    try { if (remember) localStorage.setItem('angie:remember-email', email); else localStorage.removeItem('angie:remember-email') } catch { /* email preference only */ }
  }
  return <main className="login-screen login-editorial"><div className="login-layout">
    <div className="login-brand"><Brand /><p>TU ALIADO TECNOLÓGICO</p></div>
    <div className="login-hero"><img className="login-photo" src={photo} alt="Tecnología ANGIE TECH: teléfonos, computador y accesorios" fetchPriority="high" /><div className="login-photo-copy"><span>GESTIÓN SIN LÍMITES</span><p>Tu negocio.<br/><em>Siempre contigo.</em></p></div></div>
    <form onSubmit={e => { e.preventDefault(); acceder() }} className="login-form">
      <div className="login-heading"><span className="premium-eyebrow">TU ESPACIO DE TRABAJO</span><h1>Bienvenido</h1><p className="login-intro">Administra Angie Tech.</p></div>
      {err && <div role="alert" className="bg-badbg text-bad rounded-xl p-3 text-sm mb-3">{err}</div>}
      <label className="sr-only" htmlFor="login-email">Correo</label>
      <div className="login-input"><Icon name="mail" /><input id="login-email" className="inp" type="email" placeholder="Correo electrónico" autoComplete="username" autoCapitalize="none" value={correo} onChange={e => setCorreo(e.target.value)} required /></div>
      <label className="sr-only" htmlFor="login-password">Contraseña</label>
      <div className="login-input password-field"><Icon name="lock" /><input id="login-password" className="inp" type={visible ? 'text' : 'password'} placeholder="Contraseña" autoComplete="current-password" value={clave} onChange={e => setClave(e.target.value)} required /><button type="button" aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={visible} onClick={() => setVisible(!visible)}><Icon name="eye" /><span className="sr-only">{visible ? 'Ocultar' : 'Ver'}</span></button></div>
      <div className="login-options"><label><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />Recordarme</label><button type="button" onClick={() => setHelp(true)}>¿Olvidaste tu contraseña?</button></div>
      <button className="btn full" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}<Icon name="arrow" className="w-4 h-4" /></button>
      {isDemoMode && <div className="demo-access"><button type="button" className="demo-entry" disabled={busy} onClick={() => acceder(correo, DEMO_PASSWORD)}><span><b>MODO DEMO</b><small>Explorar con datos locales</small></span><Icon name="arrow" /></button><button type="button" className="demo-roles" aria-label="Cambiar perfil demo" aria-expanded={roles} onClick={() => setRoles(!roles)}><Icon name="users" /><span className="sr-only">Probar como {DEMO_ACCOUNTS.find(a => a[2] === correo)?.[1] || 'Administrador'} · Cambiar</span></button>{roles && <><label className="sr-only" htmlFor="demo-account">Probar como</label><select id="demo-account" className="inp" value={correo} onChange={e => { setCorreo(e.target.value); setClave(DEMO_PASSWORD) }}>{DEMO_ACCOUNTS.map(a => <option key={a[0]} value={a[2]}>{a[1]} · {a[3] === 'admin' ? 'Administrador' : 'Vendedor'}</option>)}</select></>}</div>}
      <p className="login-help">Acceso exclusivo para tu equipo</p>
    </form>
    {help && <Modal title="Recuperar acceso" onClose={() => setHelp(false)}><p className="text-sm">{isDemoMode ? 'En la demo usa la contraseña ' + DEMO_PASSWORD + '. Puedes elegir un perfil desde «Cambiar».' : 'Pídele al administrador que restablezca tu contraseña.'}</p><p className="text-xs text-muted">Recordarme conserva tu correo en este dispositivo; la contraseña nunca se guarda en esta preferencia.</p></Modal>}
  </div></main>
}

