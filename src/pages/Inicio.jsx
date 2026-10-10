import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDemoRevision } from '../lib/demo/useDemoRevision'
import AppShell from '../components/AppShell'
import SalesMetricDetail from '../components/SalesMetricDetail'
import BusinessDetail from '../components/BusinessDetail'
import TechHero from '../components/TechVisuals'
import Modal from '../components/Modal'
import Scanner from '../components/Scanner'
import { Icon } from '../components/Icons'
import bannerPhoto from '../assets/photography/banner-phone.jpg'
import { Stat, Loader, ErrorBox, Empty, Badge, SearchBar } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { supabase, isDemoMode } from '../lib/supabase'
import { money, hoyBogota, rangoMes, fechaHora, numFactura, mensajeError, limpiarBusqueda } from '../lib/format'

function HomeTools() {
  const navigate = useNavigate()
  const { can } = useAuth()
  const [q,setQ] = useState('')
  const [scan,setScan] = useState(false)
  const [results,setResults] = useState([])
  useEffect(() => {
    let active = true
    const timer = setTimeout(async () => {
      const s = limpiarBusqueda(q), invoice = s.replace(/^[A-Za-z]+-0*/, '')
      if (!s) return setResults([])
      const [p,f] = await Promise.all([
        supabase.from('productos_venta').select('*').or(`nombre.ilike.%${s}%,codigo.ilike.%${s}%,codigo_barras.ilike.%${s}%`).limit(3),
        /^\d+$/.test(invoice) ? supabase.from('facturas').select('*').or(`numero.eq.${Number(invoice)},total.eq.${Number(invoice)}`).limit(3) : Promise.resolve({data:[]}),
      ])
      if(active) setResults([...(p.data||[]).map(x=>({key:'p'+x.id,title:x.nombre,sub:'Producto · '+x.codigo,to:'/inventario?producto='+x.id})),...(f.data||[]).map(x=>({key:'f'+x.id,title:numFactura(x),sub:'Factura · '+money(x.total),to:'/facturas?factura='+x.id}))])
    },250)
    return()=>{active=false;clearTimeout(timer)}
  },[q])
  return <section className="home-tools"><SearchBar value={q} onChange={setQ} placeholder="Buscar producto o factura" />
    {q && <div className="card search-results mb-3">{results.length ? results.map(x=><button key={x.key} className="row menu-row" onClick={()=>navigate(x.to)}><span className="flex-1"><b>{x.title}</b><small>{x.sub}</small></span><Icon name="back" className="w-4 h-4 rotate-180" /></button>):<p className="text-sm text-muted">Sin coincidencias</p>}</div>}
    {!q && <div className="home-search-guide"><span className="premium-eyebrow">ENCUENTRA LO QUE NECESITAS</span><p>Productos, códigos y facturas.</p><small>Prueba AirPods, USBC2M o FV-1245.</small></div>}
    <div className="quick-actions">{[{to:'/vender',title:'Nueva venta',icon:'cart',allowed:can('vender')},{to:'/inventario',title:'Inventario',icon:'box',allowed:can('ver_inventario')},{to:'/facturas',title:'Facturas',icon:'doc',allowed:true}].filter(x=>x.allowed).map(x=><button key={x.to} onClick={()=>navigate(x.to)}><span><Icon name={x.icon}/></span>{x.title}</button>)}</div>
    {scan && <Scanner onClose={()=>setScan(false)} onScan={async code=>{setScan(false);const s=limpiarBusqueda(code);const {data}=await supabase.from('productos_venta').select('*').or(`codigo.eq.${s},codigo_barras.eq.${s}`);if(data?.length===1)navigate('/inventario?producto='+data[0].id);else setQ(code)}} />}
  </section>
}
export default function Inicio() {
  const { esAdmin, can, perfil } = useAuth()
  return (esAdmin || can('ver_finanzas')) ? <DashboardAdmin /> : <MisVentas perfil={perfil} />
}
const bogotaDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' })
const dateLabel=()=>new Date().toLocaleDateString('es-CO',{weekday:'long',day:'numeric',month:'long'})

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

function DashboardAdmin() {
  const navigate = useNavigate()
  const revision = useDemoRevision()
  const [ym, setYm] = useState(() => hoyBogota().slice(0,7))
  const [period, setPeriod] = useState('mes')
  const [data, setData] = useState(null), [err, setErr] = useState(''), [verTodo, setVerTodo] = useState(false)

  useEffect(() => {
    ;(async () => {
      const [netas, movs, fac, cli, com, prov, aj, prods] = await Promise.all([
        supabase.from('facturas_netas').select('id,fecha,estado,total_neto'),
        supabase.from('movimientos').select('tipo,monto,fecha'),
        supabase.from('facturas').select('id,prefijo,numero,total,estado,fecha,cliente_id,anulada_en').order('fecha', { ascending:false }).limit(30),
        supabase.from('clientes').select('id,nombre'),
        supabase.from('compras').select('id,proveedor_id,total,estado,creado_en,numero_documento').order('creado_en', { ascending:false }).limit(15),
        supabase.from('proveedores').select('id,nombre'),
        supabase.from('movimientos_inventario').select('id,producto_id,tipo,cantidad,fecha,motivo').in('tipo', ['ajuste_entrada','ajuste_salida','devolucion_proveedor']).order('fecha', { ascending:false }).limit(15),
        supabase.from('productos_venta').select('id,nombre,stock,stock_min'),
      ])
      if (netas.error) return setErr(mensajeError(netas.error))
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
      setData({ netas:netas.data || [], movs:movs.data || [], feed, stockBajo:(prods.data || []).filter(p => p.stock <= p.stock_min).length })
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
          <div><p className="ah-amount">{money(p.ventas)}</p><p className="ah-count">{p.facturas} {p.facturas === 1 ? 'factura' : 'facturas'} · <MonthPicker value={ym} onChange={setYm} period={period} /></p></div>
          <Delta value={p.dVentas} label={p.vsLabel} />
        </div>
        <SalesChart values={p.values} labels={p.labels} current={p.current} />
      </section>

      <div className="ah-duo">
        <button type="button" className="ah-mini" onClick={() => navigate('/finanzas')}>
          <span className="ah-mini-icon gold"><Coins /></span>
          <span className="ah-mini-body"><span className="ah-mini-top"><span>Ingresos</span><Chevron /></span><b>{money(p.ingresos)}</b><Delta value={p.dIngresos} label={p.vsLabel} /></span>
        </button>
        <button type="button" className="ah-mini" onClick={() => navigate('/finanzas')}>
          <span className="ah-mini-icon red"><Wallet /></span>
          <span className="ah-mini-body"><span className="ah-mini-top"><span>Gastos</span><Chevron /></span><b>{money(p.gastos)}</b><Delta value={p.dGastos} label={p.vsLabel} inverse /></span>
        </button>
      </div>

      <button type="button" className="ah-stock" onClick={() => navigate('/inventario?filtro=bajo')}>
        <span className="ah-stock-photo2" style={{ backgroundImage:`url(${bannerPhoto})` }} aria-hidden="true" />
        <span className="ah-stock-icon"><Icon name="box" /></span>
        <span className="ah-stock-text"><span>Productos con stock bajo</span><b>{data.stockBajo} {data.stockBajo === 1 ? 'producto' : 'productos'}</b></span>
        <Chevron />
      </button>

      <div className="ah-section"><h2>Actividad reciente</h2>{data.feed.length > 4 && <button type="button" onClick={() => setVerTodo(true)}>Ver todas <Chevron /></button>}</div>
      <div className="ah-acts activity-list">
        {data.feed.length ? data.feed.slice(0, 4).map(a => <ActivityRow key={a.key} a={a} onOpen={() => navigate(a.to)} />) : <Empty text="Sin actividad reciente" description="Aquí verás tus ventas, compras y movimientos apenas ocurran." />}
      </div>
      {verTodo && <Modal title="Actividad reciente" onClose={() => setVerTodo(false)}><div className="ah-acts in-modal">{data.feed.map(a => <ActivityRow key={a.key} a={a} onOpen={() => navigate(a.to)} />)}</div></Modal>}
    </>}
  </AppShell>
}

function MisVentas({perfil}) {
  const revision = useDemoRevision()
  const[hoy,setHoy]=useState(null),[mes,setMes]=useState(null),[lista,setLista]=useState([]),[err,setErr]=useState(''),[detail,setDetail]=useState(false)
  useEffect(()=>{const m=rangoMes(),h=hoyBogota();(async()=>{const[a,b,c]=await Promise.all([supabase.rpc('ventas_por_empleado',{p_desde:h,p_hasta:h}),supabase.rpc('ventas_por_empleado',{p_desde:m.ini,p_hasta:m.fin}),supabase.from('facturas').select('id,prefijo,numero,total,estado,fecha').eq('vendedor_id',perfil.id).order('fecha',{ascending:false}).limit(15)]);if(a.error)return setErr(mensajeError(a.error));setHoy(a.data?.[0]||{facturas:0,total_vendido:0,comision:0});setMes(b.data?.[0]||{facturas:0,total_vendido:0,comision:0});setLista(c.data||[])})()},[perfil.id,revision])
  const rows=items=>items.length?items.map(f=><div className="row" key={f.id}><div className="flex-1"><b className="text-sm">{numFactura(f)}</b><p className="text-xs text-muted m-0">{fechaHora(f.fecha)}</p></div><div className="text-right"><b className="text-sm">{money(f.total)}</b>{f.estado==='anulada'&&<Badge tone="bad">Anulada</Badge>}</div></div>):<Empty text="Aún no has vendido"/>
  return <AppShell title={'Hola, '+perfil.nombre.split(' ')[0]} sub={dateLabel()}><HomeTools/><TechHero/><ErrorBox text={err}/>{!hoy&&!err?<Loader/>:hoy&&<><div className="home-section"><h2>Mis ventas</h2></div><div className="grid grid-cols-2 gap-2.5 mb-3"><Stat label="Vendido hoy" value={money(hoy.total_vendido)} sub={hoy.facturas+' facturas'}/><Stat label="Vendido en el mes" value={money(mes.total_vendido)} sub={mes.facturas+' facturas'}/>{perfil.comision_pct!=null&&<><Stat label="Comisión hoy" value={money(hoy.comision)} tone="good"/><Stat label="Comisión del mes" value={money(mes.comision)} tone="good" sub={perfil.comision_pct+'%'}/></>}</div><div className="home-section"><h2>Mis últimas facturas</h2><button onClick={()=>setDetail(true)}>Ver todo ›</button></div><div className="card activity-list">{rows(lista.slice(0,3))}</div>{detail&&<Modal title="Mis últimas facturas" onClose={()=>setDetail(false)}>{rows(lista)}</Modal>}</>}</AppShell>
}

