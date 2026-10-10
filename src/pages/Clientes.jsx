import { useEffect, useMemo, useState } from 'react'
import AppShell, { ThemeToggle } from '../components/AppShell'
import { useSearchParams } from 'react-router-dom'
import FullPage from '../components/FullPage'
import FacturaDetalle from '../components/FacturaDetalle'
import RecordStatus from '../components/RecordStatus'
import { ClienteForm } from '../components/ClientePicker'
import { AnimatedCard, Brand } from '../components/TechVisuals'
import { I } from '../components/InvIcons'
import { Empty, Loader } from '../components/ui'
import Modal from '../components/Modal'
import { supabase, isDemoMode } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { money, numFactura, limpiarBusqueda } from '../lib/format'
import { enlaceWhatsApp } from '../lib/whatsapp'

const TZ = 'America/Bogota'
const iniciales = (n) => String(n || '').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase()
const fechaCorta = (iso) => iso ? new Date(iso).toLocaleDateString('es-CO', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }).replace('.', '') : ''
const hora = (iso) => new Date(iso).toLocaleTimeString('es-CO', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).replace(/ /g, ' ')
const ymActual = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ }).slice(0, 7)
const ymDe = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ }).slice(0, 7)
const telBonito = (t) => { const d = String(t || '').replace(/\D/g, ''); return d.length === 10 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : t }

const GRUPOS = [['todos', 'Todos los clientes', 'users', ''], ['vip', 'VIP', 'tag', '5+ compras'], ['frecuentes', 'Frecuentes', 'history', '2+ compras'], ['sin', 'Sin compras', 'user', '']]
const ORDENES = [['nombre', 'Nombre A–Z', 'user'], ['total', 'Mayor compra', 'tag'], ['reciente', 'Compra más reciente', 'history']]
function pasa(k, n) { return k === 'todos' || (k === 'vip' && n >= 5) || (k === 'frecuentes' && n >= 2) || (k === 'sin' && n === 0) }

function nivel(st) {
  if (!st?.count) return null
  if (st.count >= 5) return { key: 'vip', label: 'VIP' }
  if (st.count >= 2) return { key: 'frec', label: 'Frecuente' }
  return null
}

export default function Clientes() {
  const { can } = useAuth()
  const [params] = useSearchParams()
  const [q, setQ] = useState(params.get('q') || '')
  const [filtro, setFiltro] = useState('todos')
  const [orden, setOrden] = useState('nombre')
  const [hoja, setHoja] = useState(false)
  const [totales, setTotales] = useState({})
  const [lista, setLista] = useState(null)
  const [form, setForm] = useState(null)
  const [ficha, setFicha] = useState(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    supabase.from(isDemoMode ? 'facturas_netas' : 'facturas').select('*').eq('estado', 'emitida').then(({ data }) => {
      const stats = {}
      for (const f of data || []) {
        if (!f.cliente_id) continue
        const v = stats[f.cliente_id] ||= { count: 0, total: 0, last: null, mes: false }
        v.count++; v.total += Number(f.total_neto ?? f.total)
        if (!v.last || f.fecha > v.last) v.last = f.fecha
        if (ymDe(f.fecha) === ymActual()) v.mes = true
      }
      setTotales(stats)
    })
  }, [tick])

  useEffect(() => {
    const t = setTimeout(async () => {
      const s = limpiarBusqueda(q)
      let qq = supabase.from('clientes').select('*').order('nombre').limit(200)
      if (s) qq = qq.or(`nombre.ilike.%${s}%,documento.ilike.%${s}%,telefono.ilike.%${s}%,correo.ilike.%${s}%`)
      const { data } = await qq
      setLista(data || [])
    }, 250)
    return () => clearTimeout(t)
  }, [q, tick])

  const cuenta = (k) => (lista || []).filter((c) => pasa(k, totales[c.id]?.count || 0)).length
  const visibles = useMemo(() => {
    if (!lista) return null
    const r = lista.filter((c) => pasa(filtro, totales[c.id]?.count || 0))
    if (orden === 'total') r.sort((a, b) => (totales[b.id]?.total || 0) - (totales[a.id]?.total || 0))
    if (orden === 'reciente') r.sort((a, b) => String(totales[b.id]?.last || '').localeCompare(String(totales[a.id]?.last || '')))
    return r
  }, [lista, filtro, orden, totales])
  const activos = (filtro !== 'todos') + (orden !== 'nombre')

  const header = <div className="inv-head">
    <div className="inv-head-top"><Brand compact /><ThemeToggle /></div>
    <div className="inv-head-title"><div><h1>Clientes</h1><p>Tu cartera, siempre a la mano</p></div>{can('crear_clientes') && <button type="button" className="inv-add" onClick={() => setForm({})}><I n="plus" />Nuevo</button>}</div>
  </div>

  return (
    <AppShell title="Clientes" header={header}>
      <div className="inv-search">
        <label className="inv-search-box"><I n="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, documento, teléfono o correo" aria-label="Buscar cliente" />{q && <button type="button" className="inv-scan" aria-label="Limpiar búsqueda" onClick={() => setQ('')}>✕</button>}</label>
        <button type="button" className={'inv-filter' + (activos ? ' on' : '')} aria-label={activos ? `Filtros (${activos} activos)` : 'Filtros'} onClick={() => setHoja(true)}><I n="sliders" />{activos > 0 && <span className="inv-filter-count">{activos}</span>}</button>
      </div>
      {activos > 0 && <div className="inv-tags">
        {filtro !== 'todos' && <button type="button" onClick={() => setFiltro('todos')}><I n={GRUPOS.find((g) => g[0] === filtro)[2]} />{GRUPOS.find((g) => g[0] === filtro)[1]}<span aria-hidden="true">✕</span></button>}
        {orden !== 'nombre' && <button type="button" onClick={() => setOrden('nombre')}><I n="sliders" />{ORDENES.find((o) => o[0] === orden)[1]}<span aria-hidden="true">✕</span></button>}
        <button type="button" className="clear" onClick={() => { setFiltro('todos'); setOrden('nombre') }}>Limpiar</button>
      </div>}
      {hoja && <Modal title="Filtros" className="flt-sheet" onClose={() => setHoja(false)} footer={<div className="inv-sheet-foot"><button type="button" className="inv-btn-outline" onClick={() => { setFiltro('todos'); setOrden('nombre') }}>Limpiar</button><button type="button" className="inv-btn-gold" onClick={() => setHoja(false)}>Ver {visibles?.length || 0} {visibles?.length === 1 ? 'cliente' : 'clientes'}</button></div>}>
        <p className="inv-sheet-label">Mostrar</p>
        <div className="flt-list">
          {GRUPOS.map(([k, l, ic, d]) => { const n = cuenta(k); return <button key={k} type="button" className={filtro === k ? 'on' : ''} aria-pressed={filtro === k} onClick={() => setFiltro(k)}>
            <span className="flt-row-ic"><I n={ic} /></span>
            <span className="flt-row-name">{l}{d && <small className="flt-row-sub">{d}</small>}</span>
            <span className="flt-row-n">{n}</span>
            <span className="flt-row-check">{filtro === k && <I n="check" />}</span>
          </button> })}
        </div>
        <p className="inv-sheet-label flt-gap">Ordenar por</p>
        <div className="flt-list">
          {ORDENES.map(([k, l, ic]) => <button key={k} type="button" className={orden === k ? 'on' : ''} aria-pressed={orden === k} onClick={() => setOrden(k)}>
            <span className="flt-row-ic"><I n={ic} /></span>
            <span className="flt-row-name">{l}</span>
            <span className="flt-row-check">{orden === k && <I n="check" />}</span>
          </button>)}
        </div>
      </Modal>}

      {!visibles ? <Loader /> : visibles.length === 0 ? <Empty text="No hay clientes para mostrar" description={q ? 'Prueba con otro nombre, documento o teléfono.' : 'Registra un cliente para relacionar sus compras.'} action={can('crear_clientes') ? () => setForm({}) : undefined} actionLabel="+ Crear cliente" /> : (
        <div className="fv-list">
          {visibles.map((c, index) => {
            const st = totales[c.id], nv = nivel(st)
            return (
              <AnimatedCard as="button" type="button" index={index} key={c.id} className={'fv-card cl-card' + (c.activo === false ? ' void' : '')} onClick={() => setFicha(c)}>
                <span className={'fv-avatar' + (nv?.key === 'vip' ? ' vip' : '')} aria-hidden="true">{iniciales(c.nombre)}</span>
                <span className="fv-main">
                  <span className="fv-name">{c.nombre}</span>
                  <span className="cl-line"><I n="phone" />{c.telefono ? telBonito(c.telefono) : 'Sin teléfono'}</span>
                  <span className="cl-meta">{nv && <em className={'cl-tier ' + nv.key}>{nv.label}</em>}{c.activo === false && <em className="cl-tier off">Inactivo</em>}<span>{st?.count ? fechaCorta(st.last).replace(/ de \d{4}$/, '').replace(' de ', ' ') : 'Aún sin compras'}</span></span>
                </span>
                <span className="fv-side">
                  <b className={'fv-amount' + (st?.total ? ' gold' : ' zero')}>{money(st?.total || 0)}</b>
                  <span className="cl-count">{st?.count ? `${st.count} ${st.count === 1 ? 'compra' : 'compras'}` : '—'}</span>
                </span>
              </AnimatedCard>
            )
          })}
        </div>
      )}
      {form && <ClienteForm inicial={form.id ? form : null} onClose={() => setForm(null)} onSaved={() => { setForm(null); setFicha(null); setLista(null); setTick((t) => t + 1) }} />}
      {ficha && !form && <Ficha c={ficha} st={totales[ficha.id]} onClose={() => { setFicha(null); setTick((t) => t + 1) }} onEditar={() => setForm(ficha)} puedeEditar={can('crear_clientes')} />}
    </AppShell>
  )
}

function Ficha({ c, st, onClose, onEditar, puedeEditar }) {
  const [fac, setFac] = useState(null)
  const [ver, setVer] = useState(null)
  const cargar = () => supabase.from(isDemoMode ? 'facturas_netas' : 'facturas').select('*').eq('cliente_id', c.id).order('fecha', { ascending: false }).then(({ data }) => setFac(data || []))
  useEffect(() => { cargar() }, [c.id]) // eslint-disable-line
  const vigentes = (fac || []).filter((f) => f.estado === 'emitida')
  const total = vigentes.reduce((n, f) => n + Number(f.total_neto ?? f.total), 0)
  const nv = nivel({ count: vigentes.length })
  const tel = String(c.telefono || '').replace(/\D/g, '')
  const datos = [
    ['idcard', 'Documento', [c.tipo_documento, c.documento].filter(Boolean).join(' ')],
    ['phone', 'Teléfono', c.telefono ? telBonito(c.telefono) : ''],
    ['mail', 'Correo', c.correo],
    ['pin', 'Dirección', [c.direccion, c.ciudad].filter(Boolean).join(' · ')],
  ]

  return <FullPage title="Cliente" onBack={onClose} className="cl-detail"
    footer={puedeEditar && <button type="button" className="inv-add full" onClick={onEditar}><I n="pencil" />Editar cliente</button>}>
    <section className="cl-hero">
      <span className={'cl-hero-avatar' + (nv?.key === 'vip' ? ' vip' : '')}>{iniciales(c.nombre)}</span>
      <h2>{c.nombre}</h2>
      <p>{nv ? <em className={'cl-tier ' + nv.key}>{nv.label}</em> : null}{c.activo === false ? <em className="cl-tier off">Inactivo</em> : null}<span>{vigentes.length ? `Cliente desde ${fechaCorta(vigentes[vigentes.length - 1].fecha)}` : 'Aún sin compras'}</span></p>
      <div className="cl-actions">
        <a className={'cl-act' + (tel ? '' : ' off')} href={tel ? 'tel:' + tel : undefined} aria-disabled={!tel}><I n="phone" /><span>Llamar</span></a>
        <a className={'cl-act' + (tel ? '' : ' off')} href={tel ? enlaceWhatsApp(tel, `Hola ${String(c.nombre).split(' ')[0]}, te saludamos de ANGIE TECH.`) : undefined} target="_blank" rel="noreferrer" aria-disabled={!tel}><I n="chat" /><span>WhatsApp</span></a>
        <a className={'cl-act' + (c.correo ? '' : ' off')} href={c.correo ? 'mailto:' + c.correo : undefined} aria-disabled={!c.correo}><I n="mail" /><span>Correo</span></a>
      </div>
    </section>

    <section className="cl-tiles">
      <div className="cl-tile big"><span>Total comprado</span><b>{fac ? money(total) : '—'}</b></div>
      <div className="cl-tile"><span>Compras</span><b>{fac ? vigentes.length : '—'}</b></div>
      <div className="cl-tile"><span>Ticket promedio</span><b>{fac ? money(vigentes.length ? total / vigentes.length : 0) : '—'}</b></div>
    </section>

    <h3 className="cl-section">Información</h3>
    <section className="cl-info">
      {datos.map(([ic, l, v]) => <div key={l}><span className="cl-info-ic"><I n={ic} /></span><span className="cl-info-txt"><small>{l}</small><b className={v ? '' : 'empty'}>{v || 'No registrado'}</b></span></div>)}
      {c.notas && <div><span className="cl-info-ic"><I n="pencil" /></span><span className="cl-info-txt"><small>Notas</small><b>{c.notas}</b></span></div>}
    </section>
    {isDemoMode && puedeEditar && <RecordStatus table="clientes" record={c} onSaved={onClose} />}

    <h3 className="cl-section">Historial de compras {fac?.length ? <span>{fac.length}</span> : null}</h3>
    {!fac ? <Loader /> : fac.length === 0 ? <p className="cl-empty">Este cliente todavía no tiene compras.</p> : <div className="fv-list">
      {fac.map((f) => {
        const anulada = f.estado === 'anulada'
        return <button key={f.id} type="button" className={'fv-card' + (anulada ? ' void' : '')} onClick={() => setVer(f.id)}>
          <span className="fv-avatar walkin" aria-hidden="true"><I n="receipt" /></span>
          <span className="fv-main"><span className="fv-name">{numFactura(f)}</span><span className="fv-seller">{fechaCorta(f.fecha)} · {hora(f.fecha)}</span></span>
          <span className="fv-side"><b className="fv-amount">{money(f.total)}</b><span className={'fv-status ' + (anulada ? 'bad' : 'good')}>{anulada ? 'Anulada' : 'Emitida'}</span></span>
        </button>
      })}
    </div>}
    {ver && <FacturaDetalle id={ver} onClose={() => setVer(null)} onCambio={cargar} />}
  </FullPage>
}
