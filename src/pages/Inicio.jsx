import SalesPeriodDetail from '../components/SalesPeriodDetail'
import {readFinancialRows} from '../lib/financeQueries'
import '../styles/invoice-message-settings.css'
import FacturaDetalle from '../components/FacturaDetalle'
import EmployeeSales from '../components/EmployeeSales'
import FitAmount from '../components/FitAmount'
import '../styles/team-observations.css'
import InicioVendedor from './InicioVendedor'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDemoRevision } from '../lib/demo/useDemoRevision'
import AppShell from '../components/AppShell'
import Modal from '../components/Modal'
import BusinessDetail from '../components/BusinessDetail'
import { Icon } from '../components/Icons'
import bannerPhoto from '../assets/photography/banner-phone.jpg'
import { Loader, ErrorBox, Empty } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { supabase, isDemoMode } from '../lib/supabase'
import { money, hoyBogota, rangoMes, fechaHora, numFactura, mensajeError } from '../lib/format'

export default function Inicio() {
  const { esAdmin } = useAuth()
  return esAdmin ? <DashboardAdmin /> : <InicioVendedor />
}
const bogotaDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' })

const dayKey = d => bogotaDay.format(d)
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const cap = t => t.charAt(0).toUpperCase() + t.slice(1)
const fechaLarga = () => { const h = hoyBogota(); const w = new Date(h + 'T12:00:00Z').toLocaleDateString('es-CO', { weekday:'long', timeZone:'UTC' }); return `${cap(w)}, ${Number(h.slice(8))} de ${MESES[Number(h.slice(5,7))-1]} de ${h.slice(0,4)}` }
const lastDay = ym => { const [y,m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate() }
const shiftYm = (ym, n) => { const [y,m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0,7) }
const shiftDay = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 864e5).toISOString().slice(0,10)
const pct = (a, b) => b > 0 ? Math.round((a - b) / b * 100) : (a > 0 ? 100 : null)
const bogotaHour = iso => Number(new Intl.DateTimeFormat('en-GB', { timeZone:'America/Bogota', hour:'numeric', hourCycle:'h23' }).format(new Date(iso)))
function hace(iso) {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000))
  if (min < 1) return 'Ahora'
  if (min < 60) return `Hace ${min} min`
  const h = Math.round(min / 60); if (h < 24) return `Hace ${h} ${h === 1 ? 'hora' : 'horas'}`
  const d = Math.round(h / 24); if (d < 7) return `Hace ${d} ${d === 1 ? 'día' : 'días'}`
  return fechaHora(iso)
}

const Svg = ({ children, className = '' }) => <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
const Chevron = () => <Svg className="ah-chev"><path d="M9 6l6 6-6 6"/></Svg>
const ChevronDown = () => <Svg className="ah-chev-d"><path d="M6 9l6 6 6-6"/></Svg>
const ArrowUp = ({ down }) => <Svg className={'ah-arrow' + (down ? ' down' : '')}><path d="M12 19V5M6 11l6-6 6 6"/></Svg>
const Coins = () => <Svg><ellipse cx="12" cy="5.5" rx="7" ry="2.5"/><path d="M5 5.5v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-4M5 9.5v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-4M5 13.5v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-4"/></Svg>
const Wallet = () => <Svg><path d="M4 7.5A2.5 2.5 0 016.5 5H18v3"/><rect x="4" y="7.5" width="16" height="12" rx="2.5"/><path d="M15.5 13.5h4.5v-3h-4.5a1.5 1.5 0 000 3z"/></Svg>

function MonthPicker({ value, onChange, period }) {
  const hoy = hoyBogota().slice(0,7)
  const opciones = Array.from({ length: 18 }, (_, i) => shiftYm(hoy, -i))
  const [y, m] = value.split('-')
  const texto = period === 'anio' ? y : `${MESES[Number(m) - 1]} ${y}`
  return <label className="ah-month-inline">
    <span>{texto}</span><ChevronDown />
    <select aria-label="Elegir mes" value={value} onChange={e => onChange(e.target.value)}>
      {opciones.map(o => <option key={o} value={o}>{MESES[Number(o.slice(5)) - 1]} {o.slice(0,4)}</option>)}
    </select>
  </label>
}

function Delta({ value, label, inverse }) {
  if (value === null) return <span className="ah-delta-row"><span className="ah-delta muted">—</span><small>{label}</small></span>
  const good = inverse ? value <= 0 : value >= 0
  return <span className="ah-delta-row"><span className={'ah-delta ' + (good ? 'good' : 'bad')}><ArrowUp down={value < 0} />{Math.abs(value)}%</span><small>{label}</small></span>
}

function buildPeriod(period, ym, netas, movs) {
  const hoy = hoyBogota(), actual = ym === hoy.slice(0,7)
  let ini, fin, pIni, pFin, buckets, bucketOf, labels, vsLabel
  if (period === 'dia') {
    const day = actual ? hoy : ym + '-' + String(lastDay(ym)).padStart(2,'0')
    ini = fin = day; pIni = pFin = shiftDay(day, -1)
    buckets = 24; bucketOf = f => bogotaHour(f.fecha); labels = ['0','6','12','18','23']; vsLabel = 'vs. día anterior'
  } else if (period === 'anio') {
    const year = ym.slice(0,4), cut = actual ? hoy : (year === hoy.slice(0,4) ? hoy : year + '-12-31')
    ini = year + '-01-01'; fin = cut
    pIni = (Number(year) - 1) + '-01-01'; pFin = (Number(year) - 1) + cut.slice(4)
    buckets = 12; bucketOf = f => Number(dayKey(new Date(f.fecha)).slice(5,7)) - 1; labels = ['Ene','Abr','Jul','Oct','Dic']; vsLabel = 'vs. año anterior'
  } else {
    const n = lastDay(ym), cutDay = actual ? Number(hoy.slice(8)) : n
    ini = ym + '-01'; fin = ym + '-' + String(cutDay).padStart(2,'0')
    const prev = shiftYm(ym, -1)
    pIni = prev + '-01'; pFin = prev + '-' + String(Math.min(cutDay, lastDay(prev))).padStart(2,'0')
    buckets = n; bucketOf = f => Number(dayKey(new Date(f.fecha)).slice(8)) - 1
    labels = ['1','5','10','15','20','25',String(n)]; vsLabel = 'vs. mes anterior'
  }
  const inRange = (k, a, b) => k >= a && k <= b
  const values = Array(buckets).fill(0), counts = Array(buckets).fill(0)
  let ventas = 0, facturas = 0, ventasPrev = 0
  netas.forEach(f => {
    if (f.estado !== 'emitida') return
    const k = dayKey(new Date(f.fecha)), t = Number(f.total_neto) || 0
    if (inRange(k, ini, fin)) { ventas += t; facturas++; const b = bucketOf(f); if (b >= 0 && b < buckets) { values[b] += t; counts[b]++ } }
    else if (inRange(k, pIni, pFin)) ventasPrev += t
  })
  const sumMov = (tipo, a, b) => movs.filter(m => m.tipo === tipo && inRange(String(m.fecha).slice(0,10), a, b)).reduce((s, m) => s + Number(m.monto), 0)
  const ingresos = ventas + sumMov('ingreso', ini, fin), ingresosPrev = ventasPrev + sumMov('ingreso', pIni, pFin)
  const gastos = sumMov('gasto', ini, fin), gastosPrev = sumMov('gasto', pIni, pFin)
  let current = -1
  if (period === 'dia' && ini === hoy) current = bogotaHour(new Date().toISOString())
  if (period === 'mes' && actual) current = Number(hoy.slice(8)) - 1
  if (period === 'anio' && ini.slice(0,4) === hoy.slice(0,4)) current = Number(hoy.slice(5,7)) - 1
  const mesCorto = n => MESES[n].slice(0,3).toLowerCase()
  const tipLabel = i => period === 'dia' ? `${String(i).padStart(2,'0')}:00 – ${String(i).padStart(2,'0')}:59` : period === 'anio' ? `${MESES[i]} ${ini.slice(0,4)}` : `${i + 1} ${mesCorto(Number(ym.slice(5)) - 1)} ${ym.slice(0,4)}`
  const unidad = period === 'dia' ? 'hora' : period === 'anio' ? 'mes' : 'día'
  return { ventas, facturas, values, counts, tipLabel, unidad, labels, current, vsLabel, ingresos, gastos,
    dVentas: pct(ventas, ventasPrev), dIngresos: pct(ingresos, ingresosPrev), dGastos: pct(gastos, gastosPrev), ini, fin }
}

function SalesChart({ values, labels, current }) {
  const max = Math.max(...values, 1)
  return <div className="ah-chart" aria-hidden="true">
    <div className="ah-bars">{values.map((v, i) => <span key={i} className={'ah-col' + (current >= 0 && i > current ? ' future' : '') + (i === current ? ' now' : '')}><span style={{ height: (v > 0 ? Math.max(6, v / max * 100) : 2) + '%' }} /></span>)}</div>
    <div className="ah-axis">{labels.map((l, i) => <span key={i}>{l}</span>)}</div>
  </div>
}

function ActivityRow({ a, onOpen }) {
  return <button type="button" className="ah-act" onClick={onOpen}>
    <span className={'ah-act-icon ' + a.tone}>{a.icon}</span>
    <span className="ah-act-main"><b>{a.title}</b><small>{a.sub}</small></span>
    <span className="ah-act-side"><b className={a.amountTone || ''}>{a.amount}</b><small>{hace(a.fecha)}</small></span>
    <Chevron />
  </button>
}

function DetalleNegocio({ onClose }) {
  const { can, esAdmin } = useAuth()
  const navigate=useNavigate()
  const [invoice,setInvoice]=useState(null),[employee,setEmployee]=useState(null),[tick,setTick]=useState(0)
  const revision = useDemoRevision()
  const [datos, setDatos] = useState(null), [error, setError] = useState('')
  useEffect(() => {
    if(!esAdmin)return
    let active = true
    setError('')
    const mes = rangoMes()
    Promise.all([
      supabase.rpc('resumen_dashboard'),
      supabase.rpc('ventas_por_empleado', { p_desde: mes.ini, p_hasta: mes.fin }),
      supabase.from('productos_venta').select('id,codigo,nombre,stock,stock_min'),
      supabase.from('facturas').select('id,prefijo,numero,total,estado,fecha,' + (isDemoMode ? 'perfiles(nombre)' : 'perfiles!facturas_vendedor_id_fkey(nombre)')).order('fecha', { ascending: false }).limit(6),
    ]).then(([summary, team, products, invoices]) => {
      for (const result of [summary, team, products, invoices]) if (result.error) throw result.error
      if (!summary.data?.[0]) throw new Error('No se pudo cargar el resumen del negocio.')
      if (active) setDatos({ summary: summary.data[0], team: team.data || [], products: products.data || [], invoices: invoices.data || [] })
    }).catch(e => { if (active) setError(mensajeError(e)) })
    return () => { active = false }
  }, [revision,tick,esAdmin])
  if(!esAdmin)return null
  const openMetric=(key,id)=>{onClose();navigate(key==='producto'?'/inventario?producto='+id:key==='stock_bajo'?'/inventario?filtro=bajo':key==='agotados'?'/inventario?filtro=agotado':key==='valor_inventario'?'/inventario':key==='ingresos_mes'?'/finanzas?detalle=ingreso':key==='gastos_mes'?'/finanzas?detalle=gasto':key==='utilidad_mes'?'/finanzas':key==='ventas_hoy'||key==='facturas_hoy'?'/facturas/historial?fecha='+hoyBogota():'/facturas/historial')}
  return <><Modal title="Detalle del negocio" subtitle="Resumen ejecutivo de ANGIE TECH" className="business-detail-sheet" keyboardAware onClose={onClose} footer={<button type="button" className="btn full" onClick={onClose}>Listo</button>}>
    <ErrorBox text={error} />
    {!datos && !error ? <Loader /> : datos && <BusinessDetail data={datos.summary} costos={can('ver_costos')} agotados={datos.products.filter(p => p.stock === 0).length} empleados={datos.team} bajo={datos.products.filter(p => p.stock <= p.stock_min)} facturas={datos.invoices} onInvoice={setInvoice} onEmployee={setEmployee} onMetric={openMetric} />}
  </Modal>{employee&&<EmployeeSales employee={employee} onClose={()=>setEmployee(null)}/>} {invoice&&<FacturaDetalle id={invoice} onClose={()=>setInvoice(null)} onCambio={()=>setTick(n=>n+1)}/>}</>
}

function DashboardAdmin() {
  const navigate = useNavigate()
  const revision = useDemoRevision()
  const [ym, setYm] = useState(() => hoyBogota().slice(0,7))
  const [period, setPeriod] = useState('mes')
  const [data, setData] = useState(null), [err, setErr] = useState(''), [verTodo, setVerTodo] = useState(false)
  const [detalleNegocio, setDetalleNegocio] = useState(false)
  const [salesOpen,setSalesOpen]=useState(false)

  useEffect(() => {
    ;(async () => {
      const [netas, movs, fac, cli, com, prov, aj, prods, compTot] = await Promise.all([
        readFinancialRows(()=>supabase.from('facturas_netas').select('id,fecha,estado,total_neto').order('id')).then(data=>({data}),error=>({error})),
        readFinancialRows(()=>supabase.from('movimientos').select('id,tipo,monto,fecha').order('id')).then(data=>({data}),error=>({error})),
        supabase.from('facturas').select('id,prefijo,numero,total,estado,fecha,cliente_id,anulada_en').order('fecha', { ascending:false }).limit(30),
        supabase.from('clientes').select('id,nombre'),
        supabase.from('compras').select('id,proveedor_id,total,estado,creado_en,numero_documento').order('creado_en', { ascending:false }).limit(15),
        supabase.from('proveedores').select('id,nombre'),
        supabase.from('movimientos_inventario').select('id,producto_id,tipo,cantidad,fecha,motivo').in('tipo', ['ajuste_entrada','ajuste_salida','devolucion_proveedor']).order('fecha', { ascending:false }).limit(15),
        supabase.from('productos_venta').select('id,nombre,stock,stock_min'),
        readFinancialRows(()=>supabase.from('compras').select('id,fecha,total,estado').eq('estado','recibida').order('id')).then(data=>({data}),error=>({error})),
      ])
      const financialError=[netas,movs,compTot].find(result=>result.error)?.error
      if (financialError) return setErr(mensajeError(financialError))
      const nCli = Object.fromEntries((cli.data || []).map(x => [x.id, x.nombre]))
      const nProv = Object.fromEntries((prov.data || []).map(x => [x.id, x.nombre]))
      const nProd = Object.fromEntries((prods.data || []).map(x => [x.id, x.nombre]))
      const feed = [
        ...(fac.data || []).map(f => f.estado === 'anulada'
          ? { key:'a' + f.id, fecha:f.anulada_en || f.fecha, tone:'muted', icon:<Icon name="doc" />, title:`Factura anulada ${numFactura(f)}`, sub:nCli[f.cliente_id] || 'Consumidor final', amount:money(f.total), amountTone:'strike', to:'/facturas?factura=' + f.id }
          : { key:'f' + f.id, fecha:f.fecha, tone:'rose', icon:<Icon name="cart" />, title:`Venta ${numFactura(f)}`, sub:nCli[f.cliente_id] || 'Consumidor final', amount:money(f.total), to:'/facturas?factura=' + f.id }),
        ...(com.data || []).filter(c => c.estado !== 'anulada').map(c => ({ key:'c' + c.id, fecha:c.creado_en, tone:'green', icon:<Icon name="plus" />, title:'Ingreso de mercancía', sub:'Proveedor: ' + (nProv[c.proveedor_id] || '—'), amount:money(c.total), to:'/proveedores?compra=' + c.id })),
        ...(aj.data || []).map(m => ({ key:'m' + m.id, fecha:m.fecha, tone:'gold', icon:<Icon name="box" />, title:m.tipo === 'devolucion_proveedor' ? 'Devolución a proveedor' : 'Ajuste de inventario', sub:nProd[m.producto_id] || m.motivo || 'Producto', amount:`${m.cantidad > 0 ? '+ ' : '- '}${Math.abs(m.cantidad)} ${Math.abs(m.cantidad) === 1 ? 'unidad' : 'unidades'}`, amountTone:m.cantidad > 0 ? 'pos' : 'neg', to:'/inventario?producto=' + m.producto_id })),
      ].sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
      setData({ netas:netas.data || [], movs:[...(movs.data || []), ...(compTot.data || []).map(c => ({ tipo:'gasto', monto:c.total, fecha:c.fecha }))], feed, stockBajo:(prods.data || []).filter(p => p.stock <= p.stock_min).length })
    })()
  }, [revision])

  const p = data && buildPeriod(period, ym, data.netas, data.movs)
  const titulo = 'VENTAS'
  return <AppShell title="Inicio" sub={fechaLarga()}>
    <div className="ah-quick">
      {[{ to:'/inventario', t:'Inventario', i:'box' }, { to:'/facturas', t:'Facturación', i:'doc' }, { to:'/clientes', t:'Clientes', i:'users' }].map(x =>
        <button key={x.to} type="button" onClick={() => navigate(x.to)}><span className="ah-quick-icon"><Icon name={x.i} /></span><span className="ah-quick-label">{x.t}</span><Chevron /></button>)}
    </div>
    <ErrorBox text={err} />
    {!p && !err ? <Loader /> : p && <>
      <section className="ah-sales">
        <div className="ah-sales-head">
          <span className="ah-eyebrow">{titulo}</span>
          <div className="ah-seg" role="tablist" aria-label="Periodo">
            {[['dia','Día'],['mes','Mes'],['anio','Año']].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={period === k} className={period === k ? 'on' : ''} onClick={() => setPeriod(k)}>{l}</button>)}
          </div>
        </div>
        <div className="ah-sales-row">
          <div><button type="button" className="ah-sales-open" aria-label="Ver movimientos de ventas" onClick={()=>setSalesOpen(true)}><FitAmount className="ah-amount" minSize={18}>{money(p.ventas)}</FitAmount><small>Ver movimientos ›</small></button><p className="ah-count">{p.facturas} {p.facturas === 1 ? 'factura' : 'facturas'} · <MonthPicker value={ym} onChange={setYm} period={period} /></p></div>
          <Delta value={p.dVentas} label={p.vsLabel} />
        </div>
        <SalesChart values={p.values} labels={p.labels} current={p.current} />
      </section>

      <div className="ah-duo">
        <button type="button" className="ah-mini" onClick={() => navigate('/finanzas?detalle=ingreso&mes='+ym)}>
          <span className="ah-mini-icon gold"><Coins /></span>
          <span className="ah-mini-body"><span className="ah-mini-top"><span>Ingresos</span><Chevron /></span><b><FitAmount>{money(p.ingresos)}</FitAmount></b><Delta value={p.dIngresos} label={p.vsLabel} /></span>
        </button>
        <button type="button" className="ah-mini" onClick={() => navigate('/finanzas?detalle=gasto&mes='+ym)}>
          <span className="ah-mini-icon red"><Wallet /></span>
          <span className="ah-mini-body"><span className="ah-mini-top"><span>Gastos</span><Chevron /></span><b><FitAmount>{money(p.gastos)}</FitAmount></b><Delta value={p.dGastos} label={p.vsLabel} inverse /></span>
        </button>
      </div>

      <button type="button" className="ah-stock" onClick={() => navigate('/inventario?filtro=bajo')}>
        <span className="ah-stock-photo2" style={{ backgroundImage:`url(${bannerPhoto})` }} aria-hidden="true" />
        <span className="ah-stock-icon"><Icon name="box" /></span>
        <span className="ah-stock-text"><span>Productos con stock bajo</span><b>{data.stockBajo} {data.stockBajo === 1 ? 'producto' : 'productos'}</b></span>
        <Chevron />
      </button>

      <button type="button" className="btn sec full mt-4" onClick={() => setDetalleNegocio(true)}>Detalle del negocio <Chevron /></button>
      <div className="ah-section"><h2>Actividad reciente</h2>{data.feed.length > 4 && <button type="button" onClick={() => setVerTodo(true)}>Ver todas <Chevron /></button>}</div>
      <div className="ah-acts activity-list">
        {data.feed.length ? data.feed.slice(0, 4).map(a => <ActivityRow key={a.key} a={a} onOpen={() => navigate(a.to)} />) : <Empty text="Sin actividad reciente" description="Aquí verás tus ventas, compras y movimientos apenas ocurran." />}
      </div>
      {salesOpen && <SalesPeriodDetail range={{desde:p.ini,hasta:p.fin}} expectedTotal={p.ventas} onClose={()=>setSalesOpen(false)}/>}
      {detalleNegocio && <DetalleNegocio onClose={() => setDetalleNegocio(false)} />}
      {verTodo && <Modal title="Actividad reciente" onClose={() => setVerTodo(false)}><div className="ah-acts in-modal">{data.feed.map(a => <ActivityRow key={a.key} a={a} onOpen={() => navigate(a.to)} />)}</div></Modal>}
    </>}
  </AppShell>
}

