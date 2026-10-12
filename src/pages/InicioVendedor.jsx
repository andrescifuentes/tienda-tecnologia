import { lazy, Suspense, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppShell, { ThemeToggle } from '../components/AppShell'
import { Brand } from '../components/TechVisuals'
import { Icon } from '../components/Icons'
import ProfileDialog from '../components/ProfileDialog'
import { Empty, ErrorBox, Loader } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { useDemoRevision } from '../lib/demo/useDemoRevision'
import { cargarInicioVendedor } from '../lib/sellerHome'
import { money, numFactura, fechaHora, mensajeError } from '../lib/format'
import '../styles/seller-home.css'

const FacturaDetalle = lazy(() => import('../components/FacturaDetalle'))
const PERIODOS = [['hoy', 'Hoy'], ['semana', 'Esta semana'], ['mes', 'Este mes']]
const Chevron = () => <Icon name="back" className="seller-chevron" />

export default function InicioVendedor() {
  const { perfil, can } = useAuth()
  const navigate = useNavigate()
  const revision = useDemoRevision()
  const [periodo, setPeriodo] = useState('hoy')
  const [datos, setDatos] = useState(null), [err, setErr] = useState('')
  const [perfilAbierto, setPerfilAbierto] = useState(false), [factura, setFactura] = useState(null), [tick, setTick] = useState(0)
  useEffect(() => {
    let active = true
    setDatos(null); setErr('')
    cargarInicioVendedor(supabase, perfil.id, periodo).then(data => {
      if (active) setDatos(data)
    }).catch(error => { if (active) setErr(mensajeError(error)) })
    return () => { active = false }
  }, [perfil.id, periodo, revision, tick])

  const header = <div className="seller-header">
    <div className="seller-masthead"><Brand compact /><div className="seller-controls">
      <button type="button" className="profile-avatar" aria-label="Mi perfil" onClick={() => setPerfilAbierto(true)}>{perfil.nombre?.trim().slice(0, 1)}</button><ThemeToggle />
    </div></div>
    <div className="seller-heading"><h1>Vendedor</h1><p>{perfil.nombre}</p></div>
  </div>
  const acciones = [
    { to: '/vender', label: 'Nueva venta', icon: 'cart', allowed: can('vender') },
    { to: '/inventario', label: 'Productos', icon: 'box', allowed: can('ver_inventario') },
    { to: '/facturas', label: 'Facturas', icon: 'doc', allowed: true },
  ]
  return <AppShell title="Vendedor" header={header} className="seller-home">
    <div className="seller-quick" aria-label="Accesos rápidos">
      {acciones.map(a => <button type="button" key={a.to} disabled={!a.allowed} onClick={() => navigate(a.to)} className={a.to === '/vender' ? 'primary' : ''}><span><Icon name={a.icon} /></span>{a.label}</button>)}
    </div>
    <section className="seller-sales" aria-labelledby="seller-sales-title" aria-busy={!datos && !err}>
      <div className="seller-sales-heading"><h2 id="seller-sales-title">Mis ventas</h2>
        <label className="seller-period"><span>{PERIODOS.find(([key]) => key === periodo)[1]}</span><Chevron />
          <select aria-label="Período de mis ventas" value={periodo} onChange={e => setPeriodo(e.target.value)}>{PERIODOS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        </label>
      </div>
      <ErrorBox text={err} />
      {!datos && !err ? <Loader /> : datos && <>
        <p className="seller-total-label">Total vendido</p>
        <p className={'seller-total' + (money(datos.total).length > 14 ? ' compact' : '')}>{money(datos.total)}</p>
        <div className="seller-comparison">{datos.variacion == null ? <span className="seller-no-comparison">Sin período anterior para comparar</span> : <>
          <span className={'seller-delta ' + (datos.variacion > 0 ? 'positive' : datos.variacion < 0 ? 'negative' : 'neutral')}><Icon name="arrow" />{datos.variacion > 0 ? '+' : ''}{datos.variacion}%</span>
          <span>{datos.rango.comparacion}{datos.rango.nota && <small>{datos.rango.nota}</small>}</span>
        </>}</div>
        <p className="seller-count"><Icon name="doc" /><span><b>{datos.facturas}</b> {datos.facturas === 1 ? 'factura realizada' : 'facturas realizadas'}</span><span className="seller-count-mark" aria-hidden="true" /></p>
      </>}
    </section>
    <section className="seller-recent" aria-labelledby="seller-recent-title">
      <div className="seller-section-heading"><h2 id="seller-recent-title">Mis últimas facturas</h2><button type="button" onClick={() => navigate('/facturas')}>Ver todas <Chevron /></button></div>
      {datos ? datos.ultimas.length ? <div className="seller-invoices activity-list">{datos.ultimas.map(f => <button type="button" key={f.id} className="seller-invoice" onClick={() => setFactura(f.id)}>
        <span className="seller-invoice-main"><b>{numFactura(f)}</b><span>{f.clientes?.nombre || 'Consumidor final'}</span><small>{fechaHora(f.fecha)}</small></span>
        <span className="seller-invoice-side"><strong>{money(f.total)}</strong><span className={'seller-status ' + (f.estado === 'emitida' ? 'issued' : f.estado === 'anulada' ? 'cancelled' : '')}>{f.estado === 'emitida' ? 'Emitida' : f.estado === 'anulada' ? 'Anulada' : f.estado === 'pendiente' ? 'Pendiente' : f.estado}</span></span><Chevron />
      </button>)}</div> : <Empty text="Aún no tienes facturas" description="Tu próxima venta aparecerá aquí." /> : null}
    </section>
    {perfilAbierto && <ProfileDialog onClose={() => setPerfilAbierto(false)} />}
    {factura && <Suspense fallback={<Loader />}><FacturaDetalle id={factura} onClose={() => setFactura(null)} onCambio={() => setTick(t => t + 1)} /></Suspense>}
  </AppShell>
}
