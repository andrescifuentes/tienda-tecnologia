import { useEffect, useState } from 'react'
import AppShell from '../components/AppShell'
import { monetaryError } from '../lib/money'
import { useSearchParams } from 'react-router-dom'
import CompraDetalle from '../components/CompraDetalle'
import Modal from '../components/Modal'
import { FormSection } from '../components/AdminPrimitives'
import RecordStatus from '../components/RecordStatus'
import { useAction } from '../lib/useAction'
import CompraForm from '../components/CompraForm'
import { Empty, Loader, Badge, Input, ErrorBox, Stat, SearchBar } from '../components/ui'
import { supabase, isDemoMode } from '../lib/supabase'
import { money, fecha, mensajeError } from '../lib/format'
import { toast } from '../lib/toast'

export default function Proveedores() {
  const [params]=useSearchParams()
  const [q, setQ] = useState('')
  const [compras, setCompras] = useState([])
  const [lista, setLista] = useState(null)
  const [deuda, setDeuda] = useState(0)
  const [form, setForm] = useState(null)
  const [sel, setSel] = useState(null)
  const [tick, setTick] = useState(0)
  const [balances,setBalances]=useState(false)

  useEffect(() => {
    ;(async () => {
      const [p, c] = await Promise.all([
        supabase.from('proveedores').select('*').order('nombre'),
        supabase.from('compras_saldo').select('*').eq('estado', 'recibida'),
      ])
      if(params.get('compra')){const purchaseLink=(c.data||[]).find(c=>c.id===Number(params.get('compra')));if(purchaseLink)setSel((p.data||[]).find(p=>p.id===purchaseLink.proveedor_id))}
      setLista(p.data || []); setCompras(c.data || []); setDeuda((c.data || []).filter(x=>x.saldo>0).reduce((a, x) => a + Number(x.saldo), 0))
    })()
  }, [tick,params])
  const visible = (lista||[]).filter(p=>[p.nombre,p.contacto,p.telefono,p.nit].some(v=>String(v||'').toLocaleLowerCase().includes(q.toLocaleLowerCase())))
  const refrescar = () => { setLista(null); setTick((t) => t + 1) }

  return (
    <div className="admin-premium admin-suppliers"><AppShell title="Proveedores" sub="Compras y cuentas por pagar" right={<button className="btn sm" onClick={() => setForm({})}>+ Nuevo</button>}>
      <div className="admin-payable"><Stat label="Cuentas por pagar" value={money(deuda)} tone={deuda > 0 ? 'warn' : 'good'} /><div className="admin-payable-foot"><span>{new Set(compras.filter(c=>c.saldo>0).map(c=>c.proveedor_id)).size} proveedores con saldo</span><button onClick={()=>setBalances(true)}>Ver detalle ›</button></div></div>
      <SearchBar value={q} onChange={setQ} placeholder="Buscar proveedor o contacto" />
      {!lista ? <Loader /> : visible.length === 0 ? <Empty text="Aún no hay proveedores" description="Registra un proveedor para ingresar mercancía y controlar tus cuentas por pagar." action={()=>setForm({})} actionLabel="+ Crear proveedor" /> : (
        <div className="admin-list entity-list">
          {visible.map((p) => (
            <button type="button" key={p.id} className="row card admin-list-card supplier-card" onClick={() => setSel(p)}>
              <div className="admin-card-top"><p className="admin-card-title">{p.nombre}</p>{!p.activo&&<Badge tone="bad">Inactivo</Badge>}</div><p className="admin-card-secondary">{p.contacto || 'Sin contacto'}</p>{p.telefono&&<p className="admin-card-secondary">{p.telefono}</p>}
              <div className="admin-card-bottom"><span>{compras.some(c=>c.proveedor_id===p.id&&c.saldo>0)?<><small>Saldo pendiente</small><b className="entity-total">{money(compras.filter(c=>c.proveedor_id===p.id&&c.saldo>0).reduce((n,c)=>n+Number(c.saldo),0))}</b></>:<Badge tone="good">Al día</Badge>}<small>{compras.filter(c=>c.proveedor_id===p.id).length} compras</small></span><span className="admin-chevron" aria-hidden="true">›</span></div>
            </button>
          ))}
        </div>
      )}
      {form && <Form inicial={form.id ? form : null} onClose={() => setForm(null)} onSaved={() => { setForm(null); setSel(null); refrescar() }} />}
      {sel && !form && <Detalle compraId={Number(params.get('compra'))||null} p={sel} onClose={() => setSel(null)} onEditar={() => setForm(sel)} onCambio={refrescar} />}
      {balances&&<Modal title="Cuentas por pagar" className="admin-sheet" onClose={()=>setBalances(false)}><p className="admin-hint">Saldo total {money(deuda)}</p>{(lista||[]).filter(p=>compras.some(c=>c.proveedor_id===p.id&&c.saldo>0)).map(p=><button className="row settings-row" key={p.id} onClick={()=>{setBalances(false);setSel(p)}}><span className="flex-1">{p.nombre}</span><b>{money(compras.filter(c=>c.proveedor_id===p.id&&c.saldo>0).reduce((n,c)=>n+Number(c.saldo),0))}</b><span aria-hidden="true">›</span></button>)}{deuda===0&&<Empty text="Todos los proveedores están al día"/>}</Modal>}
    </AppShell></div>
  )
}

function Form({ inicial, onClose, onSaved }) {
  const [f, setF] = useState({ nombre: '', nit: '', contacto: '', telefono: '', correo: '', direccion: '', ...(inicial || {}) })
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const [guardar, pendingSave] = useAction(guardarImpl)
  async function guardarImpl() {
    if (!f.nombre.trim()) return setErr('El nombre es obligatorio.')
    const d = { nombre: f.nombre.trim(), nit: f.nit?.trim() || null, contacto: f.contacto?.trim() || null, telefono: f.telefono?.trim() || null, correo: f.correo?.trim() || null, direccion: f.direccion?.trim() || null }
    if(isDemoMode) { d.ciudad=f.ciudad?.trim()||null; d.notas=f.notas?.trim()||null }
    const { error } = inicial?.id ? await supabase.from('proveedores').update(d).eq('id', inicial.id) : await supabase.from('proveedores').insert(d)
    if (error) return setErr(mensajeError(error))
    onSaved()
  }
  return (
    <Modal title={inicial ? 'Editar proveedor' : 'Nuevo proveedor'} className="admin-sheet supplier-form" keyboardAware onClose={onClose} footer={<button className="btn full" onClick={guardar} disabled={pendingSave}>{pendingSave?'Guardando...':'Guardar'}</button>}>
      <ErrorBox text={err} />
      <FormSection number="01" title="Identidad">
      <Input required label="Nombre / razón social" value={f.nombre} onChange={set('nombre')} />
      <Input label="NIT" value={f.nit || ''} onChange={set('nit')} />
      </FormSection><FormSection number="02" title="Contacto"><div className="admin-form-grid">
      <Input label="Contacto" value={f.contacto || ''} onChange={set('contacto')} />
      <Input label="Teléfono" value={f.telefono || ''} onChange={set('telefono')} />
      <div className="admin-span"><Input type="email" label="Correo" value={f.correo || ''} onChange={set('correo')} /></div>
      </div></FormSection><FormSection number="03" title="Ubicación">
      <Input label="Dirección" value={f.direccion || ''} onChange={set('direccion')} />
      {isDemoMode&&<Input label="Ciudad" value={f.ciudad||''} onChange={set('ciudad')} />}
      </FormSection>{isDemoMode&&<FormSection number="04" title="Otros"><Input label="Notas" value={f.notas||''} onChange={set('notas')} /></FormSection>}
    </Modal>
  )
}

function Detalle({ compraId,p, onClose, onEditar, onCambio }) {
  const [seePurchase,setSeePurchase]=useState(null)
  // Mount the supplier sheet first so the linked purchase is the top dialog.
  useEffect(()=>{setSeePurchase(compraId||null)},[compraId])
  const [compras, setCompras] = useState(null)
  const [prods, setProds] = useState(null)
  const [pagar, setPagar] = useState(null)
  const [monto, setMonto] = useState('')
  const [err, setErr] = useState('')
  const [nueva, setNueva] = useState(false)
  const cargar = () => {
    supabase.from('compras_saldo').select('*').eq('proveedor_id', p.id).order('fecha', { ascending: false }).limit(30).then(({ data }) => setCompras(data || []))
    supabase.from('productos').select('id,nombre,stock').eq('proveedor_id', p.id).eq('activo', true).order('nombre').then(({ data }) => setProds(data || []))
  }
  useEffect(cargar, [p.id]) // eslint-disable-line

  const [registrarPago, pendingPayment] = useAction(registrarPagoImpl)
  async function registrarPagoImpl() {
    setErr('')
    if (monetaryError(monto)) return setErr(monetaryError(monto))
    const { error } = await supabase.rpc('registrar_pago_proveedor', { p_compra_id: pagar.id, p_monto: Number(monto), p_metodo_pago: 'efectivo' })
    if (error) return setErr(mensajeError(error))
    toast('Pago registrado'); setPagar(null); setMonto(''); cargar(); onCambio()
  }

  return (
    <Modal title={p.nombre} className="admin-sheet supplier-detail-sheet" keyboardAware onClose={onClose}>
      <ErrorBox text={err} />
      <p className="text-sm text-muted mt-0">{[p.nit && 'NIT ' + p.nit, p.telefono, p.correo].filter(Boolean).join(' · ')}</p>
      {p.ciudad && <p className="text-sm text-muted">{p.ciudad} · {p.contacto}</p>}
      {p.direccion && <p className="text-sm text-muted">{p.direccion}</p>}
      {p.notas && <p className="text-sm text-muted">{p.notas}</p>}
      {isDemoMode && <RecordStatus table="proveedores" record={p} onSaved={()=>{onCambio();onClose()}} />}
      {compras && <p className="text-sm">Total comprado: {money(compras.reduce((n,c)=>n+c.total,0))}</p>}
      <div className="grid grid-cols-2 gap-2 mb-3"><button className="btn sec" onClick={onEditar}>Editar</button><button className="btn" disabled={p.activo===false} title={p.activo===false?'Proveedor desactivado':undefined} onClick={() => setNueva(true)}>Registrar compra</button></div>
      <h4 className="text-sm text-muted uppercase mb-1">Compras</h4>
      {!compras ? <Loader /> : compras.length === 0 ? <Empty text="Sin compras" /> : compras.map((c) => (
        <div key={c.id} className="row">
          <div className="flex-1"><p className="m-0 text-sm font-semibold">{c.numero_documento || 'Compra #' + c.id}</p><p className="m-0 text-xs text-muted">{fecha(c.fecha)} · {c.forma_pago}{c.vence_el ? ' · vence ' + fecha(c.vence_el) : ''}</p></div>
          <div className="text-right"><b className="text-sm">{money(c.total)}</b>
            {c.saldo > 0 ? <div><Badge tone="warn">Debe {money(c.saldo)}</Badge></div> : <div><Badge tone="good">Pagada</Badge></div>}
            <button className="btn sec sm mt-1" onClick={()=>setSeePurchase(c.id)}>Ver compra</button>
            {c.saldo > 0 && <button className="btn sm mt-1" onClick={() => { setPagar(c); setMonto(String(c.saldo)) }}>Pagar</button>}
          </div>
        </div>
      ))}
      <h4 className="text-sm text-muted uppercase mt-3 mb-1">Productos que surte</h4>
      {!prods ? <Loader /> : prods.length === 0 ? <Empty text="Sin productos asignados" /> : prods.map((x) => <div key={x.id} className="row"><span className="flex-1 text-sm">{x.nombre}</span><Badge>{x.stock} uds</Badge></div>)}
      {seePurchase&&<CompraDetalle id={seePurchase} onClose={()=>setSeePurchase(null)}/>}
      {pagar && (
        <Modal title="Registrar pago" className="admin-sheet" keyboardAware onClose={() => setPagar(null)} footer={<button className="btn full" disabled={pendingPayment} onClick={registrarPago}>{pendingPayment?'Registrando...':'Registrar pago'}</button>}>
          <p className="text-sm text-muted mt-0">Saldo pendiente: {money(pagar.saldo)}</p>
          <Input label="Monto" type="number" min="1" max={pagar.saldo} value={monto} onChange={(e) => setMonto(e.target.value)} />
        </Modal>
      )}
      {nueva && <CompraForm proveedorId={p.id} onClose={() => setNueva(false)} onSaved={() => { setNueva(false); cargar(); onCambio() }} />}
    </Modal>
  )
}
