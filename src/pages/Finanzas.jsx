import { useEffect, useId, useState } from 'react'
import ModuleBanner from '../components/ModuleBanner'
import { useAuth } from '../context/AuthContext'
import ConfirmAction from '../components/ConfirmAction'
import { monetaryError } from '../lib/money'
import { useDemoRevision } from '../lib/demo/useDemoRevision'
import { useAction } from '../lib/useAction'
import AppShell, { ThemeToggle } from '../components/AppShell'
import { Brand } from '../components/TechVisuals'
import Modal from '../components/Modal'
import MoneyInput from '../components/MoneyInput'
import DateField from '../components/DateField'
import BalanceChart from '../components/BalanceChart'
import { Icon } from '../components/Icons'
import { Empty, Loader, Input, Select, ErrorBox, Stat, Chips } from '../components/ui'
import { supabase, isDemoMode } from '../lib/supabase'
import { money, fecha, rangoMes, hoyBogota, mensajeError } from '../lib/format'
import { toast } from '../lib/toast'
import { I } from '../components/InvIcons'
import { useNavigate, useSearchParams } from 'react-router-dom'
import FinanceDetail from '../components/FinanceDetail'
import CompraDetalle from '../components/CompraDetalle'
import { financeDetails, incomeBreakdown, financePurchaseRows } from '../lib/financeDetails'
import { loadFinancePeriod, financeErrorMessage } from '../lib/financeQueries'

const CATS_G = ['Proveedores', 'Servicios', 'Arriendo', 'Servicios públicos', 'Nómina', 'Transporte', 'Publicidad', 'Mantenimiento', 'Impuestos', 'Otros']
const CATS_I = ['Venta adicional', 'Servicio', 'Abono', 'Otro ingreso', 'Servicio técnico', 'Otros ingresos']

export default function Finanzas() {
  const revision = useDemoRevision()
  const navigate = useNavigate()
  const [params,setParams]=useSearchParams()
  const initialMonth=params.get('mes'),currentMonth=hoyBogota().slice(0,7)
  const monthOffset=/^\d{4}-\d{2}$/.test(initialMonth||'')&&initialMonth<=currentMonth?(Number(initialMonth.slice(0,4))-Number(currentMonth.slice(0,4)))*12+Number(initialMonth.slice(5))-Number(currentMonth.slice(5)):0
  const { can, esAdmin, perfil } = useAuth()
  const costos = can('ver_costos')
  const [remove,setRemove] = useState(null)
  const [mes, setMes] = useState(monthOffset)
  const [tipo, setTipo] = useState('todos')
  const [movs, setMovs] = useState(null)
  const [profit, setProfit] = useState(0)
  const [ventas, setVentas] = useState(0)
  const [form, setForm] = useState(null)
  const [tick, setTick] = useState(0)
  const [detail, setDetail] = useState(['ingreso','gasto'].includes(params.get('detalle'))?params.get('detalle'):null)
  const [invoices, setInvoices] = useState([])
  const [compras, setCompras] = useState([])
  const [verCompra, setVerCompra] = useState(null)
  const [detailError, setDetailError] = useState(''),[loadError,setLoadError]=useState('')
  const r = rangoMes(mes)

  useEffect(() => {
    let live=true;const controller=new AbortController()
    setMovs(null);setDetailError('');setLoadError('')
    loadFinancePeriod(supabase,{period:r,demo:isDemoMode,auth:{esAdmin,perfilId:perfil.id},signal:controller.signal}).then(data=>{
      if(!live)return
      if(isDemoMode)setProfit(data.summary?.[0]?.utilidad_mes||0)
      setInvoices(data.invoices);setCompras(data.purchases);setMovs(data.movements);setDetailError(data.invoiceError?financeErrorMessage(data.invoiceError):'')
      setVentas((data.team||[]).reduce((sum,row)=>sum+Number(row.total_vendido),0))
    }).catch(error=>{if(live){setLoadError(financeErrorMessage(error));setMovs([])}})
    return()=>{live=false;controller.abort()}
  }, [mes,tick,revision,esAdmin,perfil.id]) // eslint-disable-line

  const ing = (movs || []).filter((m) => m.tipo === 'ingreso' && (!isDemoMode || !m.origen)).reduce((a, m) => a + Number(m.monto), 0)
  const comp = compras.reduce((a, c) => a + Number(c.total || 0), 0)
  const gas = (movs || []).filter((m) => m.tipo === 'gasto' && (!isDemoMode || !m.origen)).reduce((a, m) => a + Number(m.monto), 0) + comp
  const compraMovs = compras.map((c) => ({ id: 'c' + c.id, tipo: 'gasto', categoria: 'Compra de mercancía', descripcion: [c.proveedores?.nombre, c.numero_documento, c.forma_pago === 'credito' ? 'a crédito' : null].filter(Boolean).join(' · '), monto: c.total, fecha: c.fecha, origen: 'compra' }))
  const lista = [...(movs || []), ...compraMovs].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).filter((m) => tipo === 'todos' || m.tipo === tipo)
  const details = detail ? (() => { const d = financeDetails({invoices,movements:movs||[],period:r,demo:isDemoMode}); d.gasto = [...d.gasto, ...financePurchaseRows(compras)].sort((a,b)=>b.date.localeCompare(a.date)); return d })() : null

  const totalIn = ventas + ing
  const resultado = isDemoMode ? profit : totalIn - gas
  const catsGasto = Object.entries([...(movs || []).filter((m) => m.tipo === 'gasto' && !m.origen), ...compraMovs].reduce((acc, m) => { acc[m.categoria] = (acc[m.categoria] || 0) + Number(m.monto); return acc }, {})).sort((a, b) => b[1] - a[1])
  const header = <div className="inv-head fv-head">
    <div className="inv-head-top"><Brand compact /><ThemeToggle /></div>
    <ModuleBanner modulo="mas" title="Finanzas" sub="Ingresos, gastos y resultado" actions={<button type="button" onClick={() => setForm({ tipo: 'gasto' })}><I n="plus" />Registrar</button>} />
  </div>

  if(loadError)return <AppShell title="Finanzas" header={header}><div className="finance-detail-period"><button className="btn sec sm" aria-label="Mes anterior" onClick={()=>setMes(m=>m-1)}>‹</button><b>{r.label}</b><button className="btn sec sm" aria-label="Mes siguiente" disabled={mes>=0} onClick={()=>setMes(m=>m+1)}>›</button></div><ErrorBox text={loadError}/><button className="btn sec full" onClick={()=>setTick(t=>t+1)}>Reintentar consulta</button></AppShell>

  async function borrar(m) {
    const { error } = await supabase.from('movimientos').delete().eq('id', m.id)
    if (error) throw new Error(mensajeError(error))
    setTick((t) => t + 1)
  }

  return (
    <AppShell title="Finanzas" header={header}>
      {detailError&&<div className="finance-detail-warning"><ErrorBox text={"El resumen y los gastos están disponibles; el detalle de ingresos no pudo verificarse. "+detailError}/><button className="btn sec full" onClick={()=>setTick(t=>t+1)}>Reintentar detalle de ingresos</button></div>}
      <section className={'fz-hero' + (resultado < 0 ? ' neg' : '')}>
        <div className="fz-nav">
          <button type="button" aria-label="Mes anterior" onClick={() => setMes(mes - 1)}><I n="back" /></button>
          <span className="capitalize">{r.label.replace(' de ', ' ')}</span>
          <button type="button" aria-label="Mes siguiente" disabled={mes >= 0} onClick={() => setMes(mes + 1)}><I n="back" className="flip" /></button>
        </div>
        <span className="fz-eyebrow">{costos ? (isDemoMode ? 'Utilidad neta' : 'Resultado del mes') : 'Balance del mes'}</span>
        <b className="fz-total">{resultado < 0 ? '−' : ''}{money(Math.abs(resultado))}</b>
        <span className={'fz-badge ' + (resultado >= 0 ? 'up' : 'down')}>{resultado >= 0 ? '▲ Ganancia' : '▼ Pérdida'}{totalIn > 0 ? ` · margen ${Math.round(resultado / totalIn * 100)}%` : ''}</span>
        <div className="fz-split" aria-hidden="true"><span className="in" style={{ flex: totalIn || 0.0001 }} /><span className="out" style={{ flex: gas || 0.0001 }} /></div>
        <div className="fz-legend"><span><i className="in" />Entró {money(totalIn)}</span><span><i className="out" />Salió {money(gas)}</span></div>
      </section>

      <div className="fz-kpis">
        <button type="button" className="fz-kpi in" onClick={() => setDetail('ingreso')}>
          <span className="fz-kpi-top"><span className="fz-kpi-ic"><I n="cash" /></span>Ingresos<I n="back" className="flip fz-go" /></span>
          <b>{money(totalIn)}</b>
          <small>Ventas {money(ventas)}{ing ? ' · otros ' + money(ing) : ''}</small>
        </button>
        <button type="button" className="fz-kpi out" onClick={() => setDetail('gasto')}>
          <span className="fz-kpi-top"><span className="fz-kpi-ic"><I n="receipt" /></span>Gastos<I n="back" className="flip fz-go" /></span>
          <b>{money(gas)}</b>
          <small>{comp ? 'Compras ' + money(comp) : 'Sin compras'}{gas - comp ? ' · otros ' + money(gas - comp) : ''}</small>
        </button>
      </div>

      {gas > 0 && <section className="fz-cats">
        <h3 className="fz-h">¿En qué se fue el dinero?</h3>
        {catsGasto.map(([cat, v], i) => <div key={cat} className="fz-cat" style={{ '--d': i * 0.08 + 's' }}>
          <span className="fz-cat-top"><b>{cat}</b><span>{money(v)} <em>{Math.round(v / gas * 100)}%</em></span></span>
          <span className="fz-cat-bar"><span style={{ width: Math.max(3, v / gas * 100) + '%' }} /></span>
        </div>)}
      </section>}
      <div className="premium-section-heading finance-list-heading"><h2>Últimos movimientos</h2><span>{lista.length} en el mes</span></div><div className="finance-filters">
      <Chips value={tipo} onChange={setTipo} options={[{ value: 'todos', label: 'Todos' }, { value: 'ingreso', label: 'Ingresos' }, { value: 'gasto', label: 'Gastos' }]} /></div>
      {!movs ? <Loader /> : lista.length === 0 ? <Empty text="Sin movimientos este mes" /> : (
        <div className="finance-movements">
          {lista.slice(0, 5).map((m) => (
            <div key={m.id} className={"row finance-movement "+m.tipo+(m.origen === 'compra' ? ' clickable' : '')} role={m.origen === 'compra' ? 'button' : undefined} tabIndex={m.origen === 'compra' ? 0 : undefined} onClick={m.origen === 'compra' ? () => setVerCompra(Number(String(m.id).slice(1))) : undefined}><span className="movement-symbol" aria-hidden="true">{m.tipo === 'ingreso' ? '↗' : '↙'}</span>
              <div className="flex-1 movement-main"><p className="m-0 text-sm font-semibold">{m.categoria}</p><p className="m-0 text-xs text-muted">{fecha(m.fecha)}{m.descripcion ? ' · ' + m.descripcion : ''}</p></div>
              <div className="movement-value"><small>{m.origen === 'compra' ? <span className="mv-more">Ver detalle ›</span> : m.origen ? 'Automático' : 'Manual'}</small><b className={m.tipo === 'ingreso' ? 'text-good' : 'text-bad'}>{m.tipo === 'ingreso' ? '+' : '−'}{money(m.monto)}</b></div>
              {!m.origen && <button className="movement-delete" aria-label={`Eliminar ${m.categoria}`} onClick={() => setRemove(m)}><Icon name="trash" /></button>}
            </div>
          ))}
        </div>
      )}
      <button type="button" className="fv-history-btn" onClick={() => navigate('/finanzas/movimientos')}>
        <span className="fv-history-ic"><I n="history" /></span>
        <span><b>Ver todos los movimientos</b><small>Filtra por año, mes o día</small></span>
        <I n="back" className="flip" />
      </button>
      {remove && <ConfirmAction className="finance-confirm-sheet" title="Eliminar movimiento" label="Eliminar" onClose={()=>setRemove(null)} onConfirm={()=>borrar(remove)}><div className="finance-delete-preview"><b>{remove.categoria}</b><strong>{money(remove.monto)}</strong><small>{fecha(remove.fecha)} · {remove.tipo === 'ingreso' ? 'Ingreso' : 'Gasto'} manual</small></div><p>Se eliminará este movimiento manual. Las operaciones automáticas se revierten desde su registro original.</p></ConfirmAction>}
      {verCompra && <CompraDetalle id={verCompra} onClose={() => setVerCompra(null)} />}
      {form && <Form inicial={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); setTick((t) => t + 1) }} />}
      {detail && <FinanceDetail breakdown={detail==='ingreso'?incomeBreakdown({invoices,movements:movs||[],period:r,demo:isDemoMode}):null} onChanged={()=>setTick(t=>t+1)} type={detail} rows={details[detail]} total={detail==='ingreso'?ventas+ing:gas} period={r} month={mes} onMonth={setMes} loading={!movs} error={detail==='ingreso'?detailError:''} onClose={()=>{setDetail(null);if(params.has('detalle')){const next=new URLSearchParams(params);next.delete('detalle');setParams(next,{replace:true})}}}/>}
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
