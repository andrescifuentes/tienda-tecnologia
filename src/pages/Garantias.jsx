import { useEffect, useState } from 'react'
import AppShell from '../components/AppShell'
import Modal from '../components/Modal'
import { Empty, Loader, Badge, Input, ErrorBox, Chips } from '../components/ui'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { fecha, mensajeError } from '../lib/format'
import { toast } from '../lib/toast'

export default function Garantias() {
  const { perfil } = useAuth()
  const [estado, setEstado] = useState('vigente')
  const [lista, setLista] = useState(null)
  const [sel, setSel] = useState(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    setLista(null)
    let q = supabase.from('garantias').select('*, productos(nombre), clientes(nombre,telefono), unidades_serializadas(serial), reclamos_garantia(id,descripcion,estado,fecha)').order('fin').limit(80)
    if (estado !== 'todas') q = q.eq('estado', estado)
    q.then(({ data }) => setLista(data || []))
  }, [estado, tick])

  return (
    <AppShell title="Garantías" sub="Vigentes y reclamos">
      <Chips value={estado} onChange={setEstado} options={[{ value: 'vigente', label: 'Vigentes' }, { value: 'en_reclamo', label: 'En reclamo' }, { value: 'resuelta', label: 'Resueltas' }, { value: 'vencida', label: 'Vencidas' }, { value: 'todas', label: 'Todas' }]} />
      {!lista ? <Loader /> : lista.length === 0 ? <Empty text="Sin garantías" /> : (
        <div className="card !p-2">
          {lista.map((g) => (
            <div key={g.id} className="row cursor-pointer" onClick={() => setSel(g)}>
              <div className="flex-1"><p className="m-0 text-sm font-semibold">{g.productos?.nombre}</p><p className="m-0 text-xs text-muted">{g.clientes?.nombre || 'Consumidor final'}{g.unidades_serializadas?.serial ? ' · ' + g.unidades_serializadas.serial : ''}</p></div>
              <div className="text-right"><p className="m-0 text-xs">hasta {fecha(g.fin)}</p><Badge tone={g.estado === 'vigente' ? 'good' : g.estado === 'en_reclamo' ? 'warn' : ''}>{g.estado.replace('_', ' ')}</Badge></div>
            </div>
          ))}
        </div>
      )}
      {sel && <Detalle g={sel} perfil={perfil} onClose={() => setSel(null)} onCambio={() => { setSel(null); setTick((t) => t + 1) }} />}
    </AppShell>
  )
}

function Detalle({ g, perfil, onClose, onCambio }) {
  const [desc, setDesc] = useState('')
  const [err, setErr] = useState('')
  async function reclamo() {
    if (!desc.trim()) return setErr('Describe el problema.')
    const r = await supabase.from('reclamos_garantia').insert({ garantia_id: g.id, descripcion: desc.trim(), creado_por: perfil.id })
    if (r.error) return setErr(mensajeError(r.error))
    await supabase.from('garantias').update({ estado: 'en_reclamo' }).eq('id', g.id)
    toast('Reclamo registrado'); onCambio()
  }
  async function resolver(r, estado) {
    const u = await supabase.from('reclamos_garantia').update({ estado, resuelto_en: new Date().toISOString(), resolucion: estado === 'resuelto' ? 'Resuelto' : 'Rechazado' }).eq('id', r.id)
    if (u.error) return setErr(mensajeError(u.error))
    await supabase.from('garantias').update({ estado: 'resuelta' }).eq('id', g.id)
    toast('Reclamo actualizado'); onCambio()
  }
  return (
    <Modal title={g.productos?.nombre} onClose={onClose}>
      <ErrorBox text={err} />
      <p className="text-sm m-0">Cliente: {g.clientes?.nombre || 'Consumidor final'}{g.clientes?.telefono ? ' · ' + g.clientes.telefono : ''}</p>
      <p className="text-sm text-muted mt-0">Del {fecha(g.inicio)} al {fecha(g.fin)}</p>
      <h4 className="text-sm text-muted uppercase mb-1">Reclamos</h4>
      {g.reclamos_garantia.length === 0 ? <Empty text="Sin reclamos" /> : g.reclamos_garantia.map((r) => (
        <div key={r.id} className="row"><div className="flex-1"><p className="m-0 text-sm">{r.descripcion}</p><p className="m-0 text-xs text-muted">{fecha(r.fecha)} · {r.estado}</p></div>
          {(r.estado === 'abierto' || r.estado === 'en_revision') && <div className="flex gap-1"><button className="btn sm" onClick={() => resolver(r, 'resuelto')}>Resolver</button><button className="btn bad sm" onClick={() => resolver(r, 'rechazado')}>Rechazar</button></div>}
        </div>
      ))}
      {g.estado === 'vigente' && (<><h4 className="text-sm text-muted uppercase mt-3 mb-1">Nuevo reclamo</h4><Input label="Descripción del problema" value={desc} onChange={(e) => setDesc(e.target.value)} /><button className="btn full" onClick={reclamo}>Registrar reclamo</button></>)}
    </Modal>
  )
}
