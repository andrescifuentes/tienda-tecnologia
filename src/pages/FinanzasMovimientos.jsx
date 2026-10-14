import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppShell from '../components/AppShell'
import CompraDetalle from '../components/CompraDetalle'
import { I } from '../components/InvIcons'
import { Empty, Loader } from '../components/ui'
import { supabase } from '../lib/supabase'
import { money, fecha, numFactura } from '../lib/format'

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const hoyISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })

function Selector({ label, value, onChange, options }) {
  const actual = options.find((o) => String(o[0]) === String(value))
  return <label className="fh-sel">
    <small>{label}</small>
    <span className="fh-sel-val">{actual ? actual[1] : ''}<I n="chevDown" /></span>
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
  </label>
}

export default function FinanzasMovimientos() {
  const navigate = useNavigate()
  const hoy = hoyISO()
  const [anio, setAnio] = useState(hoy.slice(0, 4))
  const [mes, setMes] = useState(hoy.slice(5, 7))
  const [dia, setDia] = useState('todos')
  const [tipo, setTipo] = useState('todos')
  const [datos, setDatos] = useState(null)
  const [verCompra, setVerCompra] = useState(null)
  useEffect(() => { setDia('todos') }, [anio, mes])

  useEffect(() => {
    let vivo = true
    setDatos(null)
    let ini, fin
    if (mes === 'todos') { ini = `${anio}-01-01`; fin = `${anio}-12-31` }
    else if (dia === 'todos') { ini = `${anio}-${mes}-01`; fin = new Date(Date.UTC(Number(anio), Number(mes), 0)).toISOString().slice(0, 10) }
    else { ini = fin = `${anio}-${mes}-${dia}` }
    ;(async () => {
      const finSig = new Date(fin + 'T12:00:00Z'); finSig.setUTCDate(finSig.getUTCDate() + 1)
      const [m, c, f] = await Promise.all([
        supabase.from('movimientos').select('*').gte('fecha', ini).lte('fecha', fin).order('fecha', { ascending: false }),
        supabase.from('compras').select('id,fecha,total,numero_documento,forma_pago,estado,proveedores(nombre)').eq('estado', 'recibida').gte('fecha', ini).lte('fecha', fin),
        supabase.from('facturas').select('id,prefijo,numero,total,fecha,estado,clientes(nombre)').eq('estado', 'emitida').gte('fecha', ini + 'T00:00:00-05:00').lt('fecha', finSig.toISOString().slice(0, 10) + 'T00:00:00-05:00'),
      ])
      if (!vivo) return
      const manuales = (m.data || []).filter((x) => !x.origen)
      const compras = (c.data || []).map((x) => ({ id: 'c' + x.id, compraId: x.id, tipo: 'gasto', categoria: 'Compra de mercancía', descripcion: [x.proveedores?.nombre, x.numero_documento, x.forma_pago === 'credito' ? 'a crédito' : null].filter(Boolean).join(' · '), monto: x.total, fecha: x.fecha, origen: 'compra' }))
      // Ventas netas: se descuenta lo devuelto para que coincida con Inicio y Finanzas
      const ids = (f.data || []).map((x) => x.id)
      const dv = ids.length ? await supabase.from('devoluciones').select('factura_id,total_devuelto').in('factura_id', ids) : { data: [] }
      if (!vivo) return
      const devuelto = {}
      for (const d of dv.data || []) devuelto[d.factura_id] = (devuelto[d.factura_id] || 0) + Number(d.total_devuelto || 0)
      const ventas = (f.data || []).filter((x) => Number(x.total) - (devuelto[x.id] || 0) > 0).map((x) => ({ id: 'f' + x.id, tipo: 'ingreso', categoria: 'Venta ' + numFactura(x) + (devuelto[x.id] ? ' · con devolución' : ''), descripcion: x.clientes?.nombre || 'Consumidor final', monto: Number(x.total) - (devuelto[x.id] || 0), fecha: new Date(x.fecha).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }), origen: 'venta' }))
      setDatos([...manuales, ...compras, ...ventas].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))))
    })()
    return () => { vivo = false }
  }, [anio, mes, dia])

  const lista = useMemo(() => (datos || []).filter((m) => tipo === 'todos' || m.tipo === tipo), [datos, tipo])
  const ing = (datos || []).filter((m) => m.tipo === 'ingreso').reduce((a, m) => a + Number(m.monto), 0)
  const gas = (datos || []).filter((m) => m.tipo === 'gasto').reduce((a, m) => a + Number(m.monto), 0)

  const anios = Array.from({ length: 6 }, (_, i) => String(Number(hoy.slice(0, 4)) - i)).map((y) => [y, y])
  const meses = [['todos', 'Todo el año'], ...MESES.map((m, i) => [String(i + 1).padStart(2, '0'), m]).filter(([v]) => `${anio}-${v}` <= hoy.slice(0, 7))]
  const nDias = mes === 'todos' ? 0 : new Date(Date.UTC(Number(anio), Number(mes), 0)).getUTCDate()
  const dias = [['todos', 'Todos'], ...Array.from({ length: nDias }, (_, i) => String(i + 1).padStart(2, '0')).filter((d) => `${anio}-${mes}-${d}` <= hoy).map((d) => [d, String(Number(d))])]
  const titulo = mes === 'todos' ? `Año ${anio}` : dia === 'todos' ? `${MESES[Number(mes) - 1]} ${anio}` : `${Number(dia)} de ${MESES[Number(mes) - 1].toLowerCase()} ${anio}`

  return (
    <AppShell title="Movimientos" sub="Ingresos y gastos" onBack={() => navigate('/finanzas')}>
      <section className="fh-dates">
        <Selector label="Año" value={anio} onChange={(v) => { setAnio(v); if (mes !== 'todos' && `${v}-${mes}` > hoy.slice(0, 7)) setMes(hoy.slice(5, 7)) }} options={anios} />
        <Selector label="Mes" value={mes} onChange={setMes} options={meses} />
        <Selector label="Día" value={dia} onChange={setDia} options={mes === 'todos' ? [['todos', '—']] : dias} />
      </section>
      <div className="fm-sum">
        <small>{titulo}</small>
        <div><span className="in">Ingresos<b>+{money(ing)}</b></span><span className="out">Gastos<b>−{money(gas)}</b></span><span className={'net' + (ing - gas < 0 ? ' neg' : '')}>Neto<b>{ing - gas < 0 ? '−' : ''}{money(Math.abs(ing - gas))}</b></span></div>
      </div>
      <div className="fv-seg2 fm-seg" role="tablist" style={{ '--i': ['todos', 'ingreso', 'gasto'].indexOf(tipo) }}>
        <span className="fv-seg2-thumb" aria-hidden="true" />
        {[['todos', 'Todos'], ['ingreso', 'Ingresos'], ['gasto', 'Gastos']].map(([v, l]) => <button key={v} type="button" className={tipo === v ? 'on' : ''} onClick={() => setTipo(v)}>{l}<em>{(datos || []).filter((m) => v === 'todos' || m.tipo === v).length}</em></button>)}
      </div>
      {!datos ? <Loader /> : lista.length === 0 ? <Empty text="Sin movimientos" description="No hay ingresos ni gastos en esta fecha." /> : <div className="finance-movements">
        {lista.map((m) => <div key={m.id} className={'row finance-movement ' + m.tipo + (m.origen === 'compra' ? ' clickable' : '')} role={m.origen === 'compra' ? 'button' : undefined} onClick={m.origen === 'compra' ? () => setVerCompra(m.compraId) : undefined}>
          <span className="movement-symbol" aria-hidden="true">{m.tipo === 'ingreso' ? '↗' : '↙'}</span>
          <div className="flex-1 movement-main"><p className="m-0 text-sm font-semibold">{m.categoria}</p><p className="m-0 text-xs text-muted">{fecha(m.fecha)}{m.descripcion ? ' · ' + m.descripcion : ''}</p></div>
          <div className="movement-value"><small>{m.origen === 'compra' ? <span className="mv-more">Ver detalle ›</span> : m.origen === 'venta' ? 'Factura' : 'Manual'}</small><b className={m.tipo === 'ingreso' ? 'text-good' : 'text-bad'}>{m.tipo === 'ingreso' ? '+' : '−'}{money(m.monto)}</b></div>
        </div>)}
      </div>}
      {verCompra && <CompraDetalle id={verCompra} onClose={() => setVerCompra(null)} />}
    </AppShell>
  )
}
