import { useEffect, useMemo, useState } from 'react'
import AppShell, { ThemeToggle } from '../components/AppShell'
import { monetaryError } from '../lib/money'
import { AnimatedCard, ProductThumbnail, Brand } from '../components/TechVisuals'
import { I, CategoryIcon } from '../components/InvIcons'
import { Icon } from '../components/Icons'
import Modal from '../components/Modal'
import { FormSection } from '../components/AdminPrimitives'
import Scanner from '../components/Scanner'
import ClientePicker, { ClienteForm } from '../components/ClientePicker'
import FacturaDetalle from '../components/FacturaDetalle'
import { SearchBar, Empty, Badge, Stepper, ErrorBox, Chips, Input, Select } from '../components/ui'
import ConfirmAction from '../components/ConfirmAction'
import { useAuth } from '../context/AuthContext'
import { useAction } from '../lib/useAction'
import { imageKey } from '../lib/demo/images'
import { supabase, isDemoMode } from '../lib/supabase'
import { money, limpiarBusqueda, mensajeError } from '../lib/format'
import { toast } from '../lib/toast'
import '../styles/sale-quantity.css'

export default function Vender() {
  const { perfil, esAdmin, can } = useAuth()
  const draftKey = 'angie:cart:' + perfil.id
  const [draft] = useState(() => { try { return isDemoMode ? JSON.parse(sessionStorage.getItem(draftKey) || '{}') : {} } catch { return {} } })
  const [seller, setSeller] = useState(draft.seller || perfil.id)
  const [sellers, setSellers] = useState([]), [remove, setRemove] = useState(null), [expand, setExpand] = useState(false)
  const [requestId, setRequestId] = useState(draft.requestId || imageKey())
  useEffect(() => { if (isDemoMode && esAdmin) supabase.from('perfiles').select('*').eq('activo',true).then(({data})=>setSellers(data||[])) }, [esAdmin])

  const [categoryOptions,setCategoryOptions]=useState([])
  useEffect(()=>{supabase.from('categorias').select('*').eq('activa',true).order('nombre').then(({data})=>setCategoryOptions(data||[]))},[])
  const [categoria, setCategoriaRaw] = useState('Todos'); const [marca, setMarca] = useState('Todas'); const [hojaMarca, setHojaMarca] = useState(false); const [hojaCat, setHojaCat] = useState(false)
  const setCategoria = (c) => { setCategoriaRaw(c); setMarca('Todas') }; const [refresh, setRefresh] = useState(0)
  const [q, setQ] = useState(() => new URLSearchParams(window.location.search).get('q') || '')
  const [res, setRes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [verCatalogo, setVerCatalogo] = useState(false)
  const [extras, setExtras] = useState(false)
  const [faltaCliente, setFaltaCliente] = useState(false)
  const [hoyMio, setHoyMio] = useState({ n: 0, total: 0 })
  useEffect(() => {
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
    supabase.from('facturas').select('total,estado,fecha').eq('vendedor_id', perfil.id).gte('fecha', hoy + 'T00:00:00-05:00').then(({ data }) => {
      const ok = (data || []).filter(f => f.estado !== 'anulada')
      setHoyMio({ n: ok.length, total: ok.reduce((a, f) => a + Number(f.total || 0), 0) })
    })
  }, [refresh]) // eslint-disable-line
  const [ventasTop, setVentasTop] = useState({ propios: true, conteo: {} })
  useEffect(() => {
    let vivo = true
    ;(async () => {
      const contar = async (soloMio) => {
        let qf = supabase.from('facturas').select('id').eq('estado', 'emitida').order('fecha', { ascending: false }).limit(500)
        if (soloMio) qf = qf.eq('vendedor_id', perfil.id)
        const { data: fs } = await qf
        const ids = (fs || []).map(f => f.id)
        if (!ids.length) return {}
        const { data: its } = await supabase.from('factura_items').select('producto_id,cantidad,factura_id').in('factura_id', ids)
        const c = {}; for (const it of its || []) c[it.producto_id] = (c[it.producto_id] || 0) + Number(it.cantidad || 0)
        return c
      }
      let c = await contar(true), propios = true
      if (!Object.keys(c).length) { c = await contar(false); propios = false }
      if (vivo) setVentasTop({ propios, conteo: c })
    })()
    return () => { vivo = false }
  }, [refresh]) // eslint-disable-line
  const [detalle, setDetalle] = useState(null)
  const [cantDet, setCantDet] = useState(1)
  const [carrito, setCarrito] = useState(draft.carrito || []) // Temporary per-user tab draft.
  const [cliente, setCliente] = useState(draft.cliente || null)
  const [metodo, setMetodo] = useState(draft.metodo || 'efectivo')
  const [descuento, setDescuento] = useState(draft.descuento || '')
  const [notas, setNotas] = useState(draft.notas || '')
  const [verCliente, setVerCliente] = useState(false)
  const [scan, setScan] = useState(false)
  const [serialDe, setSerialDe] = useState(null)
  const [unidades, setUnidades] = useState([])
  const [verCarrito, setVerCarrito] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [facturaId, setFacturaId] = useState(null)

  useEffect(() => {
    const t = setTimeout(async () => {
      const s = limpiarBusqueda(q)
      let qq = supabase.from('productos_venta').select('*').order('nombre').limit(200)
      if (s) qq = qq.or(`nombre.ilike.%${s}%,codigo.ilike.%${s}%,codigo_barras.ilike.%${s}%,marca.ilike.%${s}%`)
      const { data } = await qq
      setRes(data || []); setCargando(false)
    }, 250)
    return () => clearTimeout(t)
  }, [q, refresh])

  useEffect(() => { if (!isDemoMode) return; try { sessionStorage.setItem(draftKey, JSON.stringify({carrito,cliente,metodo,descuento,notas,seller,requestId})) } catch { /* Draft does not block checkout. */ } }, [carrito,cliente,metodo,descuento,notas,seller,requestId,draftKey])
  useEffect(() => {
    if (!isDemoMode || !draft.carrito?.length) return
    let live = true
    supabase.from('productos_venta').select('*').in('id', draft.carrito.map(i=>i.producto.id)).then(({data,error})=>{
      if (!live || error) return
      setCarrito(items=>items.map(i=>({...i,producto:(data||[]).find(p=>p.id===i.producto.id)||{...i.producto,activo:false,stock:0}})))
    })
    return () => { live=false }
  }, [draft])
  const enCarrito = (id) => carrito.filter((i) => i.producto.id === id).reduce((a, i) => a + i.cantidad, 0)

  async function agregar(p) {
    if (p.maneja_serial) {
      const { data } = await supabase.from('unidades_serializadas').select('id,serial').eq('producto_id', p.id).eq('estado', 'disponible').order('id')
      const usadas = carrito.map((i) => i.unidad?.id)
      const libres = (data || []).filter((u) => !usadas.includes(u.id))
      if (libres.length === 0) return toast('No hay unidades disponibles')
      setUnidades(libres); setSerialDe(p); return
    }
    if (enCarrito(p.id) >= p.stock) return toast('No hay más stock de este producto')
    setCarrito((c) => {
      if (c.filter(x=>x.producto.id===p.id).reduce((n,x)=>n+x.cantidad,0) >= p.stock) return c
      const i = c.find((x) => x.producto.id === p.id && !x.unidad)
      return i ? c.map((x) => (x === i ? { ...x, cantidad: x.cantidad + 1 } : x)) : [...c, { key: 'p' + p.id, producto: p, cantidad: 1 }]
    })
    toast(`${p.nombre} agregado`)
  }
  function agregarUnidad(u) {
    setCarrito((c) => c.some(i=>i.unidad?.id===u.id) ? c : [...c, { key: 'u' + u.id, producto: serialDe, cantidad: 1, unidad: u }])
    setSerialDe(null); toast('Agregado con serial ' + u.serial)
  }
  async function alEscanear(codigo) {
    setScan(false)
    const { data } = await supabase.from('productos_venta').select('*').or(`codigo_barras.eq.${limpiarBusqueda(codigo)},codigo.eq.${limpiarBusqueda(codigo)}`).limit(1)
    if (data?.[0]) return agregar(data[0])
    // ¿es un serial?
    const { data: u } = await supabase.from('unidades_serializadas').select('id,serial,estado,producto_id').eq('serial', codigo.trim()).maybeSingle()
    if (u && u.estado === 'disponible') {
      const { data: p } = await supabase.from('productos_venta').select('*').eq('id', u.producto_id).maybeSingle()
      if (p) { setSerialDe(p); return agregarUnidadDirecto(p, u) }
    }
    toast('No se encontró ese código')
  }
  function agregarUnidadDirecto(p, u) {
    if (carrito.some((i) => i.unidad?.id === u.id)) return
    setCarrito((c) => [...c, { key: 'u' + u.id, producto: p, cantidad: 1, unidad: u }]); setSerialDe(null)
  }

  const subtotal = useMemo(() => carrito.reduce((a, i) => a + i.producto.precio_venta * i.cantidad, 0), [carrito])
  const desc = Math.min(Number(descuento) || 0, subtotal)
  const total = subtotal - desc
  const unidadesTotal = carrito.reduce((a, i) => a + i.cantidad, 0)

  function cambiarCant(i, n) { setCarrito((c) => c.map((x) => (x === i ? { ...x, cantidad: Math.min(n, i.producto.stock) } : x))) }
  function quitar(i) { setRemove(i) }
  function disminuir(p) {
    setCarrito(c=>{
      // A serialized line always represents one explicitly selected unit.
      const item = [...c].reverse().find(i=>i.producto.id===p.id)
      if (!item) return c
      return item.cantidad<=1 ? c.filter(i=>i.key!==item.key) : c.map(i=>i.key===item.key?{...i,cantidad:i.cantidad-1}:i)
    })
  }

  const [facturar, pendingSale] = useAction(facturarImpl, () => setBusy(false))
  async function facturarImpl() {
    if (!cliente) return setErr('Elige un cliente registrado o registra uno nuevo para continuar.')
    for (const value of [descuento,subtotal,total,...carrito.flatMap(i=>[i.producto.precio_venta,i.producto.precio_compra ?? 0])]) if (monetaryError(value)) return setErr(monetaryError(value))
    if (carrito.some(i=>!Number.isInteger(i.cantidad)||i.cantidad<=0||i.cantidad>i.producto.stock||i.producto.activo===false)) return setErr('Revisa el carrito: un producto está desactivado o no tiene stock suficiente. Reduce su cantidad o quítalo.')
    setErr(''); setBusy(true)
    const items = carrito.map((i) => ({ producto_id:i.producto.id, cantidad:i.unidad?1:i.cantidad, ...(i.unidad?{unidad_id:i.unidad.id}:{descuento:0}), ...(isDemoMode?{precio_unitario:i.producto.precio_venta}:{}) }))
    const { data, error } = await supabase.rpc('emitir_factura', { p_cliente_id: cliente?.id ?? null, p_metodo_pago: metodo, p_items: items, p_descuento: desc, p_notas: notas.trim() || null, ...(isDemoMode?{p_request_id:requestId,p_total_confirmado:total,p_vendedor_id:esAdmin?seller:undefined}:{}) })
    setBusy(false)
    if (error) {
      if (isDemoMode && /^El precio cambió/.test(error.message)) {
        const fresh = await supabase.from('productos_venta').select('*').in('id',carrito.map(i=>i.producto.id))
        if (!fresh.error) setCarrito(rows=>rows.map(i=>({...i,producto:fresh.data.find(p=>p.id===i.producto.id)||i.producto})))
      }
      return setErr(mensajeError(error))
    }
    const id = typeof data === 'object' && data !== null ? (data.id ?? data.factura_id ?? Object.values(data)[0]) : data
    setCarrito([]); setCliente(null); setDescuento(''); setNotas(''); setVerCarrito(false); setQ('')
    setRequestId(imageKey()); setRefresh(n=>n+1); setFacturaId(id); toast('Venta registrada')
  }

  const disponibles = res
  const conteoCat = disponibles.reduce((m, p) => { const k = p.categoria || 'Otros'; m[k] = (m[k] || 0) + 1; return m }, {})
  const catsVisibles = [['Todos', disponibles.length], ...categoryOptions.map(c => [c.nombre, conteoCat[c.nombre] || 0]).filter(([, n]) => n > 0)]
  const marcaDe = (p) => (p.marca || 'Genérica').trim()
  const enCategoria = disponibles.filter(p => categoria === 'Todos' || p.categoria === categoria)
  const conteoMarca = enCategoria.reduce((m, p) => { const k = marcaDe(p); m[k] = (m[k] || 0) + 1; return m }, {})
  const marcas = Object.entries(conteoMarca).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const visibles = enCategoria.filter(p => marca === 'Todas' || marcaDe(p) === marca)
  const top = (() => {
    const lista = Object.entries(ventasTop.conteo).map(([id, n]) => ({ p: disponibles.find(x => String(x.id) === String(id)), n })).filter(x => x.p).sort((a, b) => b.n - a.n).slice(0, 5)
    return { propios: ventasTop.propios, lista }
  })()
  const nombreCorto = (perfil?.nombre || '').split(' ')[0]
  const METODOS_PAGO = [['efectivo', 'Efectivo', 'cash'], ['tarjeta', 'Tarjeta', 'card'], ['transferencia', 'Transferencia', 'bank']]

  function agregarVarios(p, k) {
    if (p.maneja_serial) return agregar(p)
    const libre = p.stock - enCarrito(p.id), add = Math.min(k, libre)
    if (add <= 0) return toast('No hay más stock de este producto')
    setCarrito((c) => { const i = c.find((x) => x.producto.id === p.id && !x.unidad); return i ? c.map((x) => (x === i ? { ...x, cantidad: x.cantidad + add } : x)) : [...c, { key: 'p' + p.id, producto: p, cantidad: add }] })
    toast(`${add} × ${p.nombre} agregado`)
  }
  const abrir = (p) => { setCantDet(1); setDetalle(p) }
  const tile = (p, index) => {
    const n = enCarrito(p.id), libre = p.stock - n, agotado = p.stock === 0
    return <AnimatedCard index={index} key={p.id} className={'pos-tile' + (n ? ' in' : '') + (agotado ? ' out' : '')}>
      <button type="button" className="pos-tile-img" aria-label={`Ver ${p.nombre}`} onClick={() => abrir(p)}>
        <ProductThumbnail product={p} />
        {agotado ? <span className="pos-flag out">Agotado</span> : libre <= p.stock_min ? <span className="pos-flag low">Últimas {libre}</span> : null}
        {n > 0 && <span key={n} className="pos-qty-badge">{n}</span>}
      </button>
      <div className="pos-tile-body" onClick={() => abrir(p)}>
        <b className="pos-name">{p.nombre ? p.nombre.charAt(0).toUpperCase() + p.nombre.slice(1) : ''}</b>
        <span className="pos-meta">{p.marca || 'Genérica'}{!agotado && <> · {libre} disp.</>}</span>
        <span className="pos-price">{money(p.precio_venta)}</span>
        {agotado ? <span className="pos-add off">Sin stock</span> : n > 0 ? <div className="pos-step" role="group" aria-label={`Cantidad de ${p.nombre}`} onClick={e => e.stopPropagation()}>
          <button type="button" aria-label={`Disminuir ${p.nombre}`} onClick={() => disminuir(p)}>−</button>
          <output aria-live="polite">{n}</output>
          <button type="button" aria-label={`Aumentar ${p.nombre}`} disabled={libre <= 0} onClick={() => agregar(p)}>+</button>
        </div> : <button type="button" className="pos-add" onClick={e => { e.stopPropagation(); agregar(p) }}><I n="plus" />Agregar</button>}
      </div>
    </AnimatedCard>
  }

  const horaBog = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Bogota', hour: 'numeric', hourCycle: 'h23' }).format(new Date()))
  const saludo = horaBog < 12 ? 'Buenos días' : horaBog < 18 ? 'Buenas tardes' : 'Buenas noches'
  const iniciales = (perfil?.nombre || '').split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase()
  const vipCard = (
    <section className="pos-vip">
    <span className="pos-vip-rings" aria-hidden="true" />
    <div className="pos-vip-top">
      <span className="pos-hello-av">{iniciales || <I n="user" />}</span>
      <span className="pos-hello-txt"><small>{saludo},</small><b>{nombreCorto || 'vendedor'}</b></span>
      <button type="button" className={'pos-cart-btn' + (unidadesTotal ? ' has' : '')} onClick={() => carrito.length && setVerCarrito(true)} aria-label={`Carrito, ${unidadesTotal} productos`}>
        <I n="cart" />{unidadesTotal > 0 && <span key={unidadesTotal} className="pos-cart-n">{unidadesTotal}</span>}
      </button>
    </div>
    <span className="pos-vip-eyebrow">Punto de venta</span>
    <h1 className="pos-title">Nueva venta</h1>
    <div className="pos-vip-stats">
      <div><small>Ventas hoy</small><b>{hoyMio.n}</b></div>
      <div><small>Vendido hoy</small><b className="g">{money(hoyMio.total)}</b></div>
      <div className="live"><span className="pos-today-dot" />En turno</div>
    </div>
  </section>
  )
  const header = <div className="inv-head pos-head3">
    <div className="inv-head-top"><Brand compact /><ThemeToggle /></div>
  </div>

  return (
    <AppShell title="Nueva venta" header={header} footer={carrito.length > 0 && !verCarrito && (
        <button type="button" className="pos-bar" onClick={() => setVerCarrito(true)} aria-label={`Cobrar ${unidadesTotal} productos, total ${money(total)}`}>
          <span className="pos-bar-photos">{carrito.slice(0, 3).map(i => <ProductThumbnail key={i.key} product={i.producto} />)}</span>
          <span className="pos-bar-info"><small>{unidadesTotal} {unidadesTotal === 1 ? 'producto' : 'productos'}</small><strong key={total} className="motion-value">{money(total)}</strong></span>
          <span className="pos-bar-cta">Cobrar<I n="back" className="flip" /></span>
        </button>
      )}>
      {vipCard}

      <div className="inv-search">
        <label className="inv-search-box"><I n="search" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="¿Qué vas a vender hoy?" aria-label="Buscar producto" />{q && <button type="button" className="inv-scan" aria-label="Limpiar búsqueda" onClick={() => setQ('')}>✕</button>}</label>
      </div>

      <div className="pos-filters2">
        <button type="button" className={'pos-dd' + (categoria !== 'Todos' ? ' on' : '')} onClick={() => setHojaCat(true)} aria-haspopup="dialog">
          <span className="pos-dd-ic">{categoria === 'Todos' ? <I n="box" /> : <CategoryIcon categoria={categoria} />}</span>
          <span className="pos-dd-txt"><small>Categoría</small><b>{categoria === 'Todos' ? 'Todas' : categoria}</b></span>
          <I n="chevDown" className="pos-dd-chev" />
        </button>
        <button type="button" className={'pos-dd' + (marca !== 'Todas' ? ' on' : '')} disabled={marcas.length < 2} onClick={() => setHojaMarca(true)} aria-haspopup="dialog">
          <span className="pos-dd-ic"><I n="tag" /></span>
          <span className="pos-dd-txt"><small>Marca</small><b>{marca === 'Todas' ? (marcas.length === 1 ? marcas[0][0] : 'Todas') : marca}</b></span>
          {marca !== 'Todas' ? <span className="pos-dd-x" role="button" aria-label="Quitar marca" onClick={(e) => { e.stopPropagation(); setMarca('Todas') }}>✕</span> : <I n="chevDown" className="pos-dd-chev" />}
        </button>
      </div>
      {hojaCat && <Modal title="Categoría" className="flt-sheet" onClose={() => setHojaCat(false)}>
        <div className="pos-cat-grid">
          {catsVisibles.map(([nombre, n]) => <button key={nombre} type="button" className={categoria === nombre ? 'on' : ''} aria-pressed={categoria === nombre} onClick={() => { setCategoria(nombre); setHojaCat(false) }}>
            <span className="pos-cg-ic">{nombre === 'Todos' ? <I n="box" /> : <CategoryIcon categoria={nombre} />}</span>
            <b>{nombre === 'Todos' ? 'Todas' : nombre}</b><small>{n} {n === 1 ? 'producto' : 'productos'}</small>
            {categoria === nombre && <span className="flt-check"><I n="check" /></span>}
          </button>)}
        </div>
      </Modal>}
      {hojaMarca && <Modal title="Marca" subtitle={categoria === 'Todos' ? 'Todas las categorías' : categoria} className="flt-sheet" onClose={() => setHojaMarca(false)}>
        <div className="pos-cat-grid pos-brand-grid">
          {[['Todas', enCategoria.length], ...marcas].map(([m, n]) => <button key={m} type="button" className={marca === m ? 'on' : ''} aria-pressed={marca === m} onClick={() => { setMarca(m); setHojaMarca(false) }}>
            <span className="pos-cg-ic pos-bm">{m === 'Todas' ? <I n="tag" /> : m.slice(0, 2).toUpperCase()}</span>
            <b>{m === 'Todas' ? 'Todas' : m}</b><small>{n} {n === 1 ? 'producto' : 'productos'}</small>
            {marca === m && <span className="flt-check"><I n="check" /></span>}
          </button>)}
        </div>
      </Modal>}

      {cargando ? <div className="pos-skel">{[0, 1, 2, 3].map(i => <div key={i} className="pos-skel-tile"><span /><i /><i /><b /></div>)}</div>
      : visibles.length === 0 ? <Empty text="Sin productos" description={q ? 'Prueba con otro nombre o código.' : 'No hay productos en esta categoría.'} />
      : categoria === 'Todos' && marca === 'Todas' && !q && !verCatalogo ? <div className="pos-top">
          <header className="pos-top-head">
            <span className="pos-top-ic"><I n="tag" /></span>
            <div><h3>{top.propios ? 'Tus más vendidos' : 'Más vendidos de la tienda'}</h3><p>{top.lista.length ? (top.propios ? 'Lo que más vendes, a un toque' : 'Aún no tienes ventas propias') : 'Cuando vendas, aquí verás tus favoritos'}</p></div>
          </header>
          {top.lista.length > 0 ? <div className="pos-grid">{top.lista.map(({ p, n }, i) => <div key={p.id} className="pos-rank-wrap"><span className={'pos-rank r' + (i + 1)}>#{i + 1}</span><span className="pos-sold">{n} {n === 1 ? 'vendido' : 'vendidos'}</span>{tile(p, i)}</div>)}</div>
            : <div className="pos-grid">{disponibles.filter(p => p.stock > 0).slice(0, 4).map((p, i) => tile(p, i))}</div>}
          <button type="button" className="fv-history-btn pos-all" onClick={() => setVerCatalogo(true)}>
            <span className="fv-history-ic"><I n="box" /></span>
            <span><b>Ver todo el catálogo</b><small>{disponibles.length} productos · busca por categoría o marca</small></span>
            <I n="back" className="flip" />
          </button>
        </div>
      : <>{verCatalogo && categoria === 'Todos' && marca === 'Todas' && !q && <button type="button" className="pos-back-top" onClick={() => setVerCatalogo(false)}><I n="back" />Volver a mis más vendidos</button>}<div className="pos-grid">{visibles.map((p, i) => tile(p, i))}</div></>}

      {detalle && (() => {
        const p = res.find(x => x.id === detalle.id) || detalle, n = enCarrito(p.id), libre = p.stock - n
        return <Modal title="Detalle del producto" className="experience-sheet pos-detail" onClose={() => setDetalle(null)} footer={libre > 0 && !p.maneja_serial ? <div className="pos-detail-foot">
            <div className="pos-step"><button type="button" aria-label="Menos" disabled={cantDet <= 1} onClick={() => setCantDet(c => Math.max(1, c - 1))}>−</button><output>{cantDet}</output><button type="button" aria-label="Más" disabled={cantDet >= libre} onClick={() => setCantDet(c => Math.min(libre, c + 1))}>+</button></div>
            <button type="button" className="inv-btn-gold" onClick={() => { agregarVarios(p, cantDet); setDetalle(null) }}>Agregar · {money(p.precio_venta * cantDet)}</button>
          </div> : p.maneja_serial && libre > 0 ? <button type="button" className="inv-btn-gold full" onClick={() => { setDetalle(null); agregar(p) }}>Elegir unidad</button> : <button type="button" className="inv-btn-outline full" disabled>Sin unidades disponibles</button>}>
          <div className="pos-detail-img"><ProductThumbnail product={p} /></div>
          <span className="pos-detail-eyebrow">{[p.categoria, p.marca || 'Genérica'].filter(Boolean).join(' · ')}</span>
          <h2 className="pos-detail-name">{p.nombre ? p.nombre.charAt(0).toUpperCase() + p.nombre.slice(1) : ''}</h2>
          {p.descripcion && <p className="pos-detail-desc">{p.descripcion}</p>}
          <div className="pos-detail-box">
            <div><span>Precio</span><b className="gold">{money(p.precio_venta)}</b></div>
            <div><span>Disponibles</span><b className={libre <= 0 ? 'bad' : libre <= p.stock_min ? 'warn' : 'good'}>{libre} {libre === 1 ? 'unidad' : 'unidades'}</b></div>
            {n > 0 && <div><span>Ya en la venta</span><b>{n}</b></div>}
            <div><span>Código</span><b className="mono">{p.codigo}</b></div>
          </div>
          {libre > 0 && libre <= p.stock_min && <p className="pos-detail-note warn"><I n="warn" />Quedan pocas unidades de este producto.</p>}
        </Modal>
      })()}
      {remove && <ConfirmAction title={remove==='all'?'Vaciar carrito':'Quitar producto'} label="Quitar" onClose={()=>setRemove(null)} onConfirm={()=>setCarrito(c=>remove==='all'?[]:c.filter(i=>i.key!==remove.key))}>Se quitaran {remove==='all'?'todos los productos':remove.producto.nombre} del carrito. No cambia el inventario.</ConfirmAction>}
      {verCliente === 'nuevo' && <ClienteForm onClose={() => setVerCliente(false)} onSaved={(c) => { setCliente(c); setVerCliente(false) }} />}
      {verCliente && verCliente !== 'nuevo' && <ClientePicker sinConsumidor onClose={() => setVerCliente(false)} onPick={(c) => { setCliente(c); setVerCliente(false) }} />}
      {facturaId && <FacturaDetalle id={facturaId} nueva onClose={() => setFacturaId(null)} />}

      {serialDe && (
        <Modal title={`Serial · ${serialDe.nombre}`} subtitle="Selecciona una unidad disponible" className="experience-sheet serial-picker-sheet" keyboardAware onClose={() => setSerialDe(null)}>
          <div className="serial-product"><ProductThumbnail product={serialDe}/><span><b>{serialDe.nombre}</b><small>{unidades.length} unidades disponibles</small></span></div>
          <div className="serial-list">{unidades.map((u) => <button type="button" key={u.id} className="row serial-option" onClick={() => agregarUnidad(u)}><span className="serial-mark"><Icon name="scan"/></span><span className="flex-1"><small>SERIAL / IMEI</small><b>{u.serial}</b><Badge tone="good">Disponible</Badge></span><span className="serial-select">Elegir <span aria-hidden="true">›</span></span></button>)}</div>
        </Modal>
      )}

      {verCarrito && (() => {
        const mp = METODOS_PAGO.find(m => m[0] === metodo) || METODOS_PAGO[0]
        return <Modal expanded={expand} title="Tu venta" subtitle="Revisa y cobra" className="experience-sheet checkout-sheet pos-checkout pos-ck" keyboardAware onClose={() => setVerCarrito(false)} footer={
          <button className={'pos-pay2' + (cliente ? '' : ' locked')} disabled={busy || pendingSale || carrito.length === 0} onClick={() => { if (!cliente) { setFaltaCliente(true); setTimeout(() => setFaltaCliente(false), 600); return toast('Elige o registra el cliente para continuar') } facturar() }}>
            <span className="pos-pay2-ic"><I n={cliente ? mp[2] : 'user'} /></span>
            <span className="pos-pay2-txt"><small>{busy ? 'Procesando…' : cliente ? 'Cobrar en ' + mp[1].toLowerCase() : 'Falta el cliente'}</small><b>{busy ? 'Facturando' : money(total)}</b></span>
            <span className="pos-pay2-go"><I n="back" className="flip" /></span>
          </button>}>
          <ErrorBox text={err} />

          <div className="pos-step-head"><span className="pos-step-n">1</span><h4>Productos</h4><button type="button" className="pos-clear" disabled={!carrito.length} onClick={()=>setRemove('all')}><I n="trash" />Vaciar</button></div>
          <div className="pos-lines">
          {carrito.map((i) => (
            <div key={i.key} className="pos-line">
              <ProductThumbnail product={i.producto} />
              <div className="pos-line-txt"><b>{i.producto.nombre}</b><small>{i.unidad ? 'Serial ' + i.unidad.serial : money(i.producto.precio_venta) + ' c/u'}</small>
                <div className="pos-line-ctrl">{!i.unidad ? <div className="pos-step sm"><button type="button" aria-label="Disminuir" onClick={() => i.cantidad <= 1 ? quitar(i) : cambiarCant(i, i.cantidad - 1)}>−</button><output>{i.cantidad}</output><button type="button" aria-label="Aumentar" disabled={i.cantidad >= i.producto.stock} onClick={() => cambiarCant(i, i.cantidad + 1)}>+</button></div> : <span />}<b className="pos-line-total">{money(i.producto.precio_venta*i.cantidad)}</b></div>
              </div>
              <button className="pos-line-x" aria-label={`Quitar ${i.producto.nombre}`} onClick={() => quitar(i)}><I n="trash" /></button>
            </div>
          ))}
          </div>

          <div className="pos-step-head"><span className="pos-step-n">2</span><h4>Datos del cliente</h4>{!cliente && <span className="pos-req">Obligatorio</span>}</div>
          {cliente ? <div className="pos-client in-sheet sel">
            <span className="pos-client-av">{cliente.nombre.split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase()}</span>
            <span className="pos-client-txt"><small>{[cliente.tipo_documento, cliente.documento].filter(Boolean).join(' ') || 'Cliente'}{cliente.telefono ? ' · ' + cliente.telefono : ''}</small><b>{cliente.nombre}</b></span>
            <button type="button" className="pos-client-act" onClick={() => setCliente(null)}>Cambiar</button>
          </div> : <div className={'pos-who2' + (faltaCliente ? ' shake' : '')}>
            <button type="button" onClick={() => setVerCliente('buscar')}><span className="pos-who2-ic"><I n="search" /></span><span><b>Cliente registrado</b><small>Buscar por nombre o documento</small></span></button>
            {can('crear_clientes') && <button type="button" onClick={() => setVerCliente('nuevo')}><span className="pos-who2-ic"><I n="plus" /></span><span><b>Cliente nuevo</b><small>Registrar sus datos</small></span></button>}
          </div>}
          {isDemoMode && esAdmin && <Select label="Vendedor" value={seller} onChange={e=>setSeller(e.target.value)}>{sellers.map(p=><option key={p.id} value={p.id}>{p.nombre}</option>)}</Select>}

          <div className="pos-step-head"><span className="pos-step-n">3</span><h4>Forma de pago</h4></div>
          <div className="pos-pays2">{METODOS_PAGO.map(([k, l, ic]) => <button key={k} type="button" className={'m-' + k + (metodo === k ? ' on' : '')} aria-pressed={metodo === k} onClick={() => setMetodo(k)}><span className="pos-pays2-ic"><I n={ic} /></span><span>{l}</span></button>)}</div>

          {!extras && !desc && !notas ? <button type="button" className="pos-more" onClick={() => setExtras(true)}><I n="plus" />Agregar descuento o nota</button>
          : <div className="pos-extra">
            <Input disabled={!can('editar_precios')} title={!can('editar_precios')?'Tu perfil no puede aplicar descuentos':undefined} label="Descuento ($)" inputMode="numeric" value={descuento} onChange={(e) => setDescuento(e.target.value.replace(/\D/g, ''))} />
            <Input label="Nota (opcional)" value={notas} onChange={(e) => setNotas(e.target.value)} />
          </div>}
          <div className="pos-sum">
            <div><span>Subtotal · {unidadesTotal} {unidadesTotal === 1 ? 'producto' : 'productos'}</span><b>{money(subtotal)}</b></div>
            {desc > 0 && <div className="disc"><span>Descuento</span><b>−{money(desc)}</b></div>}
            <div className="grand"><span>Total</span><b>{money(total)}</b></div>
          </div>
        </Modal>
      })()}
    </AppShell>
  )
}
