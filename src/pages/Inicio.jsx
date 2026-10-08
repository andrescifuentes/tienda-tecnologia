import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppShell from '../components/AppShell'
import TechHero from '../components/TechVisuals'
import Modal from '../components/Modal'
import Scanner from '../components/Scanner'
import { Icon } from '../components/Icons'
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
  return <><SearchBar value={q} onChange={setQ} onScan={()=>setScan(true)} placeholder="Buscar producto, SKU o factura" />
    {q && <div className="card search-results mb-3">{results.length ? results.map(x=><button key={x.key} className="row menu-row" onClick={()=>navigate(x.to)}><span className="flex-1"><b>{x.title}</b><small>{x.sub}</small></span><Icon name="back" className="w-4 h-4 rotate-180" /></button>):<p className="text-sm text-muted">Sin coincidencias</p>}</div>}
    <div className="quick-actions">{[{to:'/vender',title:'Nueva venta',icon:'cart',allowed:can('vender')},{to:'/inventario',title:'Inventario',icon:'box',allowed:can('ver_inventario')},{to:'/facturas',title:'Facturas',icon:'doc',allowed:true}].filter(x=>x.allowed).map(x=><button key={x.to} onClick={()=>navigate(x.to)}><span><Icon name={x.icon}/></span>{x.title}</button>)}</div>
    {scan && <Scanner onClose={()=>setScan(false)} onScan={async code=>{setScan(false);const s=limpiarBusqueda(code);const {data}=await supabase.from('productos_venta').select('*').or(`codigo.eq.${s},codigo_barras.eq.${s}`);if(data?.length===1)navigate('/inventario?producto='+data[0].id);else setQ(code)}} />}
  </>
}
export default function Inicio() {
  const { esAdmin, can, perfil } = useAuth()
  return (esAdmin || can('ver_finanzas')) ? <DashboardAdmin /> : <MisVentas perfil={perfil} />
}
const bogotaDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' })
const dateLabel=()=>new Date().toLocaleDateString('es-CO',{weekday:'long',day:'numeric',month:'long'})

function DashboardAdmin() {
  const navigate=useNavigate()
  const [activity,setActivity]=useState([]),[d,setD]=useState(null),[bajo,setBajo]=useState([]),[emp,setEmp]=useState([]),[rec,setRec]=useState([]),[err,setErr]=useState(''),[detail,setDetail]=useState(null),[targets,setTargets]=useState({}),[agotados,setAgotados]=useState(0)
  useEffect(()=>{
    const m=rangoMes()
    ;(async()=>{
      const[r,b,e,f]=await Promise.all([supabase.rpc('resumen_dashboard'),supabase.from('stock_bajo').select('*').order('stock').limit(8),supabase.rpc('ventas_por_empleado',{p_desde:m.ini,p_hasta:m.fin}),supabase.from('facturas').select('id,prefijo,numero,total,estado,fecha,perfiles(nombre)').order('fecha',{ascending:false})])
      if(r.error)return setErr(mensajeError(r.error))
      const products=await supabase.from('productos_venta').select('*');setAgotados((products.data||[]).filter(p=>p.stock===0).length)
      if(isDemoMode){const [a,...records]=await Promise.all([supabase.from('actividad').select('*').order('fecha',{ascending:false}),...['productos','facturas','compras','garantias'].map(t=>supabase.from(t).select('id'))]);setActivity(a.data||[]);setTargets(Object.fromEntries(['producto','factura','compra','garantia'].map((key,i)=>[key,new Set((records[i].data||[]).map(x=>String(x.id)))])))}

      setD(r.data?.[0]||r.data);setBajo(b.data||[]);setEmp(e.data||[]);setRec(f.data||[])
    })()
  },[])
  const activities=isDemoMode?activity:rec.map(f=>({id:f.id,entidad:'factura',entidad_id:f.id,accion:numFactura(f),fecha:f.fecha,detalle:{numero:money(f.total)}}))
  const destination = a => {
    const kind = {productos:'producto',facturas:'factura',venta:'factura',compras:'compra',garantias:'garantia'}[a.entidad] || a.entidad
    if(isDemoMode && !targets[kind]?.has(String(a.entidad_id))) return null
    const route = {producto:'/inventario?producto=',factura:'/facturas?factura=',compra:'/proveedores?compra=',garantia:'/garantias?garantia='}[kind]
    return route && a.entidad_id ? route + encodeURIComponent(a.entidad_id) : null
  }
  const activityRows = rows => rows.length ? rows.map(a=>{
    const to=destination(a), Element=to?'button':'div'
    return <Element className="row menu-row" key={a.id} onClick={to?()=>navigate(to):undefined}><span className="activity-symbol"><Icon name={/compra/i.test(a.accion)?'truck':'doc'}/></span><div className="flex-1"><b className="text-sm">{a.accion}</b><p className="m-0 text-xs text-muted">{fechaHora(a.fecha)}{a.detalle?.numero?' · '+a.detalle.numero:''}</p></div>{to&&<span className="text-brand">›</span>}</Element>
  }):<Empty text="Sin actividad reciente"/>
  const sales = rec.filter(f=>f.estado==='emitida' && (detail==='day'?bogotaDay.format(new Date(f.fecha))===hoyBogota():bogotaDay.format(new Date(f.fecha)).startsWith(hoyBogota().slice(0,7))))
  return <AppShell title="Inicio" sub={dateLabel()}><HomeTools/><TechHero/><ErrorBox text={err}/>
    {!d&&!err?<Loader/>:d&&<>
      <div className="home-section"><h2>Resumen de tu negocio</h2><button onClick={()=>setDetail('summary')}>Ver detalle ›</button></div>
      <div className="grid grid-cols-2 gap-2.5 mb-3 home-metrics">
        <Stat index={0} onClick={()=>setDetail('day')} icon="cash" label="Ventas de hoy" value={money(d.ventas_hoy)} sub={d.facturas_hoy+' facturas'}/>
        <Stat index={1} onClick={()=>setDetail('month')} icon="chart" label="Ventas del mes" value={money(d.ventas_mes)} sub={d.facturas_mes+' facturas'}/>
        <Stat index={2} onClick={()=>navigate('/finanzas')} icon="cash" label="Ingresos del mes" value={money(d.ingresos_mes)}/>
        <Stat index={3} onClick={()=>navigate('/inventario?filtro=bajo')} icon="box" label="Stock bajo" value={d.productos_stock_bajo} sub="Productos por reponer" tone={d.productos_stock_bajo>0?'warn':'good'}/>
      </div>
      <div className="home-section"><h2>Actividad reciente</h2><button onClick={()=>setDetail('activity')}>Ver todo ›</button></div>
      <div className="card activity-list">{activityRows(activities.slice(0,3))}</div>
      {detail&&<Modal title={{activity:'Historial completo',day:'Ventas de hoy',month:'Ventas del mes',summary:'Detalle del negocio'}[detail]} onClose={()=>setDetail(null)}>
        {detail==='activity'?activityRows(activities):['day','month'].includes(detail)?<><p className="text-sm">Total de ventas: <b>{money(detail==='day'?d.ventas_hoy:d.ventas_mes)}</b></p>{sales.length?sales.map(f=><button className="row menu-row" key={f.id} onClick={()=>navigate('/facturas?factura='+f.id)}><span className="flex-1"><b>{numFactura(f)}</b><p className="text-xs text-muted">{fechaHora(f.fecha)}</p></span><b>{money(f.total)}</b><span>›</span></button>):<Empty text="Sin ventas en este período"/>}</>:<>
          <div className="grid grid-cols-2 gap-2"><Stat label="Ventas de hoy" value={money(d.ventas_hoy)}/><Stat label="Ventas del mes" value={money(d.ventas_mes)}/><Stat label="Ingresos del mes" value={money(d.ingresos_mes)}/><Stat label="Stock bajo" value={d.productos_stock_bajo}/><Stat label="Agotados" value={agotados}/></div>
          <div className="grid grid-cols-2 gap-2"><Stat label="Gastos del mes" value={money(d.gastos_mes)} tone="bad"/><Stat label="Utilidad del mes" value={money(d.utilidad_mes)} tone={d.utilidad_mes>=0?'good':'bad'}/><Stat label="Valor inventario" value={money(d.valor_inventario)}/><Stat label="Facturas del día" value={d.facturas_hoy}/></div>
          <h2 className="section-heading">Ventas por empleado (mes)</h2>{emp.length?emp.map(e=><div className="row" key={e.vendedor_id}><div className="flex-1"><b className="text-sm">{e.nombre}</b><p className="text-xs text-muted m-0">{e.facturas} facturas</p><div className="sales-track"><span style={{width:Math.max(3,e.total_vendido/Math.max(...emp.map(x=>x.total_vendido),1)*100)+'%'}}/></div></div><div className="text-right"><b className="text-sm">{money(e.total_vendido)}</b><p className="text-xs text-muted m-0">Comisión {money(e.comision)}</p></div></div>):<Empty text="Sin ventas este mes"/>}
          <h2 className="section-heading">Stock bajo</h2>{bajo.length?bajo.map(p=><div className="row" key={p.id}><div className="flex-1"><b className="text-sm">{p.nombre}</b><p className="text-xs text-muted m-0">{p.codigo}</p></div><Badge tone={p.stock===0?'bad':'warn'}>{p.stock} / mín {p.stock_min}</Badge></div>):<Empty text="Todo el inventario está en orden"/>}
          <h2 className="section-heading">Últimas facturas</h2>{rec.slice(0,6).map(f=><div className="row" key={f.id}><div className="flex-1"><b className="text-sm">{numFactura(f)}</b><p className="text-xs text-muted m-0">{fechaHora(f.fecha)} · {f.perfiles?.nombre}</p></div><div className="text-right"><b className="text-sm">{money(f.total)}</b>{f.estado==='anulada'&&<Badge tone="bad">Anulada</Badge>}</div></div>)}
        </>}
      </Modal>}
    </>}
  </AppShell>
}
function MisVentas({perfil}) {
  const[hoy,setHoy]=useState(null),[mes,setMes]=useState(null),[lista,setLista]=useState([]),[err,setErr]=useState(''),[detail,setDetail]=useState(false)
  useEffect(()=>{const m=rangoMes(),h=hoyBogota();(async()=>{const[a,b,c]=await Promise.all([supabase.rpc('ventas_por_empleado',{p_desde:h,p_hasta:h}),supabase.rpc('ventas_por_empleado',{p_desde:m.ini,p_hasta:m.fin}),supabase.from('facturas').select('id,prefijo,numero,total,estado,fecha').eq('vendedor_id',perfil.id).order('fecha',{ascending:false}).limit(15)]);if(a.error)return setErr(mensajeError(a.error));setHoy(a.data?.[0]||{facturas:0,total_vendido:0,comision:0});setMes(b.data?.[0]||{facturas:0,total_vendido:0,comision:0});setLista(c.data||[])})()},[perfil.id])
  const rows=items=>items.length?items.map(f=><div className="row" key={f.id}><div className="flex-1"><b className="text-sm">{numFactura(f)}</b><p className="text-xs text-muted m-0">{fechaHora(f.fecha)}</p></div><div className="text-right"><b className="text-sm">{money(f.total)}</b>{f.estado==='anulada'&&<Badge tone="bad">Anulada</Badge>}</div></div>):<Empty text="Aún no has vendido"/>
  return <AppShell title={'Hola, '+perfil.nombre.split(' ')[0]} sub={dateLabel()}><HomeTools/><TechHero/><ErrorBox text={err}/>{!hoy&&!err?<Loader/>:hoy&&<><div className="home-section"><h2>Mis ventas</h2></div><div className="grid grid-cols-2 gap-2.5 mb-3"><Stat label="Vendido hoy" value={money(hoy.total_vendido)} sub={hoy.facturas+' facturas'}/><Stat label="Vendido en el mes" value={money(mes.total_vendido)} sub={mes.facturas+' facturas'}/>{perfil.comision_pct!=null&&<><Stat label="Comisión hoy" value={money(hoy.comision)} tone="good"/><Stat label="Comisión del mes" value={money(mes.comision)} tone="good" sub={perfil.comision_pct+'%'}/></>}</div><div className="home-section"><h2>Mis últimas facturas</h2><button onClick={()=>setDetail(true)}>Ver todo ›</button></div><div className="card activity-list">{rows(lista.slice(0,3))}</div>{detail&&<Modal title="Mis últimas facturas" onClose={()=>setDetail(false)}>{rows(lista)}</Modal>}</>}</AppShell>
}

