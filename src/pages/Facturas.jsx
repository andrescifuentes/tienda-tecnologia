import { useEffect, useState } from 'react'
import AppShell from '../components/AppShell'
import FacturaDetalle from '../components/FacturaDetalle'
import { SearchBar, Empty, Loader, Badge, Chips } from '../components/ui'
import { supabase } from '../lib/supabase'
import { money, fechaHora, numFactura, limpiarBusqueda } from '../lib/format'

export default function Facturas() {
  const [q, setQ] = useState('')
  const [estado, setEstado] = useState('todas')
  const [lista, setLista] = useState(null)
  const [ver, setVer] = useState(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const t = setTimeout(async () => {
      let qq = supabase.from('facturas').select('id,prefijo,numero,total,estado,fecha,clientes(nombre),perfiles(nombre)').order('fecha', { ascending: false }).limit(60)
      if (estado !== 'todas') qq = qq.eq('estado', estado)
      const s = limpiarBusqueda(q)
      if (/^\d+$/.test(s)) qq = qq.eq('numero', Number(s))
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
    <AppShell title="Facturas" sub="Emitidas y anuladas">
      <SearchBar value={q} onChange={setQ} placeholder="Número, cliente o documento" />
      <Chips value={estado} onChange={setEstado} options={[{ value: 'todas', label: 'Todas' }, { value: 'emitida', label: 'Emitidas' }, { value: 'anulada', label: 'Anuladas' }]} />
      {!lista ? <Loader /> : lista.length === 0 ? <Empty text="No hay facturas" /> : (
        <div className="card !p-2">
          {lista.map((f) => (
            <div key={f.id} className="row cursor-pointer" onClick={() => setVer(f.id)}>
              <div className="flex-1 min-w-0"><p className="m-0 text-sm font-semibold">{numFactura(f)} · {f.clientes?.nombre || 'Consumidor final'}</p><p className="m-0 text-xs text-muted">{fechaHora(f.fecha)} · {f.perfiles?.nombre}</p></div>
              <div className="text-right"><p className="m-0 text-sm font-bold">{money(f.total)}</p>{f.estado === 'anulada' && <Badge tone="bad">Anulada</Badge>}</div>
            </div>
          ))}
        </div>
      )}
      {ver && <FacturaDetalle id={ver} onClose={() => setVer(null)} onCambio={() => setTick((t) => t + 1)} />}
    </AppShell>
  )
}
