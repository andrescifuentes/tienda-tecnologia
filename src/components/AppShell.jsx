import ModuleBanner from './ModuleBanner'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { isDemoMode } from '../lib/supabase'
import { Brand } from './TechVisuals'
import { useAuth } from '../context/AuthContext'
import Notifications, { useNotifications } from './Notifications'
import ProfileDialog from './ProfileDialog'
import BottomNav from './BottomNav'
import { Icon } from './Icons'
import { getTheme, setTheme } from '../lib/theme'
import { useSearchViewport } from '../lib/useSearchViewport'

function Toaster({ lifted = false }) {
  const [msg, setMsg] = useState(null)
  useEffect(() => {
    let t
    const h = (e) => { setMsg(e.detail); clearTimeout(t); t = setTimeout(() => setMsg(null), 2800) }
    window.addEventListener('app-toast', h)
    return () => { window.removeEventListener('app-toast', h); clearTimeout(t) }
  }, [])
  return msg ? createPortal(<div className={'toast' + (lifted ? ' toast-above-cart' : '')} role="status">{msg}</div>, document.body) : null
}

export function ThemeToggle() {
  const [dark, setDark] = useState(() => getTheme() === 'dark')
  useEffect(() => {
    const sync = () => setDark(getTheme() === 'dark')
    window.addEventListener('app-theme-change', sync)
    return () => window.removeEventListener('app-theme-change', sync)
  }, [])
  const toggle = () => setTheme(getTheme() === 'dark' ? 'light' : 'dark')
  return <button onClick={toggle} className="icon-button" aria-label="Cambiar tema"><Icon name={dark ? 'sun' : 'moon'} className="w-5 h-5" /></button>
}

function AvisoConexion() {
  const [offline, setOffline] = useState(typeof navigator !== 'undefined' && navigator.onLine === false)
  useEffect(() => {
    const h = (e) => setOffline(!e.detail), on = () => setOffline(false), off = () => setOffline(true)
    window.addEventListener('app-conexion', h); window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('app-conexion', h); window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  if (!offline) return null
  return createPortal(<div className="net-alert" role="alert"><span><b>Sin conexión</b>Lo que ves puede estar incompleto. No repitas ventas ni pagos hasta reconectar.</span><button type="button" onClick={() => window.location.reload()}>Reintentar</button></div>, document.body)
}

export default function AppShell({ title, sub, onBack, right, footer, homeAside, header, className = '', children }) {
  const deviceRef = useRef(null)
  useSearchViewport(deviceRef)
  const { pathname } = useLocation()
  const navType = useNavigationType()
  const navigate = useNavigate()
  const { perfil } = useAuth()
  const [notificationsOpen,setNotificationsOpen] = useState(false), [profileOpen,setProfileOpen] = useState(false)
  const notifications=useNotifications(pathname === '/'),notices=notifications.items
  const hour = Number(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Bogota',hour:'numeric',hourCycle:'h23'}).format(new Date()))
  const greeting = hour < 12 ? 'Buenos días,' : hour < 18 ? 'Buenas tardes,' : 'Buenas noches,'
  const volver = onBack || (pathname !== '/' ? () => navigate(-1) : null)
  return (
    <div className={'device' + (pathname === '/' ? ' home-experience' : '') + (className ? ' ' + className : '')} ref={deviceRef}>
      {header ? <header className={'top top-custom ' + (navType === 'POP' ? 'page-back' : 'page-fwd')} key={'h' + pathname}>{header}</header> : <header key={'h' + pathname} className={'top page-anim' + (pathname === '/' ? ' top-home' : '')}>

        {pathname === '/' ? <><div className="home-masthead"><Brand compact/><div className="header-controls">{right}{pathname === '/' && <><button className="icon-button" aria-label="Ver notificaciones" onClick={() => {notifications.retry();setNotificationsOpen(true)}}><Icon name="bell" className="w-5 h-5" />{notices.some(n=>!n.read)&&<span className="notification-count">{notices.filter(n=>!n.read).length}</span>}</button><button className="profile-avatar" aria-label="Mi perfil" onClick={() => setProfileOpen(true)}>{perfil?.nombre?.slice(0,1)}</button></>}<ThemeToggle /></div></div>{(() => { const admin = perfil?.rol === 'admin'; const nombre = perfil?.nombre?.split(' ')[0]; return <ModuleBanner modulo={admin ? 'inicio-admin' : 'inicio-vendedor'} variant="home" eyebrow={greeting.replace(',', '') + (nombre && !/^(administrador|vendedor)$/i.test(nombre) ? ', ' + nombre : '')} title={admin ? 'Administrador' : 'Vendedor'} tagline={admin ? 'Controla tu negocio' : 'Vende de forma rápida'} sub={admin ? 'Inventario, ventas y gestión en un solo lugar' : 'Encuentra productos y atiende a tus clientes fácilmente'}>{homeAside}</ModuleBanner> })()}</> : (<div className="top-inner">
          {volver && <button onClick={volver} className="icon-button" aria-label="Volver"><Icon name="back" className="w-5 h-5" /></button>}
          <div className="top-title">
            <Brand compact />
            {pathname !== '/' && <h1>{title}</h1>}
            {sub && <p className="sub">{sub}</p>}
          </div>
          <div className="header-controls">{right}{pathname === '/' && <><button className="icon-button" aria-label="Ver notificaciones" onClick={() => {notifications.retry();setNotificationsOpen(true)}}><Icon name="bell" className="w-5 h-5" />{notices.some(n=>!n.read)&&<span className="notification-count">{notices.filter(n=>!n.read).length}</span>}</button><button className="profile-avatar" aria-label="Mi perfil" onClick={() => setProfileOpen(true)}>{perfil?.nombre?.slice(0,1)}</button></>}<ThemeToggle /></div>
        </div>)}
      </header>}
      {isDemoMode && <div className="demo-banner" role="status"><span>{pathname === '/' ? 'DEMO LOCAL' : 'DEMO LOCAL · Datos ficticios'}</span><span>{pathname === '/' ? 'Guardado aquí' : 'Guardado en este dispositivo'}</span></div>}
      <main className="view"><div className={'page-content ' + (navType === 'POP' ? 'page-back' : 'page-fwd')} key={pathname}>{children}</div></main>
      {footer && <div className="app-footer">{footer}</div>}
      {notificationsOpen&&<Notifications items={notices} error={notifications.error} loading={notifications.loading} markRead={notifications.markRead} onRetry={notifications.retry} onClose={()=>setNotificationsOpen(false)} />}
      {profileOpen&&<ProfileDialog onClose={()=>setProfileOpen(false)} />}
      <BottomNav />
      <AvisoConexion />
      <Toaster lifted={!!footer} />
    </div>
  )
}
