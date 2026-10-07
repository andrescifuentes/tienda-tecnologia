import { useEffect, useState } from 'react'
import AppShell from '../components/AppShell'
import Modal from '../components/Modal'
import CompraForm from '../components/CompraForm'
import { Empty, Loader, Badge, Input, ErrorBox, Stat } from '../components/ui'
import { supabase } from '../lib/supabase'
import { money, fecha, mensajeError } from '../lib/format'
import { toast } from '../lib/toast'

export default function Proveedores() {
  const [lista, setLista] = useState(null)
  const [deuda, setDeuda] = useState(0)
  const [form, setForm] = useState(null)
  const [sel, setSel] = useState(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    ;(async () => {
      const [p, c] = await Promise.all([
        supabase.from('proveedores').select('*').order('nombre'),
        supabase.from('compras_saldo').select('saldo').eq('estado', 'recibida').gt('saldo', 0),
      ])
      setLista(p.data || []); setDeuda((c.data || []).reduce((a, x) => a + Number(x.saldo), 0))
    })()
  }, [tick])
  const refrescar = () => setTick((t) => t + 1)

  return (
    <AppShell title="Proveedores" sub="Compras y cuentas por pagar" right={<button className="btn sm !bg-white !text-brand" onClick={() => setForm({})}>+ Nuevo</button>}>
      <div className="mb-3"><Stat label="Cuentas por pagar" value={money(deuda)} tone={deuda > 0 ? 'warn' : 'good'} /></div>
      {!lista ? <Loader /> : lista.length === 0 ? <Empty text="Aún no hay proveedores" /> : (
        <div className="card !p-2">
          {lista.map((p) => (
            <div key={p.id} className="row cursor-pointer" onClick={() => setSel(p)}>
              <div className="flex-1"><p className="m-0 text-sm font-semibold">{p.nombre}</p><p className="m-0 text-xs text-muted">{p.contacto || ''}{p.telefono ? ' · ' + p.telefono : ''}</p></div>
              {!p.activo && <Badge tone="bad">inactivo</Badge>}
            </div>
          ))}
        </div>
      )}
      {form && <Form inicial={form.id ? form : null} onClose={() => setForm(null)} onSaved={() => { setForm(null); refrescar() }} />}
      {sel && !form && <Detalle p={sel} onClose={() => setSel(null)} onEditar={() => setForm(sel)} onCambio={refrescar} />}
    </AppShell>
  )
}

function Form({ inicial, onClose, onSaved }) {
  const [f, setF] = useState({ nombre: '', nit: '', contacto: '', telefono: '', correo: '', direccion: '', ...(inicial || {}) })
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  async function guardar() {
    if (!f.nombre.trim()) return setErr('El nombre es obligatorio.')
    const d = { nombre: f.nombre.trim(), nit: f.nit?.trim() || null, contacto: f.contacto?.trim() || null, telefono: f.telefono?.trim() || null, correo: f.correo?.trim() || null, direccion: f.direccion?.trim() || null }
    const { error } = inicial?.id ? await supabase.from('proveedores').update(d).eq('id', inicial.id) : await supabase.from('proveedores').insert(d)
    if (error) return setErr(mensajeError(error))
    onSaved()
  }
  return (
    <Modal title={inicial ? 'Editar proveedor' : 'Nuevo proveedor'} onClose={onClose} footer={<button className="btn full" onClick={guardar}>Guardar</button>}>
      <ErrorBox text={err} />
      <Input label="Nombre / razón social" value={f.nombre} onChange={set('nombre')} />
      <Input label="NIT" value={f.nit || ''} onChange={set('nit')} />
      <Input label="Contacto" value={f.contacto || ''} onChange={set('contacto')} />
      <Input label="Teléfono" value={f.telefono || ''} onChange={set('telefono')} />
      <Input label="Correo" value={f.correo || ''} onChange={set('correo')} />
      <Input label="Dirección" value={f.direccion || ''} onChange={set('direccion')} />
    </Modal>
  )
}

function Detalle({ p, onClose, onEditar, onCambio }) {
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

  async function registrarPago() {
    setErr('')
    const { error } = await supabase.rpc('registrar_pago_proveedor', { p_compra_id: pagar.id, p_monto: Number(monto), p_metodo_pago: 'efectivo' })
    if (error) return setErr(mensajeError(error))
    toast('Pago registrado'); setPagar(null); setMonto(''); cargar(); onCambio()
  }

  return (
    <Modal title={p.nombre} onClose={onClose}>
      <ErrorBox text={err} />
      <p className="text-sm text-muted mt-0">{[p.nit && 'NIT ' + p.nit, p.telefono, p.correo].filter(Boolean).join(' · ')}</p>
      <div className="grid grid-cols-2 gap-2 mb-3"><button className="btn sec" onClick={onEditar}>Editar</button><button className="btn" onClick={() => setNueva(true)}>Registrar compra</button></div>
      <h4 className="text-sm text-muted uppercase mb-1">Compras</h4>
      {!compras ? <Loader /> : compras.length === 0 ? <Empty text="Sin compras" /> : compras.map((c) => (
        <div key={c.id} className="row">
          <div className="flex-1"><p className="m-0 text-sm font-semibold">{c.numero_documento || 'Compra #' + c.id}</p><p className="m-0 text-xs text-muted">{fecha(c.fecha)} · {c.forma_pago}{c.vence_el ? ' · vence ' + fecha(c.vence_el) : ''}</p></div>
          <div className="text-right"><b className="text-sm">{money(c.total)}</b>
            {c.saldo > 0 ? <div><Badge tone="warn">Debe {money(c.saldo)}</Badge></div> : <div><Badge tone="good">Pagada</Badge></div>}
            {c.saldo > 0 && <button className="btn sm mt-1" onClick={() => { setPagar(c); setMonto(String(c.saldo)) }}>Pagar</button>}
          </div>
        </div>
      ))}
      <h4 className="text-sm text-muted uppercase mt-3 mb-1">Productos que surte</h4>
      {!prods ? <Loader /> : prods.length === 0 ? <Empty text="Sin productos asignados" /> : prods.map((x) => <div key={x.id} className="row"><span className="flex-1 text-sm">{x.nombre}</span><Badge>{x.stock} uds</Badge></div>)}
      {pagar && (
        <Modal title="Registrar pago" onClose={() => setPagar(null)} footer={<button className="btn full" onClick={registrarPago}>Registrar pago</button>}>
          <p className="text-sm text-muted mt-0">Saldo pendiente: {money(pagar.saldo)}</p>
          <Input label="Monto" type="number" min="1" max={pagar.saldo} value={monto} onChange={(e) => setMonto(e.target.value)} />
        </Modal>
      )}
      {nueva && <CompraForm proveedorId={p.id} onClose={() => setNueva(false)} onSaved={() => { setNueva(false); cargar(); onCambio() }} />}
    </Modal>
  )
}
