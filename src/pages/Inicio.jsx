import { useEffect, useState } from 'react'
import AppShell from '../components/AppShell'
import { Stat, Loader, ErrorBox, Empty, Badge } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { money, hoyBogota, rangoMes, fechaHora, numFactura, mensajeError } from '../lib/format'

export default function Inicio() {
  const { esAdmin, can, perfil } = useAuth()
  return (esAdmin || can('ver_finanzas')) ? <DashboardAdmin /> : <MisVentas perfil={perfil} />
}

function DashboardAdmin() {
  const [d, setD] = useState(null)
  const [bajo, setBajo] = useState([])
  const [emp, setEmp] = useState([])
  const [rec, setRec] = useState([])
  const [err, setErr] = useState('')

  useEffect(() => {
    const m = rangoMes()
    ;(async () => {
      const [r, b, e, f] = await Promise.all([
        supabase.rpc('resumen_dashboard'),
        supabase.from('stock_bajo').select('*').order('stock').limit(8),
        supabase.rpc('ventas_por_empleado', { p_desde: m.ini, p_hasta: m.fin }),
        supabase.from('facturas').select('id,prefijo,numero,total,estado,fecha,perfiles(nombre)').order('fecha', { ascending: false }).limit(6),
      ])
      if (r.error) return setErr(mensajeError(r.error))
      setD(r.data?.[0] || r.data)
      setBajo(b.data || []); setEmp(e.data || []); setRec(f.data || [])
    })()
  }, [])

  return (
    <AppShell title="Dashboard" sub={new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}>
      <ErrorBox text={err} />
      {!d && !err ? <Loader /> : d && (
        <>
          <div className="grid grid-cols-2 gap-2.5 mb-3">
            <Stat label="Ventas de hoy" value={money(d.ventas_hoy)} sub={`${d.facturas_hoy} facturas`} />
            <Stat label="Ventas del mes" value={money(d.ventas_mes)} sub={`${d.facturas_mes} facturas`} />
            <Stat label="Ingresos del mes" value={money(d.ingresos_mes)} />
            <Stat label="Gastos del mes" value={money(d.gastos_mes)} tone="bad" />
            <Stat label="Utilidad del mes" value={money(d.utilidad_mes)} tone={d.utilidad_mes >= 0 ? 'good' : 'bad'} />
            <Stat label="Valor inventario" value={money(d.valor_inventario)} sub={`${d.productos_stock_bajo} con stock bajo`} tone={d.productos_stock_bajo > 0 ? 'warn' : ''} />
          </div>

          <h2 className="text-sm font-bold text-muted uppercase tracking-wide mb-2">Ventas por empleado (mes)</h2>
          <div className="card mb-3">
            {emp.length === 0 ? <Empty text="Sin ventas este mes" /> : emp.map((e) => (
              <div key={e.vendedor_id} className="row">
                <div className="flex-1"><p className="m-0 font-semibold text-sm">{e.nombre}</p><p className="m-0 text-xs text-muted">{e.facturas} facturas</p></div>
                <div className="text-right"><p className="m-0 font-bold text-sm">{money(e.total_vendido)}</p>{e.comision > 0 && <p className="m-0 text-xs text-muted">Comisión {money(e.comision)}</p>}</div>
              </div>
            ))}
          </div>

          <h2 className="text-sm font-bold text-muted uppercase tracking-wide mb-2">Stock bajo</h2>
          <div className="card mb-3">
            {bajo.length === 0 ? <Empty text="Todo el inventario está en orden" /> : bajo.map((p) => (
              <div key={p.id} className="row"><div className="flex-1"><p className="m-0 text-sm font-semibold">{p.nombre}</p><p className="m-0 text-xs text-muted">{p.codigo}</p></div><Badge tone={p.stock === 0 ? 'bad' : 'warn'}>{p.stock} / mín {p.stock_min}</Badge></div>
            ))}
          </div>

          <h2 className="text-sm font-bold text-muted uppercase tracking-wide mb-2">Últimas facturas</h2>
          <div className="card">
            {rec.length === 0 ? <Empty text="Aún no hay facturas" /> : rec.map((f) => (
              <div key={f.id} className="row"><div className="flex-1"><p className="m-0 text-sm font-semibold">{numFactura(f)}</p><p className="m-0 text-xs text-muted">{fechaHora(f.fecha)} · {f.perfiles?.nombre}</p></div><div className="text-right"><p className="m-0 font-bold text-sm">{money(f.total)}</p>{f.estado === 'anulada' && <Badge tone="bad">Anulada</Badge>}</div></div>
            ))}
          </div>
        </>
      )}
    </AppShell>
  )
}

function MisVentas({ perfil }) {
  const [hoy, setHoy] = useState(null)
  const [mes, setMes] = useState(null)
  const [lista, setLista] = useState([])
  const [err, setErr] = useState('')

  useEffect(() => {
    const m = rangoMes(); const h = hoyBogota()
    ;(async () => {
      const [a, b, c] = await Promise.all([
        supabase.rpc('ventas_por_empleado', { p_desde: h, p_hasta: h }),
        supabase.rpc('ventas_por_empleado', { p_desde: m.ini, p_hasta: m.fin }),
        supabase.from('facturas').select('id,prefijo,numero,total,estado,fecha').eq('vendedor_id', perfil.id).order('fecha', { ascending: false }).limit(15),
      ])
      if (a.error) return setErr(mensajeError(a.error))
      setHoy(a.data?.[0] || { facturas: 0, total_vendido: 0, comision: 0 })
      setMes(b.data?.[0] || { facturas: 0, total_vendido: 0, comision: 0 })
      setLista(c.data || [])
    })()
  }, [perfil.id])

  const tieneCom = perfil.comision_pct != null

  return (
    <AppShell title={`Hola, ${perfil.nombre.split(' ')[0]}`} sub="Mis ventas">
      <ErrorBox text={err} />
      {!hoy && !err ? <Loader /> : hoy && (
        <>
          <div className="grid grid-cols-2 gap-2.5 mb-3">
            <Stat label="Vendido hoy" value={money(hoy.total_vendido)} sub={`${hoy.facturas} facturas`} />
            <Stat label="Vendido en el mes" value={money(mes.total_vendido)} sub={`${mes.facturas} facturas`} />
            {tieneCom && <Stat label="Comisión hoy" value={money(hoy.comision)} tone="good" />}
            {tieneCom && <Stat label="Comisión del mes" value={money(mes.comision)} tone="good" sub={`${perfil.comision_pct}%`} />}
          </div>
          <h2 className="text-sm font-bold text-muted uppercase tracking-wide mb-2">Mis últimas facturas</h2>
          <div className="card">
            {lista.length === 0 ? <Empty text="Aún no has vendido" /> : lista.map((f) => (
              <div key={f.id} className="row"><div className="flex-1"><p className="m-0 text-sm font-semibold">{numFactura(f)}</p><p className="m-0 text-xs text-muted">{fechaHora(f.fecha)}</p></div><div className="text-right"><p className="m-0 font-bold text-sm">{money(f.total)}</p>{f.estado === 'anulada' && <Badge tone="bad">Anulada</Badge>}</div></div>
            ))}
          </div>
        </>
      )}
    </AppShell>
  )
}
