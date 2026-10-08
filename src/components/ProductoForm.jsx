import { useEffect, useState } from 'react'
import Modal from './Modal'
import Scanner from './Scanner'
import ProductPhotoEditor from './ProductPhotoEditor'
import { ProductPriceInput, ProductQuantityInput, formatProductPrice } from './ProductNumberInput'
import { saveImage, removeImage, imageKey } from '../lib/demo/images'
import { useAction } from '../lib/useAction'
import { Input, Select, ErrorBox } from './ui'
import { supabase, isDemoMode } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { mensajeError } from '../lib/format'

export default function ProductoForm({ inicial, onClose, onSaved }) {
  const { can } = useAuth()
  const editando = !!inicial?.id
  const [f, setF] = useState({ codigo: '', codigo_barras: '', nombre: '', marca: '', categoria_id: '', proveedor_id: '', precio_compra: 0, precio_venta: 0, stock_min: 3, maneja_serial: false, garantia_meses: 0, ...(inicial || {}) })
  const [stock, setStock] = useState(0); const [seriales, setSeriales] = useState('')
  const [cats, setCats] = useState([]); const [provs, setProvs] = useState([])
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [scan, setScan] = useState(false)
  const set = (k) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value
    setF(previous => ({ ...previous, [k]: value }))
  }
  const [photo, setPhoto] = useState(null)
  const [photoBusy,setPhotoBusy] = useState(false)
  const precios = can('editar_precios')
  const [activePrice, setActivePrice] = useState('precio_venta')
  const setPrice = key => value => setF(previous => ({ ...previous, [key]: value }))
  function addPrice(amount) {
    if (!precios) return
    const input = document.activeElement
    if (input?.matches('[data-cop-input]')) input.blur()
    setF(previous => ({ ...previous, [activePrice]: String(Math.max(0, Number(previous[activePrice]) || 0) + amount) }))
  }

  useEffect(() => {
    supabase.from('categorias').select('id,nombre').eq('activa', true).order('nombre').then(({ data }) => setCats(data || []))
    supabase.from('proveedores').select('id,nombre').eq('activo', true).order('nombre').then(({ data }) => setProvs(data || []))
  }, [])

  const [guardar, pendingSave] = useAction(guardarImpl, () => setBusy(false))
  async function guardarImpl() {
    if (!f.codigo.trim() || !f.nombre.trim()) return setErr('Código y nombre son obligatorios.')
    for (const key of ['precio_compra','precio_venta','stock_min','garantia_meses']) if (!Number.isFinite(Number(f[key])) || Number(f[key]) < 0) return setErr('Los precios, el stock y la cobertura no pueden ser negativos.')
    if (!Number.isInteger(Number(f.stock_min)) || !Number.isInteger(Number(stock)) || Number(stock) < 0) return setErr('Stock y stock minimo deben ser enteros no negativos.')
    setBusy(true); setErr('')
    const d = {
      codigo: f.codigo.trim(), codigo_barras: f.codigo_barras?.trim() || null, nombre: f.nombre.trim(), marca: f.marca?.trim() || null,
      categoria_id: f.categoria_id ? Number(f.categoria_id) : null, proveedor_id: f.proveedor_id ? Number(f.proveedor_id) : null,
      stock_min: Number(f.stock_min) || 0, garantia_meses: Number(f.garantia_meses) || 0,
    }
    if (isDemoMode) { d.descripcion = f.descripcion?.trim() || null; d.asset_codigo = inicial?.asset_codigo || (inicial?.id <= 18 ? inicial.codigo : null) }
    let newImage
    if (isDemoMode && photo) {
      if (photo.blob) {
        newImage = imageKey()
        try { await saveImage(newImage, photo.blob); d.image_ref = newImage; d.image_removed = false } catch (error) { setBusy(false); return setErr(mensajeError(error)) }
      } else { d.image_ref = null; d.image_removed = true }
    }
    if (precios) { d.precio_compra = Number(f.precio_compra) || 0; d.precio_venta = Number(f.precio_venta) || 0 }
    if (!editando) d.maneja_serial = !!f.maneja_serial
    const q = isDemoMode && !editando ? supabase.rpc('crear_producto_demo', { producto: d, stock: Number(stock), seriales: seriales.split(/[,\n]/).map(s => s.trim()).filter(Boolean) }) : editando ? supabase.from('productos').update(d).eq('id', inicial.id) : supabase.from('productos').insert(d)
    const { error } = await q
    setBusy(false)
    if (error) { if (newImage) await removeImage(newImage).catch(()=>{}); return setErr(mensajeError(error)) }
    if (photo && inicial?.image_ref) await removeImage(inicial.image_ref).catch(()=>{})
    onSaved()
  }

  return (
    <Modal className="product-form" keyboardAware title={editando ? 'Editar producto' : 'Nuevo producto'}
      subtitle={editando ? 'Actualiza los detalles de tu inventario' : 'Registra un producto para tu inventario'}
      onClose={onClose} footer={<><p className="product-save-note">{editando ? 'El historial de este producto se conserva.' : 'Tu producto quedará listo en el inventario.'}</p><button className="btn full product-save" onClick={guardar} disabled={busy || pendingSave || photoBusy}>{busy || pendingSave || photoBusy ? 'Guardando…' : 'Guardar'}</button></>}>
      <ErrorBox text={err} />
      <section className="product-section"><div className="product-section-heading"><span>01</span><div><h3>Identidad del producto</h3><p>Los datos que lo hacen único</p></div></div>
        <Input required label="Nombre" placeholder="Ej. Samsung Galaxy S26" value={f.nombre} onChange={set('nombre')} />
        <Input required label="Código único (SKU)" placeholder="Ej. SGS26-256" autoCapitalize="characters" value={f.codigo} onChange={set('codigo')} />
        <div className="product-scan-row"><Input label="Código de barras" value={f.codigo_barras || ''} onChange={set('codigo_barras')} /><button className="btn sec" onClick={() => setScan(true)}>Escanear</button></div>
        <div className="product-fields-grid"><Input label="Marca" placeholder="Ej. Samsung" value={f.marca || ''} onChange={set('marca')} />
          <Select label="Categoría" value={f.categoria_id || ''} onChange={set('categoria_id')}><option value="">Sin categoría</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</Select></div>
        <Select label="Proveedor" value={f.proveedor_id || ''} onChange={set('proveedor_id')}><option value="">Sin proveedor</option>{provs.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</Select>
      </section>
      {isDemoMode && <ProductPhotoEditor product={inicial} value={photo} onChange={setPhoto} onBusyChange={setPhotoBusy} />}
      <section className="product-section"><div className="product-section-heading"><span>03</span><div><h3>Precios</h3><p>Valores en pesos colombianos · COP</p></div></div>
        <div className="product-price-grid">
          <ProductPriceInput label="Precio compra" value={f.precio_compra} onValueChange={setPrice('precio_compra')} onFocus={() => setActivePrice('precio_compra')} disabled={!precios} />
          <ProductPriceInput label="Precio venta" value={f.precio_venta} onValueChange={setPrice('precio_venta')} onFocus={() => setActivePrice('precio_venta')} disabled={!precios} />
        </div>
        {precios ? <div className="product-quick-prices"><p id="quick-price-target">Sumar a <b>{activePrice === 'precio_compra' ? 'Precio compra' : 'Precio venta'}</b></p><div role="group" aria-labelledby="quick-price-target">{[[10000,'+10 mil'],[100000,'+100 mil'],[1000000,'+1 millón']].map(([amount,label])=><button key={amount} type="button" className="product-amount-chip" onClick={()=>addPrice(amount)}>{label}</button>)}</div><p className="product-price-feedback" aria-live="polite">{activePrice === 'precio_compra' ? 'Compra' : 'Venta'}: <b>$ {formatProductPrice(f[activePrice])}</b></p></div> : <p className="product-hint">Tu perfil no tiene permiso para editar precios.</p>}
      </section>
      <section className="product-section"><div className="product-section-heading"><span>04</span><div><h3>Inventario</h3><p>Unidades disponibles y reposición</p></div></div>
        <div className="product-fields-grid">
          {isDemoMode && !editando && <ProductQuantityInput label="Stock inicial" value={stock} onChange={e=>setStock(e.target.value)} />}
          <ProductQuantityInput label="Stock mínimo" value={f.stock_min} onChange={set('stock_min')} />
        </div>
        <label className="product-serial-toggle"><input type="checkbox" checked={!!f.maneja_serial} onChange={set('maneja_serial')} disabled={editando} /><span><b>Maneja IMEI / serial por unidad</b><small>{editando ? 'Este tipo de control se conserva después de crear el producto.' : 'Cada unidad tendrá un identificador único.'}</small></span></label>
        {isDemoMode && !editando && f.maneja_serial && <div className="product-serial-details"><Input label="Seriales / IMEI (uno por línea o separados por coma)" value={seriales} onChange={e=>setSeriales(e.target.value)} /><p className="product-hint">Ingresa un serial distinto por cada unidad del stock inicial.</p></div>}
        <p className="product-hint">{editando ? 'Cambia las existencias con compras, ventas o ajustes de stock.' : isDemoMode ? 'El stock inicial crea un movimiento en el historial.' : 'Carga las existencias con Ingreso de mercancía.'}</p>
      </section>
      <section className="product-section"><div className="product-section-heading"><span>05</span><div><h3>Garantía y notas</h3><p>Información para acompañar la venta</p></div></div>
        <ProductQuantityInput label="Garantía (meses)" value={f.garantia_meses} onChange={set('garantia_meses')} />
        <p className="product-hint">Con 0 meses no se crea cobertura automática al vender.</p>
        {isDemoMode && <Input label="Descripción / notas" placeholder="Detalles, características o información útil" value={f.descripcion || ''} onChange={set('descripcion')} />}
      </section>
      {scan && <Scanner onClose={() => setScan(false)} onScan={(c) => { setF({ ...f, codigo: f.codigo || c, codigo_barras: c }); setScan(false) }} />}
    </Modal>
  )
}
