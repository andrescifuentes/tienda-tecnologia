import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import ProfileDialog from '../components/ProfileDialog'
import AppShell from '../components/AppShell'
import { AnimatedCard } from '../components/TechVisuals'
import { Icon } from '../components/Icons'
import { useAuth } from '../context/AuthContext'

export default function Mas() {
  const { perfil, esAdmin, can, salir, tienda } = useAuth()
  const [profileOpen,setProfileOpen] = useState(false)
  const navigate = useNavigate()
  const items = [
    esAdmin && { to: '/empleados', icon: 'users', t: 'Empleados', s: 'Crear vendedores, permisos y actividad' },
    can('registrar_compras') && { to: '/proveedores', icon: 'truck', t: 'Proveedores', s: 'Compras, cuentas por pagar' },
    can('ver_finanzas') && { to: '/finanzas', icon: 'cash', t: 'Finanzas', s: 'Ingresos y gastos' },
    esAdmin && { to: '/garantias', icon: 'shield', t: 'Garantías', s: 'Vigentes y reclamos' },
    { to: '/clientes', icon: 'users', t: 'Clientes', s: 'Buscar y registrar' },
    { to: '/facturas', icon: 'doc', t: esAdmin ? 'Facturas' : 'Mis facturas', s: 'Buscar, enviar, reimprimir' },
    { to: '/configuracion', icon: 'shield', t: 'Configuración', s: 'Preferencias y datos locales' },
  ].filter(Boolean)
  return (
    <AppShell title="Más" sub={tienda?.nombre || 'ANGIE TECH'}>
      <div className="card profile-card mb-3">
        <button className="profile-avatar" aria-label="Mi perfil" onClick={()=>setProfileOpen(true)}>{perfil.nombre.slice(0, 1).toUpperCase()}</button>
        <div><p className="m-0 font-bold">{perfil.nombre}</p>
        <p className="m-0 text-sm text-muted">{perfil.correo} · {esAdmin ? 'Administrador' : 'Vendedor'}</p></div>
      </div>
      {[{title:'Gestión del negocio',routes:['/empleados','/proveedores','/finanzas']},{title:'Clientes y ventas',routes:['/garantias','/clientes','/facturas']},{title:'Preferencias',routes:['/configuracion']}].map(group=>items.some(i=>group.routes.includes(i.to))&&<section key={group.title}><h2 className="section-heading">{group.title}</h2><div className="card menu-list mb-3">
        {items.filter(i=>group.routes.includes(i.to)).map((i, index) => (
          <AnimatedCard as="button" type="button" key={i.to} index={index} className="row menu-row" onClick={() => navigate(i.to)}>
            <span className="menu-symbol"><Icon name={i.icon} /></span>
            <div className="flex-1"><p className="m-0 text-sm font-semibold">{i.t}</p><p className="m-0 text-xs text-muted">{i.s}</p></div>
            <span className="text-muted">›</span>
          </AnimatedCard>
        ))}
      </div></section>)}
      {profileOpen&&<ProfileDialog onClose={()=>setProfileOpen(false)}/>}
      <button className="btn sec full" onClick={salir}><Icon name="out" className="w-5 h-5" /> Cerrar sesión</button>
    </AppShell>
  )
}
