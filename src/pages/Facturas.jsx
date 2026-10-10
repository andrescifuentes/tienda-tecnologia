import { useEffect, useMemo, useState } from 'react'
import AppShell, { ThemeToggle } from '../components/AppShell'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { AnimatedCard, Brand } from '../components/TechVisuals'
import { I } from '../components/InvIcons'
import FacturaDetalle from '../components/FacturaDetalle'
import { Empty, Loader } from '../components/ui'
import { supabase, isDemoMode } from '../lib/supabase'
import { money, numFactura, limpiarBusqueda } from '../lib/format'

const TZ = 'America/Bogota'
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const hoyYm = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ }).slice(0, 7)
const diaKey = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ })
const hora = (iso) => new Date(iso).toLocaleTimeString('es-CO', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).replace(/ /g, ' ')
const shiftYm = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7) }
const iniciales = (n) => String(n || '').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase()

function rango(periodo, ym) {
  if (periodo === 'todo') return [null, null]
  if (periodo === 'anio') { const y = Number(ym.slice(0, 4)); return [`${y}-01-01T00:00:00-05:00`, `${y + 1}-01-01T00:00:00-05:00`] }
  return [`${ym}-01T00:00:00-05:00`, `${shiftYm(ym, 1)}-01T00:00:00-05:00`]
}

function tituloDia(key) {
  const hoy = diaKey(new Date()), ayer = diaKey(new Date(Date.now() - 864e5))
  const d = new Date(key + 'T12:00:00-05:00')
  const txt = d.toLocaleDateString('es-CO', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' })
  if (key === hoy) return 'Hoy · ' + txt.split(', ')[1]
  if (key === ayer) return 'Ayer · ' + txt.split(', ')[1]
  return txt.charAt(0).toUpperCase() + txt.slice(1)
}

export default function Facturas() {
  const navigate = useNavigate()
  const { can } = useAuth()
  const [params] = useSearchParams()
  const [q, setQ] = useState(params.get('q') || '')
  const [estado, setEstado] = useState('todas')
  const [periodo, setPeriodo] = useState('mes') // 'mes' | 'anio' | 'todo'
  const [ym, setYm] = useState(hoyYm())
  const [datos, setDatos] = useState(null)
  const [ver, setVer] = useState(params.get('factura') ? Number(params.get('factura')) : null)
  const [tick, setTick] = useState(0)
  const [picker, setPicker] = useState(false)
  const [pickMode, setPickMode] = useState('mes')
  const [pickYear, setPickYear] = useState(Number(hoyYm().slice(0, 4)))

  useEffect(() => {
    let vivo = true
    setDatos(null)
    ;(async () => {
      const [ini, fin] = rango(periodo, ym)
      let qq = supabase.from('facturas').select(isDemoMode ? 'id,prefijo,numero,total,estado,fecha,metodo_pago,clientes(nombre),perfiles(nombre)' : 'id,prefijo,numero,total,estado,fecha,metodo_pago,clientes(nombre),perfiles!facturas_vendedor_id_fkey(nombre)').order('fecha', { ascending: false }).limit(periodo === 'todo' ? 300 : 1000)
      if (ini) qq = qq.gte('fecha', ini)
      const { data } = await qq
      if (!vivo) return
      setDatos((data || []).filter((f) => !fin || new Date(f.fecha) < new Date(fin)))
    })()
    return () => { vivo = false }
  }, [periodo, ym, tick])

  const resumen = useMemo(() => {
    const ok = (datos || []).filter((f) => f.estado !== 'anulada')
    const total = ok.reduce((a, f) => a + Number(f.total || 0), 0)
    return { total, cantidad: ok.length, promedio: ok.length ? total / ok.length : 0, anuladas: (datos || []).length - ok.length }
  }, [datos])

  const lista = useMemo(() => {
    if (!datos) return null
    const s = limpiarBusqueda(q).toLowerCase()
    const num = s.replace(/^[a-z]+-0*/, '')
    return datos.filter((f) => (estado === 'todas' || f.estado === estado) && (!s ||
      (/^\d+$/.test(num) && (String(f.numero) === num || String(Math.round(f.total)).includes(num))) ||
      (f.clientes?.nombre || 'consumidor final').toLowerCase().includes(s) ||
      numFactura(f).toLowerCase().includes(s)))
  }, [datos, q, estado])

  const grupos = useMemo(() => {
    const g = []
    for (const f of lista || []) { const k = diaKey(f.fecha); const last = g[g.length - 1]; if (last?.key === k) { last.items.push(f); last.total += f.estado === 'anulada' ? 0 : Number(f.total) } else g.push({ key: k, items: [f], total: f.estado === 'anulada' ? 0 : Number(f.total) }) }
    return g
  }, [lista])

  const etiqueta = periodo === 'anio' ? ym.slice(0, 4) : periodo === 'todo' ? 'Todo el historial' : `${MESES[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`

  const header = <div className="inv-head">
    <div className="inv-head-top"><Brand compact /><ThemeToggle /></div>
    <div className="inv-head-title"><div><h1>Facturas</h1><p>Tus ventas, en un solo lugar</p></div>{can('vender') && <button type="button" className="inv-add" onClick={() => navigate('/vender')}><I n="plus" />Nueva</button>}</div>
  </div>

  return (
    <div className="admin-premium admin-invoices"><AppShell title="Facturas" header={header}>
      <section className="fv-summary">
        <div className="fv-top">
          <p className="fv-sum-label">Total vendido</p>
          <button type="button" className={'fv-period-pill' + (picker ? ' open' : '')} aria-haspopup="dialog" aria-expanded={picker} onClick={() => { setPickYear(Number(ym.slice(0, 4))); setPickMode(periodo === 'todo' ? 'mes' : periodo); setPicker(!picker) }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><rect x="4" y="5.5" width="16" height="14.5" rx="2.5" /><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" /></svg>
            <span>{etiqueta}</span><span className="fv-caret" aria-hidden="true">▾</span>
          </button>
        </div>
        {picker && <>
          <div className="fv-pick-back" onClick={() => setPicker(false)} />
          <div className="fv-pick" role="dialog" aria-label="Elegir periodo">
            <div className="fv-seg" role="tablist" aria-label="Tipo de periodo">
              {[['mes', 'Mes'], ['anio', 'Año'], ['todo', 'Todo']].map(([v, l]) => <button key={v} type="button" role="tab" aria-selected={pickMode === v} className={pickMode === v ? 'on' : ''} onClick={() => { if (v === 'todo') { setPeriodo('todo'); setPicker(false) } else setPickMode(v) }}>{l}</button>)}
            </div>
            {pickMode === 'mes' ? <>
              <div className="fv-pick-head">
                <button type="button" aria-label="Año anterior" onClick={() => setPickYear(pickYear - 1)}>‹</button>
                <b>{pickYear}</b>
                <button type="button" aria-label="Año siguiente" disabled={pickYear >= Number(hoyYm().slice(0, 4))} onClick={() => setPickYear(pickYear + 1)}>›</button>
              </div>
              <div className="fv-pick-grid">
                {MESES.map((m, i) => {
                  const v = `${pickYear}-${String(i + 1).padStart(2, '0')}`
                  return <button key={v} type="button" disabled={v > hoyYm()} className={(periodo === 'mes' && v === ym ? 'on' : '') + (v === hoyYm() ? ' now' : '')} onClick={() => { setPeriodo('mes'); setYm(v); setPicker(false) }}>{m.slice(0, 3)}</button>
                })}
              </div>
            </> : <div className="fv-pick-grid mt">
              {Array.from({ length: 6 }, (_, i) => Number(hoyYm().slice(0, 4)) - 5 + i).map((y) => <button key={y} type="button" className={(periodo === 'anio' && String(y) === ym.slice(0, 4) ? 'on' : '') + (y === Number(hoyYm().slice(0, 4)) ? ' now' : '')} onClick={() => { setPeriodo('anio'); setYm(y + ym.slice(4) > hoyYm() ? hoyYm() : y + ym.slice(4)); setPicker(false) }}>{y}</button>)}
            </div>}
          </div>
        </>}
        <p className="fv-sum-total">{datos ? money(resumen.total) : '—'}</p>
        <div className="fv-stats">
          <div><b>{datos ? resumen.cantidad : '—'}</b><span>Facturas</span></div>
          <div><b>{datos ? money(resumen.promedio) : '—'}</b><span>Ticket promedio</span></div>
          <div><b className={resumen.anuladas ? 'bad' : ''}>{datos ? resumen.anuladas : '—'}</b><span>Anuladas</span></div>
        </div>
      </section>

      <div className="inv-search">
        <label className="inv-search-box"><I n="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Número, cliente o monto" aria-label="Buscar factura" />{q && <button type="button" className="inv-scan" aria-label="Limpiar búsqueda" onClick={() => setQ('')}>✕</button>}</label>
      </div>
      <div className="fv-chips">
        {[['todas', 'Todas'], ['emitida', 'Emitidas'], ['anulada', 'Anuladas']].map(([v, l]) => <button key={v} type="button" className={estado === v ? 'on' : ''} onClick={() => setEstado(v)}>{l}</button>)}
      </div>

      {!lista ? <Loader /> : lista.length === 0 ? <Empty text="No hay facturas" description={q ? 'Prueba con otro número o nombre.' : `No hay ventas en ${etiqueta.toLowerCase()}.`} /> : (
        <div className="fv-groups">
          {grupos.map((g) => (
            <section key={g.key} className="fv-group">
              <header className="fv-day"><span>{tituloDia(g.key)}</span><b>{money(g.total)}</b></header>
              <div className="fv-list">
                {g.items.map((f, index) => {
                  const anulada = f.estado === 'anulada'
                  return (
                    <AnimatedCard as="button" type="button" index={index} key={f.id} className={'fv-card' + (anulada ? ' void' : '')} onClick={() => setVer(f.id)}>
                      <span className={'fv-avatar' + (f.clientes?.nombre ? '' : ' walkin')} aria-hidden="true">{f.clientes?.nombre ? iniciales(f.clientes.nombre) : <I n="user" />}</span>
                      <span className="fv-main">
                        <span className="fv-name">{f.clientes?.nombre || 'Consumidor final'}</span>
                        <span className="fv-meta"><b>{numFactura(f)}</b> · {hora(f.fecha)}</span>
                        <span className="fv-seller">{f.perfiles?.nombre || 'Vendedor'}</span>
                      </span>
                      <span className="fv-side">
                        <b className="fv-amount">{money(f.total)}</b>
                        <span className={'fv-status ' + (anulada ? 'bad' : f.estado === 'pendiente' ? 'warn' : 'good')}>{anulada ? 'Anulada' : f.estado === 'pendiente' ? 'Pendiente' : 'Emitida'}</span>
                      </span>
                    </AnimatedCard>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}
      {ver && <FacturaDetalle id={ver} onClose={() => setVer(null)} onCambio={() => setTick((t) => t + 1)} />}
    </AppShell></div>
  )
}
