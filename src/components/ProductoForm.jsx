import { useEffect, useMemo, useRef, useState } from 'react'
import FullPage from './FullPage'
import { I, CategoryIcon } from './InvIcons'
import { ProductThumbnail } from './TechVisuals'
import { monetaryError } from '../lib/money'
import { prepareImage, saveImage, removeImage, imageKey } from '../lib/demo/images'
import { useAction } from '../lib/useAction'
import { ErrorBox } from './ui'
import { supabase, isDemoMode } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { mensajeError } from '../lib/format'
import { generarSku, limpiarSku, inferirMarca } from '../lib/sku'
import OptionPicker from './OptionPicker'

const MARCAS = ['Genérica', 'Apple', 'Samsung', 'Xiaomi', 'Motorola', 'Huawei', 'Honor', 'Oppo', 'Realme', 'Vivo', 'Infinix', 'Tecno', 'JBL', 'Sony', 'Lenovo', 'HP', 'Anker', 'Baseus']
const COLORES = ['Negro', 'Blanco', 'Transparente', 'Gris', 'Plateado', 'Dorado', 'Azul', 'Rojo', 'Rosado', 'Morado', 'Verde', 'Amarillo', 'Naranja', 'Multicolor']
const HEX = { negro: '#111', blanco: '#fff', transparente: 'transparent', gris: '#8a8a8a', plateado: '#cfd3d6', dorado: '#d4a85c', azul: '#2f6fd6', rojo: '#d33a3a', rosado: '#f2a7bf', morado: '#7b4bc4', verde: '#2fa36b', amarillo: '#f2c94c', naranja: '#f08a24', multicolor: 'conic-gradient(#d33a3a,#f2c94c,#2fa36b,#2f6fd6,#7b4bc4,#d33a3a)', titanio: '#9a948a', grafito: '#3b3d40', beige: '#e8dcc4', cafe: '#7a5230', 'café': '#7a5230', celeste: '#8ec5ef', lila: '#c3a5e8', vinotinto: '#7b1f2e', crema: '#f1e6cf' }
const Swatch = ({ color }) => { const k = String(color || '').toLowerCase(); const bg = HEX[k] || HEX[k.split(' ')[0]] || '#b9a37a'; return <span className={'pf-swatch' + (k === 'transparente' ? ' clear' : '')} style={{ background: bg }} /> }
const soloDigitos = v => String(v ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '')
const miles = v => { const d = soloDigitos(v); return d ? Number(d).toLocaleString('es-CO') : '' }
function Field({ label, required, hint, children, className = '' }) {
  return <div className={'pf-field ' + className}><label className="pf-label">{label}{required && <span className="pf-req"> *</span>}</label>{children}{hint && <p className="pf-hint">{hint}</p>}</div>
}

export default function ProductoForm({ inicial, onClose, onSaved }) {
  const { can } = useAuth()
  const editando = !!inicial?.id
  const precios = can('editar_precios') || !editando
  const costos = can('ver_costos')
  const [f, setF] = useState({ nombre: '', categoria_id: '', marca: '', modelo: '', color: '', precio_compra: '', precio_venta: '', stock_min: '3', stock_max: '', codigo: '', codigo_barras: '', proveedor_id: '', garantia_meses: '0', descripcion: '', maneja_serial: false,
    ...(inicial ? { ...inicial, precio_compra: String(inicial.precio_compra ?? ''), precio_venta: String(inicial.precio_venta ?? ''), stock_min: String(inicial.stock_min ?? 0), stock_max: inicial.stock_max == null ? '' : String(inicial.stock_max), garantia_meses: String(inicial.garantia_meses ?? 0), categoria_id: inicial.categoria_id ?? '', proveedor_id: inicial.proveedor_id ?? '' } : {}) })
  const [stock, setStock] = useState(editando ? String(inicial.stock ?? 0) : '0')
  const bloqueaCantidad = !!inicial?.maneja_serial
  const [cats, setCats] = useState([]), [provs, setProvs] = useState([])
  const [colores, setColores] = useState(COLORES)
  const [picker, setPicker] = useState(null) // 'cat' | 'color'
  const [foto, setFoto] = useState(null) // { blob, url } | { remove:true }
  const [err, setErr] = useState('')
  const [skuManual, setSkuManual] = useState(editando)
  const camRef = useRef(null), fileRef = useRef(null)
  const set = k => e => { const v = e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e; setF(prev => ({ ...prev, [k]: v })) }

  useEffect(() => {
    supabase.from('categorias').select('id,nombre').eq('activa', true).order('nombre').then(({ data }) => setCats(data || []))
    supabase.from('productos').select('color').not('color', 'is', null).then(({ data }) => {
      const usados = [...new Set((data || []).map(r => String(r.color).trim()).filter(Boolean))]
      setColores(prev => [...prev, ...usados.filter(c => !prev.some(x => x.toLowerCase() === c.toLowerCase()))])
    })
    supabase.from('proveedores').select('id,nombre').eq('activo', true).order('nombre').then(({ data }) => setProvs(data || []))
  }, [])
  useEffect(() => () => { if (foto?.url) URL.revokeObjectURL(foto.url) }, [foto])

  const categoria = cats.find(c => String(c.id) === String(f.categoria_id))
  const marcaFinal = (f.marca || '').trim() || inferirMarca(f.nombre)
  const skuAuto = useMemo(() => generarSku({ categoria: categoria?.nombre, marca: marcaFinal, modelo: f.modelo, nombre: f.nombre, color: f.color }), [categoria, marcaFinal, f.modelo, f.nombre, f.color])
  const skuVista = skuManual ? f.codigo : (f.nombre || f.modelo ? skuAuto : '')

  async function elegirFoto(e) {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    try { const blob = await prepareImage(file); setFoto({ blob, url: URL.createObjectURL(blob) }); setErr('') } catch (x) { setErr(mensajeError(x)) }
  }

  // Devuelve el código si está libre; si ya existe (en otro producto) agrega -002, -003...
  async function codigoLibre(base) {
    const { data } = await supabase.from('productos').select('id,codigo').ilike('codigo', base + '%')
    const usados = new Set((data || []).filter(r => r.id !== inicial?.id).map(r => String(r.codigo).toUpperCase()))
    if (!usados.has(base)) return base
    let n = 2; while (usados.has(`${base}-${String(n).padStart(3, '0')}`)) n++
    return `${base}-${String(n).padStart(3, '0')}`
  }

  const [guardar, pending] = useAction(async () => {
    setErr('')
    if (!f.nombre.trim()) return setErr('Escribe el nombre del producto.')
    if (!f.categoria_id) return setErr('Elige la categoría.')
    if (!soloDigitos(f.precio_venta)) return setErr('Escribe el precio de venta.')
    for (const k of ['precio_compra', 'precio_venta']) if (monetaryError(soloDigitos(f[k]) || '0')) return setErr(monetaryError(soloDigitos(f[k])))
    if (!Number.isInteger(Number(f.stock_min)) || Number(f.stock_min) < 0) return setErr('El stock mínimo debe ser un número entero.')
    if (!Number.isInteger(Number(stock)) || Number(stock) < 0) return setErr('La cantidad en stock debe ser un número entero.')

    const max = f.stock_max === '' ? null : Number(f.stock_max)
    if (max !== null && max < Number(f.stock_min)) return setErr('El stock máximo no puede ser menor que el mínimo.')
    const d = {
      nombre: f.nombre.trim(), categoria_id: Number(f.categoria_id), marca: editando && inicial.marca ? inicial.marca : marcaFinal,
      color: f.color || null, descripcion: f.descripcion?.trim() || null,
      stock_min: Number(f.stock_min) || 0, stock_max: max,
    }
    if (precios) { d.precio_venta = Number(soloDigitos(f.precio_venta)) || 0; if (costos) d.precio_compra = Number(soloDigitos(f.precio_compra)) || 0 }
    const base = limpiarSku(skuManual ? f.codigo : skuAuto)
    if (!base) return setErr('Escribe el código del producto o deja que se genere automáticamente.')
    if (skuManual) {
      if (!editando || base !== String(inicial.codigo).toUpperCase()) {
        if (await codigoLibre(base) !== base) return setErr(`El código ${base} ya lo tiene otro producto. Cámbialo o usa "Generar".`)
      }
      d.codigo = base
    } else d.codigo = await codigoLibre(base)

    // Foto
    let nuevaRef = null, nuevaRuta = null
    if (foto?.blob) {
      if (isDemoMode) { nuevaRef = imageKey(); await saveImage(nuevaRef, foto.blob); d.image_ref = nuevaRef; d.image_removed = false }
      else {
        const ext = foto.blob.type === 'image/png' ? 'png' : 'jpg'
        nuevaRuta = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
        const up = await supabase.storage.from('productos').upload(nuevaRuta, foto.blob, { contentType: foto.blob.type, upsert: false })
        if (up.error) return setErr('No se pudo subir la foto: ' + mensajeError(up.error) + ' (¿ejecutaste 03_productos_detalle.sql?)')
        d.foto_url = supabase.storage.from('productos').getPublicUrl(nuevaRuta).data.publicUrl
      }
    } else if (foto?.remove) { if (isDemoMode) { d.image_ref = null; d.image_removed = true } else d.foto_url = null }

    let error, nuevoId
    if (isDemoMode && !editando) {
      ({ error } = await supabase.rpc('crear_producto_demo', { producto: d, stock: Number(stock), seriales: [] }))
    } else if (editando) {
      ({ error } = await supabase.from('productos').update(d).eq('id', inicial.id))
      const diff = Number(stock) - Number(inicial.stock || 0)
      if (!error && diff !== 0 && !bloqueaCantidad) {
        const a = await supabase.rpc('ajustar_inventario', { p_producto_id: inicial.id, p_cantidad: Math.abs(diff), p_tipo: diff > 0 ? 'ajuste_entrada' : 'ajuste_salida', p_motivo: 'Ajuste desde edición del producto' })
        if (a.error) error = { message: 'Se guardaron los datos, pero no se pudo ajustar la cantidad: ' + mensajeError(a.error) }
      }
    } else {
      const r = await supabase.from('productos').insert(d).select('id').single(); error = r.error; nuevoId = r.data?.id
      if (!error && nuevoId && Number(stock) > 0) {
        const a = await supabase.rpc('ajustar_inventario', { p_producto_id: nuevoId, p_cantidad: Number(stock), p_tipo: 'ajuste_entrada', p_motivo: 'Stock inicial' })
        if (a.error) error = { message: 'El producto se creó, pero no se pudo cargar el stock inicial: ' + mensajeError(a.error) }
      }
    }
    if (error) {
      if (nuevaRef) await removeImage(nuevaRef).catch(() => {})
      if (nuevaRuta && !nuevoId) await supabase.storage.from('productos').remove([nuevaRuta]).catch(() => {})
      const m = mensajeError(error)
      return setErr(/modelo|color|descripcion|foto_url|stock_max/i.test(m) && /column|columna/i.test(m) ? 'Falta actualizar la base de datos: ejecuta supabase/03_productos_detalle.sql en Supabase.' : m)
    }
    if (foto && inicial?.image_ref) await removeImage(inicial.image_ref).catch(() => {})
    onSaved()
  })

  const preview = foto?.url || null
  const tieneFoto = !foto?.remove && (preview || inicial?.foto_url || inicial?.image_ref || (inicial && !inicial.image_removed && Number(inicial.id) <= 18 && isDemoMode))

  return <FullPage title={editando ? 'Editar producto' : 'Agregar producto'} onBack={onClose} className="inv-form"
    footer={<button type="button" className="inv-btn-gold full" disabled={pending} onClick={guardar}>{pending ? 'Guardando…' : editando ? 'Guardar cambios' : 'Guardar producto'}</button>}>
    <ErrorBox text={err} />

    {/* Foto */}
    <div className={'pf-photo' + (tieneFoto ? ' has' : '')}>
      {tieneFoto ? <>
        <div className="pf-photo-img">{preview ? <img src={preview} alt="Foto del producto" /> : <ProductThumbnail product={{ ...inicial, categoria: categoria?.nombre }} />}</div>
        <div className="pf-photo-actions">
          <button type="button" onClick={() => camRef.current?.click()}><I n="camera" />Tomar foto</button>
          <button type="button" onClick={() => fileRef.current?.click()}><I n="plus" />Cambiar imagen</button>
          <button type="button" className="danger" onClick={() => setFoto({ remove: true })}><I n="trash" />Quitar</button>
        </div>
      </> : <>
        <span className="pf-photo-icon">{categoria ? <CategoryIcon categoria={categoria.nombre} /> : <I n="camera" />}</span>
        <b>Agregar foto (opcional)</b>
        <small>Si no agregas una foto, se mostrará un ícono según la categoría</small>
        <div className="pf-photo-actions">
          <button type="button" onClick={() => camRef.current?.click()}><I n="camera" />Tomar foto</button>
          <button type="button" onClick={() => fileRef.current?.click()}><I n="plus" />Subir imagen</button>
        </div>
      </>}
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={elegirFoto} />
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={elegirFoto} />
    </div>

    <h3 className="pf-section">Información básica</h3>
    <Field label="Nombre del producto" required><input className="pf-input" placeholder="Ej. Funda iPhone 15" value={f.nombre} onChange={set('nombre')} /></Field>
    <Field label="Categoría" required>
      <button type="button" className="pf-select pf-trigger" onClick={() => setPicker('cat')}><span className="pf-ico">{categoria ? <CategoryIcon categoria={categoria.nombre} /> : <I n="box" />}</span><span className={'pf-trigger-text' + (categoria ? '' : ' ph')}>{categoria?.nombre || 'Seleccionar'}</span><I n="chevDown" className="pf-chev" /></button>
    </Field>
    <Field label="Color">
      <button type="button" className="pf-select pf-trigger" onClick={() => setPicker('color')}><span className="pf-ico">{f.color ? <Swatch color={f.color} /> : <I n="palette" />}</span><span className={'pf-trigger-text' + (f.color ? '' : ' ph')}>{f.color || 'Seleccionar'}</span><I n="chevDown" className="pf-chev" /></button>
    </Field>
    <div className="pf-grid">
      {costos && <Field label="Precio de compra"><div className="pf-money"><span>$</span><input inputMode="numeric" placeholder="0" value={miles(f.precio_compra)} onChange={e => set('precio_compra')(soloDigitos(e.target.value))} disabled={!precios} /></div></Field>}
      <Field label="Precio de venta" required className={costos ? '' : 'pf-span'}><div className="pf-money"><span>$</span><input inputMode="numeric" placeholder="0" value={miles(f.precio_venta)} onChange={e => set('precio_venta')(soloDigitos(e.target.value))} disabled={!precios} /></div></Field>
    </div>
    {!precios && <p className="pf-hint">Tu perfil no tiene permiso para cambiar precios.</p>}
    <div className="pf-grid pf-grid-3">
      <Field label="Cantidad" required><input className="pf-input" inputMode="numeric" value={stock} onChange={e => setStock(soloDigitos(e.target.value) || '0')} disabled={bloqueaCantidad} /></Field>
      <Field label="Stock mínimo"><input className="pf-input" inputMode="numeric" value={f.stock_min} onChange={e => set('stock_min')(soloDigitos(e.target.value) || '0')} /></Field>
      <Field label="Stock máximo"><input className="pf-input" inputMode="numeric" placeholder="—" value={f.stock_max} onChange={e => set('stock_max')(soloDigitos(e.target.value))} /></Field>
    </div>
    <p className="pf-hint" style={{ marginTop: '-4px', marginBottom: '12px' }}>{bloqueaCantidad ? 'Este producto maneja IMEI: las unidades se cargan con Ingreso de mercancía.' : 'Cantidad: unidades que tienes hoy. Mínimo: te avisa cuándo reponer. Máximo: hasta cuántas conviene tener.'}</p>
    <Field label="Código SKU" hint={skuManual ? (editando ? 'Cambiar el código no afecta el historial de ventas.' : 'Código escrito a mano. Toca "Generar" para volver al automático.') : 'Se arma solo con el nombre, la categoría y el color. Puedes editarlo.'}>
      <div className="pf-sku">
        <input className="pf-input" value={skuVista} placeholder="Automático" autoCapitalize="characters" spellCheck="false"
          onChange={e => { setSkuManual(true); set('codigo')(limpiarSku(e.target.value)) }} />
        <button type="button" className="pf-sku-gen" onClick={() => { setSkuManual(false); set('codigo')('') }} disabled={!skuManual} title="Generar código automático">Generar</button>
      </div>
    </Field>
    <Field label="Descripción (opcional)"><textarea className="pf-input pf-area" rows={3} placeholder="Información adicional del producto..." value={f.descripcion || ''} onChange={set('descripcion')} /></Field>

    {picker === 'cat' && <OptionPicker title="Categoría" addLabel="Nueva categoría" addPlaceholder="Ej. Smartwatch" value={f.categoria_id}
      options={cats.map(c => ({ value: c.id, label: c.nombre, icon: <CategoryIcon categoria={c.nombre} /> }))}
      onClose={() => setPicker(null)} onPick={v => { set('categoria_id')(v); setPicker(null) }}
      onAdd={async nombre => { const { data, error } = await supabase.from('categorias').insert({ nombre }).select('id,nombre').single(); if (error) throw new Error(mensajeError(error)); setCats(c => [...c, data].sort((x, y) => x.nombre.localeCompare(y.nombre))); return data.id }}
      onRename={async (id, nombre) => { const { error } = await supabase.from('categorias').update({ nombre }).eq('id', id); if (error) throw new Error(mensajeError(error)); setCats(c => c.map(x => x.id === id ? { ...x, nombre } : x)) }}
      onHide={async id => { const { error } = await supabase.from('categorias').update({ activa: false }).eq('id', id); if (error) throw new Error(mensajeError(error)); setCats(c => c.filter(x => x.id !== id)); if (String(f.categoria_id) === String(id)) set('categoria_id')('') }} />}
    {picker === 'color' && <OptionPicker title="Color" addLabel="Nuevo color" addPlaceholder="Ej. Titanio natural" value={f.color || ''}
      options={[{ value: '', label: 'Sin color', icon: <I n="palette" />, editable: false }, ...colores.map(c => ({ value: c, label: c, icon: <Swatch color={c} /> }))]}
      onClose={() => setPicker(null)} onPick={v => { set('color')(v); setPicker(null) }}
      onAdd={async nombre => { const t = nombre.charAt(0).toUpperCase() + nombre.slice(1); setColores(c => [...c, t]); return t }} />}
  </FullPage>
}
