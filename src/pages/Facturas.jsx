import { useEffect, useState } from 'react'
import AppShell from '../components/AppShell'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Icon } from '../components/Icons'
import { useAuth } from '../context/AuthContext'
import { AnimatedCard } from '../components/TechVisuals'
import FacturaDetalle from '../components/FacturaDetalle'
import { SearchBar, Empty, Loader, Badge, Chips } from '../components/ui'
import { supabase, isDemoMode } from '../lib/supabase'
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
      let qq = supabase.from('facturas').select(isDemoMode ? 'id,prefijo,numero,total,estado,fecha,clientes(nombre),perfiles(nombre)' : 'id,prefijo,numero,total,estado,fecha,clientes(nombre),perfiles!facturas_vendedor_id_fkey(nombre)').order('fecha', { ascending: false }).limit(60)
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
    <div className="admin-premium admin-invoices"><AppShell title="Facturas" sub="Tus ventas, en un solo lugar">
      {can('vender') && <button className="btn full mb-3" onClick={() => navigate('/vender')}>+ Nueva factura <Icon name="arrow" className="w-4 h-4" /></button>}
      <SearchBar value={q} onChange={setQ} placeholder="Número, cliente o monto" />
      <Chips value={estado} onChange={setEstado} options={[{ value: 'todas', label: 'Todas' }, { value: 'emitida', label: 'Emitidas' }, { value: 'anulada', label: 'Anuladas' }]} />
      {!lista ? <Loader /> : lista.length === 0 ? <Empty text="No hay facturas" /> : (
        <div className="invoice-list">
          {lista.map((f, index) => (
            <AnimatedCard as="button" type="button" index={index} key={f.id} className="row invoice-card" onClick={() => setVer(f.id)}>
              <div className="invoice-main"><strong>{numFactura(f)}</strong><p className="invoice-customer">{f.clientes?.nombre || 'Consumidor final'}</p><p className="invoice-meta">{fechaHora(f.fecha)}</p><div className="invoice-seller">{f.perfiles?.nombre || 'Vendedor'}</div></div>
              <div className="invoice-side"><b className="invoice-amount">{money(f.total)}</b><Badge tone={f.estado === 'anulada' ? 'bad' : f.estado === 'pendiente' ? 'warn' : 'good'}>{f.estado === 'anulada' ? 'Anulada' : f.estado === 'pendiente' ? 'Pendiente' : 'Emitida'}</Badge><span className="invoice-chevron" aria-hidden="true">›</span></div>
            </AnimatedCard>
          ))}
        </div>
      )}
      {ver && <FacturaDetalle id={ver} onClose={() => setVer(null)} onCambio={() => setTick((t) => t + 1)} />}
    </AppShell></div>
  )
}
