import { useEffect, useState } from 'react'
import AppShell from '../components/AppShell'
import { useSearchParams } from 'react-router-dom'
import Modal from '../components/Modal'
import FacturaDetalle from '../components/FacturaDetalle'
import RecordStatus from '../components/RecordStatus'
import { ClienteForm } from '../components/ClientePicker'
import { SearchBar, Empty, Loader, Badge } from '../components/ui'
import { supabase, isDemoMode } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { money, fechaHora, numFactura, limpiarBusqueda } from '../lib/format'

export default function Clientes() {
  const { can } = useAuth()
  const [params] = useSearchParams()
  const [q, setQ] = useState(params.get('q') || '')
  const [totales, setTotales] = useState({})
  const [lista, setLista] = useState(null)
  const [form, setForm] = useState(null)
  const [ficha, setFicha] = useState(null)
  const [tick, setTick] = useState(0)
  useEffect(() => { supabase.from(isDemoMode ? 'facturas_netas' : 'facturas').select('*').eq('estado','emitida').then(({data})=>{const stats={};for(const f of data||[]){const v=stats[f.cliente_id] ||= {count:0,total:0,last:null};v.count++;v.total+=Number(f.total_neto??f.total);if(!v.last||f.fecha>v.last)v.last=f.fecha}setTotales(stats)}) }, [tick])

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
    <AppShell title="Clientes" sub="Buscar y registrar" right={can('crear_clientes') && <button className="btn sm" onClick={() => setForm({})}>+ Nuevo</button>}>
      <SearchBar value={q} onChange={setQ} placeholder="Nombre, documento, teléfono o correo" />
      {!lista ? <Loader /> : lista.length === 0 ? <Empty text="No hay clientes para mostrar" description="Busca por nombre o documento, o registra un cliente para relacionar sus compras." action={can('crear_clientes')?()=>setForm({}):undefined} actionLabel="+ Crear cliente" /> : (
        <div className="card entity-list !p-2">
          {lista.map((c) => (
            <div key={c.id} className="row cursor-pointer" onClick={() => setFicha(c)}>
              <div className="flex-1"><p className="m-0 text-sm font-semibold">{c.nombre}</p><p className="m-0 text-xs text-muted">{c.activo===false?'Inactivo - ':''}{c.telefono || 'Sin teléfono'} · {c.documento}</p><p className="m-0 text-xs text-muted">{totales[c.id]?.count || 0} compras · {totales[c.id]?.last ? fechaHora(totales[c.id].last) : 'Sin compras'}</p></div>
              <div className="text-right"><b className="entity-total">{money(totales[c.id]?.total || 0)}</b><span className="text-[9px] text-muted">Total neto ›</span></div>
            </div>
          ))}
        </div>
      )}
      {form && <ClienteForm inicial={form.id ? form : null} onClose={() => setForm(null)} onSaved={() => { setForm(null); setFicha(null); setLista(null); setTick((t) => t + 1) }} />}
      {ficha && !form && <Ficha c={ficha} onClose={() => { setFicha(null); setLista(null); setTick(t=>t+1) }} onEditar={() => setForm(ficha)} puedeEditar={can('crear_clientes')} />}
    </AppShell>
  )
}

function Ficha({ c, onClose, onEditar, puedeEditar }) {
  const [fac, setFac] = useState(null)
  const [ver, setVer] = useState(null)
  useEffect(() => {
    supabase.from(isDemoMode?'facturas_netas':'facturas').select('id,prefijo,numero,total,estado,fecha').eq('cliente_id', c.id).order('fecha', { ascending: false }).then(({ data }) => setFac(data || []))
  }, [c.id])
  return (
    <Modal title={c.nombre} onClose={onClose}>
      <p className="text-sm m-0">{c.tipo_documento} {c.documento}</p>
      <p className="text-sm text-muted m-0">{c.telefono || 'Sin teléfono'} · {c.correo || 'Sin correo'}</p>
      {c.direccion && <p className="text-sm text-muted m-0">{c.direccion}</p>}
      {c.ciudad && <p className="text-sm text-muted m-0">{c.ciudad}</p>}
      {fac && <div className="card mt-3"><span className="text-xs text-muted">Total comprado · ventas vigentes</span><p className="m-0 font-bold">{money(fac.filter(f=>f.estado==='emitida').reduce((n,f)=>n+Number(f.total_neto??f.total),0))}</p></div>}
      {c.notas && <p className="text-sm text-muted">{c.notas}</p>}
      {isDemoMode && puedeEditar && <RecordStatus table="clientes" record={c} onSaved={onClose} />}
      {puedeEditar && <button className="btn sec sm my-3" onClick={onEditar}>Editar</button>}
      <h4 className="text-sm text-muted uppercase mt-3 mb-1">Historial de compras</h4>
      {!fac ? <Loader /> : fac.length === 0 ? <Empty text="Sin compras" /> : fac.map((f) => (
        <div key={f.id} className="row cursor-pointer" onClick={() => setVer(f.id)}>
          <div className="flex-1"><p className="m-0 text-sm font-semibold">{numFactura(f)}</p><p className="m-0 text-xs text-muted">{fechaHora(f.fecha)}</p></div>
          <div className="text-right"><b className="text-sm">{money(f.total)}</b>{f.estado === 'anulada' && <div><Badge tone="bad">Anulada</Badge></div>}</div>
        </div>
      ))}
      {ver && <FacturaDetalle id={ver} onClose={() => setVer(null)} onCambio={()=>supabase.from(isDemoMode?'facturas_netas':'facturas').select('*').eq('cliente_id',c.id).order('fecha',{ascending:false}).then(({data})=>setFac(data||[]))} />}
    </Modal>
  )
}

function GarantiasCliente({ id }) {
  const [rows, setRows] = useState([])
  useEffect(() => { supabase.from('garantias').select('*').eq('cliente_id', id).then(({ data }) => setRows(data || [])) }, [id])
  return <section><h4 className="section-heading">Garantías relacionadas</h4>{rows.length ? rows.map(g => <div className="row" key={g.id}><span className="flex-1 text-sm">{g.productos?.nombre || 'Producto'} · GAR-{g.id}</span><Badge>{g.estado}</Badge></div>) : <p className="text-xs text-muted">Sin garantías registradas.</p>}</section>
}
