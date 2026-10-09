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
    { to: '/clientes', icon: 'users', t: 'Clientes', s: 'Buscar y registrar' },
    { to: '/facturas', icon: 'doc', t: esAdmin ? 'Facturas' : 'Mis facturas', s: 'Buscar, enviar, reimprimir' },
    { to: '/configuracion', icon: 'shield', t: 'Configuración', s: 'Preferencias y datos locales' },
  ].filter(Boolean)
  return (
    <div className="admin-premium admin-hub"><AppShell title="Más" sub={tienda?.nombre || 'ANGIE TECH'}>
      <button className="admin-profile profile-card" aria-label="Mi perfil" onClick={()=>setProfileOpen(true)}>
        <span className="profile-avatar">{perfil.nombre.slice(0, 1).toUpperCase()}</span>
        <span className="admin-profile-copy"><strong>{perfil.nombre}</strong><small className="admin-role">{esAdmin ? 'Administrador' : 'Vendedor'}</small><small>{perfil.correo}</small></span><span className="admin-chevron" aria-hidden="true">›</span>
      </button>
      {[{title:'Gestión del negocio',routes:['/empleados','/proveedores','/finanzas']},{title:'Operación',routes:['/garantias','/clientes','/facturas']},{title:'Sistema',routes:['/configuracion']}].map(group=>items.some(i=>group.routes.includes(i.to))&&<section key={group.title}><h2 className="admin-group-title">{group.title}</h2><div className="card menu-list mb-3">
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
    </AppShell></div>
  )
}
