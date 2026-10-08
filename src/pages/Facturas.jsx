import { useEffect, useState } from 'react'
import AppShell from '../components/AppShell'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Icon } from '../components/Icons'
import { useAuth } from '../context/AuthContext'
import { AnimatedCard } from '../components/TechVisuals'
import FacturaDetalle from '../components/FacturaDetalle'
import { SearchBar, Empty, Loader, Badge, Chips } from '../components/ui'
import { supabase } from '../lib/supabase'
import { money, fechaHora, numFactura, limpiarBusqueda } from '../lib/format'

export default function Facturas() {
  const navigate = useNavigate()
  const { can } = useAuth()
  const [params] = useSearchParams()
  const [q, setQ] = useState(params.get('q') || '')
  const [estado, setEstado] = useState('todas')
  const [lista, setLista] = useState(null)
  const [ver, setVer] = useState(params.get('factura')?Number(params.get('factura')):null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const t = setTimeout(async () => {
      let qq = supabase.from('facturas').select('id,prefijo,numero,total,estado,fecha,clientes(nombre),perfiles(nombre)').order('fecha', { ascending: false }).limit(60)
      if (estado !== 'todas') qq = qq.eq('estado', estado)
      const s = limpiarBusqueda(q).replace(/^[A-Za-z]+-0*/, '')
      if (/^\d+$/.test(s)) qq = qq.or(`numero.eq.${Number(s)},total.eq.${Number(s)}`)
      else if (s) {
        const { data: cl } = await supabase.from('clientes').select('id').or(`nombre.ilike.%${s}%,documento.ilike.%${s}%`).limit(50)
        const ids = (cl || []).map((c) => c.id)
        if (ids.length === 0) return setLista([])
        qq = qq.in('cliente_id', ids)
      }
      const { data } = await qq
      setLista(data || [])
    }, 250)
    return () => clearTimeout(t)
  }, [q, estado, tick])

  return (
    <AppShell title="Facturas" sub="Tus ventas, en un solo lugar">
      {can('vender') && <button className="btn full mb-3" onClick={() => navigate('/vender')}>+ Nueva factura <Icon name="arrow" className="w-4 h-4" /></button>}
      <SearchBar value={q} onChange={setQ} placeholder="Número, cliente o monto" />
      <Chips value={estado} onChange={setEstado} options={[{ value: 'todas', label: 'Todas' }, { value: 'emitida', label: 'Emitidas' }, { value: 'anulada', label: 'Anuladas' }]} />
      {!lista ? <Loader /> : lista.length === 0 ? <Empty text="No hay facturas" /> : (
        <div className="invoice-list">
          {lista.map((f, index) => (
            <AnimatedCard as="button" type="button" index={index} key={f.id} className="row invoice-card" onClick={() => setVer(f.id)}>
              <span className="invoice-symbol"><Icon name="doc" /></span>
              <div className="flex-1 min-w-0"><p className="m-0 text-sm font-semibold">{numFactura(f)}</p><p className="invoice-customer">{f.clientes?.nombre || 'Consumidor final'}</p><p className="m-0 text-xs text-muted">{fechaHora(f.fecha)} · {f.perfiles?.nombre}</p></div>
              <div className="text-right"><p className="m-0 text-sm font-bold">{money(f.total)}</p><div><Badge tone={f.estado === 'anulada' ? 'bad' : f.estado === 'pendiente' ? 'warn' : 'good'}>{f.estado === 'anulada' ? 'Anulada' : f.estado === 'pendiente' ? 'Pendiente' : 'Emitida'}</Badge></div></div>
            </AnimatedCard>
          ))}
        </div>
      )}
      {ver && <FacturaDetalle id={ver} onClose={() => setVer(null)} onCambio={() => setTick((t) => t + 1)} />}
    </AppShell>
  )
}
