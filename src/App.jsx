import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import { Loader } from './components/ui'
import Login from './pages/Login'
import Inicio from './pages/Inicio'

const Configuracion = lazy(() => import('./pages/Configuracion'))
const Vender = lazy(() => import('./pages/Vender'))
const Inventario = lazy(() => import('./pages/Inventario'))
const Facturas = lazy(() => import('./pages/Facturas'))
const Clientes = lazy(() => import('./pages/Clientes'))
const Mas = lazy(() => import('./pages/Mas'))
const Empleados = lazy(() => import('./pages/Empleados'))
const Proveedores = lazy(() => import('./pages/Proveedores'))
const Finanzas = lazy(() => import('./pages/Finanzas'))
const Garantias = lazy(() => import('./pages/Garantias'))

function Privada({ children, ...p }) {
  return <ProtectedRoute {...p}><Suspense fallback={<div className="p-10"><Loader /></div>}>{children}</Suspense></ProtectedRoute>
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Privada><Inicio /></Privada>} />
      <Route path="/vender" element={<Privada permiso="vender"><Vender /></Privada>} />
      <Route path="/inventario" element={<Privada permiso="ver_inventario"><Inventario /></Privada>} />
      <Route path="/facturas" element={<Privada><Facturas /></Privada>} />
      <Route path="/clientes" element={<Privada><Clientes /></Privada>} />
      <Route path="/configuracion" element={<Privada><Configuracion /></Privada>} />
      <Route path="/mas" element={<Privada><Mas /></Privada>} />
      <Route path="/empleados" element={<Privada soloAdmin><Empleados /></Privada>} />
      <Route path="/proveedores" element={<Privada permiso="registrar_compras"><Proveedores /></Privada>} />
      <Route path="/finanzas" element={<Privada permiso="ver_finanzas"><Finanzas /></Privada>} />
      <Route path="/garantias" element={<Privada soloAdmin><Garantias /></Privada>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
