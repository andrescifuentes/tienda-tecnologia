import { useEffect, useMemo, useState } from 'react'
import AppShell from '../components/AppShell'
import Modal from '../components/Modal'
import Scanner from '../components/Scanner'
import ClientePicker from '../components/ClientePicker'
import FacturaDetalle from '../components/FacturaDetalle'
import { SearchBar, Empty, Badge, Stepper, ErrorBox, Chips, Input } from '../components/ui'
import { supabase } from '../lib/supabase'
import { money, limpiarBusqueda, mensajeError } from '../lib/format'
import { toast } from '../lib/toast'

export default function Vender() {
  const [q, setQ] = useState('')
  const [res, setRes] = useState([])
  const [carrito, setCarrito] = useState([]) // {key, producto, cantidad, unidad?}
  const [cliente, setCliente] = useState(null)
  const [metodo, setMetodo] = useState('efectivo')
  const [descuento, setDescuento] = useState('')
  const [notas, setNotas] = useState('')
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
  }, [q])

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
      const i = c.find((x) => x.producto.id === p.id && !x.unidad)
      return i ? c.map((x) => (x === i ? { ...x, cantidad: x.cantidad + 1 } : x)) : [...c, { key: 'p' + p.id, producto: p, cantidad: 1 }]
    })
    toast(`${p.nombre} agregado`)
  }
  function agregarUnidad(u) {
    setCarrito((c) => [...c, { key: 'u' + u.id, producto: serialDe, cantidad: 1, unidad: u }])
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
  function quitar(i) { setCarrito((c) => c.filter((x) => x !== i)) }

  async function facturar() {
    setErr(''); setBusy(true)
    const items = carrito.map((i) => (i.unidad ? { producto_id: i.producto.id, cantidad: 1, unidad_id: i.unidad.id } : { producto_id: i.producto.id, cantidad: i.cantidad, descuento: 0 }))
    const { data, error } = await supabase.rpc('emitir_factura', { p_cliente_id: cliente?.id ?? null, p_metodo_pago: metodo, p_items: items, p_descuento: desc, p_notas: notas.trim() || null })
    setBusy(false)
    if (error) return setErr(mensajeError(error))
    const id = typeof data === 'object' && data !== null ? (data.id ?? data.factura_id ?? Object.values(data)[0]) : data
    setCarrito([]); setCliente(null); setDescuento(''); setNotas(''); setVerCarrito(false); setQ('')
    setFacturaId(id)
  }

  return (
    <AppShell title="Nueva venta" sub={cliente ? cliente.nombre : 'Consumidor final'} right={carrito.length > 0 && <button className="btn sm !bg-white !text-brand" onClick={() => setVerCarrito(true)}>Carrito ({unidadesTotal})</button>}>
      <SearchBar value={q} onChange={setQ} placeholder="Buscar producto o código" onScan={() => setScan(true)} />
      {res.length === 0 ? <Empty text="Sin productos" /> : (
        <div className="card !p-2">
          {res.map((p) => (
            <div key={p.id} className="row cursor-pointer" onClick={() => p.stock > 0 && agregar(p)} style={{ opacity: p.stock > 0 ? 1 : 0.5 }}>
              <div className="flex-1 min-w-0">
                <p className="m-0 text-sm font-semibold">{p.nombre}</p>
                <p className="m-0 text-xs text-muted">{p.codigo}{p.marca ? ' · ' + p.marca : ''}{p.maneja_serial ? ' · serial' : ''}</p>
              </div>
              <div className="text-right">
                <p className="m-0 text-sm font-bold">{money(p.precio_venta)}</p>
                <Badge tone={p.stock === 0 ? 'bad' : p.stock <= p.stock_min ? 'warn' : 'good'}>{p.stock === 0 ? 'Agotado' : p.stock + ' disp.'}</Badge>
              </div>
            </div>
          ))}
        </div>
      )}

      {carrito.length > 0 && !verCarrito && (
        <div className="sticky bottom-0 mt-3"><button className="btn full" onClick={() => setVerCarrito(true)}>Ver carrito · {unidadesTotal} · {money(total)}</button></div>
      )}

      {scan && <Scanner onClose={() => setScan(false)} onScan={alEscanear} />}
      {verCliente && <ClientePicker onClose={() => setVerCliente(false)} onPick={(c) => { setCliente(c); setVerCliente(false) }} />}
      {facturaId && <FacturaDetalle id={facturaId} nueva onClose={() => setFacturaId(null)} />}

      {serialDe && (
        <Modal title={`Serial · ${serialDe.nombre}`} onClose={() => setSerialDe(null)}>
          {unidades.map((u) => <div key={u.id} className="row cursor-pointer" onClick={() => agregarUnidad(u)}><span className="flex-1 text-sm font-semibold">{u.serial}</span><span className="text-brand text-sm font-bold">Elegir</span></div>)}
        </Modal>
      )}

      {verCarrito && (
        <Modal title="Carrito" onClose={() => setVerCarrito(false)} footer={
          <button className="btn full" disabled={busy || carrito.length === 0} onClick={facturar}>{busy ? 'Facturando…' : `Facturar ${money(total)}`}</button>}>
          <ErrorBox text={err} />
          {carrito.map((i) => (
            <div key={i.key} className="row">
              <div className="flex-1 min-w-0"><p className="m-0 text-sm font-semibold">{i.producto.nombre}</p><p className="m-0 text-xs text-muted">{i.unidad ? 'Serial ' + i.unidad.serial : money(i.producto.precio_venta) + ' c/u'}</p></div>
              {!i.unidad && <Stepper value={i.cantidad} max={i.producto.stock} onChange={(n) => cambiarCant(i, n)} />}
              <button className="btn bad sm" onClick={() => quitar(i)}>✕</button>
            </div>
          ))}
          <div className="mt-3">
            <label className="lbl">Cliente</label>
            <button className="btn sec full mb-3" onClick={() => setVerCliente(true)}>{cliente ? `${cliente.nombre} (${cliente.documento})` : 'Consumidor final · tocar para elegir'}</button>
            <label className="lbl">Método de pago</label>
            <Chips value={metodo} onChange={setMetodo} options={[{ value: 'efectivo', label: 'Efectivo' }, { value: 'tarjeta', label: 'Tarjeta' }, { value: 'transferencia', label: 'Transferencia' }]} />
            <Input label="Descuento ($)" inputMode="numeric" value={descuento} onChange={(e) => setDescuento(e.target.value.replace(/\D/g, ''))} />
            <Input label="Notas (opcional)" value={notas} onChange={(e) => setNotas(e.target.value)} />
            <div className="flex justify-between text-sm"><span className="text-muted">Subtotal</span><b>{money(subtotal)}</b></div>
            {desc > 0 && <div className="flex justify-between text-sm"><span className="text-muted">Descuento</span><b>-{money(desc)}</b></div>}
            <div className="flex justify-between text-lg mt-1"><span>Total</span><b>{money(total)}</b></div>
          </div>
        </Modal>
      )}
    </AppShell>
  )
}
