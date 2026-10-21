import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useLocales } from '../lib/locales'
import LocalSelector from './LocalSelector'
import Modal from './Modal'
import { monetaryError } from '../lib/money'
import Scanner from './Scanner'
import DateField from './DateField'
import { FormSection } from './AdminPrimitives'
import { ProductThumbnail } from './TechVisuals'
import { Input, Select, ErrorBox, Empty, SearchBar } from './ui'
import { useAction } from '../lib/useAction'
import { imageKey } from '../lib/demo/images'
import { supabase, isDemoMode } from '../lib/supabase'
import { money, limpiarBusqueda, mensajeError, hoyBogota } from '../lib/format'
import { toast } from '../lib/toast'
import { I } from './InvIcons'

// Ingreso de mercancía = registrar compra a un proveedor
export default function CompraForm({ proveedorId, productoInicial, cantidadInicial, localInicial = null, onClose, onSaved }) {
  const { perfil } = useAuth()
  const loc = useLocales(perfil)
  const [localId, setLocalId] = useState(localInicial)
  const destino = loc.multi ? (loc.locales.some(l => l.id === localId) ? localId : (loc.filtro || loc.miLocal || loc.locales[0]?.id)) : null
  const [provs, setProvs] = useState([])
  const [prov, setProv] = useState(proveedorId || '')
  const requestId = useRef(imageKey())
  const [date, setDate] = useState(hoyBogota()), [notes, setNotes] = useState('')
  const [doc, setDoc] = useState('')
  const [forma, setForma] = useState('contado')
  const [vence, setVence] = useState('')
  const [metodo, setMetodo] = useState('efectivo')
  const [items, setItems] = useState(() => productoInicial ? [{ producto: productoInicial, cantidad: cantidadInicial || 1, costo: productoInicial.precio_compra || 0, seriales: '' }] : []) // {producto, cantidad, costo, seriales:''}
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
    for (const item of items) if (monetaryError(item.costo)) return setErr(monetaryError(item.costo))
    if (monetaryError(total)) return setErr(monetaryError(total))
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
      p_vence_el: forma === 'credito' ? vence : null, p_items, p_seriales, p_metodo_pago: metodo, ...(destino != null ? { p_local_id: destino } : {}),
    })
    setBusy(false)
    if (error) return setErr(mensajeError(error))
    toast(destino != null ? 'Mercancía registrada en ' + loc.nombre(destino) : 'Mercancía registrada'); onSaved?.()
  }

  const provSel = provs.find((x) => String(x.id) === String(prov))
  return (
    <Modal title="Compra a proveedor" subtitle="Registra la mercancía que llegó" className="experience-sheet cf-sheet cp-sheet" keyboardAware onClose={onClose} footer={
      <button className="cf-save" onClick={guardar} disabled={busy || pendingSave}><I n="check" />{busy ? 'Guardando…' : `Guardar compra · ${money(total)}`}</button>}>
      <ErrorBox text={err} />

      <h4 className="cf-sec"><span>1</span>¿Qué llegó?</h4>
      {items.length === 0 && <p className="cu-note"><I n="box" />Agrega los productos que recibiste.</p>}
      <div className="cp-items">
        {items.map((i, idx) => (
          <div key={i.producto.id} className="cp-item">
            <div className="cp-item-head"><ProductThumbnail product={i.producto} /><span><b>{i.producto.nombre}</b><small>Hoy tiene {i.producto.stock ?? 0} → quedará con {(Number(i.producto.stock) || 0) + (Number(i.cantidad) || 0)}</small></span><button type="button" className="pos-line-x" aria-label={`Quitar ${i.producto.nombre}`} onClick={() => setItems(items.filter((_, k) => k !== idx))}><I n="trash" /></button></div>
            <div className="cp-item-grid">
              <label><small>Cantidad</small><div className="pos-step"><button type="button" onClick={() => upd(idx, 'cantidad', Math.max(1, (Number(i.cantidad) || 1) - 1))}>−</button><output>{i.cantidad}</output><button type="button" onClick={() => upd(idx, 'cantidad', (Number(i.cantidad) || 0) + 1)}>+</button></div></label>
              <label><small>Costo por unidad</small><span className="cf-box sm"><span className="cf-prefix">$</span><input inputMode="numeric" value={i.costo} onChange={(e) => upd(idx, 'costo', e.target.value.replace(/\D/g, ''))} /></span></label>
            </div>
            {i.producto.maneja_serial && <label className="cp-serial"><small>Seriales / IMEI · uno por línea ({i.cantidad})</small><textarea rows={3} value={i.seriales} onChange={(e) => upd(idx, 'seriales', e.target.value)} placeholder="356789012345678" /></label>}
            <div className="cp-sub"><span>Subtotal</span><b>{money(Number(i.cantidad) * Number(i.costo))}</b></div>
          </div>
        ))}
      </div>
      <button type="button" className="pos-more" onClick={() => setBuscar(true)}><I n="plus" />{items.length ? 'Agregar otro producto' : 'Agregar producto'}</button>

      {loc.multi && <><h4 className="cf-sec"><span><I n="store" /></span>¿A qué local llegó?</h4><LocalSelector loc={loc} conTodos={false} value={destino} onChange={v => setLocalId(Number(v))} etiqueta="Local de destino" /></>}
      <h4 className="cf-sec"><span>2</span>¿A quién se lo compraste?</h4>
      {provs.length === 0 ? <p className="cu-note"><I n="warn" />Aún no tienes proveedores. Créalo en Más › Proveedores y vuelve aquí.</p> : <label className={'cf-field' + (prov ? ' filled' : '')}>
        <span className="cf-box"><span className="cf-ic"><I n="truck" /></span><select className="cp-select" value={prov} onChange={(e) => setProv(e.target.value)}><option value="">Elegir proveedor…</option>{provs.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select><I n="chevDown" className="pos-dd-chev" /></span>
      </label>}
      <label className={'cf-field' + (doc ? ' filled' : '')}><span className="cf-label">N.º de factura del proveedor <small>(opcional)</small></span><span className="cf-box"><span className="cf-ic"><I n="receipt" /></span><input value={doc} onChange={(e) => setDoc(e.target.value)} placeholder="Ej. FE-1234" /></span></label>

      <h4 className="cf-sec"><span>3</span>¿Cómo la pagaste?</h4>
      <div className="cu-opts cp-pay">
        <button type="button" className={forma === 'contado' ? 'on' : ''} onClick={() => setForma('contado')}><span className="cu-opt-ic"><I n="cash" /></span><span className="cu-opt-txt"><b>Pagué completo</b><small>No quedó deuda con {provSel?.nombre || 'el proveedor'}.</small></span><span className="cu-radio" /></button>
        <button type="button" className={forma === 'credito' ? 'on' : ''} onClick={() => setForma('credito')}><span className="cu-opt-ic"><I n="history" /></span><span className="cu-opt-txt"><b>Quedé debiendo</b><small>Se suma a cuentas por pagar hasta que la pagues.</small></span><span className="cu-radio" /></button>
      </div>
      {forma === 'contado'
        ? <div className="pos-pays2 cp-methods">{[['efectivo', 'Efectivo', 'cash'], ['transferencia', 'Transferencia', 'bank'], ['tarjeta', 'Tarjeta', 'card']].map(([k, l, ic]) => <button key={k} type="button" className={'m-' + k + (metodo === k ? ' on' : '')} onClick={() => setMetodo(k)}><span className="pos-pays2-ic"><I n={ic} /></span><span>{l}</span></button>)}</div>
        : <div className="cp-due"><DateField label="¿Hasta cuándo tienes para pagar?" min={hoyBogota()} value={vence} onChange={setVence} /></div>}
      {isDemoMode && <><DateField label="Fecha compra" value={date} onChange={setDate}/><Input label="Notas compra" value={notes} onChange={e=>setNotes(e.target.value)} /></>}

      <div className="pos-sum"><div><span>{items.reduce((a, i) => a + (Number(i.cantidad) || 0), 0)} unidades · {items.length} {items.length === 1 ? 'producto' : 'productos'}</span><b /></div><div className="grand"><span>Total de la compra</span><b>{money(total)}</b></div></div>
      {buscar && <BuscarProducto onClose={() => setBuscar(false)} onPick={add} />}
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
    <Modal title="Elegir producto" className="experience-sheet product-picker-sheet" keyboardAware onClose={onClose}>
      <SearchBar value={q} onChange={setQ} placeholder="Nombre o código" />
      {lista.map((p) => <button type="button" key={p.id} className="row product-pick" onClick={() => onPick(p)}><ProductThumbnail product={p}/><div className="flex-1"><p className="m-0 text-sm font-semibold">{p.nombre}</p><p className="m-0 text-xs text-muted">{p.codigo} · stock {p.stock}</p></div><span aria-hidden="true">›</span></button>)}
    </Modal>
  )
}
