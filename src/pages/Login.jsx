import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAction } from '../lib/useAction'
import { useAuth } from '../context/AuthContext'
import { mensajeError } from '../lib/format'
import { Brand } from '../components/TechVisuals'
import { negocioRecordado } from '../lib/marca'
import { Icon } from '../components/Icons'
import Modal from '../components/Modal'
import photo from '../assets/photography/login.jpg'
import { isDemoMode, supabase } from '../lib/supabase'
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
  const { session, entrar, salir, loading, authError, reintentarSesion } = useAuth()
  const navigate = useNavigate()
  // Dos accesos: administrador y vendedor. Se recuerda el último usado en este dispositivo.
  const [tipo, setTipoState] = useState(() => { try { return localStorage.getItem('angie:login-tipo') === 'vendedor' ? 'vendedor' : 'admin' } catch { return 'admin' } })
  const setTipo = value => { setTipoState(value); setErr(''); try { localStorage.setItem('angie:login-tipo', value) } catch { /* preferencia opcional */ } }
  const [verificando, setVerificando] = useState(false)
  // Mientras se crea la contraseña con el código, la sesión temporal no debe sacar al usuario del formulario
  const [recuperando, setRecuperando] = useState(false)
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
  if (!loading && session && !verificando && !recuperando) return <Navigate to="/" replace />
  async function accederImpl(email = correo, password = clave) {
    setErr(''); setBusy(true); setVerificando(true)
    const { data, error } = await entrar(email, password)
    if (error) { setBusy(false); setVerificando(false); return setErr(mensajeError(error)) }
    // Cada cuenta entra por su acceso: el vendedor no usa el acceso de administrador y viceversa
    if (!isDemoMode) {
      const { data: p } = await supabase.from('perfiles').select('rol').eq('id', data.user.id).maybeSingle()
      const rol = p?.rol
      if (rol && rol !== tipo) {
        await salir(); setBusy(false); setVerificando(false)
        return setErr(rol === 'admin' ? 'Esta cuenta es de administrador. Entra por «Administrador».' : 'Esta cuenta es de vendedor. Entra por «Vendedor».')
      }
      if (!rol && tipo === 'vendedor') {
        await salir(); setBusy(false); setVerificando(false)
        return setErr('Tu usuario no tiene un perfil de vendedor. Habla con el administrador.')
      }
    }
    setBusy(false); setVerificando(false)
    try { if (remember) localStorage.setItem('angie:remember-email', email); else localStorage.removeItem('angie:remember-email') } catch { /* email preference only */ }
  }
  return <main ref={screenRef} className="login-screen login-cinematic"><div className="login-layout">
    <section className="login-hero" aria-labelledby="login-headline">
      <img className="login-photo" src={photo} alt="Tecnología: teléfonos, computador y accesorios" fetchpriority="high" />
      <div className="login-ambient" aria-hidden="true"/>
      <div className="login-masthead"><div className="login-brand"><Brand /><p>TU ALIADO TECNOLÓGICO</p></div><button type="button" className="login-theme" aria-label="Cambiar tema" onClick={()=>{const next=getTheme()==='dark'?'light':'dark';setTheme(next);setLocalTheme(next)}}><Icon name={theme==='dark'?'sun':'moon'}/></button></div>
      <div className="login-story"><span className="login-kicker">TECNOLOGÍA QUE TE IMPULSA</span><h1 id="login-headline"><span>Tu negocio.</span><em>Siempre contigo.</em></h1><p>Todo tu equipo. Una sola conexión.</p></div>
      <span className="login-scene-index" aria-hidden="true">{(negocioRecordado()?.nombre || 'Angie').split(' ')[0].toUpperCase()} / 01</span>
    </section>
    <form onSubmit={e => { e.preventDefault(); acceder() }} className="login-form">
      <div className="login-role" role="tablist" aria-label="Tipo de acceso">
        <button type="button" role="tab" aria-selected={tipo === 'admin'} className={tipo === 'admin' ? 'on' : ''} onClick={() => setTipo('admin')}><Icon name="shield" />Administrador</button>
        <button type="button" role="tab" aria-selected={tipo === 'vendedor'} className={tipo === 'vendedor' ? 'on' : ''} onClick={() => setTipo('vendedor')}><Icon name="users" />Vendedor</button>
      </div>
      <div className="login-heading"><div><span className="premium-eyebrow">{tipo === 'admin' ? 'ACCESO ADMINISTRADOR' : 'ACCESO VENDEDOR'}</span><h2>{tipo === 'admin' ? 'Entra a tu negocio' : 'Entra a vender'}</h2></div><span className="login-access-mark" aria-hidden="true"><Icon name="arrow"/></span></div>
      {authError && <div className="mb-3"><p role="alert" className="text-bad text-sm">{authError}</p><button type="button" className="btn sec full" onClick={reintentarSesion}>Reintentar conexión</button></div>}
      {err && <div role="alert" className="bg-badbg text-bad rounded-xl p-3 text-sm mb-3">{err}</div>}
      <label className="sr-only" htmlFor="login-email">Correo</label>
      <div className="login-input"><Icon name="mail" /><input id="login-email" className="inp" type="email" placeholder="Correo electrónico" autoComplete="username" autoCapitalize="none" value={correo} onChange={e => setCorreo(e.target.value)} required /></div>
      <label className="sr-only" htmlFor="login-password">Contraseña</label>
      <div className="login-input password-field"><Icon name="lock" /><input id="login-password" className="inp" type={visible ? 'text' : 'password'} placeholder="Contraseña" autoComplete="current-password" value={clave} onChange={e => setClave(e.target.value)} required /><button type="button" aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={visible} onClick={() => setVisible(!visible)}><Icon name="eye" /><span className="sr-only">{visible ? 'Ocultar' : 'Ver'}</span></button></div>
      <div className="login-options"><label><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />Recordarme</label><button type="button" onClick={() => setHelp(true)}>{tipo === 'admin' ? '¿Olvidaste tu contraseña?' : '¿Olvidaste tu acceso?'}</button></div>
      <button className="btn full login-submit" disabled={busy} onPointerDown={e=>e.currentTarget.setAttribute('data-pressed','true')} onPointerUp={e=>e.currentTarget.removeAttribute('data-pressed')} onPointerCancel={e=>e.currentTarget.removeAttribute('data-pressed')} onPointerLeave={e=>e.currentTarget.removeAttribute('data-pressed')} onBlur={e=>e.currentTarget.removeAttribute('data-pressed')}><span>{busy ? 'Entrando…' : 'Entrar'}</span><Icon name="arrow" className="w-4 h-4" /></button>
      {isDemoMode && <div className="demo-access"><button type="button" className="demo-entry" disabled={busy} onClick={() => acceder(correo, DEMO_PASSWORD)}><span><b>Explorar demo</b><small>Datos locales · Sin conexión</small></span><Icon name="arrow" /></button><button type="button" className="demo-roles" aria-label="Cambiar perfil demo" aria-expanded={roles} onClick={() => setRoles(!roles)}><Icon name="users" /><span className="sr-only">Probar como {DEMO_ACCOUNTS.find(a => a[2] === correo)?.[1] || 'Administrador'} · Cambiar</span></button>{roles && <><label className="sr-only" htmlFor="demo-account">Probar como</label><select id="demo-account" className="inp" value={correo} onChange={e => { setCorreo(e.target.value); setClave(DEMO_PASSWORD) }}>{DEMO_ACCOUNTS.map(a => <option key={a[0]} value={a[2]}>{a[1]} · {a[3] === 'admin' ? 'Administrador' : 'Vendedor'}</option>)}</select></>}</div>}
      {tipo === 'admin' && !isDemoMode && <button type="button" className="login-register" onClick={() => navigate('/registro')}>¿Administrador nuevo? <b>Crear cuenta</b></button>}
      <p className="login-help"><Icon name="shield"/>{tipo === 'admin' ? 'Acceso exclusivo para administradores' : 'Tu cuenta la crea el administrador'}</p>
    </form>
    {help && <Modal title="Recuperar acceso" onClose={() => { setHelp(false); setRecuperando(false) }}>{isDemoMode ? <p className="text-sm">En la demo usa la contraseña {DEMO_PASSWORD}. Puedes elegir un perfil desde «Cambiar».</p> : tipo === 'admin' ? <Recuperar correoInicial={correo} onActivo={setRecuperando} onListo={() => { setRecuperando(false); setHelp(false); navigate('/', { replace: true }) }} /> : <p className="text-sm">Si olvidaste tu contraseña o tu correo, pídele al administrador de la tienda que te asigne unos nuevos desde <b>Más › Empleados</b>. Por seguridad, los vendedores no recuperan el acceso por correo.</p>}<p className="text-xs text-muted">Recordarme conserva tu correo en este dispositivo; la contraseña nunca se guarda en esta preferencia.</p></Modal>}
  </div></main>
}

// Recuperación de contraseña por correo: no revela si el correo existe.
function Recuperar({ correoInicial, onListo, onActivo }) {
  const [email, setEmail] = useState(correoInicial || '')
  const [estado, setEstado] = useState(''), [error, setError] = useState('')
  async function enviar(e) {
    e?.preventDefault(); setError('')
    const limpio = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpio)) return setError('Escribe un correo válido.')
    setEstado('enviando')
    const { error: err } = await supabase.auth.resetPasswordForEmail(limpio, { redirectTo: window.location.origin + '/restablecer' })
    if (err && (err.status === 429 || /rate|seconds|limit/i.test(err.message || ''))) { setEstado('enviado'); return setError('Ya pediste un correo hace poco. Usa el código que te llegó o espera un minuto para pedir otro.') }
    if (err) { setEstado(''); return setError('No se pudo enviar el correo. Revisa tu conexión e inténtalo de nuevo.') }
    setEstado('enviado')
  }
  if (estado === 'enviado') return <CodigoNuevaClave email={email.trim().toLowerCase()} aviso={error} onActivo={onActivo} onReenviar={() => { setError(''); setEstado('') }} onListo={onListo} />
  return <form onSubmit={enviar} className="grid gap-3" noValidate>
    <p className="text-sm m-0">Escribe el correo con el que entras como administrador. Te enviaremos un correo para crear una contraseña nueva.</p>
    {error && <div role="alert" className="bg-badbg text-bad rounded-xl p-3 text-sm">{error}</div>}
    <input className="inp" type="email" inputMode="email" autoCapitalize="none" autoComplete="username" placeholder="Correo electrónico" value={email} onChange={e => setEmail(e.target.value)} required />
    <button className="btn full" disabled={estado === 'enviando'}>{estado === 'enviando' ? 'Enviando…' : 'Enviar correo'}</button>
  </form>
}

// Paso 2 (como en la app de herrería): el correo trae un código; con él se crea la contraseña
// sin salir de la app (sirve también con la app instalada, donde el enlace abriría el navegador).
function CodigoNuevaClave({ email, aviso, onReenviar, onListo, onActivo }) {
  const [codigo, setCodigo] = useState(''), [p1, setP1] = useState(''), [p2, setP2] = useState(''), [ver, setVer] = useState(false)
  const [error, setError] = useState(aviso || ''), [busy, setBusy] = useState(false), [hecho, setHecho] = useState(false)
  async function guardar(e) {
    e.preventDefault(); setError('')
    const c = codigo.replace(/\D/g, '')
    if (c.length < 6) return setError('Escribe el código que llegó a tu correo.')
    if (p1.length < 8 || !/[A-Za-z]/.test(p1) || !/\d/.test(p1)) return setError('La contraseña debe tener mínimo 8 caracteres, con letras y números.')
    if (p1 !== p2) return setError('Las contraseñas no coinciden.')
    setBusy(true); onActivo?.(true)
    try {
      const { error: e1 } = await supabase.auth.verifyOtp({ email, token: c, type: 'recovery' })
      if (e1) { onActivo?.(false); return setError(e1.status === 429 ? 'Demasiados intentos. Espera un momento.' : 'El código no es válido o ya venció. Pide uno nuevo.') }
      // Solo los administradores recuperan por correo; el acceso de un vendedor lo cambia el administrador
      const { data: yo } = await supabase.auth.getUser()
      const { data: pf } = await supabase.from('perfiles').select('rol').eq('id', yo?.user?.id).maybeSingle()
      if (pf?.rol === 'vendedor') { await supabase.auth.signOut(); onActivo?.(false); return setError('Esta cuenta es de vendedor: pídele al administrador que te asigne una contraseña nueva desde Empleados.') }
      const { error: e2 } = await supabase.auth.updateUser({ password: p1 })
      if (e2) return setError(/same|different/i.test(e2.message || '') ? 'La contraseña nueva debe ser distinta a la anterior.' : mensajeError(e2))
      await supabase.auth.signOut({ scope: 'others' }).catch(() => {})
      setHecho(true)
    } catch { setError('No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.') }
    finally { setBusy(false) }
  }
  if (hecho) return <div className="grid gap-3"><p className="text-sm m-0"><b>¡Contraseña actualizada!</b> Ya entraste con tu nueva contraseña.</p><button type="button" className="btn full" onClick={onListo}>Entrar a la app</button></div>
  return <form onSubmit={guardar} className="grid gap-3" noValidate>
    <p className="text-sm m-0">Si <b>{email}</b> es una cuenta de administrador, te llegó un correo (revisa también spam). <b>Toca el enlace del correo</b> y crea ahí tu contraseña nueva. Si el correo trae un <b>código</b>, también puedes escribirlo aquí abajo.</p>
    {error && <div role="alert" className="bg-badbg text-bad rounded-xl p-3 text-sm">{error}</div>}
    <input className="inp" inputMode="numeric" autoComplete="one-time-code" placeholder="Código del correo" value={codigo} onChange={e => setCodigo(e.target.value.replace(/[^\d]/g, '').slice(0, 8))} />
    <input className="inp" type={ver ? 'text' : 'password'} autoComplete="new-password" placeholder="Nueva contraseña" value={p1} onChange={e => setP1(e.target.value)} />
    <input className="inp" type={ver ? 'text' : 'password'} autoComplete="new-password" placeholder="Repite la contraseña" value={p2} onChange={e => setP2(e.target.value)} />
    <label className="text-xs text-muted flex items-center gap-2"><input type="checkbox" checked={ver} onChange={e => setVer(e.target.checked)} />Mostrar contraseña</label>
    <button className="btn full" disabled={busy}>{busy ? 'Guardando…' : 'Guardar contraseña'}</button>
    <button type="button" className="btn sec full" onClick={onReenviar}>No me llegó: enviar otro correo</button>
  </form>
}
