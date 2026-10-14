import { useLocation, useNavigate } from 'react-router-dom'
import { Icon } from './Icons'
import { useAuth } from '../context/AuthContext'

const ADMIN = [
  { to: '/', icon: 'home', label: 'Inicio' },
  { to: '/inventario', icon: 'box', label: 'Inventario' },
  { to: '/facturas', icon: 'doc', label: 'Facturas' },
  { to: '/vender', icon: 'cart', label: 'Vender' },
  { to: '/mas', icon: 'menu', label: 'Más' },
]
const VENDEDOR = [
  { to: '/', icon: 'home', label: 'Inicio' },
  { to: '/inventario', icon: 'box', label: 'Inventario', permiso: 'ver_inventario' },
  { to: '/vender', icon: 'cart', label: 'Vender', permiso: 'vender' },
  { to: '/facturas', icon: 'doc', label: 'Facturas' },
  { to: '/clientes', icon: 'users', label: 'Clientes' },
]

export default function BottomNav() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { esAdmin, can } = useAuth()
  const tabs = esAdmin ? ADMIN : VENDEDOR.filter(t => !t.permiso || can(t.permiso))
  return (
    <nav className="nav" aria-label="Navegación principal">
      {tabs.map((t) => {
        const on = t.to === '/' ? pathname === '/' : pathname.startsWith(t.to)
        return <button key={t.to} aria-current={on ? 'page' : undefined} className={on ? 'on' : ''} onClick={() => navigate(t.to)}><Icon name={t.icon} />{t.label}</button>
      })}
    </nav>
  )
}
