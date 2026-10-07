import { useEffect, useState } from 'react'
import AppShell from '../components/AppShell'
import Modal from '../components/Modal'
import { Empty, Loader, Input, Select, ErrorBox, Stat, Chips } from '../components/ui'
import { supabase } from '../lib/supabase'
import { money, fecha, rangoMes, hoyBogota, mensajeError } from '../lib/format'
import { toast } from '../lib/toast'

const CATS_G = ['Arriendo', 'Servicios públicos', 'Nómina', 'Transporte', 'Publicidad', 'Mantenimiento', 'Impuestos', 'Otros']
const CATS_I = ['Servicio técnico', 'Otros ingresos']

export default function Finanzas() {
  const [mes, setMes] = useState(0)
  const [tipo, setTipo] = useState('todos')
  const [movs, setMovs] = useState(null)
  const [ventas, setVentas] = useState(0)
  const [form, setForm] = useState(null)
  const [tick, setTick] = useState(0)
  const r = rangoMes(mes)

  useEffect(() => {
    setMovs(null)
    ;(async () => {
      const [m, v] = await Promise.all([
        supabase.from('movimientos').select('*').gte('fecha', r.ini).lte('fecha', r.fin).order('fecha', { ascending: false }).order('id', { ascending: false }),
        supabase.rpc('ventas_por_empleado', { p_desde: r.ini, p_hasta: r.fin }),
      ])
      setMovs(m.data || []); setVentas((v.data || []).reduce((a, x) => a + Number(x.total_vendido), 0))
    })()
  }, [mes, tick]) // eslint-disable-line

  const ing = (movs || []).filter((m) => m.tipo === 'ingreso').reduce((a, m) => a + Number(m.monto), 0)
  const gas = (movs || []).filter((m) => m.tipo === 'gasto').reduce((a, m) => a + Number(m.monto), 0)
  const lista = (movs || []).filter((m) => tipo === 'todos' || m.tipo === tipo)

  async function borrar(m) {
    const { error } = await supabase.from('movimientos').delete().eq('id', m.id)
    if (error) return toast(mensajeError(error))
    setTick((t) => t + 1)
  }

  return (
    <AppShell title="Finanzas" sub="Ingresos y gastos" right={<button className="btn sm !bg-white !text-brand" onClick={() => setForm({ tipo: 'gasto' })}>+ Registrar</button>}>
      <div className="flex items-center justify-between mb-3">
        <button className="btn sec sm" onClick={() => setMes(mes - 1)}>‹</button>
        <b className="capitalize">{r.label}</b>
        <button className="btn sec sm" disabled={mes >= 0} onClick={() => setMes(mes + 1)}>›</button>
      </div>
      <div className="grid grid-cols-2 gap-2.5 mb-3">
        <Stat label="Ventas (facturas)" value={money(ventas)} />
        <Stat label="Otros ingresos" value={money(ing)} tone="good" />
        <Stat label="Gastos" value={money(gas)} tone="bad" />
        <Stat label="Resultado (sin costo de mercancía)" value={money(ventas + ing - gas)} tone={ventas + ing - gas >= 0 ? 'good' : 'bad'} />
      </div>
      <Chips value={tipo} onChange={setTipo} options={[{ value: 'todos', label: 'Todos' }, { value: 'ingreso', label: 'Ingresos' }, { value: 'gasto', label: 'Gastos' }]} />
      {!movs ? <Loader /> : lista.length === 0 ? <Empty text="Sin movimientos este mes" /> : (
        <div className="card !p-2">
          {lista.map((m) => (
            <div key={m.id} className="row">
              <div className="flex-1"><p className="m-0 text-sm font-semibold">{m.categoria}</p><p className="m-0 text-xs text-muted">{fecha(m.fecha)}{m.descripcion ? ' · ' + m.descripcion : ''}</p></div>
              <b className={m.tipo === 'ingreso' ? 'text-good' : 'text-bad'}>{m.tipo === 'ingreso' ? '+' : '−'}{money(m.monto)}</b>
              <button className="btn bad sm" onClick={() => borrar(m)}>✕</button>
            </div>
          ))}
        </div>
      )}
      {form && <Form inicial={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); setTick((t) => t + 1) }} />}
    </AppShell>
  )
}

function Form({ inicial, onClose, onSaved }) {
  const [f, setF] = useState({ tipo: inicial.tipo, categoria: '', descripcion: '', monto: '', fecha: hoyBogota() })
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  async function guardar() {
    if (!f.categoria.trim()) return setErr('Elige o escribe la categoría.')
    if (!(Number(f.monto) > 0)) return setErr('El monto debe ser mayor que cero.')
    const { error } = await supabase.from('movimientos').insert({ tipo: f.tipo, categoria: f.categoria.trim(), descripcion: f.descripcion.trim() || null, monto: Number(f.monto), fecha: f.fecha })
    if (error) return setErr(mensajeError(error))
    toast('Registrado'); onSaved()
  }
  const cats = f.tipo === 'gasto' ? CATS_G : CATS_I
  return (
    <Modal title="Registrar movimiento" onClose={onClose} footer={<button className="btn full" onClick={guardar}>Guardar</button>}>
      <ErrorBox text={err} />
      <Chips value={f.tipo} onChange={(v) => setF({ ...f, tipo: v, categoria: '' })} options={[{ value: 'gasto', label: 'Gasto' }, { value: 'ingreso', label: 'Ingreso' }]} />
      <Select label="Categoría" value={cats.includes(f.categoria) ? f.categoria : ''} onChange={set('categoria')}><option value="">Elegir…</option>{cats.map((c) => <option key={c}>{c}</option>)}</Select>
      <Input label="…o escribe otra" value={f.categoria} onChange={set('categoria')} />
      <Input label="Monto" type="number" min="1" value={f.monto} onChange={set('monto')} />
      <Input label="Fecha" type="date" value={f.fecha} onChange={set('fecha')} />
      <Input label="Descripción (opcional)" value={f.descripcion} onChange={set('descripcion')} />
    </Modal>
  )
}
