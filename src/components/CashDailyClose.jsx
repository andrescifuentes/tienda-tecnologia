import { useEffect, useRef, useState } from 'react'
import Modal from './Modal'
import MoneyInput from './MoneyInput'
import DateField from './DateField'
import FacturaDetalle from './FacturaDetalle'
import { ErrorBox, Input, Select, Loader } from './ui'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { useDemoRevision } from '../lib/demo/useDemoRevision'
import { useAction } from '../lib/useAction'
import { fecha as fechaCorta, fechaHora, hoyBogota, mensajeError, numFactura } from '../lib/format'
import { cashCentavos, cashInteger, cashRequest, cashSchemaMissing, newCashRequest, CASH_METHODS } from '../lib/cashRegister'
import { dailyReportCsv } from '../lib/cashDaily'
import { toast } from '../lib/toast'

const label = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencias' }
const cop = cents => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(cashInteger(cents) / 100)
const Line = ({ k, v, tone = '', strong = false }) => <div className={'cash-line ' + tone}><span>{k}</span>{strong ? <strong>{v}</strong> : <b>{v}</b>}</div>

// Caja → Cierre del día. Admin: todo el negocio o un responsable. Vendedor con permiso «cerrar_caja»: su propio día.
export default function CashDailyClose() {
  const { perfil, esAdmin } = useAuth(), revision = useDemoRevision()
  const [dia, setDia] = useState(hoyBogota()), [scope, setScope] = useState(''), [people, setPeople] = useState([])
  const [loaded, setLoaded] = useState(null), [error, setError] = useState(''), [missing, setMissing] = useState(false), [tick, setTick] = useState(0)
  const [form, setForm] = useState(null), [formError, setFormError] = useState(''), [invoice, setInvoice] = useState(null)
  const [history, setHistory] = useState(null), [cursor, setCursor] = useState(null)
  const sequence = useRef(0)
  useEffect(() => { if (esAdmin) supabase.from('perfiles').select('id,nombre,activo').order('nombre').then(({ data: rows }) => setPeople(rows || [])) }, [esAdmin])
  useEffect(() => {
    const request = ++sequence.current, key = dia + '|' + scope
    setError('')
    cashRequest(supabase, 'caja_dia_estado', { p_fecha: dia, p_responsable: esAdmin ? scope || null : perfil.id })
      .then(value => { if (sequence.current === request) { setMissing(false); setLoaded({ key, value }) } })
      .catch(e => { if (sequence.current === request) { setMissing(cashSchemaMissing(e)); setError(mensajeError(e)) } })
  }, [dia, scope, tick, revision, esAdmin, perfil.id])
  useEffect(() => {
    cashRequest(supabase, 'caja_cierres_dia', { p_antes_id: cursor }).then(setHistory).catch(() => setHistory({ cierres: [], limitado: false }))
  }, [cursor, tick, revision])

  // Data is shown only for the selected day/scope; the close form keeps the latest response.
  const data = loaded?.key === dia + '|' + scope ? loaded.value : null
  const cierre = data?.cierre, live = loaded?.value?.resumen, r = cierre?.resumen || data?.resumen
  const changedAfter = cierre && live && cierre.huella !== live.huella
  const abiertas = live?.pendientes.cajas_abiertas || []
  const [confirmar, busy] = useAction(async () => {
    setFormError('')
    try {
      await cashRequest(supabase, 'caja_cerrar_dia', { p_fecha: dia, p_responsable: esAdmin ? scope || null : perfil.id, p_request_id: form.request, p_huella: form.huella, p_contado_cent: cashCentavos(form.amount || '0'), p_observaciones: form.notes })
      setForm(null); toast('Cierre del día confirmado'); setTick(t => t + 1)
    } catch (e) { setFormError(mensajeError(e)); setTick(t => t + 1) }
  })
  function exportar() {
    const url = URL.createObjectURL(new Blob([dailyReportCsv(r, cierre, data.facturas)], { type: 'text/csv;charset=utf-8' })), a = document.createElement('a')
    a.href = url; a.download = 'Angie-Tech-cierre-' + dia + (r.alcance === 'responsable' ? '-' + String(r.responsable_nombre || 'responsable').replace(/\W+/g, '-') : '') + '.csv'
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000)
  }
  const elegirFecha = value => { if (value > hoyBogota()) return toast('Solo puedes revisar días hasta hoy.'); setDia(value) }

  if (missing) return <section className="card cash-card"><h2>Cierre diario pendiente de activación</h2><p>La base de datos aún no tiene el cierre consolidado ni el permiso de cierre (script <b>17_cierre_caja_diario.sql</b>, después de 14). No se ha registrado ningún cierre.</p><button className="btn sec full" onClick={() => setTick(t => t + 1)}>Reintentar consulta</button></section>
  return <>
    <section className="card cash-card cash-day-controls">
      <DateField label="Día del cierre" value={dia} onChange={elegirFecha} />
      {esAdmin ? <Select label="Alcance" value={scope} onChange={e => setScope(e.target.value)}><option value="">Todo el negocio (consolidado)</option>{people.map(p => <option key={p.id} value={p.id}>{p.nombre}{p.activo === false ? ' (inactivo)' : ''}</option>)}</Select> : <p className="cash-note">Responsable: <b>{perfil.nombre}</b>. Ves tus ventas, ajustes y cajas del día.</p>}
    </section>
    <ErrorBox text={error} />
    {!data && !error ? <Loader /> : !data ? <button className="btn sec full" onClick={() => setTick(t => t + 1)}>Reintentar consulta</button> : <>
      <section className="card cash-card cash-hero">
        <div className="cash-title"><h2>Cierre del {fechaCorta(dia)}</h2><span className={'badge ' + (cierre ? 'good' : '')}>{cierre ? 'Cerrado' : 'Sin cerrar'}</span></div>
        <p>{r.alcance === 'negocio' ? 'Consolidado de todo el negocio' : 'Responsable: ' + (r.responsable_nombre || perfil.nombre)} · America/Bogota</p>
        <span className="text-muted">Total vendido · {r.ventas.cantidad} {r.ventas.cantidad === 1 ? 'venta' : 'ventas'}</span>
        <strong className="cash-value">{cop(r.ventas.bruto_cent)}</strong>
        <div className="cash-methods">{CASH_METHODS.map(m => <div key={m}><span>{label[m]}</span><b>{cop(r.ventas.por_metodo[m])}</b></div>)}</div>
        {r.ventas.transferencias_por_medio.length > 0 && <div className="cash-sub">{r.ventas.transferencias_por_medio.map(t => <Line key={t.nombre} k={'Transferencia · ' + t.nombre} v={cop(t.cent)} />)}</div>}
        <p className="cash-note">Tarjeta y transferencia no suman al efectivo físico. Cada venta tiene un solo medio de pago registrado.</p>
        {changedAfter && <p className="cash-warning" role="status">Hubo movimientos después de confirmar este cierre. Se muestran los valores confirmados; los posteriores aparecerán en el cierre de otro día o como ajuste.</p>}
      </section>
      <section className="card cash-card">
        <h2>Ajustes y total neto</h2>
        <Line k={'Devoluciones (' + r.devoluciones.cantidad + ')'} v={'−' + cop(r.devoluciones.cent)} tone={r.devoluciones.cent ? 'bad' : ''} />
        <Line k={'Anulaciones (' + r.anulaciones.cantidad + ')'} v={'−' + cop(r.anulaciones.cent)} tone={r.anulaciones.cent ? 'bad' : ''} />
        {r.ventas.anuladas > 0 && <p className="cash-note">{r.ventas.anuladas} venta(s) de este día ya fueron anuladas; su reverso se cuenta el día de la anulación.</p>}
        {CASH_METHODS.map(m => <Line key={m} k={'Neto ' + label[m].toLowerCase()} v={cop(r.neto_por_metodo[m])} />)}
        <Line k="Total neto del día" v={cop(r.neto_cent)} strong />
      </section>
      <section className="card cash-card">
        <h2>Efectivo en caja</h2>
        <Line k="Saldo inicial de turnos del día" v={cop(r.efectivo.inicial_cent)} />
        <Line k="Ventas en efectivo" v={cop(r.efectivo.ventas_cent)} />
        <Line k="Entradas registradas" v={cop(r.efectivo.entradas_cent)} />
        <Line k="Retiros, gastos y pagos" v={cop(r.efectivo.salidas_cent)} />
        <Line k="Reembolsos en efectivo confirmados" v={cop(r.efectivo.reembolsos_cent)} />
        <Line k="Saldo de efectivo esperado" v={cop(r.efectivo.esperado_cent)} strong />
        {cierre && <><Line k="Efectivo contado" v={cop(cierre.contado_cent)} /><Line k="Diferencia" v={cop(cierre.diferencia_cent)} tone={cierre.diferencia_cent ? 'bad' : 'good'} strong />{cierre.observaciones && <p className="cash-note">{cierre.observaciones}</p>}<p className="cash-note">Confirmado por {cierre.cerrado_nombre} · {fechaHora(cierre.cerrado_en)}</p></>}
        {(abiertas.length > 0 || r.pendientes.reembolsos_sin_confirmar > 0) && <div className="cash-warning" role="status">
          <b>Pendientes</b>
          {abiertas.length > 0 && <p>Turnos de caja abiertos: {abiertas.map(c => '#' + c.id + ' ' + c.responsable_nombre).join(', ')}. Ciérralos antes de confirmar el día.</p>}
          {r.pendientes.reembolsos_sin_confirmar > 0 && <p>{r.pendientes.reembolsos_sin_confirmar} devolución(es) o anulación(es) sin reembolso confirmado en caja. No se restan del efectivo hasta confirmarlas.</p>}
        </div>}
        <div className="cash-actions">
          {!cierre && <button className="btn gold" disabled={abiertas.length > 0} onClick={() => { setFormError(''); setForm({ request: newCashRequest(), huella: live.huella, amount: '', notes: '' }) }}>Confirmar cierre del día</button>}
          <button className="btn sec" onClick={exportar}>Descargar CSV</button>
        </div>
      </section>
      <section className="card cash-card">
        <details><summary><b>Facturas del día ({data.facturas.length})</b></summary>
          {!data.facturas.length ? <p className="text-muted">Sin facturas en este día.</p> : <div className="cash-events">{data.facturas.map(f => <article key={f.id} role="button" tabIndex={0} className="cash-invoice" onClick={() => setInvoice(f.id)} onKeyDown={e => { if (e.key === 'Enter') setInvoice(f.id) }}><div><b>{numFactura(f)}</b><small>{fechaHora(f.fecha)} · {f.metodo_pago}{f.medio_transferencia?.nombre ? ' · ' + f.medio_transferencia.nombre : ''}{f.estado === 'anulada' ? ' · Anulada' : ''}</small></div><strong>{cop(cashCentavos(String(f.total)))}</strong></article>)}</div>}
          {data.facturas.length >= 200 && <p className="cash-warning">Se muestran las últimas 200 facturas. Los totales incluyen todas.</p>}
        </details>
      </section>
    </>}
    <section className="card cash-card"><h2>Cierres diarios confirmados</h2>
      {!history ? <Loader filas={2} /> : !history.cierres.length ? <p className="text-muted">Aún no hay cierres diarios.</p> : <div className="cash-history">{history.cierres.map(c => <button type="button" key={c.id} className={'cash-history-row' + (c.fecha === dia && (c.responsable_id || '') === (esAdmin ? scope : perfil.id) ? ' selected' : '')} onClick={() => { setDia(c.fecha); if (esAdmin) setScope(c.responsable_id || '') }}><span><b>{fechaCorta(c.fecha)} · {c.alcance === 'negocio' ? 'Todo el negocio' : c.responsable_nombre}</b><small>Neto {cop(c.neto_cent)} · {c.cerrado_nombre}</small></span><span>Cerrado<small>{c.diferencia_cent ? 'Dif. ' + cop(c.diferencia_cent) : 'Sin diferencia'}</small></span></button>)}</div>}
      <div className="cash-actions">{cursor && <button className="btn sec" onClick={() => setCursor(null)}>Recientes</button>}{history?.limitado && <button className="btn sec" onClick={() => setCursor(history.cierres[history.cierres.length - 1].id)}>Ver anteriores</button>}</div>
    </section>
    {form && live && <Modal title="Confirmar cierre del día" subtitle={fechaCorta(dia) + ' · ' + (live.alcance === 'negocio' ? 'Todo el negocio' : live.responsable_nombre || perfil.nombre)} keyboardAware onClose={() => { if (!busy) setForm(null) }} footer={<button type="submit" form="cash-day-form" className="btn gold full" disabled={busy}>{busy ? 'Confirmando…' : 'Confirmar cierre'}</button>}>
      <form id="cash-day-form" onSubmit={e => { e.preventDefault(); confirmar() }}>
        <ErrorBox text={formError} />
        <Line k="Total vendido" v={cop(live.ventas.bruto_cent)} />
        <Line k="Total neto" v={cop(live.neto_cent)} />
        <Line k="Efectivo esperado" v={cop(live.efectivo.esperado_cent)} strong />
        {form.huella !== live.huella && <div className="cash-warning"><p>Entraron movimientos nuevos. Revisa los totales actualizados.</p><button type="button" className="btn sec full" onClick={() => setForm(f => ({ ...f, huella: live.huella }))}>He revisado los totales</button></div>}
        <MoneyInput label="Efectivo físico contado (COP)" required value={form.amount} onValueChange={amount => setForm(f => ({ ...f, amount }))} disabled={busy} />
        <Input label="Observaciones del cierre" maxLength={1000} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        <p className="cash-note">Si hay sobrante o faltante debes explicarlo. El cierre queda registrado y no se puede repetir para este día; no anula ni modifica facturas.</p>
      </form>
    </Modal>}
    {invoice && <FacturaDetalle id={invoice} onClose={() => setInvoice(null)} />}
  </>
}
