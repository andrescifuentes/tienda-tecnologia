import BrandStrip from '../components/BrandStrip'
﻿import { useEffect, useState } from 'react'
import ModuleBanner from '../components/ModuleBanner'
import { useNavigate, useSearchParams } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { useDemoRevision } from '../lib/demo/useDemoRevision'
import { AnimatedCard, ProductThumbnail, Brand } from '../components/TechVisuals'
import { I, CategoryIcon } from '../components/InvIcons'
import Modal from '../components/Modal'
import RecordStatus from '../components/RecordStatus'
import { useAction } from '../lib/useAction'
import ProductoForm from '../components/ProductoForm'
import FullPage from '../components/FullPage'
import CompraForm from '../components/CompraForm'
import ProductUnits from '../components/ProductUnits'
import { Empty, Loader, Input, Select, ErrorBox } from '../components/ui'
import { supabase, isDemoMode } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { money, fechaHora, limpiarBusqueda, mensajeError } from '../lib/format'
import { toast } from '../lib/toast'
import { useLocales, cargarStockLocales, avisarCambioLocales } from '../lib/locales'
import LocalSelector, { LocalTag } from '../components/LocalSelector'
import '../styles/locales.css'

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
  const { can, esAdmin, perfil } = useAuth()
  const loc = useLocales(perfil)
  // El administrador puede ver un local o todos; el vendedor ve el stock de todos los locales
  const filtroLocal = esAdmin ? loc.filtro : null
  const localTrabajo = filtroLocal || loc.miLocal || loc.locales[0]?.id || null
  const [stockLoc, setStockLoc] = useState(null)
  const [traslado, setTraslado] = useState(null)
  const editar = esAdmin && can('editar_inventario')
  const costos = esAdmin && can('ver_costos')
  const [params] = useSearchParams()
  const [q, setQ] = useState(params.get('q') || '')
  const [filtro, setFiltro] = useState(['bajo', 'agotado', 'inactivos'].includes(params.get('filtro')) ? params.get('filtro') : 'todos')
  const [cats, setCats] = useState([])
  const [categoria, setCategoriaRaw] = useState('Todos')
  const [marca, setMarca] = useState('Todas')
  const setCategoria = (c) => { setCategoriaRaw(c); setMarca('Todas') }
  const [lista, setLista] = useState(null)
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
      const base = (data || []).map(p => ({ ...p, categoria: p.categoria || p.categorias?.nombre }))
      const sl = loc.habilitado ? await cargarStockLocales(supabase, base.map(p => p.id)) : null
      setStockLoc(sl)
      // Con un local elegido solo se listan los productos que ese local maneja
      // (los que han tenido stock allí); lo del otro local no sale como «Agotado»
      const rows = base.map(p => decorarLocal(p, sl)).filter(p => !filtroLocal || !sl || sl[p.id]?.[filtroLocal] !== undefined)
      setLista(rows)
      setSel(prev => prev ? rows.find(p => p.id === prev.id) || prev : null)
    }, 220)
    return () => clearTimeout(t)
  }, [q, tick, tabla, filtro, revision, loc.habilitado, filtroLocal]) // eslint-disable-line react-hooks/exhaustive-deps
  // Con un local elegido, el stock que se ve (y los filtros de stock bajo/agotado) son los de ese local
  function decorarLocal(p, sl = stockLoc) {
    if (!loc.habilitado || !sl) return p
    const stocks = sl[p.id] || {}
    return { ...p, _stocks: stocks, _total: p.stock, stock: filtroLocal ? (stocks[filtroLocal] || 0) : p.stock }
  }

  const marcaDe = (p) => (p.marca || 'Genérica').trim()
  const marcasCat = Object.entries((lista || []).filter(p => categoria === 'Todos' || p.categoria === categoria).reduce((m, p) => { const k = marcaDe(p); m[k] = (m[k] || 0) + 1; return m }, {})).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const visible = (lista || []).filter(p => (categoria === 'Todos' || p.categoria === categoria) && (marca === 'Todas' || marcaDe(p) === marca) && (filtro === 'bajo' ? p.stock <= p.stock_min : filtro === 'agotado' ? p.stock === 0 : true))
  const bajos = (lista || []).filter(p => p.stock <= p.stock_min).length
  const porEstado = (lista || []).filter(p => filtro === 'bajo' ? p.stock <= p.stock_min : filtro === 'agotado' ? p.stock === 0 : true)
  const conteo = porEstado.reduce((m, p) => { const k = p.categoria || 'Sin categoría'; m[k] = (m[k] || 0) + 1; return m }, {})
  const activos = (categoria !== 'Todos' ? 1 : 0) + (filtro !== 'todos' ? 1 : 0) + (marca !== 'Todas' ? 1 : 0)
  const chipsCategorias = [{ nombre: 'Todos', n: porEstado.length }, ...Object.entries(conteo).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([nombre, n]) => ({ nombre, n }))]
  const refrescar = () => setTick(t => t + 1)
  useEffect(() => { if (lista && categoria !== 'Todos' && !conteo[categoria]) setCategoria('Todos') }, [lista, filtro]) // eslint-disable-line
  const vender = p => navigate('/vender?q=' + encodeURIComponent(p.codigo))
  const acciones = p => [
    { label: 'Ver detalle', icon: 'box', onClick: () => setSel(p) },
    editar && { label: 'Editar', icon: 'pencil', onClick: () => setForm(p) },
    (editar || (esAdmin && can('registrar_compras'))) && { label: 'Cargar unidades', icon: 'truckIn', onClick: () => setCargar(p) },
    editar && !p.maneja_serial && { label: 'Ajustar stock', icon: 'adjust', onClick: () => setAjuste(p) },
    editar && loc.multi && { label: 'Trasladar a otro local', icon: 'swap', onClick: () => setTraslado(p) },
    editar && { label: 'Movimientos', icon: 'history', onClick: () => setMovs(p) },
    can('vender') && p.stock > 0 && { label: 'Vender', icon: 'cart', onClick: () => vender(p) },
  ]

  const header = <div className="inv-head">
    <div className="inv-head-top"><Brand compact /><button type="button" className="inv-bell" aria-label={bajos ? `${bajos} productos con stock bajo` : 'Sin alertas de stock'} onClick={() => setFiltro(bajos ? 'bajo' : 'todos')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15L6 16zM10 20.5a2 2 0 004 0" /></svg>{bajos > 0 && <span className="inv-dot" />}</button></div>
    <ModuleBanner modulo="productos" title={editar ? 'Inventario' : 'Productos'} sub={editar ? 'Consulta y gestiona el inventario' : 'Consulta stock y precios'} actions={editar && <button type="button" onClick={() => setForm({})}><I n="plus" />Agregar producto</button>} />
  </div>

  return (
    <AppShell title="Inventario" header={header}>
      <div className="inv-search">
        <label className="inv-search-box"><I n="search" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por nombre o código" autoCapitalize="none" aria-label="Buscar producto" />{q && <button type="button" className="inv-scan" aria-label="Limpiar búsqueda" onClick={() => setQ('')}>✕</button>}</label>
        <button type="button" className={'inv-filter' + (activos ? ' on' : '')} aria-label={activos ? `Filtros (${activos} activos)` : 'Filtros'} onClick={() => setFiltros(true)}><I n="sliders" />{activos > 0 && <span className="inv-filter-count">{activos}</span>}</button>
      </div>
      {esAdmin && <LocalSelector loc={loc} />}
      {esAdmin && loc.habilitado && loc.locales.length === 1 && <div className="loc-aviso"><I n="store" /><span>Todo tu inventario está en <b>{loc.locales[0].nombre}</b>. Para separar el stock por local, crea tu segundo local en <b>Más › Configuración › Locales</b>. <button type="button" className="loc-aviso-btn" onClick={() => navigate('/configuracion#locales')}>Ir a Locales</button></span></div>}
      {marcasCat.length>1&&<BrandStrip brands={[["Todas",marcasCat.reduce((a,[,n])=>a+n,0)],...marcasCat]} value={marca} onChange={setMarca}/>}
      {activos > 0 && <div className="inv-tags">
        {marca !== 'Todas' && <button type="button" onClick={() => setMarca('Todas')}><I n="tag" />{marca}<span aria-hidden="true">✕</span></button>}
        {categoria !== 'Todos' && <button type="button" onClick={() => setCategoria('Todos')}><CategoryIcon categoria={categoria} />{categoria}<span aria-hidden="true">✕</span></button>}
        {filtro !== 'todos' && <button type="button" onClick={() => setFiltro('todos')}><I n="warn" />{{ bajo: 'Stock bajo', agotado: 'Agotados', inactivos: 'Inactivos' }[filtro]}<span aria-hidden="true">✕</span></button>}
        <button type="button" className="clear" onClick={() => { setCategoria('Todos'); setFiltro('todos'); setMarca('Todas') }}>Limpiar</button>
      </div>}

      {!lista ? <Loader /> : visible.length === 0 ? <Empty text={filtroLocal && !(lista || []).length ? loc.nombre(filtroLocal) + " aún no tiene inventario" : "No hay productos para mostrar"} description={filtroLocal && !(lista || []).length ? "Traslada productos desde otro local (en el detalle del producto) o registra una compra que llegue a este local." : "Cambia la categoría o los filtros, o agrega un producto nuevo."} action={editar ? () => setForm({}) : undefined} actionLabel="+ Agregar producto" /> : (
        <><p className="inv-count">{visible.length} {visible.length === 1 ? 'producto' : 'productos'}{categoria !== 'Todos' ? ' · ' + categoria : ''}</p>
        <div className="inv-list">
          {visible.map((p, index) => {
            const [tone] = estadoStock(p)
            const tope = Math.max(Number(p.stock_max) || 0, (Number(p.stock_min) || 0) * 3, Number(p.stock) || 0, 1)
            const pct = Math.max(p.stock > 0 ? 6 : 0, Math.min(100, Math.round((Number(p.stock) || 0) / tope * 100)))
            const nombre = p.nombre ? p.nombre.charAt(0).toUpperCase() + p.nombre.slice(1) : ''
            return <AnimatedCard as="div" index={index} key={p.id} className={'inv-card pro ' + tone} role="button" tabIndex={0} onClick={() => setSel(p)} onKeyDown={e => { if (e.key === 'Enter') setSel(p) }}>
              <ProductThumbnail product={p} />
              <div className="inv-card-body">
                <div className="inv-card-top"><span className="inv-eyebrow">{[p.categoria, p.marca || 'Genérica'].filter(Boolean).join(' · ')}</span><Menu items={acciones(p)} /></div>
                <b className="inv-card-name">{nombre}</b>
                <span className="inv-card-sku">{p.codigo}</span>
                <div className="inv-card-bottom">
                  <span className="inv-stock"><span className="inv-stock-txt"><i />{p.stock === 0 ? 'Agotado' : unidades(p.stock)}</span><span className="inv-meter"><span style={{ width: pct + '%' }} /></span></span>
                  <b className="inv-price">{money(p.precio_venta)}</b>
                </div>
                {loc.habilitado && p._stocks && loc.locales.length > 0 && <span className="loc-stock-mini">{loc.locales.map(l => { const n = p._stocks[l.id] || 0; return <span key={l.id} className={n ? '' : 'cero'}>{l.nombre}: <b>{n}</b></span> })}</span>}
              </div>
            </AnimatedCard>
          })}
        </div></>
      )}

      {filtros && <Modal title="Filtros" className="flt-sheet" keyboardAware onClose={() => setFiltros(false)} footer={<div className="inv-sheet-foot"><button type="button" className="inv-btn-outline" onClick={() => { setCategoria('Todos'); setFiltro('todos'); setMarca('Todas') }}>Limpiar</button><button type="button" className="inv-btn-gold" onClick={() => setFiltros(false)}>Ver {visible.length} {visible.length === 1 ? 'producto' : 'productos'}</button></div>}>
        <p className="inv-sheet-label">Estado del stock</p>
        <div className="flt-stats">
          {[['todos', 'Todos', 'box', ''], ['bajo', 'Stock bajo', 'warn', 'warn'], ['agotado', 'Agotados', 'box', 'bad'], ...(isDemoMode && editar ? [['inactivos', 'Inactivos', 'history', '']] : [])].map(([k, l, ic, tone]) => {
            const base = (lista || []).filter(p => categoria === 'Todos' || p.categoria === categoria)
            const n = k === 'bajo' ? base.filter(p => p.stock <= p.stock_min).length : k === 'agotado' ? base.filter(p => p.stock === 0).length : base.length
            return <button key={k} type="button" className={'flt-stat ' + tone + (filtro === k ? ' on' : '')} aria-pressed={filtro === k} onClick={() => setFiltro(k)}>
              <span className="flt-stat-top"><span className="flt-stat-ic"><I n={ic} /></span>{filtro === k && <span className="flt-check"><I n="check" /></span>}</span>
              <b>{n}</b><small>{l}</small>
            </button>
          })}
        </div>
        <p className="inv-sheet-label">Categoría</p>
        <div className="flt-list">
          {[{ nombre: 'Todos', n: porEstado.length }, ...cats.map(c => ({ nombre: c.nombre, n: conteo[c.nombre] || 0 })).filter(c => c.n > 0 || categoria === c.nombre).sort((x, y) => y.n - x.n || x.nombre.localeCompare(y.nombre))].map(c =>
            <button key={c.nombre} type="button" className={categoria === c.nombre ? 'on' : ''} aria-pressed={categoria === c.nombre} onClick={() => setCategoria(c.nombre)}>
              <span className="flt-row-ic">{c.nombre === 'Todos' ? <I n="box" /> : <CategoryIcon categoria={c.nombre} />}</span>
              <span className="flt-row-name">{c.nombre === 'Todos' ? 'Todas las categorías' : c.nombre}</span>
              <span className="flt-row-n">{c.n}</span>
              <span className="flt-row-check">{categoria === c.nombre && <I n="check" />}</span>
            </button>)}
        </div>
        {cats.some(c => !conteo[c.nombre]) && <p className="flt-note">Las categorías sin productos no se muestran.</p>}
        {marcasCat.length > 1 && <>
          <p className="inv-sheet-label flt-gap">Marca{categoria !== 'Todos' ? ' · ' + categoria : ''}</p>
          <BrandStrip brands={[["Todas",marcasCat.reduce((a,[,n])=>a+n,0)],...marcasCat]} value={marca} onChange={setMarca}/>
        </>}
      </Modal>}
      {sel && !form && <ProductoDetalle loc={loc} filtroLocal={filtroLocal} onTraslado={editar && loc.multi ? () => setTraslado(sel) : null} p={sel} editar={editar} costos={costos} puedeVender={can('vender')} onClose={() => { setSel(null); if (productoId) navigate('/inventario', { replace: true }) }} onEditar={() => setForm(sel)} onVender={() => vender(sel)} onAjuste={() => setAjuste(sel)} onMovs={() => setMovs(sel)} onIngreso={(esAdmin && can('registrar_compras')) ? () => setCompra(sel) : null} onCargar={editar || (esAdmin && can('registrar_compras')) ? () => setCargar(sel) : null} onCambio={refrescar} />}
      {form && <ProductoForm localId={loc.multi ? localTrabajo : null} localNombre={loc.multi ? loc.nombre(localTrabajo) : ''} inicial={form.id ? form : null} onClose={() => setForm(null)} onSaved={() => { setForm(null); refrescar(); toast('Producto guardado') }} />}
      {esAdmin && can('registrar_compras') && compra && <CompraForm localInicial={compra._local} productoInicial={compra.id ? compra : null} cantidadInicial={compra._cant} proveedorId={compra._prov} onClose={() => setCompra(false)} onSaved={() => { setCompra(false); refrescar() }} />}
      {esAdmin && (editar || can('registrar_compras')) && cargar && <CargarUnidades p={cargar} loc={loc} localInicial={localTrabajo} puedeComprar={can('registrar_compras')} onClose={() => setCargar(null)} onCompra={(n, provId, localId) => { const p = cargar; setCargar(null); setCompra({ ...p, _cant: n, _prov: provId, _local: localId }) }} onSaved={() => { setCargar(null); refrescar() }} />}
      {traslado && <TrasladoStock p={traslado} loc={loc} origenInicial={filtroLocal} onClose={() => setTraslado(null)} onSaved={() => { setTraslado(null); avisarCambioLocales(); refrescar() }} />}
      {ajuste && <AjusteStock loc={loc} localInicial={localTrabajo} p={ajuste} onClose={() => setAjuste(null)} onSaved={() => { setAjuste(null); refrescar() }} />}
      {movs && <Movimientos loc={loc} p={movs} onClose={() => setMovs(null)} />}
    </AppShell>
  )
}

function ProductoDetalle({ p, loc, filtroLocal, onTraslado, editar, costos, puedeVender, onClose, onEditar, onVender, onAjuste, onMovs, onIngreso, onCargar, onCambio }) {
  const [tone, label] = estadoStock(p)
  const copiar = async () => { try { await navigator.clipboard.writeText(p.codigo); toast('Código copiado') } catch { toast(p.codigo) } }
  const filas = [
    ['phone', 'Categoría', p.categoria || 'Sin categoría', <CategoryIcon key="c" categoria={p.categoria} />],
    ['tag', 'Marca', p.marca || 'Genérica'],
    ['phone', 'Modelo compatible', p.modelo],
    ['palette', 'Color', p.color],
    ['box', loc?.multi ? (filtroLocal ? 'Stock en ' + loc.nombre(filtroLocal) : 'Stock total (todos los locales)') : loc?.habilitado && loc.locales[0] ? 'Stock en ' + loc.locales[0].nombre : 'Stock actual', unidades(p.stock)],
    ['warn', 'Stock mínimo', unidades(p.stock_min)],
    p.stock_max != null && ['box', 'Stock máximo', unidades(p.stock_max)],
    costos && p.precio_compra != null && ['tag', 'Precio de compra', money(p.precio_compra)],
    p.codigo_barras && ['barcode', 'Código de barras', p.codigo_barras],
    ...(Array.isArray(p.atributos) ? p.atributos : []).map(a => ['tag', a.etiqueta, a.valor]),
  ].filter(f => f && f[2])
  const menu = <Menu label="Opciones del producto" items={[
    editar && { label: 'Editar', icon: 'pencil', onClick: onEditar },
    editar && !p.maneja_serial && { label: 'Ajustar stock', icon: 'adjust', onClick: onAjuste },
    onTraslado && { label: 'Trasladar a otro local', icon: 'swap', onClick: onTraslado },
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
    {loc?.habilitado && p._stocks && loc.locales.length > 0 && <div className="inv-desc"><small>Stock por local</small>
      <div className="loc-stock">{loc.locales.map(l => { const n = p._stocks[l.id] || 0; return <div key={l.id} className={'loc-stock-cell' + (l.id === (filtroLocal || loc.miLocal) ? ' mio' : '')}><small>{l.nombre}</small><b className={n ? '' : 'cero'}>{unidades(n)}</b></div> })}</div>
      {onTraslado && <button type="button" className="inv-load-btn" style={{ marginTop: 10 }} onClick={onTraslado}><I n="swap" />Trasladar entre locales</button>}
      {editar && loc.locales.length === 1 && <p className="inv-zero-hint" style={{ marginTop: 10 }}>Cuando crees tu segundo local en <b>Más › Configuración › Locales</b>, aquí verás el stock de cada uno y podrás trasladar unidades.</p>}
    </div>}
    {p.descripcion && <div className="inv-desc"><small>Descripción</small><p>{p.descripcion}</p></div>}
    {p.maneja_serial && <ProductUnits producto={p} editar={editar} nombreLocal={loc?.habilitado ? loc.nombre : null} />}
    {isDemoMode && editar && <div className="destructive-zone"><RecordStatus table="productos" record={p} onSaved={onCambio} /></div>}
  </FullPage>
}

function AjusteStock({ p, loc, localInicial, onClose, onSaved }) {
  const [localId, setLocalId] = useState(localInicial)
  const stockAqui = loc?.multi && p._stocks ? (p._stocks[localId] || 0) : p.stock
  const [tipo, setTipo] = useState('ajuste_entrada')
  const [cant, setCant] = useState('')
  const [motivo, setMotivo] = useState('')
  const [fisico, setFisico] = useState(String(stockAqui))
  const [err, setErr] = useState('')
  const [guardar, pending] = useAction(async () => {
    setErr('')
    if (tipo !== 'fisico' && (!Number.isInteger(Number(cant)) || Number(cant) <= 0)) return setErr('La cantidad debe ser un entero mayor que cero.')
    if (!motivo.trim()) return setErr('Escribe el motivo del ajuste.')
    const { error } = await (isDemoMode && tipo === 'fisico' ? supabase.rpc('ajustar_stock_fisico_demo', { id: p.id, stock: Number(fisico), motivo, ...(loc?.multi ? { local_id: localId } : {}) }) : supabase.rpc('ajustar_inventario', { p_producto_id: p.id, p_cantidad: Number(cant), p_tipo: tipo, p_motivo: motivo, ...(loc?.multi ? { p_local_id: localId } : {}) }))
    if (error) return setErr(mensajeError(error))
    toast('Inventario actualizado'); onSaved()
  })
  return <Modal title="Ajustar stock" subtitle={`${p.nombre} · stock ${loc?.multi ? 'en ' + loc.nombre(localId) : 'actual'} ${stockAqui}`} keyboardAware onClose={onClose} footer={<div className="action-grid"><button className="btn sec" onClick={onClose}>Cancelar</button><button className="btn" disabled={pending} onClick={guardar}>{pending ? 'Guardando…' : 'Guardar'}</button></div>}>
    <ErrorBox text={err} />
    {loc?.multi && <Select label="Local" value={localId || ''} onChange={e => { setLocalId(Number(e.target.value)); setFisico(String(p._stocks?.[e.target.value] || 0)) }}>{loc.locales.map(l => <option key={l.id} value={l.id}>{l.nombre} · {p._stocks?.[l.id] || 0} en stock</option>)}</Select>}
    <Select label="Tipo de movimiento" value={tipo} onChange={e => setTipo(e.target.value)}>
      {isDemoMode && <option value="fisico">Conciliar stock físico</option>}
      <option value="ajuste_entrada">Entrada (ajuste)</option><option value="ajuste_salida">Salida (pérdida, daño, uso)</option><option value="devolucion_proveedor">Devolución a proveedor</option>
    </Select>
    {tipo === 'fisico' ? <Input label="Stock físico" type="number" min="0" step="1" value={fisico} onChange={e => setFisico(e.target.value)} /> : <Input label="Cantidad" type="number" min="1" value={cant} onChange={e => setCant(e.target.value)} />}
    <Input label="Motivo" value={motivo} onChange={e => setMotivo(e.target.value)} />
  </Modal>
}

function Movimientos({ p, loc, onClose }) {
  const [movs, setMovs] = useState(null)
  useEffect(() => { supabase.from('movimientos_inventario').select('*').eq('producto_id', p.id).order('fecha', { ascending: false }).limit(50).then(({ data }) => setMovs(data || [])) }, [p.id])
  return <Modal title="Movimientos" subtitle={p.nombre} onClose={onClose}>
    {!movs ? <Loader /> : movs.length === 0 ? <Empty text="Sin movimientos" description="Aquí verás compras, ventas y ajustes de este producto." /> : movs.map(m => (
      <div key={m.id} className="row"><div className="flex-1"><p className="m-0 text-sm font-semibold" style={{ textTransform: 'capitalize' }}>{m.tipo.replace(/_/g, ' ')}</p><p className="m-0 text-xs text-muted">{fechaHora(m.fecha)}{m.motivo ? ' · ' + m.motivo : ''}</p>{loc?.multi && m.local_id != null && <LocalTag nombre={loc.nombre(m.local_id)} />}</div><div className="text-right"><b className={m.cantidad > 0 ? 'text-good' : 'text-bad'}>{m.cantidad > 0 ? '+' : ''}{m.cantidad}</b><p className="m-0 text-xs text-muted">queda {loc?.multi && m.stock_local_despues != null ? m.stock_local_despues + ' aquí · ' + m.stock_despues + ' total' : m.stock_despues}</p></div></div>
    ))}
  </Modal>
}

function CargarUnidades({ p, loc, localInicial, puedeComprar, onClose, onCompra, onSaved }) {
  const { esAdmin, can } = useAuth()
  const [localId, setLocalId] = useState(localInicial)
  const stockAqui = loc?.multi && p._stocks ? (p._stocks[localId] || 0) : p.stock
  const [n, setN] = useState(1)
  const [provs, setProvs] = useState(null)
  const [origen, setOrigen] = useState(null) // id de proveedor | 'otro'
  const [motivoOtro, setMotivoOtro] = useState('compra_propia')
  const [nuevo, setNuevo] = useState(null) // { nombre, telefono }
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const soloCompra = !!p.maneja_serial
  useEffect(() => { supabase.from('proveedores').select('id,nombre,telefono').eq('activo', true).order('nombre').then(({ data }) => setProvs(data || [])) }, [])

  async function crearProveedor() {
    if (!esAdmin || !can('registrar_compras')) return setErr('No tienes permiso para registrar proveedores.')
    const nombre = (nuevo?.nombre || '').trim()
    if (!nombre) return setErr('Escribe el nombre del proveedor.')
    setBusy(true); setErr('')
    const { data, error } = await supabase.from('proveedores').insert({ nombre, telefono: (nuevo.telefono || '').trim() || null }).select('id,nombre,telefono').single()
    setBusy(false)
    if (error) return setErr(mensajeError(error))
    setProvs(l => [...(l || []), data].sort((x, y) => x.nombre.localeCompare(y.nombre))); setOrigen(data.id); setNuevo(null); toast('Proveedor registrado')
  }
  async function continuar() {
    setErr('')
    if (!esAdmin || !(can('editar_inventario') || can('registrar_compras'))) return setErr('No tienes permiso para cargar unidades.')
    if (!Number.isInteger(n) || n < 1) return setErr('Escribe cuántas unidades vas a agregar.')
    if (!origen) return setErr('Elige de dónde vienen las unidades.')
    if (origen !== 'otro') return onCompra(n, origen, loc?.multi ? localId : null)
    setBusy(true)
    const motivo = motivoOtro === 'compra_propia' ? 'Compra propia (sin proveedor)' : motivoOtro === 'devolucion' ? 'Devolución o cambio de cliente' : 'Unidades que ya estaban en la tienda'
    const { error } = await supabase.rpc('ajustar_inventario', { p_producto_id: p.id, p_cantidad: n, p_tipo: 'ajuste_entrada', p_motivo: motivo, ...(loc?.multi ? { p_local_id: localId } : {}) })
    setBusy(false)
    if (error) return setErr(mensajeError(error))
    toast(`${unidades(n)} agregadas a ${p.nombre}${loc?.multi ? ' en ' + loc.nombre(localId) : ''}`); onSaved()
  }
  const provSel = (provs || []).find(x => x.id === origen)
  return <Modal title="Agregar unidades" subtitle={p.nombre} className="experience-sheet cu-sheet" keyboardAware onClose={onClose} footer={
    <button type="button" className="cf-save" disabled={busy || !origen || !!nuevo} onClick={continuar}>
      {busy ? 'Guardando…' : !origen ? 'Elige de dónde vienen' : origen === 'otro' ? <><I n="check" />Agregar {unidades(n)}</> : <>Registrar compra a {provSel?.nombre}<I n="back" className="flip" /></>}
    </button>}>
    <ErrorBox text={err} />
    <section className="cu-qty">
      <span className="cu-label">¿Cuántas unidades llegaron?</span>
      <div className="cu-step">
        <button type="button" aria-label="Menos" disabled={n <= 1} onClick={() => setN(x => Math.max(1, x - 1))}>−</button>
        <input inputMode="numeric" value={n} onChange={e => setN(Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0))} aria-label="Cantidad" />
        <button type="button" aria-label="Más" onClick={() => setN(x => x + 1)}>+</button>
      </div>
      <div className="cu-preview"><span>Hoy tienes <b>{stockAqui}</b></span><I n="back" className="flip" /><span>Quedarás con <b className="g">{Number(stockAqui) + (n || 0)}</b></span></div>
    </section>
    {loc?.multi && <><span className="cu-label">¿A qué local llegaron?</span><LocalSelector loc={loc} conTodos={false} value={localId} onChange={v => setLocalId(Number(v))} etiqueta="Local de destino" /></>}

    <span className="cu-label">¿Quién te las vendió?</span>
    {provs === null ? <Loader filas={2} /> : <div className="cu-provs">
      {puedeComprar && provs.map(pv => <button key={pv.id} type="button" className={origen === pv.id ? 'on' : ''} onClick={() => { setOrigen(pv.id); setNuevo(null) }}>
        <span className="cu-pv-av">{pv.nombre.split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase()}</span>
        <span className="cu-pv-txt"><b>{pv.nombre}</b><small>{pv.telefono || 'Proveedor registrado'}</small></span>
        <span className="cu-radio" />
      </button>)}
      {puedeComprar && (nuevo ? <div className="cu-new">
        <b className="cu-new-title"><I n="plus" />Nuevo proveedor</b>
        <label className="cf-box"><span className="cf-ic"><I n="truck" /></span><input autoFocus placeholder="Nombre del proveedor" value={nuevo.nombre} onChange={e => setNuevo({ ...nuevo, nombre: e.target.value })} /></label>
        <label className="cf-box"><span className="cf-ic"><I n="chat" /></span><span className="cf-prefix">+57</span><input inputMode="tel" placeholder="WhatsApp (opcional)" value={nuevo.telefono} onChange={e => setNuevo({ ...nuevo, telefono: e.target.value })} /></label>
        <div className="cu-new-actions"><button type="button" className="inv-btn-outline" onClick={() => setNuevo(null)}>Cancelar</button><button type="button" className="inv-btn-gold" disabled={busy} onClick={crearProveedor}>Guardar proveedor</button></div>
      </div> : <button type="button" className="cu-add" onClick={() => { setNuevo({ nombre: '', telefono: '' }); setOrigen(null) }}><span className="cu-pv-av add"><I n="plus" /></span><span className="cu-pv-txt"><b>Registrar proveedor nuevo</b><small>Si es la primera vez que le compras</small></span></button>)}
      {!soloCompra && <button type="button" className={'cu-other' + (origen === 'otro' ? ' on' : '')} onClick={() => { setOrigen('otro'); setNuevo(null) }}>
        <span className="cu-pv-av other"><I n="box" /></span>
        <span className="cu-pv-txt"><b>Otro origen, sin proveedor</b><small>Las compraste tú, ya estaban en la tienda o te las devolvieron</small></span>
        <span className="cu-radio" />
      </button>}
    </div>}
    {origen === 'otro' && <div className="cu-why">
      {[['compra_propia', 'Las compré yo'], ['tienda', 'Ya estaban en la tienda'], ['devolucion', 'Devolución de cliente']].map(([k, l]) => <button key={k} type="button" className={motivoOtro === k ? 'on' : ''} onClick={() => setMotivoOtro(k)}>{l}</button>)}
    </div>}
    {soloCompra && <p className="cu-note"><I n="warn" />Este producto maneja serial/IMEI: las unidades se registran con una compra para anotar cada serial.</p>}
  </Modal>
}

// Pasar mercancía de un local a otro (queda en los movimientos de ambos locales)
function TrasladoStock({ p, loc, origenInicial, onClose, onSaved }) {
  const stocks = p._stocks || {}
  const conStock = loc.locales.filter(l => (stocks[l.id] || 0) > 0)
  const [origen, setOrigen] = useState(origenInicial && stocks[origenInicial] ? origenInicial : conStock[0]?.id || loc.locales[0]?.id)
  const [destino, setDestino] = useState(() => loc.locales.find(l => l.id !== (origenInicial && stocks[origenInicial] ? origenInicial : conStock[0]?.id))?.id)
  const [cant, setCant] = useState(1)
  const [motivo, setMotivo] = useState('')
  const [units, setUnits] = useState(null), [elegidas, setElegidas] = useState([])
  const [err, setErr] = useState('')
  const disponible = stocks[origen] || 0
  useEffect(() => {
    if (!p.maneja_serial) return
    setUnits(null); setElegidas([])
    supabase.from('unidades_serializadas').select('id,serial,local_id').eq('producto_id', p.id).eq('estado', 'disponible').eq('local_id', origen).order('id').then(({ data }) => setUnits(data || []))
  }, [p.id, p.maneja_serial, origen])
  const cambiarOrigen = id => { setOrigen(id); if (id === destino) setDestino(loc.locales.find(l => l.id !== id)?.id) }
  const [guardar, pending] = useAction(async () => {
    setErr('')
    if (!origen || !destino || origen === destino) return setErr('Elige un local de origen y uno de destino diferentes.')
    if (p.maneja_serial ? !elegidas.length : (!Number.isInteger(cant) || cant < 1)) return setErr(p.maneja_serial ? 'Elige los equipos que vas a trasladar.' : 'Escribe cuántas unidades vas a trasladar.')
    if (!p.maneja_serial && cant > disponible) return setErr(`En ${loc.nombre(origen)} solo hay ${unidades(disponible)}.`)
    const { error } = await supabase.rpc('trasladar_inventario', { p_producto_id: p.id, p_origen: origen, p_destino: destino, p_cantidad: p.maneja_serial ? null : cant, p_unidades: p.maneja_serial ? elegidas : null, p_motivo: motivo.trim() || null })
    if (error) return setErr(mensajeError(error))
    const n = p.maneja_serial ? elegidas.length : cant
    toast(`${unidades(n)} trasladadas a ${loc.nombre(destino)}`); onSaved()
  })
  const n = p.maneja_serial ? elegidas.length : cant
  return <Modal title="Trasladar entre locales" subtitle={p.nombre} className="experience-sheet" keyboardAware onClose={onClose} footer={<div className="action-grid"><button type="button" className="btn sec" onClick={onClose}>Cancelar</button><button type="button" className="btn" disabled={pending || !n} onClick={guardar}>{pending ? 'Trasladando…' : `Trasladar ${unidades(n)}`}</button></div>}>
    <ErrorBox text={err} />
    <div className="loc-stock">{loc.locales.map(l => <div key={l.id} className={'loc-stock-cell' + (l.id === origen ? ' mio' : '')}><small>{l.nombre}</small><b className={stocks[l.id] ? '' : 'cero'}>{unidades(stocks[l.id] || 0)}</b></div>)}</div>
    <div className="loc-ruta" style={{ marginTop: 14 }}>
      <Select label="Sale de" value={origen || ''} onChange={e => cambiarOrigen(Number(e.target.value))}>{loc.locales.map(l => <option key={l.id} value={l.id}>{l.nombre} ({stocks[l.id] || 0})</option>)}</Select>
      <span className="loc-ruta-flecha" aria-hidden="true"><I n="swap" /></span>
      <Select label="Llega a" value={destino || ''} onChange={e => setDestino(Number(e.target.value))}>{loc.locales.filter(l => l.id !== origen).map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}</Select>
    </div>
    {p.maneja_serial ? <><span className="cu-label">Equipos en {loc.nombre(origen)}</span>
      {units === null ? <Loader filas={2} /> : units.length === 0 ? <p className="text-sm text-muted">No hay equipos disponibles en este local.</p> : <div className="loc-units">{units.map(u => { const on = elegidas.includes(u.id); return <label key={u.id} className={'loc-unit' + (on ? ' on' : '')}><input type="checkbox" checked={on} onChange={() => setElegidas(x => on ? x.filter(i => i !== u.id) : [...x, u.id])} /><span className="mono">{u.serial}</span></label> })}</div>}
    </> : <section className="cu-qty" style={{ marginTop: 6 }}>
      <span className="cu-label">¿Cuántas unidades?</span>
      <div className="cu-step">
        <button type="button" aria-label="Menos" disabled={cant <= 1} onClick={() => setCant(x => Math.max(1, x - 1))}>−</button>
        <input inputMode="numeric" value={cant} onChange={e => setCant(Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0))} aria-label="Cantidad a trasladar" />
        <button type="button" aria-label="Más" disabled={cant >= disponible} onClick={() => setCant(x => x + 1)}>+</button>
      </div>
    </section>}
    <Input label="Motivo (opcional)" placeholder="Ej: pedido de un cliente" value={motivo} onChange={e => setMotivo(e.target.value)} />
  </Modal>
}
