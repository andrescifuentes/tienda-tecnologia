import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { I } from '../components/InvIcons'
import FacturaDetalle from '../components/FacturaDetalle'
import { Empty, Loader } from '../components/ui'
import { supabase, isDemoMode } from '../lib/supabase'
import { money, numFactura, limpiarBusqueda } from '../lib/format'
import { MESES, METODOS, SELECT_FACTURA, hoyYm, diaKey, tituloDia, agruparPorDia, FacturaCard, FiltrosFactura } from '../components/FacturaUI'

const PASO = 30

function Selector({ label, value, onChange, options }) {
  const actual = options.find((o) => String(o[0]) === String(value))
  return <label className="fh-sel">
    <small>{label}</small>
    <span className="fh-sel-val">{actual ? actual[1] : ''}<I n="chevDown" /></span>
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  </label>
}

export default function FacturasHistorial() {
  const navigate = useNavigate()
  const hoy = hoyYm()
  const [anio, setAnio] = useState(hoy.slice(0, 4))
  const [mes, setMes] = useState(hoy.slice(5)) // '01'..'12' | 'todos'
  const [dia, setDia] = useState('todos')
  const [q, setQ] = useState('')
  const [estado, setEstado] = useState('todas')
  const [metodo, setMetodo] = useState('todos')
  const [hoja, setHoja] = useState(false)
  const [datos, setDatos] = useState(null)
  const [limite, setLimite] = useState(PASO)
  const [ver, setVer] = useState(null)
  const [tick, setTick] = useState(0)

  useEffect(() => { setDia('todos') }, [anio, mes])
  useEffect(() => {
    let vivo = true
    setDatos(null); setLimite(PASO)
    ;(async () => {
      let ini, fin
      if (mes === 'todos') { ini = `${anio}-01-01`; fin = `${Number(anio) + 1}-01-01` }
      else if (dia === 'todos') { ini = `${anio}-${mes}-01`; const [y, m] = [Number(anio), Number(mes)]; fin = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10) }
      else { ini = `${anio}-${mes}-${dia}`; const d = new Date(`${ini}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); fin = d.toISOString().slice(0, 10) }
      const { data } = await supabase.from('facturas').select(SELECT_FACTURA + (isDemoMode ? 'perfiles(nombre)' : 'perfiles!facturas_vendedor_id_fkey(nombre)')).gte('fecha', ini + 'T00:00:00-05:00').order('fecha', { ascending: false }).limit(3000)
      const tope = new Date(fin + 'T00:00:00-05:00')
      if (vivo) setDatos((data || []).filter((f) => new Date(f.fecha) < tope))
    })()
    return () => { vivo = false }
  }, [anio, mes, dia, tick])

  const lista = useMemo(() => {
    if (!datos) return null
    const s = limpiarBusqueda(q).toLowerCase(), num = s.replace(/^[a-z]+-0*/, '')
    return datos.filter((f) => (estado === 'todas' || f.estado === estado) && (metodo === 'todos' || f.metodo_pago === metodo) && (!s ||
      (/^\d+$/.test(num) && (String(f.numero) === num || String(Math.round(f.total)).includes(num))) ||
      (f.clientes?.nombre || 'consumidor final').toLowerCase().includes(s) || numFactura(f).toLowerCase().includes(s)))
  }, [datos, q, estado, metodo])
  const total = (lista || []).filter((f) => f.estado !== 'anulada').reduce((a, f) => a + Number(f.total || 0), 0)
  const grupos = useMemo(() => agruparPorDia((lista || []).slice(0, limite)), [lista, limite])
  const activos = (estado !== 'todas') + (metodo !== 'todos')

  const anios = Array.from({ length: 6 }, (_, i) => String(Number(hoy.slice(0, 4)) - i)).map((y) => [y, y])
  const meses = [['todos', 'Todo el año'], ...MESES.map((m, i) => [String(i + 1).padStart(2, '0'), m]).filter(([v]) => `${anio}-${v}` <= hoy)]
  const nDias = mes === 'todos' ? 0 : new Date(Date.UTC(Number(anio), Number(mes), 0)).getUTCDate()
  const hoyD = diaKey(new Date())
  const dias = [['todos', 'Todos'], ...Array.from({ length: nDias }, (_, i) => String(i + 1).padStart(2, '0')).filter((d) => `${anio}-${mes}-${d}` <= hoyD).map((d) => [d, String(Number(d))])]
  const titulo = mes === 'todos' ? `Año ${anio}` : dia === 'todos' ? `${MESES[Number(mes) - 1]} ${anio}` : tituloDia(`${anio}-${mes}-${dia}`) + (anio !== hoy.slice(0, 4) ? ' ' + anio : '')

  return (
    <div className="admin-premium admin-invoices"><AppShell title="Historial" sub="Todas tus facturas" onBack={() => navigate('/facturas')}>
      <section className="fh-dates">
        <Selector label="Año" value={anio} onChange={(v) => { setAnio(v); if (`${v}-${mes}` > hoy) setMes(hoy.slice(5)) }} options={anios} />
        <Selector label="Mes" value={mes} onChange={setMes} options={meses} />
        <Selector label="Día" value={dia} onChange={setDia} options={mes === 'todos' ? [['todos', '—']] : dias} />
      </section>

      <div className="fh-strip">
        <div><small>{titulo}</small><b>{datos ? money(total) : '—'}</b></div>
        <span>{lista ? lista.length : '—'} {lista?.length === 1 ? 'factura' : 'facturas'}</span>
      </div>

      <div className="inv-search">
        <label className="inv-search-box"><I n="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Número, cliente o monto" aria-label="Buscar factura" />{q && <button type="button" className="inv-scan" aria-label="Limpiar búsqueda" onClick={() => setQ('')}>✕</button>}</label>
        <button type="button" className={'inv-filter' + (activos ? ' on' : '')} aria-label={activos ? `Filtros (${activos} activos)` : 'Filtros'} onClick={() => setHoja(true)}><I n="sliders" />{activos > 0 && <span className="inv-filter-count">{activos}</span>}</button>
      </div>
      {activos > 0 && <div className="inv-tags">
        {estado !== 'todas' && <button type="button" onClick={() => setEstado('todas')}><I n="receipt" />{estado === 'anulada' ? 'Anuladas' : 'Emitidas'}<span aria-hidden="true">✕</span></button>}
        {metodo !== 'todos' && <button type="button" onClick={() => setMetodo('todos')}><I n={METODOS.find((m) => m[0] === metodo)[2]} />{METODOS.find((m) => m[0] === metodo)[1]}<span aria-hidden="true">✕</span></button>}
        <button type="button" className="clear" onClick={() => { setEstado('todas'); setMetodo('todos') }}>Limpiar</button>
      </div>}

      {!lista ? <Loader /> : lista.length === 0 ? <Empty text="No hay facturas" description={q ? 'Prueba con otro número o nombre.' : 'No hay ventas en esta fecha.'} /> : <>
        <div className="fv-groups">
          {grupos.map((g) => <section key={g.key} className="fv-group">
            <header className="fv-day"><span>{tituloDia(g.key)}</span><i aria-hidden="true" /><small>{g.items.length} {g.items.length === 1 ? 'venta' : 'ventas'}</small><b>{money(g.total)}</b></header>
            <div className="fv-list">{g.items.map((f, i) => <FacturaCard key={f.id} f={f} index={i} onClick={() => setVer(f.id)} />)}</div>
          </section>)}
        </div>
        {lista.length > limite && <button type="button" className="inv-btn-outline fh-more" onClick={() => setLimite((l) => l + PASO)}>Ver {Math.min(PASO, lista.length - limite)} más · quedan {lista.length - limite}</button>}
      </>}
      {hoja && <FiltrosFactura datos={datos} estado={estado} setEstado={setEstado} metodo={metodo} setMetodo={setMetodo} total={lista?.length || 0} onClose={() => setHoja(false)} />}
      {ver && <FacturaDetalle id={ver} onClose={() => setVer(null)} onCambio={() => setTick((t) => t + 1)} />}
    </AppShell></div>
  )
}
