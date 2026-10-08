import { useEffect, useState } from 'react'
import AppShell from '../components/AppShell'
import { useDemoRevision } from '../lib/demo/useDemoRevision'
import { useSearchParams } from 'react-router-dom'
import { AnimatedCard, ProductThumbnail } from '../components/TechVisuals'
import { Icon } from '../components/Icons'
import Modal from '../components/Modal'
import Scanner from '../components/Scanner'
import RecordStatus from '../components/RecordStatus'
import { useAction } from '../lib/useAction'
import ProductoForm from '../components/ProductoForm'
import CompraForm from '../components/CompraForm'
import { SearchBar, Empty, Loader, Badge, Chips, Input, Select, ErrorBox } from '../components/ui'
import { supabase, isDemoMode } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { money, fechaHora, limpiarBusqueda, mensajeError } from '../lib/format'
import { toast } from '../lib/toast'

export default function Inventario() {
  const revision = useDemoRevision()
  const { can } = useAuth()
  const editar = can('editar_inventario')
  const costos = can('ver_costos')
  const [params] = useSearchParams()
  const [q, setQ] = useState(params.get('q') || '')
  const [filtro, setFiltro] = useState(['bajo','agotado','inactivos'].includes(params.get('filtro')) ? params.get('filtro') : 'todos')
  const [categoryOptions,setCategoryOptions]=useState([])
  useEffect(()=>{supabase.from('categorias').select('*').eq('activa',true).order('nombre').then(({data})=>setCategoryOptions(data||[]))},[])
  const [categoria, setCategoria] = useState('Todas')
  const [categorias, setCategorias] = useState(false)
  const [lista, setLista] = useState(null)
  const [scan, setScan] = useState(false)
  const [sel, setSel] = useState(null)
  const [form, setForm] = useState(null)
  const [compra, setCompra] = useState(false)
  const [tick, setTick] = useState(0)
  const productoId = params.get('producto')
  useEffect(() => {
    if (!productoId) return
    let active = true
    const tabla = costos || editar ? 'productos' : 'productos_venta'
    supabase.from(tabla).select('*').eq('id', Number(productoId)).then(({ data }) => {
      if (active && data?.[0]) setSel(data[0])
    })
    return () => { active = false }
  }, [productoId, costos, editar, revision])

  useEffect(() => {
    const t = setTimeout(async () => {
      const s = limpiarBusqueda(q)
      const tabla = costos || editar ? 'productos' : 'productos_venta'
      let qq = supabase.from(tabla).select(tabla === 'productos' ? '*, categorias(nombre)' : '*').order('nombre').limit(80)
      if (tabla === 'productos') qq = qq.eq('activo', filtro!=='inactivos')
      if (s) qq = qq.or(`nombre.ilike.%${s}%,codigo.ilike.%${s}%,codigo_barras.ilike.%${s}%,marca.ilike.%${s}%`)
      const { data } = await qq
      setLista((data || []).map((p) => ({ ...p, categoria: p.categoria || p.categorias?.nombre })))
      setSel(previous => previous ? (data || []).find(p => p.id === previous.id) || previous : null)
    }, 250)
    return () => clearTimeout(t)
  }, [q, tick, costos, editar, filtro, revision])

  const visible = (lista || []).filter((p) => (categoria === 'Todas' || p.categoria === categoria) && (filtro === 'bajo' ? p.stock <= p.stock_min : filtro === 'agotado' ? p.stock === 0 : true))
  const refrescar = () => { setLista(null); setTick((t) => t + 1); setSel(null) }

  return (
    <AppShell title={editar ? 'Inventario' : 'Productos'} sub={editar ? 'Control de stock' : 'Consulta de stock y precios'} right={editar && <button className="btn sm" onClick={() => setForm({})}>+ Nuevo</button>}>
      <SearchBar value={q} onChange={setQ} onScan={() => setScan(true)} placeholder="Buscar nombre, código o marca" />
      <div className="flex gap-2 items-start">
        <div className="flex-1 min-w-0"><Chips value={filtro} onChange={setFiltro} options={[{ value: 'todos', label: 'Todos' }, { value: 'bajo', label: 'Stock bajo' }, { value: 'agotado', label: 'Agotados' },...(isDemoMode&&editar?[{value:'inactivos',label:'Inactivos'}]:[])]} /></div>
        {can('registrar_compras') && <button className="btn sec sm" onClick={() => setCompra(true)}>Ingreso</button>}
      </div>
      <button className="category-toggle" aria-expanded={categorias} onClick={() => setCategorias(!categorias)}>Categorías · {categoria} <span>⌄</span></button>
      {categorias && <Chips value={categoria} onChange={setCategoria} options={['Todas', ...categoryOptions.map(c=>c.nombre)].map(value => ({value,label:value}))} />}
      {!lista ? <Loader /> : visible.length === 0 ? <Empty text="No hay productos para mostrar" description="Cambia los filtros o agrega un producto para comenzar a controlar el inventario." action={editar ? ()=>setForm({}) : undefined} actionLabel="+ Crear producto" /> : (
        <div className="product-list">
          {visible.map((p, index) => (
            <AnimatedCard as="button" type="button" index={index} key={p.id} className="row product-card" onClick={() => setSel(p)}>
              <ProductThumbnail product={p} />
              <div className="flex-1 min-w-0"><p className="m-0 text-sm font-semibold">{p.nombre}</p><p className="m-0 text-xs text-muted">{p.codigo}{p.marca ? ' · ' + p.marca : ''}{p.categoria ? ' · ' + p.categoria : ''}</p></div>
              <div className="text-right"><p className="m-0 text-sm font-bold">{money(p.precio_venta)}</p><p className="m-0 text-xs text-muted">Stock: {p.stock}</p><Badge tone={p.stock===0 ? 'bad' : p.stock <= p.stock_min ? 'warn' : 'good'}>{p.stock===0?'Agotado':p.stock<=p.stock_min?'Stock bajo':'Normal'}</Badge></div>
            </AnimatedCard>
          ))}
        </div>
      )}
      {scan && <Scanner onClose={() => setScan(false)} onScan={(c) => { setQ(c); setScan(false) }} />}
      {sel && !form && <Detalle p={sel} editar={editar} costos={costos} onClose={() => setSel(null)} onEditar={() => setForm(sel)} onCambio={refrescar} />}
      {form && <ProductoForm inicial={form.id ? form : null} onClose={() => setForm(null)} onSaved={() => { setForm(null); refrescar(); toast('Producto guardado') }} />}
      {compra && <CompraForm onClose={() => setCompra(false)} onSaved={() => { setCompra(false); refrescar() }} />}
    </AppShell>
  )
}

function Detalle({ p, editar, costos, onClose, onEditar, onCambio }) {
  const [modo, setModo] = useState(null)
  const [movs, setMovs] = useState(null)
  const [uni, setUni] = useState(null)
  const [tipo, setTipo] = useState('ajuste_entrada')
  const [cant, setCant] = useState('')
  const [motivo, setMotivo] = useState('')
  const [err, setErr] = useState('')
  const [fisico, setFisico] = useState(String(p.stock))

  useEffect(() => {
    if (p.maneja_serial) supabase.from('unidades_serializadas').select('id,serial,estado').eq('producto_id', p.id).order('id', { ascending: false }).limit(100).then(({ data }) => setUni(data || []))
  }, [p])

  async function verMovs() {
    setModo('movs')
    const { data } = await supabase.from('movimientos_inventario').select('*').eq('producto_id', p.id).order('fecha', { ascending: false }).limit(40)
    setMovs(data || [])
  }
  const [ajustar, pendingAdjust] = useAction(ajustarImpl)
  async function ajustarImpl() {
    setErr('')
    if (tipo !== 'fisico' && (!Number.isInteger(Number(cant)) || Number(cant)<=0)) return setErr('La cantidad debe ser un entero mayor que cero.')
    const { error } = await (isDemoMode && tipo==='fisico' ? supabase.rpc('ajustar_stock_fisico_demo',{id:p.id,stock:Number(fisico),motivo}) : supabase.rpc('ajustar_inventario', { p_producto_id: p.id, p_cantidad: Number(cant), p_tipo: tipo, p_motivo: motivo }))
    if (error) return setErr(mensajeError(error))
    toast('Inventario actualizado'); onCambio()
  }

  return (
    <Modal title={p.nombre} className="experience-sheet product-detail-sheet" keyboardAware onClose={onClose} footer={modo==='ajuste'&&<div className="action-grid"><button className="btn sec" onClick={()=>setModo(null)}>Cancelar</button><button className="btn" disabled={pendingAdjust} onClick={ajustar}>{pendingAdjust?'Guardando...':'Guardar'}</button></div>}>
      <ErrorBox text={err} />
      {modo === null && (
        <>
          <div className="product-detail-hero"><ProductThumbnail product={p}/><div><span className="premium-eyebrow">FICHA DE PRODUCTO</span><Badge tone={p.stock===0?'bad':p.stock<=p.stock_min?'warn':'good'}>{p.stock===0?'Agotado':p.stock<=p.stock_min?'Stock bajo':'Disponible'}</Badge><p>{p.marca || p.categoria || 'ANGIE TECH'}</p></div></div>
          <div className="card product-detail-info !p-3 mb-3 text-sm">
            <div className="flex justify-between"><span className="text-muted">Código</span><b>{p.codigo}</b></div>
            {p.codigo_barras && <div className="flex justify-between"><span className="text-muted">Barras</span><b>{p.codigo_barras}</b></div>}
            {p.marca && <div className="flex justify-between"><span className="text-muted">Marca</span><b>{p.marca}</b></div>}
            <div className="flex justify-between"><span className="text-muted">Precio venta</span><b>{money(p.precio_venta)}</b></div>
            {costos && p.precio_compra != null && <div className="flex justify-between"><span className="text-muted">Costo</span><b>{money(p.precio_compra)}</b></div>}
            <div className="flex justify-between"><span className="text-muted">Stock</span><b>{p.stock} (mín. {p.stock_min})</b></div>
            {costos && p.precio_compra != null && <div className="flex justify-between"><span className="text-muted">Valor en stock</span><b>{money(p.stock * p.precio_compra)}</b></div>}
            <div className="flex justify-between"><span className="text-muted">Garantía</span><b>{p.garantia_meses ? p.garantia_meses + ' meses' : 'Sin garantía'}</b></div>
          </div>
          {p.descripcion && <p className="text-sm">{p.descripcion}</p>}
          {p.maneja_serial && uni && (
            <div className="mb-3"><h4 className="text-sm text-muted uppercase m-0 mb-1">IMEI / seriales</h4>
              {uni.length === 0 ? <Empty text="Sin unidades" /> : uni.map((u) => <div key={u.id} className="row"><span className="flex-1 text-sm">{u.serial}</span><Badge tone={u.estado === 'disponible' ? 'good' : ''}>{u.estado}</Badge></div>)}
            </div>
          )}
          {editar && (
            <div className="action-grid product-detail-actions">
              <button className="btn sec" onClick={onEditar}>Editar</button>
              {!p.maneja_serial && <button className="btn sec" onClick={() => setModo('ajuste')}>Ajustar stock</button>}
              <button className="btn sec" onClick={verMovs}>Movimientos</button>
            </div>
          )}
          {isDemoMode && editar && <div className="destructive-zone"><RecordStatus table="productos" record={p} onSaved={onCambio} /></div>}
        </>
      )}
      {modo === 'ajuste' && (
        <>
          <p className="text-sm text-muted">Stock del sistema: {p.stock}</p>
          <Select label="Tipo de movimiento" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {isDemoMode && <option value="fisico">Conciliar stock fisico</option>}
            <option value="ajuste_entrada">Entrada (ajuste)</option><option value="ajuste_salida">Salida (pérdida, daño, uso)</option><option value="devolucion_proveedor">Devolución a proveedor</option>
          </Select>
          {tipo==='fisico' ? <Input label="Stock fisico" type="number" min="0" step="1" value={fisico} onChange={e=>setFisico(e.target.value)} /> : <Input label="Cantidad" type="number" min="1" value={cant} onChange={(e) => setCant(e.target.value)} />}
          <Input label="Motivo (obligatorio)" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </>
      )}
      {modo === 'movs' && (
        <>
          <button className="btn sec sm mb-2" onClick={() => setModo(null)}>‹ Volver</button>
          {!movs ? <Loader /> : movs.length === 0 ? <Empty text="Sin movimientos" /> : movs.map((m) => (
            <div key={m.id} className="row"><div className="flex-1"><p className="m-0 text-sm font-semibold">{m.tipo.replace(/_/g, ' ')}</p><p className="m-0 text-xs text-muted">{fechaHora(m.fecha)}{m.motivo ? ' · ' + m.motivo : ''}</p></div><div className="text-right"><b className={m.cantidad > 0 ? 'text-good' : 'text-bad'}>{m.cantidad > 0 ? '+' : ''}{m.cantidad}</b><p className="m-0 text-xs text-muted">queda {m.stock_despues}</p></div></div>
          ))}
        </>
      )}
    </Modal>
  )
}
