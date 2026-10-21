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
import { abrirCajaDelDia, esCajaAutomatica, hoyCaja } from '../lib/cajaAutomatica'
import { useLocales } from '../lib/locales'
import { I } from '../components/InvIcons'
import LocalSelector from '../components/LocalSelector'

const labels = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', venta: 'Venta', entrada: 'Entrada de efectivo', salida: 'Retiro de efectivo', gasto: 'Gasto pagado en efectivo', pago_proveedor: 'Pago a proveedor en efectivo', devolucion: 'Devolución comercial', anulacion: 'Anulación comercial', reembolso: 'Reembolso confirmado', novedad: 'Novedad' }
const cop = cents => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(cashInteger(cents) / 100)
export default function Caja() {
  const { perfil, esAdmin, can } = useAuth(), revision = useDemoRevision()
  const [data, setData] = useState(null), [error, setError] = useState(''), [actionError,setActionError] = useState(''), [missing, setMissing] = useState(false), [selected, setSelected] = useState(null), [tick, setTick] = useState(0), [historyCursor,setHistoryCursor] = useState(null), [form, setForm] = useState(null)
  const sequence = useRef(0)
  const [detalleCierre, setDetalleCierre] = useState(null)
  const [verVentas, setVerVentas] = useState(null) // { metodo } | { metodo: null } = todas
  const allowed = can('vender')
  // Caja por local: el vendedor opera la de su local; el administrador elige el local
  const loc = useLocales(perfil)
  const [localSel, setLocalSel] = useState(null)
  const localPropio = loc.habilitado ? (loc.miLocal ?? (loc.locales.length === 1 ? loc.locales[0].id : undefined)) : null
  const localCaja = loc.habilitado ? (esAdmin ? (localSel ?? loc.filtro ?? loc.miLocal ?? loc.locales[0]?.id ?? null) : null) : null
  const conLocal = localCaja != null ? { p_local_id: localCaja } : {}
  useEffect(() => {
    if (!allowed) return
    const request = ++sequence.current
    setError('')
    cashRequest(supabase, 'caja_estado', { p_caja_id: selected, p_antes_id:historyCursor, ...conLocal }).then(value => { if (sequence.current === request) { setMissing(false); setData(value) } }).catch(e => { if (sequence.current === request) { setMissing(cashSchemaMissing(e)); setError(mensajeError(e)); if(cashSchemaMissing(e)){setData(null);setForm(null)} } })
    return () => { sequence.current++ }
  }, [selected, historyCursor, tick, revision, allowed, perfil.id, localCaja])
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') setTick(t => t + 1) }
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh)
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [])
  const session = data?.session, summary = data?.summary
  // Al entrar a Caja también se intenta la apertura automática del día
  useEffect(() => { if (allowed && !missing && localPropio !== undefined) abrirCajaDelDia(supabase, perfil, { local: localPropio }).then(r => { if (r.accion === 'abrir' && r.id) setTick(t => t + 1) }) }, [allowed, missing, perfil?.id, localPropio]) // eslint-disable-line react-hooks/exhaustive-deps
  const diaDe = f => f ? new Date(f).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }) : ''
  const cajaVieja = data?.active && diaDe(data.active.apertura_en) < hoyCaja()
  const novedades = (data?.events || []).filter(e => e.tipo === 'novedad')
  // Si la cierran por error a mitad del día, un administrador la reabre (mismo día, con motivo)
  // Sin caja abierta: se muestra la última de hoy (cerrada) para ver su cierre o reabrirla
  const cerradaHoy = !data?.active && (data?.history || []).find(c => c.estado === 'cerrada' && diaDe(c.apertura_en) === hoyCaja())
  useEffect(() => { if (cerradaHoy && selected == null) setSelected(cerradaHoy.id) }, [cerradaHoy?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const puedeReabrir = esAdmin && session?.estado === 'cerrada' && !data?.active && diaDe(session.apertura_en) === hoyCaja()
  const pendingAdjustments = data?.pending_adjustments || (data?.events || []).filter(e => ['devolucion', 'anulacion'].includes(e.tipo) && !(data?.events || []).some(p => String(p.ajuste_id) === String(e.id)))
  const [save, busy] = useAction(async () => {
    setActionError('')
    try {
      const args = { p_request_id: form.request, p_caja_id: session?.id }
      if (form.type === 'open') {
        const id = await cashRequest(supabase, 'caja_abrir', { p_request_id: form.request, p_inicial_cent: cashCentavos(form.amount || '0'), ...conLocal })
        setSelected(id)
      } else if (form.type === 'novedad') {
        await cashRequest(supabase, 'caja_novedad', { ...args, p_descripcion: form.notes })
      } else if (form.type === 'reopen') {
        const id = await cashRequest(supabase, 'caja_reabrir', { ...args, p_motivo: form.notes })
        setSelected(id)
      } else if (form.type === 'close') {
        setSelected(session.id)
        const contado = cashCentavos(form.amount || '0'), base = form.base === 'no' ? 0 : form.baseAmount === '' ? contado : cashCentavos(form.baseAmount)
        await cashRequest(supabase, 'caja_cerrar', { ...args, p_revision: form.revision, p_contado_cent: contado, p_observaciones: form.notes, p_base_siguiente_cent: Math.min(base, contado) })
      } else {
        await cashRequest(supabase, 'caja_movimiento', { ...args, p_tipo: form.kind, p_monto_cent: cashCentavos(form.amount || '0'), p_metodo: form.method, p_descripcion: form.notes, p_referencia: form.reference, p_ajuste_id: form.adjustment || null })
      }
      setForm(null); setTick(t => t + 1)
      if (form.type === 'close' && localPropio !== undefined) abrirCajaDelDia(supabase, perfil, { local: localPropio }).then(r => { if (r.accion === 'abrir' && r.id) { setSelected(r.id); setTick(t => t + 1) } })
    } catch (e) { setActionError(mensajeError(e)); setTick(t => t + 1); throw e }
  })
  const openForm = type => { setActionError(''); setForm({ type, request: newCashRequest(), revision: session?.revision, amount: '', notes: '', reference: '', kind: 'entrada', method: 'efectivo', adjustment: '', base: 'si', baseAmount: '' }) }
  const update = patch => setForm(f => ({ ...f, ...patch }))
  function exportReport() {
    const url = URL.createObjectURL(new Blob([cashReportCsv(session, summary)], { type: 'text/csv;charset=utf-8' })), a = document.createElement('a')
    a.href = url; a.download = 'Angie-Tech-caja-' + session.id + '.csv'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000)
  }
  const header = <div className="inv-head"><div className="inv-head-top"><Brand compact /><ThemeToggle /></div><ModuleBanner modulo="mas" title="Caja" sub="Control de efectivo y cierre de jornada" actions={<button type="button" onClick={() => setTick(t => t + 1)}>Actualizar</button>} /></div>
  if (!allowed) return <AppShell title="Caja" header={header}><ErrorBox text="No tienes permiso para operar caja." /></AppShell>
  return <AppShell title="Caja" header={header}><div className="cash-page">
    <p className="cash-note">{isDemoMode ? 'Demo local: esta caja se conserva en este navegador; no se sincroniza con otras IP o dispositivos.' : 'Una caja por local: suma todas las ventas del día de ese local. La abre y la cierra cualquier vendedor del local o un administrador.'}</p>
    {missing ? <section className="card cash-card"><h2>Caja pendiente de activación</h2><p>La infraestructura de caja no está disponible en este proyecto. No se ha abierto ni cerrado una caja real.</p><p className="text-muted">Requiere revisar y autorizar <b>14_caja.sql</b>. Las ventas y Finanzas existentes siguen independientes.</p><button className="btn sec full" onClick={() => setTick(t => t + 1)}>Reintentar consulta</button></section> : <><ErrorBox text={error} />{!data && !error ? <Loader /> : !data ? <button className="btn sec full" onClick={() => setTick(t => t + 1)}>Reintentar consulta</button> : <>
      {esAdmin && loc.multi && <LocalSelector loc={loc} conTodos={false} value={localCaja} onChange={v => { setLocalSel(Number(v)); setSelected(null); setHistoryCursor(null) }} etiqueta="Caja del local" />}
      {esAdmin && data.locales?.length > 1 && <ResumenLocales locales={data.locales} actual={data.local_id} onElegir={id => { setLocalSel(id); setSelected(null); setHistoryCursor(null) }} />}
      {cajaVieja && <section className="card cash-card cash-old"><h2>Cierra la caja anterior</h2><p>Tu caja del <b>{fechaHora(data.active.apertura_en)}</b> sigue abierta. Ciérrala contando el efectivo; al hacerlo se abre sola la caja de hoy con esa base.</p>{session?.id !== data.active.id && <button className="btn gold full" onClick={() => setSelected(data.active.id)}>Ver caja abierta</button>}</section>}
      {!data.active && <section className="card cash-card"><h2>Abrir caja{loc.habilitado && data.local_id != null ? ' · ' + loc.nombre(data.local_id) : ''}</h2><p>Abre: <b>{perfil.nombre}</b></p>{cerradaHoy && <p className="cash-warning">La caja de hoy ya se cerró ({fechaHora(cerradaHoy.cierre_en)}). {esAdmin ? 'Si se cerró por error, reábrela abajo; si van a seguir vendiendo con una caja nueva, ábrela aquí.' : 'Si se cerró por error, pide a un administrador que la reabra. Mientras tanto, las ventas no entran a ninguna caja.'}</p>}<p className="text-muted">Cada día laboral la caja del local se abre sola cuando alguien del local entra a la app, con el efectivo contado en el último cierre como base. Suma todas las ventas del local, sin importar quién vendió.</p><button className="btn gold full" onClick={() => openForm('open')}>Abrir caja</button></section>}
      {data.active && session?.id !== data.active.id && <button className="btn sec full" onClick={() => setSelected(data.active.id)}>Volver a la caja abierta</button>}
      {session && <>
        <section className="card cash-card cash-hero">
          {(() => {
            const vendido = Number(summary.vendido_bruto_cent || 0), efectivoVentas = Number(summary.ventas.efectivo || 0)
            const movimientos = Number(summary.efectivo_esperado_cent) - Number(session.inicial_cent) - efectivoVentas
            const n = summary.ventas_cantidad
            return <>
              <header className="cash-head">
                <span className="cash-head-ic"><I n="store" /></span>
                <div className="cash-head-txt"><h2>Caja{loc.habilitado && session.local_id != null ? ' · ' + loc.nombre(session.local_id) : ' #' + session.id}</h2><small>Abrió {session.responsable_nombre} · {fechaHora(session.apertura_en)}{esCajaAutomatica(session) ? ' · automática' : ''}</small></div>
                <span className={'badge ' + (session.estado === 'abierta' ? 'good' : '')}>{session.estado === 'abierta' ? 'Abierta' : 'Cerrada'}</span>
              </header>
              <div className="cash-kpis">
                <div className="cash-kpi main" role="button" tabIndex={0} onClick={() => setVerVentas({ metodo: null })}><span>Vendido en el día</span><b>{cop(vendido)}</b><small>{n != null ? n + (n === 1 ? ' venta' : ' ventas') : 'Ventas del local'}</small></div>
                <div className="cash-kpi"><span>Efectivo en caja</span><strong className="cash-value">{cop(summary.efectivo_esperado_cent)}</strong><small>Lo que debe haber al contar</small></div>
              </div>
              <h3 className="cash-sub">Ventas por medio de pago</h3>
              <div className="cash-methods">{CASH_METHODS.map(m => { const v = Number(summary.ventas[m] || 0); return <button type="button" key={m} className="cash-method" onClick={() => setVerVentas({ metodo: m })}>
                <span className={'cash-method-ic m-' + m}><I n={{ efectivo: 'cash', tarjeta: 'card', transferencia: 'bank' }[m]} /></span>
                <span className="cash-method-txt"><span>{labels[m]}</span><i className="cash-bar"><i style={{ width: (vendido ? Math.round(v / vendido * 100) : 0) + '%' }} /></i></span>
                <b>{cop(v)}</b>
              </button> })}</div>
              <h3 className="cash-sub">Cuadre del efectivo</h3>
              <div className="cash-cuadre">
                <div><span>Base inicial</span><b>{cop(session.inicial_cent)}</b></div>
                <div><span>+ Ventas en efectivo</span><b>{cop(efectivoVentas)}</b></div>
                {movimientos !== 0 && <div><span>{movimientos < 0 ? '− Retiros, gastos y pagos' : '+ Entradas de efectivo'}</span><b>{cop(Math.abs(movimientos))}</b></div>}
                <div className="total"><span>= Efectivo esperado</span><b>{cop(summary.efectivo_esperado_cent)}</b></div>
              </div>
              <p className="cash-note">Tarjeta y transferencia no entran al efectivo físico.{Number(summary.ajustes_cent) ? ' Devoluciones o anulaciones: ' + cop(summary.ajustes_cent) + '.' : ''}</p>
            </>
          })()}
          {summary.reembolsos_por_confirmar > 0 && <p className="cash-warning" role="status">{summary.reembolsos_por_confirmar} devolución(es) o anulación(es) sin confirmar medio de reembolso. No se restó efectivo automáticamente.</p>}
          {novedades.length > 0 && <><h3 className="cash-sub">Novedades del día</h3><div className="cash-novedades">{novedades.map(e => <div key={e.id}><p>{e.descripcion}</p><small>{e.referencia} · {fechaHora(e.fecha)}</small></div>)}</div></>}
          {(session.cierres_anteriores || []).length > 0 && <p className="cash-note">Esta caja se reabrió {session.cierres_anteriores.length === 1 ? 'una vez' : session.cierres_anteriores.length + ' veces'}: {session.cierres_anteriores.map(c => `${fechaHora(c.reabierta_en)} por ${c.reabierta_por} (${c.motivo})`).join(' · ')}.</p>}
          {session.estado === 'abierta' ? <><div className="cash-actions"><button className="btn sec" onClick={() => openForm('movement')}>Registrar movimiento</button><button className="btn sec" onClick={() => openForm('novedad')}>Registrar novedad</button></div><button className="btn gold full cash-close-btn" onClick={() => openForm('close')}>Cerrar caja</button></> : <div className="cash-closed"><h3 className="cash-sub">Cierre</h3><p className="cash-note">Cerró {session.cerrado_nombre || session.cerrado_por} · {fechaHora(session.cierre_en)}</p><div className="cash-cuadre">
            <div><span>Efectivo contado</span><b>{cop(session.contado_cent)}</b></div>
            <div><span>Diferencia</span><b className={Number(session.diferencia_cent) ? 'cash-neg' : ''}>{Number(session.diferencia_cent) === 0 ? 'Cuadró' : (Number(session.diferencia_cent) > 0 ? 'Sobró ' : 'Faltó ') + cop(Math.abs(Number(session.diferencia_cent)))}</b></div>
            {session.base_siguiente_cent != null && <div><span>Se retiró</span><b>{cop(Number(session.contado_cent) - Number(session.base_siguiente_cent))}</b></div>}
            {session.base_siguiente_cent != null && <div className="total"><span>Base para mañana</span><b>{cop(session.base_siguiente_cent)}</b></div>}
          </div>{session.observaciones && <p className="cash-note">Observaciones: {session.observaciones}</p>}{puedeReabrir && <button className="btn sec full" onClick={() => openForm('reopen')}>Reabrir caja (se cerró por error)</button>}</div>}
          <button className="btn sec full" onClick={exportReport}>Exportar resumen CSV</button>
        </section>
        <section className="card cash-card"><h2>Movimientos de caja</h2><p className="text-muted">Los pagos a proveedores, gastos y reembolsos solo descuentan efectivo al confirmar aquí el pago realizado. Este registro operativo no duplica ni crea movimientos en Finanzas.</p>{!data.events.length ? <Empty text="Sin movimientos desde la apertura" description="Las ventas nuevas confirmadas por este responsable aparecerán aquí." /> : <div className="cash-events">{data.events.map(e => <article key={e.id}><div><b>{labels[e.tipo] || e.tipo}</b><small>{e.referencia} · {fechaHora(e.fecha)}</small><small>{e.tipo === 'novedad' ? e.descripcion : e.descripcion + ' · ' + (labels[e.metodo] || e.metodo)}</small></div>{e.tipo === 'novedad' ? <span className="badge">Nota</span> : <strong>{cop(e.monto_cent)}</strong>}</article>)}</div>}{data.events_limited && <p className="cash-warning">Se muestran los últimos 100 movimientos. El resumen y el cierre incluyen todos los eventos.</p>}</section>
      </>}
      <HistorialCierres local={esAdmin ? (loc.multi ? localCaja : null) : null} nombreLocal={id => loc.nombre(id)} multi={loc.multi} tick={tick} seleccionada={session?.id} onElegir={id => setDetalleCierre(id)} />
    </>}</>}
    {form && <Modal title={form.type === 'open' ? 'Apertura de caja' : form.type === 'close' ? 'Cerrar caja' : form.type === 'novedad' ? 'Registrar novedad' : form.type === 'reopen' ? 'Reabrir caja' : 'Registrar movimiento'} subtitle={form.type === 'close' ? (loc.habilitado && session?.local_id != null ? loc.nombre(session.local_id) + ' · ' : '') + 'cierra ' + perfil.nombre : perfil.nombre} keyboardAware onClose={() => { if (!busy) setForm(null) }} footer={<button type="submit" form="cash-form" className="btn gold full" disabled={busy}>{busy ? 'Confirmando…' : form.type === 'close' ? 'Confirmar cierre de caja' : form.type === 'reopen' ? 'Reabrir caja' : 'Guardar'}</button>}>
      <form id="cash-form" onSubmit={e => { e.preventDefault(); save() }}><ErrorBox text={actionError || error} />
        {form.type === 'novedad' && <><p className="cash-note">Anota lo que pasó en el día (sin dinero): por ejemplo «el datáfono no funcionó de 2 a 4 pm». Queda con tu nombre y la hora, y sale en el cierre.</p><label className="lbl" htmlFor="cash-novedad">Novedad</label><textarea id="cash-novedad" className="inp" rows={4} maxLength={500} required value={form.notes} onChange={e => update({ notes: e.target.value })} autoFocus /></>}
        {form.type === 'reopen' && <><p className="cash-note">La caja vuelve a quedar abierta. El cierre anterior queda guardado en el historial y las ventas que se hicieron mientras estuvo cerrada se suman a la caja.</p><label className="lbl" htmlFor="cash-motivo">Motivo</label><textarea id="cash-motivo" className="inp" rows={3} maxLength={500} required placeholder="Ej: se cerró por error a las 3 pm" value={form.notes} onChange={e => update({ notes: e.target.value })} autoFocus /></>}
        {form.type === 'close' && (() => {
          let contado = null; try { contado = form.amount === '' ? null : cashCentavos(form.amount) } catch { contado = null }
          const esperado = Number(summary.efectivo_esperado_cent), dif = contado == null ? null : contado - esperado
          return <div className="cc">
            <section className="cc-sum">
              <p className="cc-sum-eyebrow">Resumen de ventas del día</p>
              {CASH_METHODS.map(m => { const n = (data?.events || []).filter(e => e.tipo === 'venta' && e.metodo === m).length; return <button type="button" key={m} className="cc-line" onClick={() => setVerVentas({ metodo: m })}>
                <span className={'cash-method-ic m-' + m}><I n={{ efectivo: 'cash', tarjeta: 'card', transferencia: 'bank' }[m]} /></span>
                <span className="cc-line-txt"><b>Total venta {{ efectivo: 'en efectivo', tarjeta: 'con tarjeta', transferencia: 'por transferencia' }[m]}</b><small>{n} {n === 1 ? 'venta' : 'ventas'}</small></span>
                <b className="cc-line-v">{cop(summary.ventas[m])}<I n="back" className="flip cc-go" /></b>
              </button> })}
              <div className="cc-total" role="button" tabIndex={0} onClick={() => setVerVentas({ metodo: null })}><span>Total venta<small>{summary.ventas_cantidad ?? 0} {summary.ventas_cantidad === 1 ? 'venta' : 'ventas'}</small></span><strong>{cop(summary.vendido_bruto_cent)}</strong></div>
            </section>
            {form.revision !== session?.revision && <div className="cash-warning"><p>Entró un movimiento nuevo mientras cerrabas. Revisa el efectivo esperado.</p><button type="button" className="btn sec full" onClick={() => update({ revision: session.revision })}>He revisado el saldo actualizado</button></div>}
            <p className="cc-step"><span>1</span>Cuenta el efectivo del cajón</p>
            <MoneyInput label="Efectivo contado (COP)" required value={form.amount} onValueChange={amount => {
              let c = null, b = null; try { c = amount === '' ? null : cashCentavos(amount) } catch { c = null } try { b = form.baseAmount === '' ? null : cashCentavos(form.baseAmount) } catch { b = null }
              update({ amount, ...(c != null && b != null && b > c ? { baseAmount: String(c / 100) } : {}) })
            }} disabled={busy} />
            {dif != null && <div className={'cc-dif ' + (dif === 0 ? 'ok' : dif > 0 ? 'mas' : 'menos')}><I n={dif === 0 ? 'check' : 'warn'} /><span>{dif === 0 ? 'La caja cuadra' : dif > 0 ? 'Sobran ' + cop(dif) : 'Faltan ' + cop(-dif)}</span></div>}
            <p className="cc-step"><span>2</span>{dif ? 'Explica la diferencia' : 'Observaciones (opcional)'}</p>
            <textarea className="inp cc-obs" rows={2} maxLength={1000} required={!!dif} placeholder={dif ? 'Ej: se dio mal un cambio' : 'Algo que quieras dejar anotado'} value={form.notes} onChange={e => update({ notes: e.target.value })} />
            <p className="cc-step"><span>3</span>¿Dejas base en el cajón para mañana?</p>
            <div className="cc-base-opts" role="radiogroup" aria-label="Base para mañana">
              <button type="button" role="radio" aria-checked={form.base !== 'no'} className={form.base !== 'no' ? 'on' : ''} onClick={() => update({ base: 'si' })}><b>Sí, dejar base</b><small>Mañana la caja abre con ese efectivo</small></button>
              <button type="button" role="radio" aria-checked={form.base === 'no'} className={form.base === 'no' ? 'on' : ''} onClick={() => update({ base: 'no', baseAmount: '' })}><b>No dejar base</b><small>Se retira todo; mañana abre en $0</small></button>
            </div>
            {form.base !== 'no' && <MoneyInput label="Base que queda en el cajón (COP)" value={form.baseAmount} placeholder={contado == null ? 'Primero cuenta el efectivo (paso 1)' : 'Si lo dejas vacío, queda todo lo contado'} disabled={busy || contado == null} onValueChange={baseAmount => {
              // La base sale del efectivo contado: no puede ser mayor
              let v = null; try { v = baseAmount === '' ? null : cashCentavos(baseAmount) } catch { v = null }
              update({ baseAmount: v != null && contado != null && v > contado ? String(contado / 100) : baseAmount })
            }} />}
            {contado != null && form.base !== 'no' && contado > 0 || contado != null && form.base === 'no' ? (() => { let base = 0; try { base = form.base === 'no' ? 0 : form.baseAmount === '' ? contado : cashCentavos(form.baseAmount) } catch { base = 0 } base = Math.min(base, contado); return <div className="cc-split"><div><span>Queda de base</span><b>{cop(base)}</b></div><div><span>Se retira</span><b>{cop(contado - base)}</b></div></div> })() : null}
            {novedades.length > 0 && <div className="cc-nov"><small>Novedades del día</small>{novedades.map(e => <p key={e.id}>• {e.descripcion}</p>)}</div>}
            <p className="cc-foot"><I n="shield" />Cerrar termina el día de este local. Si fue un error, un administrador puede reabrirla hoy.</p>
          </div>
        })()}
        {form.type === 'movement' && <><Select label="Movimiento" value={form.kind} onChange={e => update({ kind: e.target.value, method: 'efectivo', adjustment: '', amount: '' })}>{['entrada', 'salida', 'gasto', 'pago_proveedor', 'reembolso'].map(k => <option key={k} value={k}>{labels[k]}</option>)}</Select>{form.kind === 'reembolso' && <><Select label="Devolución o anulación pendiente" required value={form.adjustment} onChange={e => { const a = pendingAdjustments.find(a => String(a.id) === e.target.value); update({ adjustment: e.target.value, amount: a ? String(Math.abs(a.monto_cent) / 100) : '', reference: a?.referencia || '' }) }}><option value="">Selecciona el ajuste</option>{pendingAdjustments.map(a => <option key={a.id} value={a.id}>{a.referencia} · {cop(Math.abs(a.monto_cent))}</option>)}</Select><Select label="Medio real del reembolso" value={form.method} onChange={e => update({ method: e.target.value })}>{CASH_METHODS.map(m => <option key={m} value={m}>{labels[m]}</option>)}</Select></>}<Input label="Referencia del pago o soporte" required maxLength={120} value={form.reference} onChange={e => update({ reference: e.target.value })} /><p className="cash-note">Confirma únicamente dinero realmente recibido o entregado. Una compra a crédito no es una salida de efectivo.</p></>}
        {!['novedad', 'reopen', 'close'].includes(form.type) && <MoneyInput label={form.type === 'open' ? 'Saldo inicial en efectivo (COP)' : form.type === 'close' ? 'Efectivo físico contado (COP)' : 'Importe (COP)'} required value={form.amount} onValueChange={amount => update({ amount })} disabled={busy || form.kind === 'reembolso' && !!form.adjustment} />}
        {!['open', 'novedad', 'reopen', 'close'].includes(form.type) && <Input label={form.type === 'close' ? 'Observaciones del cierre' : 'Motivo / descripción'} required={form.type === 'movement'} maxLength={form.type === 'close' ? 1000 : 500} value={form.notes} onChange={e => update({ notes: e.target.value })} />}
      </form>
    </Modal>}
    {detalleCierre && <CierreDetalle id={detalleCierre} nombreLocal={id => loc.habilitado ? loc.nombre(id) : ''} onClose={() => setDetalleCierre(null)} />}
    {verVentas && session && <VentasCaja caja={session} metodo={verVentas.metodo} titulo={(loc.habilitado && session.local_id != null ? loc.nombre(session.local_id) : 'Caja') + ' · ' + fechaHora(session.apertura_en)} onClose={() => setVerVentas(null)} />}
  </div></AppShell>
}

// Ventas de la caja (por medio de pago o todas) con los productos vendidos
function VentasCaja({ caja, metodo, titulo, onClose }) {
  const [ventas, setVentas] = useState(null), [err, setErr] = useState(''), [abierta, setAbierta] = useState(null)
  useEffect(() => { cashRequest(supabase, 'caja_ventas_detalle', { p_caja_id: caja.id, p_metodo: metodo }).then(setVentas, e => setErr(cashSchemaMissing(e) ? 'Falta ejecutar el script 21_caja_detalle_ventas.sql en Supabase.' : mensajeError(e))) }, [caja.id, metodo])
  const pesos = n => cop(Math.round(Number(n || 0) * 100))
  const validas = (ventas || []).filter(v => v.estado !== 'anulada')
  const productos = Object.values(validas.flatMap(v => v.items).reduce((m, i) => { const k = i.producto_id ?? i.nombre; (m[k] ||= { nombre: i.nombre, cantidad: 0, total: 0 }); m[k].cantidad += Number(i.cantidad); m[k].total += Number(i.total); return m }, {})).sort((a, b) => b.total - a.total)
  const total = validas.reduce((n, v) => n + Number(v.total), 0)
  const nombreMetodo = { efectivo: 'en efectivo', tarjeta: 'con tarjeta', transferencia: 'por transferencia' }[metodo]
  return <Modal title={metodo ? 'Ventas ' + nombreMetodo : 'Ventas del día'} subtitle={titulo} className="experience-sheet cv-sheet" onClose={onClose}>
    <ErrorBox text={err} />
    {!ventas && !err ? <Loader /> : ventas && <>
      <section className="cv-hero"><span>Total</span><strong>{pesos(total)}</strong><small>{validas.length} {validas.length === 1 ? 'venta' : 'ventas'} · {productos.reduce((n, p) => n + p.cantidad, 0)} productos</small></section>
      {productos.length > 0 && <><h3 className="cash-sub">Productos vendidos</h3>
        <div className="cv-prods">{productos.map(p => <div key={p.nombre}><span className="cv-q">{p.cantidad}×</span><span className="cv-n">{p.nombre}</span><b>{pesos(p.total)}</b></div>)}</div></>}
      <h3 className="cash-sub">Ventas</h3>
      {!ventas.length ? <Empty text="Sin ventas" description="Aún no hay ventas con este medio de pago en esta caja." /> : <div className="cv-list">{ventas.map(v => {
        const open = abierta === v.id
        return <article key={v.id} className={'cv-venta' + (v.estado === 'anulada' ? ' void' : '')}>
          <button type="button" className="cv-head" onClick={() => setAbierta(open ? null : v.id)}>
            <span className="cv-num">{v.prefijo}-{String(v.numero).padStart(4, '0')}</span>
            <span className="cv-meta"><b>{v.cliente || 'Consumidor final'}</b><small>{fechaHora(v.fecha)} · {v.vendedor || 'Vendedor'}{metodo ? '' : ' · ' + labels[v.metodo]}</small></span>
            <span className="cv-total">{v.estado === 'anulada' ? <span className="badge bad">Anulada</span> : pesos(v.total)}</span>
          </button>
          {open && <div className="cv-items">{v.items.map((i, k) => <div key={k}><span>{i.cantidad}× {i.nombre}</span><b>{pesos(i.total)}</b></div>)}{Number(v.descuento) > 0 && <div className="disc"><span>Descuento</span><b>−{pesos(v.descuento)}</b></div>}</div>}
        </article>
      })}</div>}
    </>}
  </Modal>
}

// Administrador: cómo va la caja de cada local hoy y el total de ambos
function ResumenLocales({ locales, actual, onElegir }) {
  const vendido = l => Number(l.resumen?.vendido_bruto_cent || 0)
  const total = locales.reduce((n, l) => n + (l.caja && (l.caja.estado === 'abierta' || new Date(l.caja.apertura_en).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }) === hoyCaja()) ? vendido(l) : 0), 0)
  return <section className="card cash-card cash-locales">
    <h2>Cajas de los locales</h2>
    <div className="cash-locales-grid">{locales.map(l => {
      const c = l.caja, abierta = c?.estado === 'abierta', hoy = c && new Date(c.apertura_en).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }) === hoyCaja()
      return <button type="button" key={l.local_id} className={'cash-local' + (String(l.local_id) === String(actual) ? ' on' : '')} onClick={() => onElegir(l.local_id)}>
        <small>{l.local}</small>
        <b>{abierta || hoy ? cop(vendido(l)) : '—'}</b>
        <span className={'badge ' + (abierta ? 'good' : '')}>{abierta ? 'Abierta' : c ? (hoy ? 'Cerrada hoy' : 'Cerrada') : 'Sin abrir'}</span>
      </button>
    })}</div>
    <p className="cash-total">Vendido hoy en todos los locales <b>{cop(total)}</b></p>
  </section>
}

// Historial de cierres de caja con filtro por año, mes y día
const MESES_CAJA = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
function HistorialCierres({ local, nombreLocal, multi, tick, seleccionada, onElegir }) {
  const hoy = hoyCaja()
  const [anio, setAnio] = useState(hoy.slice(0, 4)), [mes, setMes] = useState(hoy.slice(5, 7)), [dia, setDia] = useState('todos')
  const [lista, setLista] = useState(null), [err, setErr] = useState('')
  const rango = (() => {
    if (mes === 'todos') return [anio + '-01-01', anio + '-12-31']
    const fin = new Date(Date.UTC(Number(anio), Number(mes), 0)).getUTCDate()
    return dia === 'todos' ? [`${anio}-${mes}-01`, `${anio}-${mes}-${String(fin).padStart(2, '0')}`] : [`${anio}-${mes}-${dia}`, `${anio}-${mes}-${dia}`]
  })()
  useEffect(() => {
    let vivo = true; setLista(null); setErr('')
    cashRequest(supabase, 'caja_historial', { p_desde: rango[0], p_hasta: rango[1], ...(local != null ? { p_local_id: local } : {}) })
      .then(v => { if (vivo) setLista(v || []) }, e => { if (vivo) { setErr(cashSchemaMissing(e) ? 'Falta ejecutar el script 22_caja_historial.sql en Supabase.' : mensajeError(e)); setLista([]) } })
    return () => { vivo = false }
  }, [rango[0], rango[1], local, tick]) // eslint-disable-line react-hooks/exhaustive-deps
  const anios = Array.from({ length: 5 }, (_, i) => String(Number(hoy.slice(0, 4)) - i))
  const diasMes = mes === 'todos' ? 0 : new Date(Date.UTC(Number(anio), Number(mes), 0)).getUTCDate()
  const vendido = c => Number(c.resumen?.vendido_bruto_cent || 0)
  const totalVendido = (lista || []).reduce((n, c) => n + vendido(c), 0)
  const totalDif = (lista || []).reduce((n, c) => n + Number(c.diferencia_cent || 0), 0)
  const fechaCorta = f => new Date(f).toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'America/Bogota' })
  return <section className="card cash-card hc">
    <h2>Historial de cierres</h2>
    <div className="hc-filtros">
      <label><span>Año</span><select className="inp" value={anio} onChange={e => setAnio(e.target.value)}>{anios.map(a => <option key={a}>{a}</option>)}</select></label>
      <label><span>Mes</span><select className="inp" value={mes} onChange={e => { setMes(e.target.value); setDia('todos') }}><option value="todos">Todos</option>{MESES_CAJA.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}</select></label>
      <label><span>Día</span><select className="inp" value={dia} disabled={mes === 'todos'} onChange={e => setDia(e.target.value)}><option value="todos">Todos</option>{Array.from({ length: diasMes }, (_, i) => String(i + 1).padStart(2, '0')).map(d => <option key={d} value={d}>{Number(d)}</option>)}</select></label>
    </div>
    <ErrorBox text={err} />
    {!lista ? <Loader /> : <>
      <div className="hc-resumen">
        <div><span>Cierres</span><b>{lista.length}</b></div>
        <div><span>Vendido</span><b>{cop(totalVendido)}</b></div>
        <div><span>Diferencias</span><b className={totalDif ? (totalDif > 0 ? 'mas' : 'menos') : ''}>{totalDif ? (totalDif > 0 ? '+' : '−') + cop(Math.abs(totalDif)) : 'Cuadró'}</b></div>
      </div>
      {!lista.length ? <p className="text-muted hc-vacio">No hay cierres de caja en este periodo.</p> : <div className="hc-lista">{lista.map(c => {
        const d = Number(c.diferencia_cent || 0)
        return <button type="button" key={c.id} className={'cash-history-row hc-row' + (seleccionada === c.id ? ' selected' : '')} onClick={() => onElegir(c.id)}>
          <span className="hc-fecha"><b>{fechaCorta(c.cierre_en)}</b><small>{new Date(c.cierre_en).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' })}</small></span>
          <span className="hc-info"><b>{multi && c.local ? c.local : 'Cierre #' + c.id}</b><small>Cerró {c.cerrado_nombre || '—'}{c.reabierta ? ' · reabierta' : ''}</small>
            <small className="hc-metodos">{['efectivo', 'tarjeta', 'transferencia'].filter(m => Number(c.resumen?.ventas?.[m])).map(m => labels[m] + ' ' + cop(c.resumen.ventas[m])).join(' · ') || 'Sin ventas'}</small></span>
          <span className="hc-valor"><b>{cop(vendido(c))}</b><span className={'hc-dif ' + (d === 0 ? 'ok' : d > 0 ? 'mas' : 'menos')}>{d === 0 ? 'Cuadró' : (d > 0 ? 'Sobró ' : 'Faltó ') + cop(Math.abs(d))}</span></span>
        </button>
      })}</div>}
    </>}
  </section>
}

// Detalle de un cierre de caja (desde el historial)
function CierreDetalle({ id, nombreLocal, onClose }) {
  const [d, setD] = useState(null), [err, setErr] = useState(''), [ventas, setVentas] = useState(null)
  useEffect(() => { cashRequest(supabase, 'caja_estado', { p_caja_id: id }).then(setD, e => setErr(mensajeError(e))) }, [id])
  const c = d?.session, sm = d?.summary
  const exportar = () => { const url = URL.createObjectURL(new Blob([cashReportCsv(c, sm)], { type: 'text/csv;charset=utf-8' })), a = document.createElement('a'); a.href = url; a.download = 'Angie-Tech-caja-' + c.id + '.csv'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000) }
  const local = c?.local_id != null ? nombreLocal(c.local_id) : ''
  return <Modal title="Detalle del cierre" subtitle={c ? [local, fechaHora(c.cierre_en || c.apertura_en)].filter(Boolean).join(' · ') : ''} className="experience-sheet cv-sheet" onClose={onClose}>
    <ErrorBox text={err} />
    {!d && !err ? <Loader /> : c && sm && (() => {
      const efectivoVentas = Number(sm.ventas.efectivo || 0), movimientos = Number(sm.efectivo_esperado_cent) - Number(c.inicial_cent) - efectivoVentas
      const dif = Number(c.diferencia_cent || 0), novedades = (d.events || []).filter(e => e.tipo === 'novedad')
      return <div className="cc">
        <section className="cc-sum">
          <p className="cc-sum-eyebrow">Ventas del día</p>
          {CASH_METHODS.map(m => { const n = (d.events || []).filter(e => e.tipo === 'venta' && e.metodo === m).length; return <button type="button" key={m} className="cc-line" onClick={() => setVentas(m)}>
            <span className={'cash-method-ic m-' + m}><I n={{ efectivo: 'cash', tarjeta: 'card', transferencia: 'bank' }[m]} /></span>
            <span className="cc-line-txt"><b>Total venta {{ efectivo: 'en efectivo', tarjeta: 'con tarjeta', transferencia: 'por transferencia' }[m]}</b><small>{n} {n === 1 ? 'venta' : 'ventas'}</small></span>
            <b className="cc-line-v">{cop(sm.ventas[m])}<I n="back" className="flip cc-go" /></b>
          </button> })}
          <div className="cc-total" role="button" tabIndex={0} onClick={() => setVentas('todas')}><span>Total venta<small>{sm.ventas_cantidad ?? 0} {sm.ventas_cantidad === 1 ? 'venta' : 'ventas'}</small></span><strong>{cop(sm.vendido_bruto_cent)}</strong></div>
        </section>
        <h3 className="cash-sub">Cuadre del efectivo</h3>
        <div className="cash-cuadre">
          <div><span>Base inicial</span><b>{cop(c.inicial_cent)}</b></div>
          <div><span>+ Ventas en efectivo</span><b>{cop(efectivoVentas)}</b></div>
          {movimientos !== 0 && <div><span>{movimientos < 0 ? '− Retiros, gastos y pagos' : '+ Entradas de efectivo'}</span><b>{cop(Math.abs(movimientos))}</b></div>}
          <div><span>= Efectivo esperado</span><b>{cop(sm.efectivo_esperado_cent)}</b></div>
          {c.estado === 'cerrada' && <div><span>Efectivo contado</span><b>{cop(c.contado_cent)}</b></div>}
          {c.estado === 'cerrada' && <div><span>Diferencia</span><b className={dif < 0 ? 'cash-neg' : ''}>{dif === 0 ? 'Cuadró' : (dif > 0 ? 'Sobró ' : 'Faltó ') + cop(Math.abs(dif))}</b></div>}
          {c.base_siguiente_cent != null && <div><span>Se retiró</span><b>{cop(Number(c.contado_cent) - Number(c.base_siguiente_cent))}</b></div>}
          {c.base_siguiente_cent != null && <div className="total"><span>Base para el día siguiente</span><b>{cop(c.base_siguiente_cent)}</b></div>}
        </div>
        <div className="cash-closed cd-quien">
          <p><span>Abrió</span><b>{c.responsable_nombre}</b><small>{fechaHora(c.apertura_en)}{esCajaAutomatica(c) ? ' · automática' : ''}</small></p>
          {c.estado === 'cerrada' ? <p><span>Cerró</span><b>{c.cerrado_nombre || '—'}</b><small>{fechaHora(c.cierre_en)}</small></p> : <p><span>Estado</span><b>Abierta</b></p>}
        </div>
        {c.observaciones && <div className="cc-nov"><small>Observaciones</small><p>{c.observaciones}</p></div>}
        {novedades.length > 0 && <div className="cc-nov"><small>Novedades del día</small>{novedades.map(e => <p key={e.id}>• {e.descripcion} <span className="text-muted">({e.referencia})</span></p>)}</div>}
        {(c.cierres_anteriores || []).length > 0 && <p className="cash-note">Se reabrió: {c.cierres_anteriores.map(x => `${fechaHora(x.reabierta_en)} por ${x.reabierta_por} (${x.motivo})`).join(' · ')}.</p>}
        <button type="button" className="btn sec full" onClick={exportar}>Exportar resumen CSV</button>
      </div>
    })()}
    {ventas && c && <VentasCaja caja={c} metodo={ventas === 'todas' ? null : ventas} titulo={[local, fechaHora(c.apertura_en)].filter(Boolean).join(' · ')} onClose={() => setVentas(null)} />}
  </Modal>
}
