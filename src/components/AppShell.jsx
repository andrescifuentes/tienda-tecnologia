import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import BottomNav from './BottomNav'
import { Icon } from './Icons'

function Toaster() {
  const [msg, setMsg] = useState(null)
  useEffect(() => {
    let t
    const h = (e) => { setMsg(e.detail); clearTimeout(t); t = setTimeout(() => setMsg(null), 2800) }
    window.addEventListener('app-toast', h)
    return () => { window.removeEventListener('app-toast', h); clearTimeout(t) }
  }, [])
  return msg ? createPortal(<div className="toast" role="status">{msg}</div>, document.body) : null
}

export function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.getAttribute('data-theme') === 'dark')
  const toggle = () => {
    const next = dark ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', next)
    try { localStorage.setItem('tema', next) } catch { /* ignore */ }
    setDark(!dark)
  }
  return <button onClick={toggle} className="bg-white/15 border-0 text-white rounded-full w-9 h-9 grid place-items-center cursor-pointer" aria-label="Cambiar tema"><Icon name={dark ? 'sun' : 'moon'} className="w-5 h-5" /></button>
}

export default function AppShell({ title, sub, onBack, right, children }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const volver = onBack || (pathname !== '/' ? () => navigate(-1) : null)
  return (
    <div className="device">
      <header className="top">
        <div className="flex items-center gap-3">
          {volver && <button onClick={volver} className="bg-white/15 border-0 text-white rounded-full w-9 h-9 grid place-items-center cursor-pointer" aria-label="Volver"><Icon name="back" className="w-5 h-5" /></button>}
          <div className="flex-1 min-w-0">
            <h1 className="truncate">{title}</h1>
            {sub && <p className="sub truncate">{sub}</p>}
          </div>
          {right}
          <ThemeToggle />
        </div>
      </header>
      <main className="view">{children}</main>
      <BottomNav />
      <Toaster />
    </div>
  )
}
