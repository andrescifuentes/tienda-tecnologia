import { useEffect, useId, useState } from 'react'
import ConfirmAction from '../components/ConfirmAction'
import { monetaryError } from '../lib/money'
import { useDemoRevision } from '../lib/demo/useDemoRevision'
import { useAction } from '../lib/useAction'
import AppShell from '../components/AppShell'
import Modal from '../components/Modal'
import MoneyInput from '../components/MoneyInput'
import DateField from '../components/DateField'
import { Icon } from '../components/Icons'
import { Empty, Loader, Input, Select, ErrorBox, Stat, Chips } from '../components/ui'
import { supabase, isDemoMode } from '../lib/supabase'
import { money, fecha, rangoMes, hoyBogota, mensajeError } from '../lib/format'
import { toast } from '../lib/toast'

const CATS_G = ['Proveedores', 'Servicios', 'Arriendo', 'Servicios públicos', 'Nómina', 'Transporte', 'Publicidad', 'Mantenimiento', 'Impuestos', 'Otros']
const CATS_I = ['Venta adicional', 'Servicio', 'Abono', 'Otro ingreso', 'Servicio técnico', 'Otros ingresos']

export default function Finanzas() {
  const revision = useDemoRevision()
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
  }, [mes, tick, revision]) // eslint-disable-line

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
      <section className="finance-period" aria-label="Período financiero">
        <button className="btn sec sm" aria-label="Mes financiero anterior" onClick={() => setMes(mes - 1)}>‹</button>
        <div><span className="premium-eyebrow">RESUMEN MENSUAL</span><b className="capitalize">{r.label}</b></div>
        <button className="btn sec sm" aria-label="Mes financiero siguiente" disabled={mes >= 0} onClick={() => setMes(mes + 1)}>›</button>
      </section>
      <div className="grid finance-stats mb-3">
        <Stat label="Ingresos" icon="cash" value={money(ventas + ing)} sub="Ventas y otros ingresos" tone="good" />
        <Stat label="Gastos" icon="out" value={money(gas)} sub="Movimientos manuales" tone="bad" />
        <Stat label={isDemoMode ? "Utilidad neta" : "Resultado (sin costo de mercancía)"} value={money(isDemoMode ? profit : ventas + ing - gas)} tone={(isDemoMode ? profit : ventas + ing - gas) >= 0 ? 'good' : 'bad'} />
      </div>
      <div className="card finance-chart"><div className="finance-balance-heading"><span className="document-symbol"><Icon name="chart" /></span><div><span className="premium-eyebrow">TU ACTIVIDAD FINANCIERA</span><h2>Balance del mes</h2></div><span className="finance-currency">COP</span></div>{[{label:'Ventas',value:ventas},{label:'Otros ingresos',value:ing},{label:'Gastos',value:gas}].map(x=><div className={"chart-row balance-"+(x.label==='Gastos'?'expense':'income')} key={x.label}><span>{x.label}</span><div className="chart-track"><span style={{width:(x.value/Math.max(ventas,ing,gas,1)*100)+'%'}} /></div><b>{money(x.value)}</b></div>)}<p>Ventas netas de facturas y movimientos manuales del período.{isDemoMode ? ' Las compras de inventario se reflejan como mercancía; la utilidad descuenta el costo vendido.' : ' El resultado no incluye el costo de mercancía.'}</p></div>
      <div className="premium-section-heading finance-list-heading"><h2>Movimientos y categorías</h2><span>{lista.length} registros</span></div><div className="finance-filters">
      <Chips value={tipo} onChange={setTipo} options={[{ value: 'todos', label: 'Todos' }, { value: 'ingreso', label: 'Ingresos' }, { value: 'gasto', label: 'Gastos' }]} /></div>
      {!movs ? <Loader /> : lista.length === 0 ? <Empty text="Sin movimientos este mes" /> : (
        <div className="finance-movements">
          {lista.map((m) => (
            <div key={m.id} className={"row finance-movement "+m.tipo}><span className="movement-symbol" aria-hidden="true">{m.tipo === 'ingreso' ? '↗' : '↙'}</span>
              <div className="flex-1 movement-main"><p className="m-0 text-sm font-semibold">{m.categoria}</p><p className="m-0 text-xs text-muted">{fecha(m.fecha)}{m.descripcion ? ' · ' + m.descripcion : ''}</p></div>
              <div className="movement-value"><small>{m.origen ? 'Automático' : 'Manual'}</small><b className={m.tipo === 'ingreso' ? 'text-good' : 'text-bad'}>{m.tipo === 'ingreso' ? '+' : '−'}{money(m.monto)}</b></div>
              {!m.origen && <button className="movement-delete" aria-label={`Eliminar ${m.categoria}`} onClick={() => setRemove(m)}><Icon name="trash" /></button>}
            </div>
          ))}
        </div>
      )}
      {remove && <ConfirmAction className="finance-confirm-sheet" title="Eliminar movimiento" label="Eliminar" onClose={()=>setRemove(null)} onConfirm={()=>borrar(remove)}><div className="finance-delete-preview"><b>{remove.categoria}</b><strong>{money(remove.monto)}</strong><small>{fecha(remove.fecha)} · {remove.tipo === 'ingreso' ? 'Ingreso' : 'Gasto'} manual</small></div><p>Se eliminará este movimiento manual. Las operaciones automáticas se revierten desde su registro original.</p></ConfirmAction>}
      {form && <Form inicial={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); setTick((t) => t + 1) }} />}
    </AppShell>
  )
}

function Form({ inicial, onClose, onSaved }) {
  const [f, setF] = useState({ tipo: inicial.tipo, categoria: '', descripcion: '', monto: '', fecha: hoyBogota() })
  const [err, setErr] = useState('')
  const [custom, setCustom] = useState(false)
  const descriptionId = useId()
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const [guardar, pendingSave] = useAction(guardarImpl)
  async function guardarImpl() {
    if (!f.categoria.trim()) return setErr('Elige o escribe la categoría.')
    if (!(Number(f.monto) > 0)) return setErr('El monto debe ser mayor que cero.')
    if (monetaryError(f.monto)) return setErr(monetaryError(f.monto))
    const { error } = await supabase.from('movimientos').insert({ tipo: f.tipo, categoria: f.categoria.trim(), descripcion: f.descripcion.trim() || null, monto: Number(f.monto), fecha: f.fecha })
    if (error) return setErr(mensajeError(error))
    toast(f.tipo === 'gasto' ? 'Gasto registrado' : 'Ingreso registrado'); onSaved()
  }
  const cats = f.tipo === 'gasto' ? CATS_G : CATS_I
  return (
    <Modal title="Registrar movimiento" subtitle="Registra un ingreso o gasto manual" className="movement-form" keyboardAware onClose={onClose} footer={<><p className="movement-summary"><span className="movement-summary-dot" />{f.tipo === 'gasto' ? 'Gasto' : 'Ingreso'} · {f.categoria || 'Elige categoría'} · {money(f.monto)} · {fecha(f.fecha)}</p><button className="btn full" onClick={guardar} disabled={pendingSave}>{pendingSave ? 'Guardando...' : f.tipo === 'gasto' ? 'Registrar gasto' : 'Registrar ingreso'}</button></>}>
      <ErrorBox text={err} />
      <div className="movement-segments" aria-label="Tipo de movimiento">{['gasto','ingreso'].map(t => <button key={t} type="button" className={t + (f.tipo === t ? ' active' : '')} aria-pressed={f.tipo === t} onClick={() => { setF({...f, tipo:t, categoria:''}); setCustom(false) }}>{t === 'gasto' ? 'Gasto' : 'Ingreso'}</button>)}</div>
      <Select label="Categoría" value={custom ? '__custom' : f.categoria} onChange={e => { const other = e.target.value === '__custom'; setCustom(other); setF({...f,categoria:other?'':e.target.value}) }}><option value="">Elegir categoría</option>{cats.map(c => <option key={c}>{c}</option>)}<option value="__custom">+ Otra categoría</option></Select>
      {custom && <Input label="Otra categoría" value={f.categoria} onChange={set('categoria')} maxLength={100} />}
      <section className="movement-money-card"><div className="movement-money-heading"><span className="premium-eyebrow">IMPORTE DEL MOVIMIENTO</span><span>COP</span></div><MoneyInput label="Monto" value={f.monto} onValueChange={monto => setF(prev => ({...prev,monto}))} />
      <div className="movement-amounts">{[[10000,'+10 mil'],[50000,'+50 mil'],[100000,'+100 mil'],[500000,'+500 mil'],[1000000,'+1 millón']].map(([amount,label]) => <button type="button" key={amount} onClick={() => setF(prev => ({...prev,monto:String(BigInt(prev.monto || '0')+BigInt(amount))}))}>{label}</button>)}</div>
      </section>
      <DateField value={f.fecha} onChange={date => setF(prev => ({...prev,fecha:date}))} />
      <label className="lbl" htmlFor={descriptionId}>Descripción (opcional)</label>
      <textarea className="inp movement-description" id={descriptionId} rows={2} value={f.descripcion} onChange={set('descripcion')} placeholder={f.tipo === 'gasto' ? 'Ej. compra de insumos' : 'Ej. servicio técnico'} />
    </Modal>
  )
}
