import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { useDemoRevision } from '../lib/demo/useDemoRevision'
import { AnimatedCard, ProductThumbnail, Brand } from '../components/TechVisuals'
import { I, CategoryIcon } from '../components/InvIcons'
import Modal from '../components/Modal'
import Scanner from '../components/Scanner'
import RecordStatus from '../components/RecordStatus'
import { useAction } from '../lib/useAction'
import ProductoForm from '../components/ProductoForm'
import FullPage from '../components/FullPage'
import CompraForm from '../components/CompraForm'
import { Empty, Loader, Badge, Input, Select, ErrorBox } from '../components/ui'
import { supabase, isDemoMode } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { money, fechaHora, limpiarBusqueda, mensajeError } from '../lib/format'
import { toast } from '../lib/toast'

const estadoStock = p => p.stock === 0 ? ['bad', 'Agotado'] : p.stock <= p.stock_min ? ['warn', 'Stock bajo'] : ['good', 'En stock']
const unidades = n => `${n} ${Number(n) === 1 ? 'unidad' : 'unidades'}`

function Menu({ items, label = 'Más opciones', className = '' }) {
  const [open, setOpen] = useState(false)
  const visibles = items.filter(Boolean)
  if (!visibles.length) return <span className="fp-icon-space" />
  return <span className={'inv-menu ' + className}>
    <button type="button" className="fp-icon" aria-label={label} aria-expanded={open} onClick={e => { e.stopPropagation(); setOpen(!open) }}><I n="dots" /></button>
    {open && <>
      <span className="inv-menu-backdrop" onClick={e => { e.stopPropagation(); setOpen(false) }} />
      <span className="inv-menu-pop" role="menu">{visibles.map(x => <button key={x.label} type="button" role="menuitem" className={x.danger ? 'danger' : ''} onClick={e => { e.stopPropagation(); setOpen(false); x.onClick() }}><I n={x.icon} />{x.label}</button>)}</span>
    </>}
  </span>
}

export default function Inventario() {
  const revision = useDemoRevision()
  const navigate = useNavigate()
  const { can } = useAuth()
  const editar = can('editar_inventario')
  const costos = can('ver_costos')
  const [params] = useSearchParams()
  const [q, setQ] = useState(params.get('q') || '')
  const [filtro, setFiltro] = useState(['bajo', 'agotado', 'inactivos'].includes(params.get('filtro')) ? params.get('filtro') : 'todos')
  const [cats, setCats] = useState([])
  const [categoria, setCategoria] = useState('Todos')
  const [lista, setLista] = useState(null)
  const [scan, setScan] = useState(false)
  const [filtros, setFiltros] = useState(false)
  const [sel, setSel] = useState(null)
  const [form, setForm] = useState(null)
  const [compra, setCompra] = useState(false)
  const [cargar, setCargar] = useState(null)
  const [ajuste, setAjuste] = useState(null)
  const [movs, setMovs] = useState(null)
  const [tick, setTick] = useState(0)
  const productoId = params.get('producto')
  const tabla = costos || editar ? 'productos' : 'productos_venta'

  useEffect(() => { supabase.from('categorias').select('*').eq('activa', true).order('nombre').then(({ data }) => setCats(data || [])) }, [revision])
  useEffect(() => {
    if (!productoId) return
    let active = true
    supabase.from(tabla).select(tabla === 'productos' ? '*, categorias(nombre)' : '*').eq('id', Number(productoId)).then(({ data }) => { if (active && data?.[0]) setSel({ ...data[0], categoria: data[0].categoria || data[0].categorias?.nombre }) })
    return () => { active = false }
  }, [productoId, tabla, revision])

  useEffect(() => {
    const t = setTimeout(async () => {
      const s = limpiarBusqueda(q)
      let qq = supabase.from(tabla).select(tabla === 'productos' ? '*, categorias(nombre)' : '*').order('nombre').limit(150)
      if (tabla === 'productos') qq = qq.eq('activo', filtro !== 'inactivos')
      if (s) qq = qq.or(`nombre.ilike.%${s}%,codigo.ilike.%${s}%,codigo_barras.ilike.%${s}%,marca.ilike.%${s}%,modelo.ilike.%${s}%`)
      let { data, error } = await qq
      if (error && s) ({ data } = await supabase.from(tabla).select(tabla === 'productos' ? '*, categorias(nombre)' : '*').order('nombre').limit(150).or(`nombre.ilike.%${s}%,codigo.ilike.%${s}%,codigo_barras.ilike.%${s}%,marca.ilike.%${s}%`))
      const rows = (data || []).map(p => ({ ...p, categoria: p.categoria || p.categorias?.nombre }))
      setLista(rows)
      setSel(prev => prev ? rows.find(p => p.id === prev.id) || prev : null)
    }, 220)
    return () => clearTimeout(t)
  }, [q, tick, tabla, filtro, revision])

  const visible = (lista || []).filter(p => (categoria === 'Todos' || p.categoria === categoria) && (filtro === 'bajo' ? p.stock <= p.stock_min : filtro === 'agotado' ? p.stock === 0 : true))
  const bajos = (lista || []).filter(p => p.stock <= p.stock_min).length
  const porEstado = (lista || []).filter(p => filtro === 'bajo' ? p.stock <= p.stock_min : filtro === 'agotado' ? p.stock === 0 : true)
  const conteo = porEstado.reduce((m, p) => { const k = p.categoria || 'Sin categoría'; m[k] = (m[k] || 0) + 1; return m }, {})
  const activos = (categoria !== 'Todos' ? 1 : 0) + (filtro !== 'todos' ? 1 : 0)
  const chipsCategorias = [{ nombre: 'Todos', n: porEstado.length }, ...Object.entries(conteo).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([nombre, n]) => ({ nombre, n }))]
  const refrescar = () => setTick(t => t + 1)
  useEffect(() => { if (lista && categoria !== 'Todos' && !conteo[categoria]) setCategoria('Todos') }, [lista, filtro]) // eslint-disable-line
  const vender = p => navigate('/vender?q=' + encodeURIComponent(p.codigo))
  const acciones = p => [
    { label: 'Ver detalle', icon: 'box', onClick: () => setSel(p) },
    editar && { label: 'Editar', icon: 'pencil', onClick: () => setForm(p) },
    (editar || can('registrar_compras')) && { label: 'Cargar unidades', icon: 'truckIn', onClick: () => setCargar(p) },
    editar && !p.maneja_serial && { label: 'Ajustar stock', icon: 'adjust', onClick: () => setAjuste(p) },
    editar && { label: 'Movimientos', icon: 'history', onClick: () => setMovs(p) },
    can('vender') && p.stock > 0 && { label: 'Vender', icon: 'cart', onClick: () => vender(p) },
  ]

  const header = <div className="inv-head">
    <div className="inv-head-top"><Brand compact /><button type="button" className="inv-bell" aria-label={bajos ? `${bajos} productos con stock bajo` : 'Sin alertas de stock'} onClick={() => setFiltro(bajos ? 'bajo' : 'todos')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15L6 16zM10 20.5a2 2 0 004 0" /></svg>{bajos > 0 && <span className="inv-dot" />}</button></div>
    <div className="inv-head-title"><div><h1>{editar ? 'Inventario' : 'Productos'}</h1><p>{editar ? 'Gestiona tus productos' : 'Consulta stock y precios'}</p></div>{editar && <button type="button" className="inv-add" onClick={() => setForm({})}><I n="plus" />Agregar</button>}</div>
  </div>

  return (
    <AppShell title="Inventario" header={header}>
      <div className="inv-search">
        <label className="inv-search-box"><I n="search" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar producto, marca o modelo..." autoCapitalize="none" aria-label="Buscar producto" /><button type="button" className="inv-scan" aria-label="Escanear código" onClick={() => setScan(true)}><I n="scan" /></button></label>
        <button type="button" className={'inv-filter' + (activos ? ' on' : '')} aria-label={activos ? `Filtros (${activos} activos)` : 'Filtros'} onClick={() => setFiltros(true)}><I n="sliders" />{activos > 0 && <span className="inv-filter-count">{activos}</span>}</button>
      </div>
      {activos > 0 && <div className="inv-tags">
        {categoria !== 'Todos' && <button type="button" onClick={() => setCategoria('Todos')}><CategoryIcon categoria={categoria} />{categoria}<span aria-hidden="true">✕</span></button>}
        {filtro !== 'todos' && <button type="button" onClick={() => setFiltro('todos')}><I n="warn" />{{ bajo: 'Stock bajo', agotado: 'Agotados', inactivos: 'Inactivos' }[filtro]}<span aria-hidden="true">✕</span></button>}
        <button type="button" className="clear" onClick={() => { setCategoria('Todos'); setFiltro('todos') }}>Limpiar</button>
      </div>}

      {!lista ? <Loader /> : visible.length === 0 ? <Empty text="No hay productos para mostrar" description="Cambia la categoría o los filtros, o agrega un producto nuevo." action={editar ? () => setForm({}) : undefined} actionLabel="+ Agregar producto" /> : (
        <div className="inv-list">
          {visible.map((p, index) => {
            const [tone] = estadoStock(p)
            return <AnimatedCard as="div" index={index} key={p.id} className="inv-card" role="button" tabIndex={0} onClick={() => setSel(p)} onKeyDown={e => { if (e.key === 'Enter') setSel(p) }}>
              <ProductThumbnail product={p} />
              <div className="inv-card-body">
                <div className="inv-card-top"><b>{p.nombre}</b><Menu items={acciones(p)} /></div>
                <span className="inv-card-sub">{p.marca || 'Genérica'}{p.modelo ? ' · ' + p.modelo : ''}</span>
                <span className="inv-card-sku">{p.codigo}</span>
                <div className="inv-card-bottom"><span className={'inv-pill ' + tone}>{tone !== 'good' && <i />}{unidades(p.stock)}</span><b className="inv-price">{money(p.precio_venta)}</b></div>
              </div>
            </AnimatedCard>
          })}
        </div>
      )}

      {filtros && <Modal title="Filtros" onClose={() => setFiltros(false)} footer={<div className="inv-sheet-foot"><button type="button" className="inv-btn-outline" onClick={() => { setCategoria('Todos'); setFiltro('todos') }}>Limpiar</button><button type="button" className="inv-btn-gold" onClick={() => setFiltros(false)}>Ver {visible.length} {visible.length === 1 ? 'producto' : 'productos'}</button></div>}>
        <p className="inv-sheet-label">Estado del stock</p>
        <div className="inv-seg3">
          {[['todos', 'Todos'], ['bajo', 'Stock bajo'], ['agotado', 'Agotados'], ...(isDemoMode && editar ? [['inactivos', 'Inactivos']] : [])].map(([k, l]) => <button key={k} type="button" className={filtro === k ? 'on' : ''} aria-pressed={filtro === k} onClick={() => setFiltro(k)}>{l}</button>)}
        </div>
        <p className="inv-sheet-label">Categoría</p>
        <div className="inv-cat-grid">
          {[{ nombre: 'Todos', n: porEstado.length }, ...cats.map(c => ({ nombre: c.nombre, n: conteo[c.nombre] || 0 })).sort((x, y) => y.n - x.n || x.nombre.localeCompare(y.nombre))].map(c =>
            <button key={c.nombre} type="button" className={(categoria === c.nombre ? 'on' : '') + (c.n === 0 ? ' empty' : '')} aria-pressed={categoria === c.nombre} onClick={() => setCategoria(c.nombre)}>
              <span className="inv-cat-icon">{c.nombre === 'Todos' ? <I n="box" /> : <CategoryIcon categoria={c.nombre} />}</span>
              <span className="inv-cat-text"><b>{c.nombre === 'Todos' ? 'Todas' : c.nombre}</b><small>{c.n} {c.n === 1 ? 'producto' : 'productos'}</small></span>
            </button>)}
        </div>
        {can('registrar_compras') && <button type="button" className="inv-sheet-link" onClick={() => { setFiltros(false); setCompra(true) }}><I n="truckIn" />Registrar ingreso de mercancía</button>}
      </Modal>}
      {scan && <Scanner onClose={() => setScan(false)} onScan={c => { setQ(c); setScan(false) }} />}
      {sel && !form && <ProductoDetalle p={sel} editar={editar} costos={costos} puedeVender={can('vender')} onClose={() => { setSel(null); if (productoId) navigate('/inventario', { replace: true }) }} onEditar={() => setForm(sel)} onVender={() => vender(sel)} onAjuste={() => setAjuste(sel)} onMovs={() => setMovs(sel)} onIngreso={can('registrar_compras') ? () => setCompra(sel) : null} onCargar={editar || can('registrar_compras') ? () => setCargar(sel) : null} onCambio={refrescar} />}
      {form && <ProductoForm inicial={form.id ? form : null} onClose={() => setForm(null)} onSaved={() => { setForm(null); refrescar(); toast('Producto guardado') }} />}
      {compra && <CompraForm productoInicial={compra.id ? compra : null} onClose={() => setCompra(false)} onSaved={() => { setCompra(false); refrescar() }} />}
      {cargar && <Modal title="Cargar unidades" subtitle={cargar.nombre} onClose={() => setCargar(null)}>
        <div className="inv-load-options">
          {can('registrar_compras') && <button type="button" onClick={() => { const p = cargar; setCargar(null); setCompra(p) }}><span className="inv-load-icon"><I n="truckIn" /></span><span><b>Compra a proveedor</b><small>Ingreso de mercancía: registra costo, proveedor y lo que queda por pagar{cargar.maneja_serial ? ', con el IMEI de cada unidad' : ''}.</small></span></button>}
          {!cargar.maneja_serial && <button type="button" onClick={() => { const p = cargar; setCargar(null); setAjuste(p) }}><span className="inv-load-icon"><I n="adjust" /></span><span><b>Ajuste rápido</b><small>Para unidades que ya tienes en la tienda (inventario inicial, conteo físico).</small></span></button>}
        </div>
      </Modal>}
      {ajuste && <AjusteStock p={ajuste} onClose={() => setAjuste(null)} onSaved={() => { setAjuste(null); refrescar() }} />}
      {movs && <Movimientos p={movs} onClose={() => setMovs(null)} />}
    </AppShell>
  )
}

function ProductoDetalle({ p, editar, costos, puedeVender, onClose, onEditar, onVender, onAjuste, onMovs, onIngreso, onCargar, onCambio }) {
  const [uni, setUni] = useState(null)
  const [tone, label] = estadoStock(p)
  useEffect(() => {
    if (p.maneja_serial) supabase.from('unidades_serializadas').select('id,serial,estado').eq('producto_id', p.id).order('id', { ascending: false }).limit(100).then(({ data }) => setUni(data || []))
  }, [p])
  const copiar = async () => { try { await navigator.clipboard.writeText(p.codigo); toast('Código copiado') } catch { toast(p.codigo) } }
  const filas = [
    ['phone', 'Categoría', p.categoria || 'Sin categoría', <CategoryIcon key="c" categoria={p.categoria} />],
    ['tag', 'Marca', p.marca || 'Genérica'],
    ['phone', 'Modelo compatible', p.modelo],
    ['palette', 'Color', p.color],
    ['box', 'Stock actual', unidades(p.stock)],
    ['warn', 'Stock mínimo', unidades(p.stock_min)],
    p.stock_max != null && ['box', 'Stock máximo', unidades(p.stock_max)],
    costos && p.precio_compra != null && ['tag', 'Precio de compra', money(p.precio_compra)],
    p.codigo_barras && ['barcode', 'Código de barras', p.codigo_barras],
  ].filter(f => f && f[2])
  const menu = <Menu label="Opciones del producto" items={[
    editar && { label: 'Editar', icon: 'pencil', onClick: onEditar },
    editar && !p.maneja_serial && { label: 'Ajustar stock', icon: 'adjust', onClick: onAjuste },
    editar && { label: 'Movimientos', icon: 'history', onClick: onMovs },
    onIngreso && { label: 'Ingreso de mercancía', icon: 'truckIn', onClick: onIngreso },
  ]} />
  return <FullPage title="Detalle del producto" onBack={onClose} menu={menu} className="inv-detail"
    footer={(editar || puedeVender) && <div className="inv-detail-actions">
      {editar && <button type="button" className="inv-btn-outline" onClick={onEditar}><I n="pencil" />Editar</button>}
      {puedeVender && <button type="button" className="inv-btn-gold" disabled={p.stock <= 0} onClick={onVender}><I n="cart" />{p.stock > 0 ? 'Vender' : 'Agotado'}</button>}
    </div>}>
    <div className="inv-gallery">
      <div className="inv-gallery-main"><ProductThumbnail product={p} /></div>
      <div className="inv-gallery-side">
        <div className="inv-gallery-thumb on"><ProductThumbnail product={p} /></div>
        {editar && <button type="button" className="inv-gallery-add" aria-label="Cambiar foto" onClick={onEditar}><I n="plus" /></button>}
      </div>
    </div>
    <div className="inv-detail-title">
      <div><h2>{p.nombre}</h2><button type="button" className="inv-sku" onClick={copiar} aria-label="Copiar código">{p.codigo}<I n="copy" /></button></div>
      <span className={'inv-status ' + tone}>{label}</span>
    </div>
    <div className="inv-price-row"><p className="inv-detail-price">{money(p.precio_venta)}</p>
      {onCargar && <button type="button" className="inv-load-btn" onClick={onCargar}><I n="plus" />Cargar unidades</button>}</div>
    {p.stock === 0 && onCargar && <p className="inv-zero-hint">Este producto aún no tiene unidades. Toca <b>Cargar unidades</b> para agregarlas.</p>}
    <div className="inv-specs">
      {filas.map(([ic, k, v, custom]) => <div key={k} className="inv-spec"><span className="inv-spec-icon">{custom || <I n={ic} />}</span><span><small>{k}</small><b>{v}</b></span></div>)}
    </div>
    {p.descripcion && <div className="inv-desc"><small>Descripción</small><p>{p.descripcion}</p></div>}
    {p.maneja_serial && <div className="inv-desc"><small>IMEI / seriales</small>
      {!uni ? <Loader /> : uni.length === 0 ? <p>Sin unidades registradas.</p> : uni.map(u => <div key={u.id} className="inv-serial"><span>{u.serial}</span><Badge tone={u.estado === 'disponible' ? 'good' : ''}>{u.estado}</Badge></div>)}
    </div>}
    {isDemoMode && editar && <div className="destructive-zone"><RecordStatus table="productos" record={p} onSaved={onCambio} /></div>}
  </FullPage>
}

function AjusteStock({ p, onClose, onSaved }) {
  const [tipo, setTipo] = useState('ajuste_entrada')
  const [cant, setCant] = useState('')
  const [motivo, setMotivo] = useState('')
  const [fisico, setFisico] = useState(String(p.stock))
  const [err, setErr] = useState('')
  const [guardar, pending] = useAction(async () => {
    setErr('')
    if (tipo !== 'fisico' && (!Number.isInteger(Number(cant)) || Number(cant) <= 0)) return setErr('La cantidad debe ser un entero mayor que cero.')
    if (!motivo.trim()) return setErr('Escribe el motivo del ajuste.')
    const { error } = await (isDemoMode && tipo === 'fisico' ? supabase.rpc('ajustar_stock_fisico_demo', { id: p.id, stock: Number(fisico), motivo }) : supabase.rpc('ajustar_inventario', { p_producto_id: p.id, p_cantidad: Number(cant), p_tipo: tipo, p_motivo: motivo }))
    if (error) return setErr(mensajeError(error))
    toast('Inventario actualizado'); onSaved()
  })
  return <Modal title="Ajustar stock" subtitle={`${p.nombre} · stock actual ${p.stock}`} keyboardAware onClose={onClose} footer={<div className="action-grid"><button className="btn sec" onClick={onClose}>Cancelar</button><button className="btn" disabled={pending} onClick={guardar}>{pending ? 'Guardando…' : 'Guardar'}</button></div>}>
    <ErrorBox text={err} />
    <Select label="Tipo de movimiento" value={tipo} onChange={e => setTipo(e.target.value)}>
      {isDemoMode && <option value="fisico">Conciliar stock físico</option>}
      <option value="ajuste_entrada">Entrada (ajuste)</option><option value="ajuste_salida">Salida (pérdida, daño, uso)</option><option value="devolucion_proveedor">Devolución a proveedor</option>
    </Select>
    {tipo === 'fisico' ? <Input label="Stock físico" type="number" min="0" step="1" value={fisico} onChange={e => setFisico(e.target.value)} /> : <Input label="Cantidad" type="number" min="1" value={cant} onChange={e => setCant(e.target.value)} />}
    <Input label="Motivo" value={motivo} onChange={e => setMotivo(e.target.value)} />
  </Modal>
}

function Movimientos({ p, onClose }) {
  const [movs, setMovs] = useState(null)
  useEffect(() => { supabase.from('movimientos_inventario').select('*').eq('producto_id', p.id).order('fecha', { ascending: false }).limit(50).then(({ data }) => setMovs(data || [])) }, [p.id])
  return <Modal title="Movimientos" subtitle={p.nombre} onClose={onClose}>
    {!movs ? <Loader /> : movs.length === 0 ? <Empty text="Sin movimientos" description="Aquí verás compras, ventas y ajustes de este producto." /> : movs.map(m => (
      <div key={m.id} className="row"><div className="flex-1"><p className="m-0 text-sm font-semibold" style={{ textTransform: 'capitalize' }}>{m.tipo.replace(/_/g, ' ')}</p><p className="m-0 text-xs text-muted">{fechaHora(m.fecha)}{m.motivo ? ' · ' + m.motivo : ''}</p></div><div className="text-right"><b className={m.cantidad > 0 ? 'text-good' : 'text-bad'}>{m.cantidad > 0 ? '+' : ''}{m.cantidad}</b><p className="m-0 text-xs text-muted">queda {m.stock_despues}</p></div></div>
    ))}
  </Modal>
}
