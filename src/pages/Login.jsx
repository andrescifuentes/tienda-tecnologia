import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
import { getTheme, setTheme } from '../lib/theme'
import '../styles/login-cinematic.css'

// Only this login frame follows Safari's visible viewport; shared keyboard
// handling in the application and its modals remains untouched.
function useLoginViewport(ref) {
  useLayoutEffect(()=>{
    const viewport=window.visualViewport, element=ref.current
    if (!viewport || !element) return
    let baseline=Math.max(innerHeight,viewport.height), frame
    const fit=()=>{
      const keyboard=baseline-viewport.height>Math.max(120,baseline*.15)&&Math.abs(viewport.scale-1)<.05
      element.classList.toggle('login-keyboard',keyboard)
      element.style.setProperty('--login-viewport-height',`${viewport.height}px`)
      element.style.setProperty('--login-viewport-top',`${viewport.offsetTop}px`)
      if (!keyboard && Math.abs(viewport.scale-1)<.05) baseline=Math.max(innerHeight,viewport.height)
      cancelAnimationFrame(frame)
      frame=requestAnimationFrame(()=>{
        const input=document.activeElement
        if (!keyboard || !element.contains(input) || !input.matches('input')) return
        const bounds=element.getBoundingClientRect(),field=input.getBoundingClientRect()
        const delta=field.bottom>bounds.bottom-12?field.bottom-bounds.bottom+12:field.top<bounds.top+12?field.top-bounds.top-12:0
        if (delta) element.scrollBy({top:delta,behavior:'instant'})
      })
    }
    const orientation=()=>{baseline=Math.max(innerHeight,document.documentElement.clientHeight,viewport.height);fit()}
    fit();viewport.addEventListener('resize',fit);viewport.addEventListener('scroll',fit);element.addEventListener('focusin',fit);window.addEventListener('orientationchange',orientation)
    return()=>{cancelAnimationFrame(frame);viewport.removeEventListener('resize',fit);viewport.removeEventListener('scroll',fit);element.removeEventListener('focusin',fit);window.removeEventListener('orientationchange',orientation)}
  },[ref])
}

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
  const screenRef = useRef(null)
  const [theme, setLocalTheme] = useState(getTheme())
  useEffect(()=>{
    const sync=()=>setLocalTheme(getTheme())
    window.addEventListener('app-theme-change',sync)
    return()=>window.removeEventListener('app-theme-change',sync)
  },[])
  useLoginViewport(screenRef)
  const [acceder] = useAction(accederImpl, () => setBusy(false))
  if (!loading && session) return <Navigate to="/" replace />
  async function accederImpl(email = correo, password = clave) {
    setErr(''); setBusy(true)
    const { error } = await entrar(email, password)
    setBusy(false)
    if (error) return setErr(mensajeError(error))
    try { if (remember) localStorage.setItem('angie:remember-email', email); else localStorage.removeItem('angie:remember-email') } catch { /* email preference only */ }
  }
  return <main ref={screenRef} className="login-screen login-cinematic"><div className="login-layout">
    <section className="login-hero" aria-labelledby="login-headline">
      <img className="login-photo" src={photo} alt="Tecnología ANGIE TECH: teléfonos, computador y accesorios" fetchPriority="high" />
      <div className="login-ambient" aria-hidden="true"/>
      <div className="login-masthead"><div className="login-brand"><Brand /><p>TU ALIADO TECNOLÓGICO</p></div><button type="button" className="login-theme" aria-label="Cambiar tema" onClick={()=>{const next=getTheme()==='dark'?'light':'dark';setTheme(next);setLocalTheme(next)}}><Icon name={theme==='dark'?'sun':'moon'}/></button></div>
      <div className="login-story"><span className="login-kicker">TECNOLOGÍA QUE TE IMPULSA</span><h1 id="login-headline"><span>Tu negocio.</span><em>Siempre contigo.</em></h1><p>Todo tu equipo. Una sola conexión.</p></div>
      <span className="login-scene-index" aria-hidden="true">ANGIE / 01</span>
    </section>
    <form onSubmit={e => { e.preventDefault(); acceder() }} className="login-form">
      <div className="login-heading"><div><span className="premium-eyebrow">TU ESPACIO PRIVADO</span><h2>Entra a tu negocio</h2></div><span className="login-access-mark" aria-hidden="true"><Icon name="arrow"/></span></div>
      {err && <div role="alert" className="bg-badbg text-bad rounded-xl p-3 text-sm mb-3">{err}</div>}
      <label className="sr-only" htmlFor="login-email">Correo</label>
      <div className="login-input"><Icon name="mail" /><input id="login-email" className="inp" type="email" placeholder="Correo electrónico" autoComplete="username" autoCapitalize="none" value={correo} onChange={e => setCorreo(e.target.value)} required /></div>
      <label className="sr-only" htmlFor="login-password">Contraseña</label>
      <div className="login-input password-field"><Icon name="lock" /><input id="login-password" className="inp" type={visible ? 'text' : 'password'} placeholder="Contraseña" autoComplete="current-password" value={clave} onChange={e => setClave(e.target.value)} required /><button type="button" aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={visible} onClick={() => setVisible(!visible)}><Icon name="eye" /><span className="sr-only">{visible ? 'Ocultar' : 'Ver'}</span></button></div>
      <div className="login-options"><label><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />Recordarme</label><button type="button" onClick={() => setHelp(true)}>¿Olvidaste tu contraseña?</button></div>
      <button className="btn full login-submit" disabled={busy} onPointerDown={e=>e.currentTarget.setAttribute('data-pressed','true')} onPointerUp={e=>e.currentTarget.removeAttribute('data-pressed')} onPointerCancel={e=>e.currentTarget.removeAttribute('data-pressed')} onPointerLeave={e=>e.currentTarget.removeAttribute('data-pressed')} onBlur={e=>e.currentTarget.removeAttribute('data-pressed')}><span>{busy ? 'Entrando…' : 'Entrar'}</span><Icon name="arrow" className="w-4 h-4" /></button>
      {isDemoMode && <div className="demo-access"><button type="button" className="demo-entry" disabled={busy} onClick={() => acceder(correo, DEMO_PASSWORD)}><span><b>Explorar demo</b><small>Datos locales · Sin conexión</small></span><Icon name="arrow" /></button><button type="button" className="demo-roles" aria-label="Cambiar perfil demo" aria-expanded={roles} onClick={() => setRoles(!roles)}><Icon name="users" /><span className="sr-only">Probar como {DEMO_ACCOUNTS.find(a => a[2] === correo)?.[1] || 'Administrador'} · Cambiar</span></button>{roles && <><label className="sr-only" htmlFor="demo-account">Probar como</label><select id="demo-account" className="inp" value={correo} onChange={e => { setCorreo(e.target.value); setClave(DEMO_PASSWORD) }}>{DEMO_ACCOUNTS.map(a => <option key={a[0]} value={a[2]}>{a[1]} · {a[3] === 'admin' ? 'Administrador' : 'Vendedor'}</option>)}</select></>}</div>}
      <p className="login-help"><Icon name="shield"/>Acceso exclusivo para tu equipo</p>
    </form>
    {help && <Modal title="Recuperar acceso" onClose={() => setHelp(false)}><p className="text-sm">{isDemoMode ? 'En la demo usa la contraseña ' + DEMO_PASSWORD + '. Puedes elegir un perfil desde «Cambiar».' : 'Pídele al administrador que restablezca tu contraseña.'}</p><p className="text-xs text-muted">Recordarme conserva tu correo en este dispositivo; la contraseña nunca se guarda en esta preferencia.</p></Modal>}
  </div></main>
}

