import { useNavigate } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { Icon } from '../components/Icons'
import { useAuth } from '../context/AuthContext'

export default function Mas() {
  const { perfil, esAdmin, can, salir, tienda } = useAuth()
  const navigate = useNavigate()
  const items = [
    esAdmin && { to: '/empleados', icon: 'users', t: 'Empleados', s: 'Crear vendedores, permisos y actividad' },
    can('registrar_compras') && { to: '/proveedores', icon: 'truck', t: 'Proveedores', s: 'Compras, cuentas por pagar' },
    can('ver_finanzas') && { to: '/finanzas', icon: 'cash', t: 'Finanzas', s: 'Ingresos y gastos' },
    esAdmin && { to: '/garantias', icon: 'shield', t: 'Garantías', s: 'Vigentes y reclamos' },
    { to: '/clientes', icon: 'users', t: 'Clientes', s: 'Buscar y registrar' },
    { to: '/facturas', icon: 'doc', t: esAdmin ? 'Facturas' : 'Mis facturas', s: 'Buscar, enviar, reimprimir' },
  ].filter(Boolean)
  return (
    <AppShell title="Más" sub={tienda?.nombre || 'TechStore'}>
      <div className="card mb-3">
        <p className="m-0 font-bold">{perfil.nombre}</p>
        <p className="m-0 text-sm text-muted">{perfil.correo} · {esAdmin ? 'Administrador' : 'Vendedor'}</p>
      </div>
      <div className="card !p-2 mb-3">
        {items.map((i) => (
          <div key={i.to} className="row cursor-pointer" onClick={() => navigate(i.to)}>
            <Icon name={i.icon} className="w-6 h-6 text-brand" />
            <div className="flex-1"><p className="m-0 text-sm font-semibold">{i.t}</p><p className="m-0 text-xs text-muted">{i.s}</p></div>
            <span className="text-muted">›</span>
          </div>
        ))}
      </div>
      <button className="btn sec full" onClick={salir}><Icon name="out" className="w-5 h-5" /> Cerrar sesión</button>
    </AppShell>
  )
}
