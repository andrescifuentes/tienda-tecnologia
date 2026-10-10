import { AnimatedCard } from './TechVisuals'
import { I } from './InvIcons'
import Modal from './Modal'
import { useState } from 'react'
import { money, numFactura } from '../lib/format'

export const TZ = 'America/Bogota'
export const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
export const hoyYm = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ }).slice(0, 7)
export const diaKey = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ })
export const hora = (iso) => new Date(iso).toLocaleTimeString('es-CO', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).replace(/\u202f/g, ' ')
export const fechaCorta = (iso) => new Date(iso).toLocaleDateString('es-CO', { timeZone: TZ, day: 'numeric', month: 'short' }).replace('.', '')
export const shiftYm = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7) }
export const iniciales = (n) => String(n || '').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase()
export const METODOS = [['efectivo', 'Efectivo', 'cash'], ['tarjeta', 'Tarjeta', 'card'], ['transferencia', 'Transferencia', 'bank']]
export const SELECT_FACTURA = 'id,prefijo,numero,total,estado,fecha,metodo_pago,clientes(nombre),'

export function rango(periodo, ym) {
  if (periodo === 'todo') return [null, null]
  if (periodo === 'anio') { const y = Number(ym.slice(0, 4)); return [`${y}-01-01T00:00:00-05:00`, `${y + 1}-01-01T00:00:00-05:00`] }
  return [`${ym}-01T00:00:00-05:00`, `${shiftYm(ym, 1)}-01T00:00:00-05:00`]
}

export function tituloDia(key) {
  const hoy = diaKey(new Date()), ayer = diaKey(new Date(Date.now() - 864e5))
  const d = new Date(key + 'T12:00:00-05:00')
  const txt = d.toLocaleDateString('es-CO', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' })
  if (key === hoy) return 'Hoy · ' + txt.split(', ')[1]
  if (key === ayer) return 'Ayer · ' + txt.split(', ')[1]
  return txt.charAt(0).toUpperCase() + txt.slice(1)
}

export function agruparPorDia(lista) {
  const g = []
  for (const f of lista || []) { const k = diaKey(f.fecha); const last = g[g.length - 1]; const v = f.estado === 'anulada' ? 0 : Number(f.total); if (last?.key === k) { last.items.push(f); last.total += v } else g.push({ key: k, items: [f], total: v }) }
  return g
}

export function FacturaCard({ f, index = 0, onClick, conFecha = false }) {
  const anulada = f.estado === 'anulada'
  const m = METODOS.find((x) => x[0] === f.metodo_pago)
  return <AnimatedCard as="button" type="button" index={index} className={'fv-card pro' + (anulada ? ' void' : '')} onClick={onClick}>
    <span className={'fv-avatar' + (f.clientes?.nombre ? '' : ' walkin')} aria-hidden="true">{f.clientes?.nombre ? iniciales(f.clientes.nombre) : <I n="user" />}</span>
    <span className="fv-main">
      <span className="fv-name">{f.clientes?.nombre || 'Consumidor final'}</span>
      <span className="fv-meta"><b className="fv-num">{numFactura(f)}</b><span>{conFecha ? fechaCorta(f.fecha) : hora(f.fecha)}</span></span>
      <span className="fv-seller"><I n="user" />{f.perfiles?.nombre || 'Vendedor'}</span>
    </span>
    <span className="fv-side">
      <b className="fv-amount">{money(f.total)}</b>
      {anulada ? <span className="fv-status bad">Anulada</span> : <span className={'fv-method m-' + f.metodo_pago}><I n={m?.[2] || 'cash'} />{m?.[1] || f.metodo_pago}</span>}
    </span>
  </AnimatedCard>
}

export function FiltrosFactura({ datos, estado, setEstado, metodo, setMetodo, total, onClose }) {
  return <Modal title="Filtros" className="flt-sheet" onClose={onClose} footer={<div className="inv-sheet-foot"><button type="button" className="inv-btn-outline" onClick={() => { setEstado('todas'); setMetodo('todos') }}>Limpiar</button><button type="button" className="inv-btn-gold" onClick={onClose}>Ver {total} {total === 1 ? 'factura' : 'facturas'}</button></div>}>
    <p className="inv-sheet-label">Estado</p>
    <div className="flt-stats">
      {[['todas', 'Todas', 'receipt', ''], ['emitida', 'Emitidas', 'check', ''], ['anulada', 'Anuladas', 'warn', 'bad']].map(([k, l, ic, tone]) => {
        const n = (datos || []).filter((f) => (k === 'todas' || f.estado === k) && (metodo === 'todos' || f.metodo_pago === metodo)).length
        return <button key={k} type="button" className={'flt-stat ' + tone + (estado === k ? ' on' : '')} aria-pressed={estado === k} onClick={() => setEstado(k)}>
          <span className="flt-stat-top"><span className="flt-stat-ic"><I n={ic} /></span>{estado === k && <span className="flt-check"><I n="check" /></span>}</span>
          <b>{n}</b><small>{l}</small>
        </button>
      })}
    </div>
    <p className="inv-sheet-label">Medio de pago</p>
    <div className="flt-list">
      {[['todos', 'Todos los medios', 'receipt'], ...METODOS].map(([k, l, ic]) => {
        const ok = (datos || []).filter((f) => f.estado !== 'anulada' && (k === 'todos' || f.metodo_pago === k))
        const n = (datos || []).filter((f) => (estado === 'todas' || f.estado === estado) && (k === 'todos' || f.metodo_pago === k)).length
        return <button key={k} type="button" className={'m-' + k + (metodo === k ? ' on' : '')} aria-pressed={metodo === k} onClick={() => setMetodo(k)}>
          <span className="flt-row-ic"><I n={ic} /></span>
          <span className="flt-row-name">{l}<small className="flt-row-sub">{money(ok.reduce((a, f) => a + Number(f.total || 0), 0))}</small></span>
          <span className="flt-row-n">{n}</span>
          <span className="flt-row-check">{metodo === k && <I n="check" />}</span>
        </button>
      })}
    </div>
  </Modal>
}

// Curva suave monótona (no se pasa de los puntos, ideal para acumulados)
function curva(p) {
  if (p.length < 2) return p.length ? `M${p[0][0]} ${p[0][1]}` : ''
  const n = p.length, d = [], m = []
  for (let i = 0; i < n - 1; i++) d.push((p[i + 1][1] - p[i][1]) / (p[i + 1][0] - p[i][0] || 1))
  m[0] = d[0]; m[n - 1] = d[n - 2]
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2
  for (let i = 0; i < n - 1; i++) { if (d[i] === 0) { m[i] = 0; m[i + 1] = 0 } else { const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b; if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i] } } }
  let s = `M${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)}`
  for (let i = 0; i < n - 1; i++) { const h = (p[i + 1][0] - p[i][0]) / 3; s += ` C${(p[i][0] + h).toFixed(1)} ${(p[i][1] + m[i] * h).toFixed(1)} ${(p[i + 1][0] - h).toFixed(1)} ${(p[i + 1][1] - m[i + 1] * h).toFixed(1)} ${p[i + 1][0].toFixed(1)} ${p[i + 1][1].toFixed(1)}` }
  return s
}

export const corto = (v) => v >= 1e6 ? '$' + (v / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 1 }) + 'M' : v >= 1e3 ? '$' + Math.round(v / 1e3) + 'K' : '$' + Math.round(v)

export function Bolsa({ serie, previo, total, anual }) {
  const [sel, setSel] = useState(null)
  if (!serie?.length) return null
  const W = 320, H = 132, PT = 14, PB = 18
  const max = Math.max(...serie.map((q) => q.v), 1) * 1.18
  const pico = serie.reduce((a, q, i) => (q.v > serie[a].v ? i : a), 0)
  const x = (i) => serie.total > 1 ? (i / (serie.total - 1)) * W : W / 2
  const y = (v) => PT + (1 - v / max) * (H - PT - PB)
  const pts = serie.map((p, i) => [x(i), y(p.v)])
  const linea = curva(pts)
  const area = linea + ` L ${pts[pts.length - 1][0].toFixed(1)} ${H - PB} L 0 ${H - PB} Z`
  const delta = previo ? (total - previo) / previo * 100 : null
  const tono = delta == null ? 'gold' : delta >= 0 ? 'up' : 'down'
  const ult = pts[pts.length - 1]
  const p = sel != null ? serie[sel] : null
  const mover = (e) => { const r = e.currentTarget.getBoundingClientRect(); const rel = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); const i = Math.round(rel * (serie.total - 1)); setSel(Math.min(serie.length - 1, Math.max(0, i))) }
  const ticks = anual ? [0, 3, 6, 9, 11] : [0, 7, 14, 21, serie.total - 1]
  return <div className={'fv-stock ' + tono}>
    <div className="fv-stock-head">
      {delta != null ? <span className="fv-delta">{delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toLocaleString('es-CO', { maximumFractionDigits: 1 })}%<small>vs. {anual ? 'año' : 'mes'} anterior</small></span> : <span />}
      <span className="fv-stock-read">{p ? <><b>{p.v ? money(p.v) : 'Sin ventas'}</b><small>{p.l}</small></> : null}</span>
    </div>
    <div className="fv-stock-plot"><svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="fv-stock-svg" onPointerMove={mover} onPointerDown={mover} onPointerLeave={() => setSel(null)} role="img" aria-label="Ventas por día del periodo">
      <defs>
        <linearGradient id="fvArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".45" /><stop offset=".6" stopColor="currentColor" stopOpacity=".12" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient>
        <linearGradient id="fvStroke" x1="0" y1="0" x2="1" y2="0"><stop offset="0" className="fv-s0" /><stop offset=".55" className="fv-s1" /><stop offset="1" className="fv-s2" /></linearGradient>
        <linearGradient id="fvFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" className="fv-f0" /><stop offset="1" className="fv-f1" /></linearGradient>
        <filter id="fvGlow" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="2.4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2={W} y1={PT + g * (H - PT - PB)} y2={PT + g * (H - PT - PB)} className="fv-grid" />)}
      
      <path d={area} fill="url(#fvFill)" className="fv-area" />
      <path d={linea} stroke="url(#fvStroke)" className="fv-line" filter="url(#fvGlow)" vectorEffect="non-scaling-stroke" />
      {serie[pico].v > 0 && <line x1={x(pico)} x2={x(pico)} y1={y(serie[pico].v)} y2={H - PB} className="fv-drop" vectorEffect="non-scaling-stroke" />}
      {p && <line x1={x(sel)} x2={x(sel)} y1={PT - 6} y2={H - PB} className="fv-cross" vectorEffect="non-scaling-stroke" />}
      {ticks.filter((t, i, a) => a.indexOf(t) === i).map((t) => <text key={t} x={Math.min(W - 8, Math.max(8, x(t)))} y={H - 4} textAnchor="middle" className="fv-tick">{anual ? MESES[t].slice(0, 3) : t + 1}</text>)}
    </svg>
    {serie[pico].v > 0 && <span className="fv-peak" style={{ left: Math.min(78, Math.max(22, x(pico) / W * 100)) + '%', top: (y(serie[pico].v) / H * 100) + '%' }}>{corto(serie[pico].v)}</span>}
    {serie[pico].v > 0 && <span className="fv-dot peak" style={{ left: (x(pico) / W * 100) + '%', top: (y(serie[pico].v) / H * 100) + '%' }} />}
    <span className="fv-dot pulse" style={{ left: (ult[0] / W * 100) + '%', top: (ult[1] / H * 100) + '%' }} />
    {p && <span className="fv-dot" style={{ left: (x(sel) / W * 100) + '%', top: (y(p.v) / H * 100) + '%' }} />}</div>
  </div>
}

