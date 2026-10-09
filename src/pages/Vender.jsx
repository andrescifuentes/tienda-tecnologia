import { useEffect, useMemo, useState } from 'react'
import AppShell from '../components/AppShell'
import { monetaryError } from '../lib/money'
import { AnimatedCard, ProductThumbnail } from '../components/TechVisuals'
import { Icon } from '../components/Icons'
import Modal from '../components/Modal'
import { FormSection } from '../components/AdminPrimitives'
import Scanner from '../components/Scanner'
import ClientePicker from '../components/ClientePicker'
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
  const [categoria, setCategoria] = useState('Todos'); const [refresh, setRefresh] = useState(0)
  const [q, setQ] = useState(() => new URLSearchParams(window.location.search).get('q') || '')
  const [res, setRes] = useState([])
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
      let qq = supabase.from('productos_venta').select('*').order('nombre').limit(30)
      if (s) qq = qq.or(`nombre.ilike.%${s}%,codigo.ilike.%${s}%,codigo_barras.ilike.%${s}%,marca.ilike.%${s}%`)
      const { data } = await qq
      setRes(data || [])
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

  return (
    <AppShell title="Nueva venta" sub={cliente ? cliente.nombre : 'Consumidor final'} right={carrito.length > 0 && <button className="btn sec sm" onClick={() => setVerCarrito(true)}><Icon name="cart" className="w-4 h-4" /> Carrito <span key={unidadesTotal} className="cart-count">{unidadesTotal}</span></button>} footer={carrito.length > 0 && !verCarrito && (
        <div className="cart-bar"><div className="cart-preview"><div className="cart-photos">{carrito.slice(0,3).map(i => <ProductThumbnail key={i.key} product={i.producto} />)}</div><span>{unidadesTotal} {unidadesTotal === 1 ? 'producto' : 'productos'} en tu carrito</span></div><button className="cart-bar-button" onClick={() => setVerCarrito(true)} aria-label={`Ver carrito, ${unidadesTotal} productos, total ${money(total)}`}>
          <span><small><span key={unidadesTotal} className="motion-value">{unidadesTotal}</span> {unidadesTotal === 1 ? 'producto' : 'productos'} · {desc > 0 ? 'Total' : 'Subtotal'}</small><strong key={total} className="motion-value">{money(total)}</strong></span>
          <span className="cart-cta">Procesar venta <Icon name="arrow" className="w-4 h-4" /></span>
        </button></div>
      )}>
      <SearchBar value={q} onChange={setQ} placeholder="Buscar producto o código" onScan={() => setScan(true)} />
      <Chips value={categoria} onChange={setCategoria} options={['Todos', ...categoryOptions.map(c=>c.nombre)].map(value=>({value,label:value}))} />
      {res.filter(p=>categoria==='Todos'||p.categoria===categoria).length === 0 ? <Empty text="Sin productos" /> : (
        <div className="product-list">
          {res.filter(p=>categoria==='Todos'||p.categoria===categoria).map((p, index) => (
            <AnimatedCard index={index} key={p.id} className="row product-card sale-product inline-sale-product" onClick={e=>{if(!e.target.closest('button')&&p.stock>enCarrito(p.id))agregar(p)}} style={{ opacity: p.stock > 0 ? 1 : 0.5 }}>
              <button type="button" className="sale-product-main" aria-label={`Agregar ${p.nombre}`} disabled={enCarrito(p.id)>=p.stock} onClick={()=>agregar(p)}>
              <ProductThumbnail product={p} />
              <div className="flex-1 min-w-0">
                <p className="m-0 text-sm font-semibold">{p.nombre}</p>
                <p className="m-0 text-xs text-muted">{p.codigo}{p.marca ? ' · ' + p.marca : ''}{p.maneja_serial ? ' · serial' : ''}</p>
                <Badge tone={p.stock === 0 ? 'bad' : p.stock-enCarrito(p.id) <= p.stock_min ? 'warn' : 'good'}>{p.stock === 0 ? 'Agotado' : (p.stock-enCarrito(p.id)) + ' disp.'}</Badge>
              </div>
              <div className="text-right">
                <p className="m-0 text-sm font-bold">{money(p.precio_venta)}</p>
              </div>
              </button>
              <div className={'sale-inline-control'+(enCarrito(p.id)>0?' selected':'')} role="group" aria-label={`Cantidad de ${p.nombre}`}>
                {enCarrito(p.id)>0&&<><button type="button" aria-label={`Disminuir ${p.nombre}`} title={p.maneja_serial?'Quita el último serial seleccionado':undefined} onClick={()=>disminuir(p)}>−</button><output aria-label={`Unidades de ${p.nombre}`} aria-live="polite">{enCarrito(p.id)}</output></>}
                <button type="button" aria-label={`Aumentar ${p.nombre}`} disabled={enCarrito(p.id)>=p.stock} onClick={()=>agregar(p)}><Icon name="plus"/></button>
              </div>
            </AnimatedCard>
          ))}
        </div>
      )}
      {remove && <ConfirmAction title={remove==='all'?'Vaciar carrito':'Quitar producto'} label="Quitar" onClose={()=>setRemove(null)} onConfirm={()=>setCarrito(c=>remove==='all'?[]:c.filter(i=>i.key!==remove.key))}>Se quitaran {remove==='all'?'todos los productos':remove.producto.nombre} del carrito. No cambia el inventario.</ConfirmAction>}
      {scan && <Scanner onClose={() => setScan(false)} onScan={alEscanear} />}
      {verCliente && <ClientePicker onClose={() => setVerCliente(false)} onPick={(c) => { setCliente(c); setVerCliente(false) }} />}
      {facturaId && <FacturaDetalle id={facturaId} nueva onClose={() => setFacturaId(null)} />}

      {serialDe && (
        <Modal title={`Serial · ${serialDe.nombre}`} subtitle="Selecciona una unidad disponible" className="experience-sheet serial-picker-sheet" keyboardAware onClose={() => setSerialDe(null)}>
          <div className="serial-product"><ProductThumbnail product={serialDe}/><span><b>{serialDe.nombre}</b><small>{unidades.length} unidades disponibles</small></span></div>
          <div className="serial-list">{unidades.map((u) => <button type="button" key={u.id} className="row serial-option" onClick={() => agregarUnidad(u)}><span className="serial-mark"><Icon name="scan"/></span><span className="flex-1"><small>SERIAL / IMEI</small><b>{u.serial}</b><Badge tone="good">Disponible</Badge></span><span className="serial-select">Elegir <span aria-hidden="true">›</span></span></button>)}</div>
        </Modal>
      )}

      {verCarrito && (
        <Modal expanded={expand} title="Carrito" subtitle="Revisa tu venta antes de confirmar" className="experience-sheet checkout-sheet" keyboardAware onClose={() => setVerCarrito(false)} footer={
          <button className="btn full" disabled={busy || pendingSale || carrito.length === 0} onClick={facturar}>{busy ? 'Facturando…' : `Confirmar venta · ${money(total)}`}</button>}>
          <div className="flex gap-2 mb-2"><button className="btn sec sm" onClick={()=>setExpand(!expand)}>{expand?'Contraer carrito':'Expandir carrito'}</button><button className="btn sec sm" disabled={!carrito.length} onClick={()=>setRemove('all')}>Vaciar carrito</button></div>
          <ErrorBox text={err} />
          <FormSection number="01" title="Tu selección">
          {carrito.map((i) => (
            <div key={i.key} className="row checkout-item">
              <ProductThumbnail product={i.producto} />
              <div className="flex-1 min-w-0"><p className="m-0 text-sm font-semibold">{i.producto.nombre}</p><p className="m-0 text-xs text-muted">{i.unidad ? 'Serial ' + i.unidad.serial : money(i.producto.precio_venta) + ' c/u'}</p></div>
              <div className="checkout-item-controls">{!i.unidad && <Stepper value={i.cantidad} max={i.producto.stock} onChange={(n) => cambiarCant(i, n)} />}<b>{money(i.producto.precio_venta*i.cantidad)}</b><button className="checkout-remove" aria-label={`Quitar ${i.producto.nombre}`} onClick={() => quitar(i)}><Icon name="trash"/></button></div>
            </div>
          ))}
          </FormSection><div className="mt-3">
            <FormSection number="02" title="Cliente y vendedor">
            <label className="lbl">Cliente</label>
            <button className="btn sec full mb-3" onClick={() => setVerCliente(true)}>{cliente ? cliente.nombre + (cliente.documento?' ('+cliente.documento+')':'') : 'Consumidor final · tocar para elegir'}</button>
            {isDemoMode && esAdmin && <Select label="Vendedor" value={seller} onChange={e=>setSeller(e.target.value)}>{sellers.map(p=><option key={p.id} value={p.id}>{p.nombre}</option>)}</Select>}
            </FormSection><FormSection number="03" title="Pago y observaciones">
            <label className="lbl">Método de pago</label>
            <Chips value={metodo} onChange={setMetodo} options={[{ value: 'efectivo', label: 'Efectivo' }, { value: 'tarjeta', label: 'Tarjeta' }, { value: 'transferencia', label: 'Transferencia' }]} />
            <Input disabled={!can('editar_precios')} title={!can('editar_precios')?'Tu perfil no puede aplicar descuentos':undefined} label="Descuento ($)" inputMode="numeric" value={descuento} onChange={(e) => setDescuento(e.target.value.replace(/\D/g, ''))} />
            <Input label="Notas (opcional)" value={notas} onChange={(e) => setNotas(e.target.value)} />
            </FormSection><div className="checkout-totals">
            <div className="flex justify-between text-sm"><span className="text-muted">Subtotal</span><b>{money(subtotal)}</b></div>
            {desc > 0 && <div className="flex justify-between text-sm"><span className="text-muted">Descuento</span><b>-{money(desc)}</b></div>}
            <div className="flex justify-between text-lg mt-1"><span>Total</span><b>{money(total)}</b></div>
            </div>
          </div>
        </Modal>
      )}
    </AppShell>
  )
}
