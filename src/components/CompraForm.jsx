import { useEffect, useRef, useState } from 'react'
import Modal from './Modal'
import Scanner from './Scanner'
import { Input, Select, ErrorBox, Empty, SearchBar } from './ui'
import { useAction } from '../lib/useAction'
import { imageKey } from '../lib/demo/images'
import { supabase, isDemoMode } from '../lib/supabase'
import { money, limpiarBusqueda, mensajeError, hoyBogota } from '../lib/format'
import { toast } from '../lib/toast'

// Ingreso de mercancía = registrar compra a un proveedor
export default function CompraForm({ proveedorId, onClose, onSaved }) {
  const [provs, setProvs] = useState([])
  const [prov, setProv] = useState(proveedorId || '')
  const requestId = useRef(imageKey())
  const [date, setDate] = useState(hoyBogota()), [notes, setNotes] = useState('')
  const [doc, setDoc] = useState('')
  const [forma, setForma] = useState('contado')
  const [vence, setVence] = useState('')
  const [metodo, setMetodo] = useState('efectivo')
  const [items, setItems] = useState([]) // {producto, cantidad, costo, seriales:''}
  const [buscar, setBuscar] = useState(false)
  const [scan, setScan] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { supabase.from('proveedores').select('id,nombre').eq('activo', true).order('nombre').then(({ data }) => setProvs(data || [])) }, [])

  const add = (p) => {
    setBuscar(false)
    if (items.some((i) => i.producto.id === p.id)) return toast('Ya está en la lista')
    setItems([...items, { producto: p, cantidad: 1, costo: p.precio_compra || 0, seriales: '' }])
  }
  const upd = (idx, k, v) => setItems(items.map((it, i) => (i === idx ? { ...it, [k]: v } : it)))
  const total = items.reduce((a, i) => a + (Number(i.cantidad) || 0) * (Number(i.costo) || 0), 0)

  const [guardar, pendingSave] = useAction(guardarImpl, () => setBusy(false))
  async function guardarImpl() {
    setErr('')
    if (!prov) return setErr('Elige el proveedor.')
    if (items.length === 0) return setErr('Agrega al menos un producto.')
    if (forma === 'credito' && !vence) return setErr('Indica la fecha de vencimiento del crédito.')
    const p_items = [], p_seriales = []
    for (const i of items) {
      const cant = Number(i.cantidad)
      if (!Number.isInteger(cant) || cant <= 0) return setErr(`Cantidad inválida en ${i.producto.nombre}`)
      if (!Number.isFinite(Number(i.costo)) || Number(i.costo) < 0) return setErr(`Costo inválido en ${i.producto.nombre}`)
      p_items.push({ producto_id: i.producto.id, cantidad: cant, costo_unitario: Number(i.costo) || 0 })
      if (i.producto.maneja_serial) {
        const ss = i.seriales.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)
        if (ss.length !== cant) return setErr(`${i.producto.nombre}: escribe ${cant} seriales (uno por línea). Llevas ${ss.length}.`)
        ss.forEach((s) => p_seriales.push({ producto_id: i.producto.id, serial: s }))
      }
    }
    setBusy(true)
    const { error } = await supabase.rpc('registrar_compra', {
      p_proveedor_id: Number(prov), p_numero_documento: doc.trim() || null, p_forma_pago: forma,
      ...(isDemoMode?{p_fecha:date,p_notas:notes.trim(),p_request_id:requestId.current}:{}),
      p_vence_el: forma === 'credito' ? vence : null, p_items, p_seriales, p_metodo_pago: metodo,
    })
    setBusy(false)
    if (error) return setErr(mensajeError(error))
    toast('Mercancía registrada'); onSaved?.()
  }

  return (
    <Modal title="Ingreso de mercancía" onClose={onClose} footer={<button className="btn full" onClick={guardar} disabled={busy || pendingSave}>{busy ? 'Guardando…' : `Registrar compra · ${money(total)}`}</button>}>
      <ErrorBox text={err} />
      <Select required label="Proveedor" value={prov} onChange={(e) => setProv(e.target.value)}>
        <option value="">Elegir…</option>{provs.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
      </Select>
      <Input label="N.º factura del proveedor" value={doc} onChange={(e) => setDoc(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <Select label="Forma de pago" value={forma} onChange={(e) => setForma(e.target.value)}><option value="contado">Contado</option><option value="credito">Crédito</option></Select>
        {forma === 'contado'
          ? <Select label="Método" value={metodo} onChange={(e) => setMetodo(e.target.value)}><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option><option value="tarjeta">Tarjeta</option></Select>
          : <Input label="Vence el" type="date" min={hoyBogota()} value={vence} onChange={(e) => setVence(e.target.value)} />}
      </div>
      {isDemoMode && <><Input label="Fecha compra" type="date" required value={date} onChange={e=>setDate(e.target.value)} /><Input label="Notas compra" value={notes} onChange={e=>setNotes(e.target.value)} /></>}
      <h4 className="text-sm text-muted uppercase mb-1">Productos</h4>
      {items.length === 0 && <Empty text="Agrega productos" />}
      {items.map((i, idx) => (
        <div key={i.producto.id} className="card !p-3 mb-2">
          <div className="flex justify-between"><b className="text-sm">{i.producto.nombre}</b><button className="btn bad sm" onClick={() => setItems(items.filter((_, k) => k !== idx))}>✕</button></div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <Input label="Cantidad" type="number" min="1" value={i.cantidad} onChange={(e) => upd(idx, 'cantidad', e.target.value)} />
            <Input label="Costo unitario" type="number" min="0" value={i.costo} onChange={(e) => upd(idx, 'costo', e.target.value)} />
          </div>
          {i.producto.maneja_serial && (
            <div><label className="lbl">Seriales / IMEI (uno por línea)</label><textarea className="inp" rows={3} value={i.seriales} onChange={(e) => upd(idx, 'seriales', e.target.value)} /></div>
          )}
          <div className="flex justify-between text-sm"><span className="text-muted">Subtotal</span><b>{money(Number(i.cantidad)*Number(i.costo))}</b></div>
        </div>
      ))}
      <button className="btn sec full" onClick={() => setBuscar(true)}>+ Agregar producto</button>
      <div className="flex justify-between text-base mt-3"><span>Total compra</span><b>{money(total)}</b></div>
      {buscar && <BuscarProducto onClose={() => setBuscar(false)} onPick={add} onScan={() => setScan(true)} />}
      {scan && <Scanner onClose={() => setScan(false)} onScan={async (c) => {
        setScan(false)
        const { data } = await supabase.from('productos').select('*').or(`codigo_barras.eq.${limpiarBusqueda(c)},codigo.eq.${limpiarBusqueda(c)}`).limit(1)
        data?.[0] ? add(data[0]) : toast('Producto no encontrado: créalo primero en Inventario')
      }} />}
    </Modal>
  )
}

function BuscarProducto({ onPick, onClose, onScan }) {
  const [q, setQ] = useState(''); const [lista, setLista] = useState([])
  useEffect(() => {
    const t = setTimeout(async () => {
      const s = limpiarBusqueda(q)
      let qq = supabase.from('productos').select('*').eq('activo', true).order('nombre').limit(30)
      if (s) qq = qq.or(`nombre.ilike.%${s}%,codigo.ilike.%${s}%,codigo_barras.ilike.%${s}%`)
      const { data } = await qq; setLista(data || [])
    }, 250)
    return () => clearTimeout(t)
  }, [q])
  return (
    <Modal title="Elegir producto" onClose={onClose}>
      <SearchBar value={q} onChange={setQ} onScan={onScan} placeholder="Nombre o código" />
      {lista.map((p) => <div key={p.id} className="row cursor-pointer" onClick={() => onPick(p)}><div className="flex-1"><p className="m-0 text-sm font-semibold">{p.nombre}</p><p className="m-0 text-xs text-muted">{p.codigo} · stock {p.stock}</p></div></div>)}
    </Modal>
  )
}
