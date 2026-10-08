import { useEffect, useState } from 'react'
import ConfirmAction from '../components/ConfirmAction'
import { useAction } from '../lib/useAction'
import AppShell from '../components/AppShell'
import Modal from '../components/Modal'
import { Empty, Loader, Input, Select, ErrorBox, Stat, Chips } from '../components/ui'
import { supabase, isDemoMode } from '../lib/supabase'
import { money, fecha, rangoMes, hoyBogota, mensajeError } from '../lib/format'
import { toast } from '../lib/toast'

const CATS_G = ['Arriendo', 'Servicios públicos', 'Nómina', 'Transporte', 'Publicidad', 'Mantenimiento', 'Impuestos', 'Otros']
const CATS_I = ['Servicio técnico', 'Otros ingresos']

export default function Finanzas() {
  const [remove,setRemove] = useState(null)
  const [mes, setMes] = useState(0)
  const [tipo, setTipo] = useState('todos')
  const [movs, setMovs] = useState(null)
  const [profit, setProfit] = useState(0)
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
      if(isDemoMode){const summary=await supabase.rpc('resumen_dashboard',{p_desde:r.ini,p_hasta:r.fin});setProfit(summary.data?.[0]?.utilidad_mes||0)}
      setMovs(m.data || []); setVentas((v.data || []).reduce((a, x) => a + Number(x.total_vendido), 0))
    })()
  }, [mes, tick]) // eslint-disable-line

  const ing = (movs || []).filter((m) => m.tipo === 'ingreso' && (!isDemoMode || !m.origen)).reduce((a, m) => a + Number(m.monto), 0)
  const gas = (movs || []).filter((m) => m.tipo === 'gasto' && (!isDemoMode || !m.origen)).reduce((a, m) => a + Number(m.monto), 0)
  const lista = (movs || []).filter((m) => tipo === 'todos' || m.tipo === tipo)

  async function borrar(m) {
    const { error } = await supabase.from('movimientos').delete().eq('id', m.id)
    if (error) throw new Error(mensajeError(error))
    setTick((t) => t + 1)
  }

  return (
    <AppShell title="Finanzas" sub="Ingresos y gastos" right={<button className="btn sm" onClick={() => setForm({ tipo: 'gasto' })}>+ Registrar</button>}>
      <div className="flex items-center justify-between mb-3">
        <button className="btn sec sm" onClick={() => setMes(mes - 1)}>‹</button>
        <b className="capitalize">{r.label}</b>
        <button className="btn sec sm" disabled={mes >= 0} onClick={() => setMes(mes + 1)}>›</button>
      </div>
      <div className="grid finance-stats mb-3">
        <Stat label="Ingresos" value={money(ventas + ing)} tone="good" />
        <Stat label="Gastos" value={money(gas)} tone="bad" />
        <Stat label={isDemoMode ? "Utilidad neta" : "Resultado (sin costo de mercancía)"} value={money(isDemoMode ? profit : ventas + ing - gas)} tone={(isDemoMode ? profit : ventas + ing - gas) >= 0 ? 'good' : 'bad'} />
      </div>
      <div className="card finance-chart"><h2>Balance del mes</h2>{[{label:'Ventas',value:ventas},{label:'Otros ingresos',value:ing},{label:'Gastos',value:gas}].map(x=><div className="chart-row" key={x.label}><span>{x.label}</span><div className="chart-track"><span style={{width:(x.value/Math.max(ventas,ing,gas,1)*100)+'%'}} /></div><b>{money(x.value)}</b></div>)}<p>Ventas netas de facturas y movimientos manuales del período.{isDemoMode ? ' Las compras de inventario se reflejan como mercancía; la utilidad descuenta el costo vendido.' : ' El resultado no incluye el costo de mercancía.'}</p></div>
      <h2 className="section-heading">Movimientos y categorías</h2>
      <Chips value={tipo} onChange={setTipo} options={[{ value: 'todos', label: 'Todos' }, { value: 'ingreso', label: 'Ingresos' }, { value: 'gasto', label: 'Gastos' }]} />
      {!movs ? <Loader /> : lista.length === 0 ? <Empty text="Sin movimientos este mes" /> : (
        <div className="card !p-2">
          {lista.map((m) => (
            <div key={m.id} className="row">
              <div className="flex-1"><p className="m-0 text-sm font-semibold">{m.categoria}</p><p className="m-0 text-xs text-muted">{fecha(m.fecha)}{m.descripcion ? ' · ' + m.descripcion : ''}</p></div>
              <b className={m.tipo === 'ingreso' ? 'text-good' : 'text-bad'}>{m.tipo === 'ingreso' ? '+' : '−'}{money(m.monto)}</b>
              {!m.origen && <button className="btn bad sm" aria-label={`Eliminar ${m.categoria}`} onClick={() => setRemove(m)}>✕</button>}
            </div>
          ))}
        </div>
      )}
      {remove && <ConfirmAction title="Eliminar movimiento" label="Eliminar" onClose={()=>setRemove(null)} onConfirm={()=>borrar(remove)}>Se eliminara este movimiento manual. Los movimientos automaticos se revierten desde la operacion original.</ConfirmAction>}
      {form && <Form inicial={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); setTick((t) => t + 1) }} />}
    </AppShell>
  )
}

function Form({ inicial, onClose, onSaved }) {
  const [f, setF] = useState({ tipo: inicial.tipo, categoria: '', descripcion: '', monto: '', fecha: hoyBogota() })
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const [guardar, pendingSave] = useAction(guardarImpl)
  async function guardarImpl() {
    if (!f.categoria.trim()) return setErr('Elige o escribe la categoría.')
    if (!(Number(f.monto) > 0)) return setErr('El monto debe ser mayor que cero.')
    const { error } = await supabase.from('movimientos').insert({ tipo: f.tipo, categoria: f.categoria.trim(), descripcion: f.descripcion.trim() || null, monto: Number(f.monto), fecha: f.fecha })
    if (error) return setErr(mensajeError(error))
    toast('Registrado'); onSaved()
  }
  const cats = f.tipo === 'gasto' ? CATS_G : CATS_I
  return (
    <Modal title="Registrar movimiento" onClose={onClose} footer={<button className="btn full" onClick={guardar} disabled={pendingSave}>{pendingSave?'Guardando...':'Guardar'}</button>}>
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
