import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAction } from '../lib/useAction'
import AppShell from '../components/AppShell'
import Modal from '../components/Modal'
import { Empty, Loader, Badge, Input, Select, ErrorBox, Chips } from '../components/ui'
import { supabase, isDemoMode } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { fecha, mensajeError, hoyBogota, numFactura } from '../lib/format'
import { toast } from '../lib/toast'

export default function Garantias() {
  const [params]=useSearchParams()
  const { perfil } = useAuth()
  const [estado, setEstado] = useState('vigente')
  const [lista, setLista] = useState(null)
  const [sel, setSel] = useState(null)
  const [tick, setTick] = useState(0)
  const [nuevo, setNuevo] = useState(false)
  const [facturas, setFacturas] = useState({})
  useEffect(()=>{if(params.get('garantia'))supabase.from('garantias').select('*').eq('id',Number(params.get('garantia'))).maybeSingle().then(({data})=>setSel(data))},[params])
  useEffect(()=>{Promise.all([supabase.from('factura_items').select('id,factura_id'),supabase.from('facturas').select('id,prefijo,numero')]).then(([items,fac])=>setFacturas(Object.fromEntries((items.data||[]).map(i=>[i.id,(fac.data||[]).find(f=>f.id===i.factura_id)]))))},[tick])

  useEffect(() => {
    setLista(null)
    let q = supabase.from('garantias').select('*, productos(nombre), clientes(nombre,telefono), unidades_serializadas(serial), reclamos_garantia(id,descripcion,estado,fecha)').order('fin').limit(80)
    q.then(({ data }) => setLista((data || []).filter(g=>estado==='todas'||estado==='por_vencer'&&statusLabel(g)==='Por vencer'||estado==='vencida'&&statusLabel(g)==='Vencida'||estado==='vigente'&&['Vigente','Por vencer'].includes(statusLabel(g))||!['vigente','por_vencer','vencida'].includes(estado)&&g.estado===estado)))
  }, [estado, tick])

  return (
    <div className="admin-premium admin-warranties"><AppShell title="Garantías" sub="Vigentes y reclamos" right={isDemoMode&&<button className="btn sm" onClick={()=>setNuevo(true)}>+ Nueva</button>}>
      <div className="admin-filter-fade"><Chips value={estado} onChange={setEstado} options={[{ value: 'vigente', label: 'Vigentes' }, { value: 'por_vencer', label: 'Por vencer' }, { value: 'en_reclamo', label: 'En revisión' }, { value: 'resuelta', label: 'Resueltas' }, {value:'rechazada',label:'Rechazadas'}, { value: 'vencida', label: 'Vencidas' }, { value: 'todas', label: 'Todas' }]} /></div>
      {!lista ? <Loader /> : lista.length === 0 ? <Empty text="Sin garantías" /> : (
        <div className="admin-list entity-list">
          {lista.map((g) => (
            <button type="button" key={g.id} className="row card admin-list-card warranty-card" onClick={() => setSel(g)}>
              <div className="admin-card-top"><span className="admin-reference">GAR-{String(g.id).padStart(4,'0')}{facturas[g.factura_item_id] ? ' · '+numFactura(facturas[g.factura_item_id]) : ''}</span><Badge tone={['Rechazada','Vencida'].includes(statusLabel(g))?'bad':['Por vencer','En revisión','Aprobada'].includes(statusLabel(g))?'warn':'good'}>{statusLabel(g)}</Badge></div>
              <p className="admin-card-title">{g.productos?.nombre}</p><p className="admin-card-secondary">{g.clientes?.nombre || 'Consumidor final'}</p>{g.unidades_serializadas?.serial&&<p className="admin-card-secondary">{g.unidades_serializadas.serial}</p>}
              <div className="admin-card-bottom"><span><small>Vence</small><b>{fecha(g.fin)}</b></span><span className="admin-chevron" aria-hidden="true">›</span></div>
            </button>
          ))}
        </div>
      )}
      {sel && <Detalle g={sel} perfil={perfil} onClose={() => setSel(null)} onCambio={() => { setSel(null); setTick((t) => t + 1) }} />}
      {nuevo&&<NuevaGarantia onClose={()=>setNuevo(false)} onSaved={()=>{setNuevo(false);setTick(t=>t+1)}}/>}
    </AppShell></div>
  )
}

function statusLabel(g){if(g.historial?.length){const status=g.historial.at(-1).estado;return ({vigente:g.fin<hoyBogota()?'Vencida':(Date.parse(g.fin)-Date.parse(hoyBogota()))/86400000<=30?'Por vencer':'Vigente',en_reclamo:'En revisión',resuelta:'Resuelta',rechazada:'Rechazada',vencida:'Vencida'})[status]||status}const last=g.reclamos_garantia?.at(-1);if(last)return ({en_revision:'En revisión',aprobado:'Aprobada',resuelto:'Resuelta',rechazado:'Rechazada',abierto:'En revisión'})[last.estado]||last.estado;if(g.estado==='vigente'){const days=(Date.parse(g.fin)-Date.parse(hoyBogota()))/86400000;return days<0?'Vencida':days<=30?'Por vencer':'Vigente'}return ({en_reclamo:'En revisión',resuelta:'Resuelta',vencida:'Vencida'})[g.estado]||g.estado}

export function NuevaGarantia({onClose,onSaved,facturaId}){
  const [inicio,setInicio]=useState(hoyBogota()),[fin,setFin]=useState(''),[motivo,setMotivo]=useState(''),[descripcion,setDescripcion]=useState('')
  const [options,setOptions]=useState([]),[item,setItem]=useState(''),[err,setErr]=useState(''),[busy,setBusy]=useState(false)
  useEffect(()=>{Promise.all([supabase.from('factura_items').select('*'),supabase.from('facturas').select('*').eq('estado','emitida'),supabase.from('garantias').select('*')]).then(([items,invoices,gs])=>setOptions((items.data||[]).filter(i=>invoices.data?.some(f=>f.id===i.factura_id&&(!facturaId||f.id===facturaId))&&!gs.data?.some(g=>g.factura_item_id===i.id)).map(i=>({...i,invoice:invoices.data.find(f=>f.id===i.factura_id)}))))},[])
  const [guardar,pendingSave]=useAction(guardarImpl, () => setBusy(false))
  async function guardarImpl(){if(!item)return setErr('Elige un producto de una factura vigente.');setBusy(true);const {error}=await supabase.rpc('crear_garantia_demo',{factura_item_id:Number(item),inicio,fin:fin||undefined,motivo,descripcion});setBusy(false);if(error)return setErr(mensajeError(error));toast('Garantía registrada');onSaved()}
  return <Modal title="Nueva garantía" className="admin-sheet warranty-create-sheet" keyboardAware onClose={onClose} footer={<button className="btn full" disabled={busy||pendingSave||!options.length} onClick={guardar}>Guardar garantía</button>}><ErrorBox text={err}/><p className="text-sm text-muted">Asocia un producto vendido sin garantía registrada. Cliente, serial y cobertura se toman de la venta.</p><Select label="Producto y factura" value={item} onChange={e=>setItem(e.target.value)}><option value="">Elegir…</option>{options.map(i=><option key={i.id} value={i.id}>FV-{i.invoice.numero} · {i.nombre}</option>)}</Select><Input label="Inicio de cobertura" type="date" value={inicio} onChange={e=>setInicio(e.target.value)}/><Input label="Vencimiento de cobertura (opcional)" type="date" min={inicio} value={fin} onChange={e=>setFin(e.target.value)}/><Input label="Motivo garantia" value={motivo} onChange={e=>setMotivo(e.target.value)}/><Input label="Descripcion garantia" value={descripcion} onChange={e=>setDescripcion(e.target.value)}/>{!options.length&&<Empty text="Todas las ventas tienen garantía" description="La próxima venta de un producto con cobertura creará su garantía automáticamente."/>}</Modal>
}

function Detalle({ g, perfil, onClose, onCambio }) {
  const [estado,setEstado]=useState(g.estado),[nota,setNota]=useState('')
  const [desc, setDesc] = useState('')
  const [err, setErr] = useState('')
  const [reclamo,pendingClaim]=useAction(async()=>{
    if(!desc.trim())return setErr('Describe el problema.')
    const r=isDemoMode?await supabase.rpc('abrir_reclamo_demo',{id:g.id,descripcion:desc}):await supabase.from('reclamos_garantia').insert({garantia_id:g.id,descripcion:desc,creado_por:perfil.id})
    if(r.error)return setErr(mensajeError(r.error))
    if(!isDemoMode)await supabase.from('garantias').update({estado:'en_reclamo'}).eq('id',g.id)
    toast('Reclamo registrado');onCambio()
  })
  const [resolver,pendingResolve]=useAction(async(r,estado)=>{
    const result=isDemoMode?await supabase.rpc('resolver_reclamo_demo',{id:r.id,estado,nota}):await supabase.from('reclamos_garantia').update({estado}).eq('id',r.id)
    if(result.error)return setErr(mensajeError(result.error))
    if(!isDemoMode)await supabase.from('garantias').update({estado:estado==='resuelto'?'resuelta':'en_reclamo'}).eq('id',g.id)
    toast('Reclamo actualizado');onCambio()
  })
  const [actualizar,pendingUpdate]=useAction(async()=>{
    const result=await supabase.rpc('actualizar_garantia_demo',{id:g.id,estado,nota})
    if(result.error)return setErr(mensajeError(result.error))
    toast('Estado y nota guardados');onCambio()
  })
  return (
    <Modal title={g.productos?.nombre} className="admin-sheet warranty-detail-sheet" keyboardAware onClose={onClose}>
      <ErrorBox text={err} />
      <p className="text-sm m-0">Cliente: {g.clientes?.nombre || 'Consumidor final'}{g.clientes?.telefono ? ' · ' + g.clientes.telefono : ''}</p>
      <p className="text-sm text-muted mt-0">Del {fecha(g.inicio)} al {fecha(g.fin)}</p>
      {g.factura&&<p className="text-xs text-muted">Compra: {numFactura(g.factura)} · {fecha(g.factura.fecha)}</p>}
      {g.motivo&&<p className="text-sm">{g.motivo}</p>}{g.descripcion&&<p className="text-sm">{g.descripcion}</p>}
      {isDemoMode&&<section className="form-section"><Select label="Estado garantia" value={estado} onChange={e=>setEstado(e.target.value)}>{[['vigente','Vigente'],['en_reclamo','En revisión'],['resuelta','Resuelta'],['rechazada','Rechazada'],['vencida','Vencida']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</Select><Input label="Nota de seguimiento" value={nota} onChange={e=>setNota(e.target.value)}/><button className="btn full" disabled={pendingUpdate} onClick={actualizar}>Guardar estado y nota</button><h4 className="section-heading">Historial de garantía</h4>{g.historial?.length?g.historial.map(h=><div className="row" key={h.id}><span className="text-xs">{fecha(h.fecha)} · {h.estado}<br/>{h.nota}</span></div>):<p className="text-xs text-muted">Sin notas adicionales.</p>}</section>}
      <h4 className="text-sm text-muted uppercase mb-1">Reclamos</h4>
      {g.reclamos_garantia.length === 0 ? <Empty text="Sin reclamos" /> : g.reclamos_garantia.map((r) => (
        <div key={r.id} className="row"><div className="flex-1"><p className="m-0 text-sm">{r.descripcion}</p><p className="m-0 text-xs text-muted">{fecha(r.fecha)} · {r.estado}</p></div>
          {['abierto','en_revision','aprobado'].includes(r.estado) && <div className="warranty-actions">{isDemoMode&&r.estado==='abierto'&&<button className="btn sec sm" disabled={pendingResolve} onClick={()=>resolver(r,'en_revision')}>En revisión</button>}{isDemoMode&&r.estado!=='aprobado'&&<button className="btn sec sm" onClick={()=>resolver(r,'aprobado')}>Aprobar</button>}<button className="btn sm" disabled={pendingResolve} onClick={() => resolver(r, 'resuelto')}>{isDemoMode?'Finalizar':'Resolver'}</button><button className="btn bad sm" onClick={() => resolver(r, 'rechazado')}>Rechazar</button></div>}
        </div>
      ))}
      {g.estado === 'vigente' && (<><h4 className="text-sm text-muted uppercase mt-3 mb-1">Nuevo reclamo</h4><Input label="Descripción del problema" value={desc} onChange={(e) => setDesc(e.target.value)} /><button className="btn full" disabled={pendingClaim} onClick={reclamo}>Registrar reclamo</button></>)}
    </Modal>
  )
}
