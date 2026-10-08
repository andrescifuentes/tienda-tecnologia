import { useEffect, useState } from 'react'
import AppShell from '../components/AppShell'
import { useSearchParams } from 'react-router-dom'
import CompraDetalle from '../components/CompraDetalle'
import Modal from '../components/Modal'
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
    <AppShell title="Proveedores" sub="Compras y cuentas por pagar" right={<button className="btn sm" onClick={() => setForm({})}>+ Nuevo</button>}>
      <div className="mb-3"><Stat label="Cuentas por pagar" value={money(deuda)} tone={deuda > 0 ? 'warn' : 'good'} /></div>
      <SearchBar value={q} onChange={setQ} placeholder="Buscar proveedor o contacto" />
      {!lista ? <Loader /> : visible.length === 0 ? <Empty text="Aún no hay proveedores" description="Registra un proveedor para ingresar mercancía y controlar tus cuentas por pagar." action={()=>setForm({})} actionLabel="+ Crear proveedor" /> : (
        <div className="card entity-list !p-2">
          {visible.map((p) => (
            <div key={p.id} className="row cursor-pointer" onClick={() => setSel(p)}>
              <div className="flex-1"><p className="m-0 text-sm font-semibold">{p.nombre}</p><p className="m-0 text-xs text-muted">{p.contacto || ''}{p.telefono ? ' · ' + p.telefono : ''}</p></div>
              <div className="text-right"><b className="entity-total">{money(compras.filter(c=>c.proveedor_id===p.id&&c.saldo>0).reduce((n,c)=>n+Number(c.saldo),0))}</b><p className="m-0 text-xs text-muted">{compras.filter(c=>c.proveedor_id===p.id).length} compras · Saldo</p>{!p.activo && <Badge tone="bad">inactivo</Badge>}</div>
            </div>
          ))}
        </div>
      )}
      {form && <Form inicial={form.id ? form : null} onClose={() => setForm(null)} onSaved={() => { setForm(null); setSel(null); refrescar() }} />}
      {sel && !form && <Detalle compraId={Number(params.get('compra'))||null} p={sel} onClose={() => setSel(null)} onEditar={() => setForm(sel)} onCambio={refrescar} />}
    </AppShell>
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
    <Modal title={inicial ? 'Editar proveedor' : 'Nuevo proveedor'} onClose={onClose} footer={<button className="btn full" onClick={guardar} disabled={pendingSave}>{pendingSave?'Guardando...':'Guardar'}</button>}>
      <ErrorBox text={err} />
      <Input required label="Nombre / razón social" value={f.nombre} onChange={set('nombre')} />
      <Input label="NIT" value={f.nit || ''} onChange={set('nit')} />
      <Input label="Contacto" value={f.contacto || ''} onChange={set('contacto')} />
      <Input label="Teléfono" value={f.telefono || ''} onChange={set('telefono')} />
      <Input type="email" label="Correo" value={f.correo || ''} onChange={set('correo')} />
      <Input label="Dirección" value={f.direccion || ''} onChange={set('direccion')} />
      {isDemoMode&&<Input label="Notas" value={f.notas||''} onChange={set('notas')} />}
      {isDemoMode&&<Input label="Ciudad" value={f.ciudad||''} onChange={set('ciudad')} />}
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
    const { error } = await supabase.rpc('registrar_pago_proveedor', { p_compra_id: pagar.id, p_monto: Number(monto), p_metodo_pago: 'efectivo' })
    if (error) return setErr(mensajeError(error))
    toast('Pago registrado'); setPagar(null); setMonto(''); cargar(); onCambio()
  }

  return (
    <Modal title={p.nombre} onClose={onClose}>
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
        <Modal title="Registrar pago" onClose={() => setPagar(null)} footer={<button className="btn full" disabled={pendingPayment} onClick={registrarPago}>{pendingPayment?'Registrando...':'Registrar pago'}</button>}>
          <p className="text-sm text-muted mt-0">Saldo pendiente: {money(pagar.saldo)}</p>
          <Input label="Monto" type="number" min="1" max={pagar.saldo} value={monto} onChange={(e) => setMonto(e.target.value)} />
        </Modal>
      )}
      {nueva && <CompraForm proveedorId={p.id} onClose={() => setNueva(false)} onSaved={() => { setNueva(false); cargar(); onCambio() }} />}
    </Modal>
  )
}
