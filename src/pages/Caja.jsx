import { useEffect, useRef, useState } from 'react'
import AppShell, { ThemeToggle } from '../components/AppShell'
import { Brand } from '../components/TechVisuals'
import ModuleBanner from '../components/ModuleBanner'
import Modal from '../components/Modal'
import MoneyInput from '../components/MoneyInput'
import { ErrorBox, Input, Select, Loader, Empty } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { supabase, isDemoMode } from '../lib/supabase'
import { useDemoRevision } from '../lib/demo/useDemoRevision'
import { useAction } from '../lib/useAction'
import { fechaHora, mensajeError } from '../lib/format'
import { cashCentavos, cashInteger, cashReportCsv, cashRequest, cashSchemaMissing, newCashRequest, CASH_METHODS } from '../lib/cashRegister'
import '../styles/caja.css'

const labels = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', venta: 'Venta', entrada: 'Entrada de efectivo', salida: 'Retiro de efectivo', gasto: 'Gasto pagado en efectivo', pago_proveedor: 'Pago a proveedor en efectivo', devolucion: 'Devolución comercial', anulacion: 'Anulación comercial', reembolso: 'Reembolso confirmado' }
const cop = cents => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(cashInteger(cents) / 100)
export default function Caja() {
  const { perfil, esAdmin, can } = useAuth(), revision = useDemoRevision()
  const [data, setData] = useState(null), [error, setError] = useState(''), [actionError,setActionError] = useState(''), [missing, setMissing] = useState(false), [selected, setSelected] = useState(null), [tick, setTick] = useState(0), [historyCursor,setHistoryCursor] = useState(null), [form, setForm] = useState(null)
  const sequence = useRef(0)
  const allowed = can('vender')
  useEffect(() => {
    if (!allowed) return
    const request = ++sequence.current
    setError('')
    cashRequest(supabase, 'caja_estado', { p_caja_id: selected, p_antes_id:historyCursor }).then(value => { if (sequence.current === request) { setMissing(false); setData(value) } }).catch(e => { if (sequence.current === request) { setMissing(cashSchemaMissing(e)); setError(mensajeError(e)); if(cashSchemaMissing(e)){setData(null);setForm(null)} } })
    return () => { sequence.current++ }
  }, [selected, historyCursor, tick, revision, allowed, perfil.id])
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') setTick(t => t + 1) }
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh)
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [])
  const session = data?.session, summary = data?.summary
  const pendingAdjustments = data?.pending_adjustments || (data?.events || []).filter(e => ['devolucion', 'anulacion'].includes(e.tipo) && !(data?.events || []).some(p => String(p.ajuste_id) === String(e.id)))
  const [save, busy] = useAction(async () => {
    setActionError('')
    try {
      const args = { p_request_id: form.request, p_caja_id: session?.id }
      if (form.type === 'open') {
        const id = await cashRequest(supabase, 'caja_abrir', { p_request_id: form.request, p_inicial_cent: cashCentavos(form.amount || '0') })
        setSelected(id)
      } else if (form.type === 'close') {
        await cashRequest(supabase, 'caja_cerrar', { ...args, p_revision: form.revision, p_contado_cent: cashCentavos(form.amount || '0'), p_observaciones: form.notes })
      } else {
        await cashRequest(supabase, 'caja_movimiento', { ...args, p_tipo: form.kind, p_monto_cent: cashCentavos(form.amount || '0'), p_metodo: form.method, p_descripcion: form.notes, p_referencia: form.reference, p_ajuste_id: form.adjustment || null })
      }
      setForm(null); setTick(t => t + 1)
    } catch (e) { setActionError(mensajeError(e)); setTick(t => t + 1); throw e }
  })
  const openForm = type => { setActionError(''); setForm({ type, request: newCashRequest(), revision: session?.revision, amount: '', notes: '', reference: '', kind: 'entrada', method: 'efectivo', adjustment: '' }) }
  const update = patch => setForm(f => ({ ...f, ...patch }))
  function exportReport() {
    const url = URL.createObjectURL(new Blob([cashReportCsv(session, summary)], { type: 'text/csv;charset=utf-8' })), a = document.createElement('a')
    a.href = url; a.download = 'Angie-Tech-caja-' + session.id + '.csv'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000)
  }
  const header = <div className="inv-head"><div className="inv-head-top"><Brand compact /><ThemeToggle /></div><ModuleBanner modulo="mas" title="Caja" sub="Control de efectivo y cierre de jornada" actions={<button type="button" onClick={() => setTick(t => t + 1)}>Actualizar</button>} /></div>
  if (!allowed) return <AppShell title="Caja" header={header}><ErrorBox text="No tienes permiso para operar caja." /></AppShell>
  return <AppShell title="Caja" header={header}><div className="cash-page">
    <p className="cash-note">{isDemoMode ? 'Demo local: esta caja se conserva en este navegador; no se sincroniza con otras IP o dispositivos.' : 'Caja por responsable. Las operaciones se confirman en Supabase; no se guardan cierres locales en modo real.'}</p>
    {missing ? <section className="card cash-card"><h2>Caja pendiente de activación</h2><p>La infraestructura de caja no está disponible en este proyecto. No se ha abierto ni cerrado una caja real.</p><p className="text-muted">Requiere revisar y autorizar <b>14_caja.sql</b>. Las ventas y Finanzas existentes siguen independientes.</p><button className="btn sec full" onClick={() => setTick(t => t + 1)}>Reintentar consulta</button></section> : <><ErrorBox text={error} />{!data && !error ? <Loader /> : !data ? <button className="btn sec full" onClick={() => setTick(t => t + 1)}>Reintentar consulta</button> : <>
      {!data.active && <section className="card cash-card"><h2>Abrir mi caja</h2><p>Responsable: <b>{perfil.nombre}</b></p><p className="text-muted">El saldo inicial es efectivo físico. Se registran automáticamente las ventas confirmadas por tu sesión desde la apertura, sin importar quién sea el vendedor asignado.</p><button className="btn gold full" onClick={() => openForm('open')}>Abrir caja</button></section>}
      {data.active && session?.id !== data.active.id && <button className="btn sec full" onClick={() => setSelected(data.active.id)}>Volver a mi caja abierta</button>}
      {session && <>
        <section className="card cash-card cash-hero"><div className="cash-title"><h2>Caja #{session.id}</h2><span className={'badge ' + (session.estado === 'abierta' ? 'good' : '')}>{session.estado === 'abierta' ? 'Abierta' : 'Cerrada'}</span></div><p>{session.responsable_nombre} · {fechaHora(session.apertura_en)}</p><span className="text-muted">Efectivo esperado</span><strong className="cash-value">{cop(summary.efectivo_esperado_cent)}</strong><small>Inicial {cop(session.inicial_cent)} · Solo movimientos reales en efectivo</small>
          <div className="cash-methods">{CASH_METHODS.map(m => <div key={m}><span>{labels[m]}</span><b>{cop(summary.ventas[m])}</b></div>)}</div><p className="cash-note">Ventas brutas por medio. Tarjetas y transferencias no suman efectivo físico. Ajustes comerciales: {cop(summary.ajustes_cent)}.</p>
          {summary.reembolsos_por_confirmar > 0 && <p className="cash-warning" role="status">{summary.reembolsos_por_confirmar} devolución(es) o anulación(es) sin confirmar medio de reembolso. No se restó efectivo automáticamente.</p>}
          {session.estado === 'abierta' ? <div className="cash-actions"><button className="btn sec" onClick={() => openForm('movement')}>Registrar movimiento</button><button className="btn gold" onClick={() => openForm('close')}>Cerrar caja</button></div> : <div className="cash-closed"><p>Cierre: {fechaHora(session.cierre_en)} · {session.cerrado_nombre || session.cerrado_por}</p><p>Contado <b>{cop(session.contado_cent)}</b></p><p>Diferencia <b>{cop(session.diferencia_cent)}</b></p>{session.observaciones && <p>{session.observaciones}</p>}</div>}
          <button className="btn sec full" onClick={exportReport}>Exportar resumen CSV</button>
        </section>
        <section className="card cash-card"><h2>Movimientos de caja</h2><p className="text-muted">Los pagos a proveedores, gastos y reembolsos solo descuentan efectivo al confirmar aquí el pago realizado. Este registro operativo no duplica ni crea movimientos en Finanzas.</p>{!data.events.length ? <Empty text="Sin movimientos desde la apertura" description="Las ventas nuevas confirmadas por este responsable aparecerán aquí." /> : <div className="cash-events">{data.events.map(e => <article key={e.id}><div><b>{labels[e.tipo] || e.tipo}</b><small>{e.referencia} · {fechaHora(e.fecha)}</small><small>{e.descripcion} · {labels[e.metodo] || e.metodo}</small></div><strong>{cop(e.monto_cent)}</strong></article>)}</div>}{data.events_limited && <p className="cash-warning">Se muestran los últimos 100 movimientos. El resumen y el cierre incluyen todos los eventos.</p>}</section>
      </>}
      <section className="card cash-card"><h2>{esAdmin ? 'Historial de cajas autorizadas' : 'Mis cajas'}</h2>{!data.history.length ? <p className="text-muted">Aún no hay aperturas.</p> : <div className="cash-history">{data.history.map(s => <button type="button" key={s.id} className={'cash-history-row' + (session?.id === s.id ? ' selected' : '')} onClick={() => setSelected(s.id)}><span><b>#{s.id} · {s.responsable_nombre}</b><small>{fechaHora(s.apertura_en)}</small></span><span>{s.estado === 'abierta' ? 'Abierta' : 'Cerrada'}{s.diferencia_cent != null && <small>{cop(s.diferencia_cent)}</small>}</span></button>)}</div>}<div className="cash-actions">{historyCursor&&<button className="btn sec" onClick={()=>setHistoryCursor(null)}>Cajas recientes</button>}{data.history_limited&&<button className="btn sec" onClick={()=>setHistoryCursor(data.history[data.history.length-1].id)}>Ver cajas anteriores</button>}</div></section>
    </>}</>}
    {form && <Modal title={form.type === 'open' ? 'Apertura de caja' : form.type === 'close' ? 'Confirmar cierre de caja' : 'Registrar movimiento'} subtitle={perfil.nombre} keyboardAware onClose={() => { if (!busy) setForm(null) }} footer={<button type="submit" form="cash-form" className="btn gold full" disabled={busy}>{busy ? 'Confirmando…' : form.type === 'close' ? 'Confirmar cierre' : 'Guardar'}</button>}>
      <form id="cash-form" onSubmit={e => { e.preventDefault(); save() }}><ErrorBox text={actionError || error} />
        {form.type === 'close' && <><p>Efectivo esperado: <b>{cop(summary.efectivo_esperado_cent)}</b></p><p className="cash-note">Si entra una venta antes de confirmar, el cierre se rechaza para que revises el nuevo saldo. Cerrar no anula ni modifica facturas.</p>{form.revision !== session?.revision && <div className="cash-warning"><p>La caja recibió movimientos nuevos. Revisa el saldo actualizado antes de confirmar.</p><button type="button" className="btn sec full" onClick={() => update({ revision: session.revision })}>He revisado el saldo actualizado</button></div>}</>}
        {form.type === 'movement' && <><Select label="Movimiento" value={form.kind} onChange={e => update({ kind: e.target.value, method: 'efectivo', adjustment: '', amount: '' })}>{['entrada', 'salida', 'gasto', 'pago_proveedor', 'reembolso'].map(k => <option key={k} value={k}>{labels[k]}</option>)}</Select>{form.kind === 'reembolso' && <><Select label="Devolución o anulación pendiente" required value={form.adjustment} onChange={e => { const a = pendingAdjustments.find(a => String(a.id) === e.target.value); update({ adjustment: e.target.value, amount: a ? String(Math.abs(a.monto_cent) / 100) : '', reference: a?.referencia || '' }) }}><option value="">Selecciona el ajuste</option>{pendingAdjustments.map(a => <option key={a.id} value={a.id}>{a.referencia} · {cop(Math.abs(a.monto_cent))}</option>)}</Select><Select label="Medio real del reembolso" value={form.method} onChange={e => update({ method: e.target.value })}>{CASH_METHODS.map(m => <option key={m} value={m}>{labels[m]}</option>)}</Select></>}<Input label="Referencia del pago o soporte" required maxLength={120} value={form.reference} onChange={e => update({ reference: e.target.value })} /><p className="cash-note">Confirma únicamente dinero realmente recibido o entregado. Una compra a crédito no es una salida de efectivo.</p></>}
        <MoneyInput label={form.type === 'open' ? 'Saldo inicial en efectivo (COP)' : form.type === 'close' ? 'Efectivo físico contado (COP)' : 'Importe (COP)'} required value={form.amount} onValueChange={amount => update({ amount })} disabled={busy || form.kind === 'reembolso' && !!form.adjustment} />
        {form.type !== 'open' && <Input label={form.type === 'close' ? 'Observaciones del cierre' : 'Motivo / descripción'} required={form.type === 'movement'} maxLength={form.type === 'close' ? 1000 : 500} value={form.notes} onChange={e => update({ notes: e.target.value })} />}
        {form.type === 'close' && <p className="text-muted">Si hay sobrante o faltante debes explicar la diferencia. Los reembolsos no confirmados seguirán señalados en el reporte.</p>}
      </form>
    </Modal>}
  </div></AppShell>
}
