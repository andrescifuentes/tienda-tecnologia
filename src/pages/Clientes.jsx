import { useEffect, useState } from 'react'
import AppShell from '../components/AppShell'
import Modal from '../components/Modal'
import FacturaDetalle from '../components/FacturaDetalle'
import { ClienteForm } from '../components/ClientePicker'
import { SearchBar, Empty, Loader, Badge } from '../components/ui'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { money, fechaHora, numFactura, limpiarBusqueda } from '../lib/format'

export default function Clientes() {
  const { can } = useAuth()
  const [q, setQ] = useState('')
  const [lista, setLista] = useState(null)
  const [form, setForm] = useState(null)
  const [ficha, setFicha] = useState(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const t = setTimeout(async () => {
      const s = limpiarBusqueda(q)
      let qq = supabase.from('clientes').select('*').order('nombre').limit(60)
      if (s) qq = qq.or(`nombre.ilike.%${s}%,documento.ilike.%${s}%,telefono.ilike.%${s}%,correo.ilike.%${s}%`)
      const { data } = await qq
      setLista(data || [])
    }, 250)
    return () => clearTimeout(t)
  }, [q, tick])

  return (
    <AppShell title="Clientes" sub="Buscar y registrar" right={can('crear_clientes') && <button className="btn sm !bg-white !text-brand" onClick={() => setForm({})}>+ Nuevo</button>}>
      <SearchBar value={q} onChange={setQ} placeholder="Nombre, documento, teléfono o correo" />
      {!lista ? <Loader /> : lista.length === 0 ? <Empty text="No hay clientes" /> : (
        <div className="card !p-2">
          {lista.map((c) => (
            <div key={c.id} className="row cursor-pointer" onClick={() => setFicha(c)}>
              <div className="flex-1"><p className="m-0 text-sm font-semibold">{c.nombre}</p><p className="m-0 text-xs text-muted">{c.tipo_documento} {c.documento}{c.telefono ? ' · ' + c.telefono : ''}</p></div>
            </div>
          ))}
        </div>
      )}
      {form && <ClienteForm inicial={form.id ? form : null} onClose={() => setForm(null)} onSaved={() => { setForm(null); setFicha(null); setTick((t) => t + 1) }} />}
      {ficha && !form && <Ficha c={ficha} onClose={() => setFicha(null)} onEditar={() => setForm(ficha)} puedeEditar={can('crear_clientes')} />}
    </AppShell>
  )
}

function Ficha({ c, onClose, onEditar, puedeEditar }) {
  const [fac, setFac] = useState(null)
  const [ver, setVer] = useState(null)
  useEffect(() => {
    supabase.from('facturas').select('id,prefijo,numero,total,estado,fecha').eq('cliente_id', c.id).order('fecha', { ascending: false }).limit(30).then(({ data }) => setFac(data || []))
  }, [c.id])
  return (
    <Modal title={c.nombre} onClose={onClose}>
      <p className="text-sm m-0">{c.tipo_documento} {c.documento}</p>
      <p className="text-sm text-muted m-0">{c.telefono || 'Sin teléfono'} · {c.correo || 'Sin correo'}</p>
      {c.direccion && <p className="text-sm text-muted m-0">{c.direccion}</p>}
      {puedeEditar && <button className="btn sec sm my-3" onClick={onEditar}>Editar</button>}
      <h4 className="text-sm text-muted uppercase mt-3 mb-1">Historial de compras</h4>
      {!fac ? <Loader /> : fac.length === 0 ? <Empty text="Sin compras" /> : fac.map((f) => (
        <div key={f.id} className="row cursor-pointer" onClick={() => setVer(f.id)}>
          <div className="flex-1"><p className="m-0 text-sm font-semibold">{numFactura(f)}</p><p className="m-0 text-xs text-muted">{fechaHora(f.fecha)}</p></div>
          <div className="text-right"><b className="text-sm">{money(f.total)}</b>{f.estado === 'anulada' && <div><Badge tone="bad">Anulada</Badge></div>}</div>
        </div>
      ))}
      {ver && <FacturaDetalle id={ver} onClose={() => setVer(null)} />}
    </Modal>
  )
}
