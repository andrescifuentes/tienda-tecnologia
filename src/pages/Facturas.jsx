import { useEffect, useMemo, useState } from 'react'
import AppShell, { ThemeToggle } from '../components/AppShell'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Brand } from '../components/TechVisuals'
import { I } from '../components/InvIcons'
import FacturaDetalle from '../components/FacturaDetalle'
import { Empty, Loader } from '../components/ui'
import { supabase, isDemoMode } from '../lib/supabase'
import { money } from '../lib/format'
import { MESES, METODOS, SELECT_FACTURA, hoyYm, diaKey, rango, Bolsa, FacturaCard } from '../components/FacturaUI'

const ULTIMAS = 5

export default function Facturas() {
  const navigate = useNavigate()
  const { can } = useAuth()
  const [params] = useSearchParams()
  const [periodo, setPeriodo] = useState('mes') // 'mes' | 'anio' | 'todo'
  const ym = hoyYm()
  const [datos, setDatos] = useState(null)
  const [previo, setPrevio] = useState(null)
  const [ver, setVer] = useState(params.get('factura') ? Number(params.get('factura')) : null)
  const [tick, setTick] = useState(0)
  const sel = SELECT_FACTURA + (isDemoMode ? 'perfiles(nombre)' : 'perfiles!facturas_vendedor_id_fkey(nombre)')

  useEffect(() => {
    let vivo = true
    setDatos(null)
    ;(async () => {
      const [ini, fin] = rango(periodo, ym)
      let qq = supabase.from('facturas').select(sel).order('fecha', { ascending: false }).limit(periodo === 'todo' ? 2000 : 1000)
      if (ini) qq = qq.gte('fecha', ini)
      const { data } = await qq
      if (vivo) setDatos((data || []).filter((f) => !fin || new Date(f.fecha) < new Date(fin)))
    })()
    return () => { vivo = false }
  }, [periodo, tick]) // eslint-disable-line

  useEffect(() => {
    let vivo = true
    setPrevio(null)
    if (periodo === 'todo') return
    const [ini, fin] = rango(periodo, periodo === 'anio' ? (Number(ym.slice(0, 4)) - 1) + ym.slice(4) : prevYm(ym))
    const c = new Date(); if (periodo === 'anio') c.setFullYear(c.getFullYear() - 1); else c.setMonth(c.getMonth() - 1)
    const corte = c < new Date(fin) ? c : new Date(fin)
    supabase.from('facturas').select('total,estado,fecha').gte('fecha', ini).then(({ data }) => {
      if (vivo) setPrevio((data || []).filter((f) => f.estado !== 'anulada' && new Date(f.fecha) < corte).reduce((a, f) => a + Number(f.total || 0), 0))
    })
    return () => { vivo = false }
  }, [periodo, tick]) // eslint-disable-line

  const resumen = useMemo(() => {
    const ok = (datos || []).filter((f) => f.estado !== 'anulada')
    const total = ok.reduce((a, f) => a + Number(f.total || 0), 0)
    const porMetodo = {}
    for (const f of ok) porMetodo[f.metodo_pago || 'otro'] = (porMetodo[f.metodo_pago || 'otro'] || 0) + Number(f.total || 0)
    let serie = null
    const hoyD = diaKey(new Date())
    if (periodo === 'mes') {
      const [y, m] = ym.split('-').map(Number); const n = new Date(Date.UTC(y, m, 0)).getUTCDate()
      const porDia = {}; for (const f of ok) { const k = diaKey(f.fecha); porDia[k] = (porDia[k] || 0) + Number(f.total) }
      let acc = 0; serie = []
      for (let d = 1; d <= Number(hoyD.slice(8)); d++) { const k = `${ym}-${String(d).padStart(2, '0')}`; const v = porDia[k] || 0; acc += v; serie.push({ k, l: `${d} ${MESES[m - 1].slice(0, 3).toLowerCase()}`, d: v, v }) }
      serie.total = n
    } else if (periodo === 'anio') {
      const y = ym.slice(0, 4); const pm = Array(12).fill(0); for (const f of ok) pm[Number(diaKey(f.fecha).slice(5, 7)) - 1] += Number(f.total)
      let acc = 0; serie = []
      for (let i = 0; i < Number(ym.slice(5)); i++) { acc += pm[i]; serie.push({ k: `${y}-${i + 1}`, l: `${MESES[i]} ${y}`, d: pm[i], v: pm[i] }) }
      serie.total = 12
    }
    const hoyK = diaKey(new Date())
    return { hoy: ok.filter((f) => diaKey(f.fecha) === hoyK).length, maxima: ok.reduce((a, f) => Math.max(a, Number(f.total || 0)), 0), total, cantidad: ok.length, promedio: ok.length ? total / ok.length : 0, anuladas: (datos || []).length - ok.length, porMetodo, serie }
  }, [datos, periodo, ym])

  const etiqueta = periodo === 'anio' ? 'Este año' : periodo === 'todo' ? 'Todo el historial' : `${MESES[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`
  const ultimas = (datos || []).slice(0, ULTIMAS)

  const header = <div className="inv-head fv-head">
    <div className="inv-head-top"><Brand compact /><ThemeToggle /></div>
    <div className="fv-head-row">
      <div>
        <span className="fv-eyebrow">Centro de facturación</span>
        <h1>Facturas</h1>
        <p>{datos ? <><b>{resumen.cantidad}</b> {resumen.cantidad === 1 ? 'venta' : 'ventas'} · {etiqueta.toLowerCase()}</> : 'Cargando ventas…'}</p>
      </div>
      {can('vender') && <button type="button" className="fv-new" onClick={() => navigate('/vender')} aria-label="Nueva factura"><span className="fv-new-ic"><I n="plus" /></span><span className="fv-new-txt">Nueva<small>venta</small></span></button>}
    </div>
  </div>

  return (
    <div className="admin-premium admin-invoices"><AppShell title="Facturas" header={header}>
      <section className="fv-summary">
        <p className="fv-sum-label">Ventas · {etiqueta}</p>
        <p className="fv-sum-total">{datos ? money(resumen.total) : '—'}</p>
        {datos && resumen.serie && <Bolsa serie={resumen.serie} previo={previo} total={resumen.total} anual={periodo === 'anio'} />}
        <div className="fv-range" role="tablist" aria-label="Periodo">
          {[['mes', 'Mes', 'Este mes'], ['anio', 'Año', 'Este año'], ['todo', 'Todo', 'Todo el historial']].map(([v, l, t]) => <button key={v} type="button" role="tab" aria-selected={periodo === v} aria-label={t} className={periodo === v ? 'on' : ''} onClick={() => setPeriodo(v)}>{l}</button>)}
        </div>
        {datos && resumen.total > 0 && <div className="fv-mix">
          <div className="fv-mix-bar">{METODOS.filter(([k]) => resumen.porMetodo[k]).map(([k]) => <span key={k} className={'m-' + k} style={{ width: (resumen.porMetodo[k] / resumen.total * 100) + '%' }} />)}</div>
          <div className="fv-mix-legend">{METODOS.filter(([k]) => resumen.porMetodo[k]).map(([k, l]) => <span key={k}><i className={'m-' + k} />{l} <b>{Math.round(resumen.porMetodo[k] / resumen.total * 100)}%</b></span>)}</div>
        </div>}
        <div className="fv-kpis">
          <div className="fv-kpi k-ok">
            <span className="fv-kpi-top"><span className="fv-kpi-ic"><I n="receipt" /></span>Ventas</span>
            <b><Cuenta valor={datos ? resumen.cantidad : null} /></b>
            <small>{resumen.hoy ? <><em>+{resumen.hoy}</em> hoy</> : 'realizadas'}</small>
          </div>
          <div className={'fv-kpi ' + (resumen.anuladas ? 'k-bad' : 'k-calm')}>
            <span className="fv-kpi-top"><span className="fv-kpi-ic"><I n={resumen.anuladas ? 'warn' : 'check'} /></span>Anuladas</span>
            <b><Cuenta valor={datos ? resumen.anuladas : null} /></b>
            <small>{resumen.anuladas ? `${Math.round(resumen.anuladas / ((datos || []).length || 1) * 100)}% del total` : 'Todo en orden'}</small>
          </div>
          <div className="fv-kpi k-gold wide">
            <span className="fv-kpi-top"><span className="fv-kpi-ic"><I n="tag" /></span>Valor promedio por venta</span>
            <b><Cuenta valor={datos ? resumen.promedio : null} dinero /></b>
            {resumen.maxima > 0 && <span className="fv-kpi-meter"><span style={{ width: Math.round(resumen.promedio / resumen.maxima * 100) + '%' }} /></span>}
            {resumen.maxima > 0 && <small>Venta más alta <em>{money(resumen.maxima)}</em></small>}
          </div>
        </div>
      </section>

      <div className="fv-sec-head"><h3>Últimas facturas</h3></div>
      {!datos ? <Loader /> : ultimas.length === 0 ? <Empty text="Aún no hay facturas" description={`No hay ventas en ${etiqueta.toLowerCase()}.`} /> : (
        <div className="fv-list">
          {ultimas.map((f, i) => <FacturaCard key={f.id} f={f} index={i} conFecha onClick={() => setVer(f.id)} />)}
        </div>
      )}
      <button type="button" className="fv-history-btn" onClick={() => navigate('/facturas/historial')}>
        <span className="fv-history-ic"><I n="history" /></span>
        <span><b>Historial de facturas</b><small>Busca por año, mes o día</small></span>
        <I n="back" className="flip" />
      </button>
      {ver && <FacturaDetalle id={ver} onClose={() => setVer(null)} onCambio={() => setTick((t) => t + 1)} />}
    </AppShell></div>
  )
}

function Cuenta({ valor, dinero = false }) {
  const [v, setV] = useState(0)
  useEffect(() => {
    if (valor == null) return
    let raf, t0
    const paso = (t) => { t0 ??= t; const k = Math.min(1, (t - t0) / 900); setV(valor * (1 - Math.pow(1 - k, 3))); if (k < 1) raf = requestAnimationFrame(paso) }
    raf = requestAnimationFrame(paso)
    return () => cancelAnimationFrame(raf)
  }, [valor])
  if (valor == null) return '—'
  return dinero ? money(Math.round(v)) : Math.round(v)
}

function prevYm(ym) { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return d.toISOString().slice(0, 7) }
