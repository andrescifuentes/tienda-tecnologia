import { useLocation, useNavigate } from 'react-router-dom'
import { Icon } from './Icons'
import { useAuth } from '../context/AuthContext'

const ADMIN = [
  { to: '/', icon: 'home', label: 'Inicio' },
  { to: '/inventario', icon: 'box', label: 'Inventario' },
  { to: '/vender', icon: 'cart', label: 'Vender' },
  { to: '/facturas', icon: 'doc', label: 'Facturas' },
  { to: '/mas', icon: 'menu', label: 'Más' },
]
const VENDEDOR = [
  { to: '/', icon: 'home', label: 'Mis ventas' },
  { to: '/vender', icon: 'cart', label: 'Vender' },
  { to: '/inventario', icon: 'box', label: 'Productos' },
  { to: '/clientes', icon: 'users', label: 'Clientes' },
  { to: '/mas', icon: 'menu', label: 'Más' },
]

export default function BottomNav() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { esAdmin } = useAuth()
  const tabs = esAdmin ? ADMIN : VENDEDOR
  return (
    <nav className="nav">
      {tabs.map((t) => {
        const on = t.to === '/' ? pathname === '/' : pathname.startsWith(t.to)
        return <button key={t.to} className={on ? 'on' : ''} onClick={() => navigate(t.to)}><Icon name={t.icon} />{t.label}</button>
      })}
    </nav>
  )
}
