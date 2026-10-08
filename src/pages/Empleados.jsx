import { useEffect, useState } from 'react'
import ConfirmAction from '../components/ConfirmAction'
import { useAction } from '../lib/useAction'
import AppShell from '../components/AppShell'
import Modal from '../components/Modal'
import { Empty, Loader, Badge, Input, ErrorBox, SearchBar, Select } from '../components/ui'
import { supabase, isDemoMode } from '../lib/supabase'
import { fechaHora, mensajeError, money, hoyBogota, rangoMes } from '../lib/format'
import { toast } from '../lib/toast'

const PERMISOS = [
  ['vender', 'Vender y facturar'], ['ver_inventario', 'Ver inventario'], ['editar_inventario', 'Modificar inventario'],
  ['editar_precios', 'Cambiar precios'], ['ver_costos', 'Ver costos'], ['crear_clientes', 'Crear clientes'],
  ['hacer_devoluciones', 'Hacer devoluciones'], ['anular_facturas', 'Anular facturas'], ['registrar_compras', 'Registrar compras'], ['ver_finanzas', 'Ver finanzas'],
]
const BASE = ['vender', 'ver_inventario', 'crear_clientes']

export default function Empleados() {
  const [q, setQ] = useState('')
  const [lista, setLista] = useState(null)
  const [nuevo, setNuevo] = useState(false)
  const [sel, setSel] = useState(null)
  const [tick, setTick] = useState(0)
  const [sales, setSales] = useState({day:[],month:[]})
  useEffect(()=>{if(!isDemoMode)return;const today=hoyBogota(),m=rangoMes();Promise.all([supabase.rpc('ventas_por_empleado',{p_desde:today,p_hasta:today}),supabase.rpc('ventas_por_empleado',{p_desde:m.ini,p_hasta:m.fin})]).then(([day,month])=>setSales({day:day.data||[],month:month.data||[]}))},[tick])
  useEffect(() => { supabase.from('perfiles').select('*').order('nombre').then(({ data }) => setLista(data || [])) }, [tick])
  const visible = (lista||[]).filter(p=>[p.nombre,p.correo,p.rol].some(v=>String(v||'').toLocaleLowerCase().includes(q.toLocaleLowerCase())))
  const refrescar = () => { setLista(null); setTick((t) => t + 1) }

  return (
    <AppShell title="Empleados" sub="Solo el administrador crea usuarios" right={<button className="btn sm" onClick={() => setNuevo(true)}>+ Vendedor</button>}>
      <SearchBar value={q} onChange={setQ} placeholder="Buscar empleado o correo" />
      {!lista ? <Loader /> : visible.length === 0 ? <Empty /> : (
        <div className="card entity-list !p-2">
          {visible.map((p) => (
            <div key={p.id} className="row cursor-pointer" onClick={() => setSel(p)}>
              <span className="entity-avatar">{p.nombre.slice(0,1)}</span>
              <div className="flex-1"><p className="m-0 text-sm font-semibold">{p.nombre}</p><p className="m-0 text-xs text-muted">{p.correo}</p>{isDemoMode&&<div className="employee-summary"><p>Hoy {money(sales.day.find(s=>s.vendedor_id===p.id)?.total_vendido||0)}</p><p>Mes {money(sales.month.find(s=>s.vendedor_id===p.id)?.total_vendido||0)} · {sales.month.find(s=>s.vendedor_id===p.id)?.facturas||0} facturas</p>{p.comision_pct!=null&&<p>Comisión ({p.comision_pct}%) {money(sales.month.find(s=>s.vendedor_id===p.id)?.comision||0)}</p>}</div>}</div>
              <div className="employee-state"><Badge tone={p.rol === 'admin' ? 'good' : ''}>{p.rol === 'admin' ? 'Admin' : 'Vendedor'}</Badge><Badge tone={p.activo?'good':'bad'}>{p.activo?'Activo':'Inactivo'}</Badge></div>
            </div>
          ))}
        </div>
      )}
      {nuevo && <Nuevo onClose={() => setNuevo(false)} onSaved={() => { setNuevo(false); refrescar() }} />}
      {sel && <Detalle p={sel} onClose={() => setSel(null)} onCambio={() => { refrescar(); setSel(null) }} />}
    </AppShell>
  )
}

function Permisos({ value, onChange }) {
  return PERMISOS.map(([k, t]) => (
    <label key={k} className="flex items-center gap-2 text-sm py-1.5">
      <input type="checkbox" checked={value.includes(k)} onChange={(e) => onChange(e.target.checked ? [...value, k] : value.filter((x) => x !== k))} /> {t}
    </label>
  ))
}

function Nuevo({ onClose, onSaved }) {
  const [f, setF] = useState({ nombre: '', correo: '', password: '', telefono: '', comision_pct: '' })
  const [permisos, setPermisos] = useState(BASE)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const [crear, pendingCreate] = useAction(crearImpl, () => setBusy(false))
  async function crearImpl() {
    if (!f.nombre.trim() || !f.correo.trim()) return setErr('Nombre y correo son obligatorios.')
    if (f.password.length < 8) return setErr('La contraseña debe tener al menos 8 caracteres.')
    setBusy(true); setErr('')
    const { data, error } = await supabase.functions.invoke('crear-empleado', {
      body: { nombre: f.nombre.trim(), correo: f.correo.trim().toLowerCase(), password: f.password, telefono: f.telefono.trim() || null, ...(isDemoMode?{documento:f.documento?.trim()||null}:{}), rol: isDemoMode?(f.rol||'vendedor'):'vendedor', comision_pct: f.comision_pct === '' ? null : Number(f.comision_pct), permisos },
    })
    setBusy(false)
    if (error || data?.error) {
      let m = data?.error
      if (!m && error?.context?.json) { try { m = (await error.context.json()).error } catch { /* ignore */ } }
      return setErr(mensajeError({ message: m || error?.message || 'No se pudo crear el empleado' }))
    }
    toast('Empleado creado'); onSaved()
  }
  return (
    <Modal title="Nuevo vendedor" onClose={onClose} footer={<button className="btn full" onClick={crear} disabled={busy || pendingCreate}>{busy ? 'Creando…' : 'Crear usuario'}</button>}>
      <ErrorBox text={err} />
      {isDemoMode&&<Input label="Documento empleado" value={f.documento||''} onChange={set('documento')}/>}
      <Input required label="Nombre completo" value={f.nombre} onChange={set('nombre')} />
      <Input label="Correo (con él inicia sesión)" type="email" value={f.correo} onChange={set('correo')} />
      {isDemoMode&&<Select label="Rol" value={f.rol||'vendedor'} onChange={set('rol')}><option value="vendedor">Vendedor</option><option value="admin">Administrador</option></Select>}
      <Input label="Contraseña inicial" type="password" value={f.password} onChange={set('password')} />
      <Input label="Teléfono" value={f.telefono} onChange={set('telefono')} inputMode="tel" />
      <Input label="Comisión % (opcional)" type="number" min="0" max="100" step="0.01" value={f.comision_pct} onChange={set('comision_pct')} />
      <h4 className="text-sm text-muted uppercase mb-1">Permisos</h4>
      <Permisos value={permisos} onChange={setPermisos} />
    </Modal>
  )
}

function Detalle({ p, onClose, onCambio }) {
  const [permisos, setPermisos] = useState(null)
  const [act, setAct] = useState(null)
  const [name,setName] = useState(p.nombre), [documento,setDocumento] = useState(p.documento||''), [rol,setRol] = useState(p.rol), [confirm,setConfirm] = useState(false), [sales,setSales] = useState([])
  const [tel, setTel] = useState(p.telefono || '')
  const [com, setCom] = useState(p.comision_pct ?? '')
  const [err, setErr] = useState('')
  const esAdmin = p.rol === 'admin'

  useEffect(() => {
    if(isDemoMode) supabase.from('facturas_netas').select('*').eq('vendedor_id',p.id).order('fecha',{ascending:false}).then(({data})=>setSales(data||[]))
    supabase.from('perfil_permisos').select('permiso').eq('perfil_id', p.id).then(({ data }) => setPermisos((data || []).map((r) => r.permiso)))
    supabase.from('actividad').select('*').eq('perfil_id', p.id).order('fecha', { ascending: false }).limit(25).then(({ data }) => setAct(data || []))
  }, [p.id])

  const [guardar, pendingSave] = useAction(guardarImpl)
  async function guardarImpl() {
    setErr('')
    if(isDemoMode){ const {error}=await supabase.rpc('guardar_empleado_demo',{id:p.id,datos:{nombre:name.trim(),documento:documento.trim()||null,telefono:tel.trim()||null,rol,comision_pct:com===''?null:Number(com)},permisos:permisos||[]});if(error)return setErr(mensajeError(error));toast('Cambios guardados');onCambio();return }
    const { error } = await supabase.from('perfiles').update({ telefono: tel.trim() || null, comision_pct: com === '' ? null : Number(com) }).eq('id', p.id)
    if (error) return setErr(mensajeError(error))
    if (!esAdmin) {
      const d = await supabase.from('perfil_permisos').delete().eq('perfil_id', p.id)
      if (d.error) return setErr(mensajeError(d.error))
      if (permisos.length) {
        const i = await supabase.from('perfil_permisos').insert(permisos.map((permiso) => ({ perfil_id: p.id, permiso })))
        if (i.error) return setErr(mensajeError(i.error))
      }
    }
    toast('Cambios guardados'); onCambio()
  }
  async function alternar() {
    const { error } = await supabase.from('perfiles').update({ activo: !p.activo }).eq('id', p.id)
    if (error) throw new Error(mensajeError(error))
    toast(p.activo ? 'Empleado desactivado' : 'Empleado activado'); onCambio()
  }

  return (
    <Modal title={p.nombre} onClose={onClose} footer={<button className="btn full" onClick={guardar} disabled={pendingSave}>{pendingSave?'Guardando...':'Guardar cambios'}</button>}>
      <ErrorBox text={err} />
      <p className="text-sm text-muted mt-0">{p.correo} · {p.rol}</p>
      {isDemoMode && <><Input required label="Nombre empleado" value={name} onChange={e=>setName(e.target.value)} /><Input label="Documento empleado" value={documento} onChange={e=>setDocumento(e.target.value)} /><label className="lbl">Rol empleado</label><select className="inp mb-3" value={rol} onChange={e=>setRol(e.target.value)}><option value="vendedor">Vendedor</option><option value="admin">Administrador</option></select></>}
      <Input label="Teléfono" value={tel} onChange={(e) => setTel(e.target.value)} />
      <Input label="Comisión % (vacío = sin comisión)" type="number" min="0" max="100" step="0.01" value={com} onChange={(e) => setCom(e.target.value)} />
      {!esAdmin && (
        <>
          <h4 className="text-sm text-muted uppercase mb-1">Permisos</h4>
          {permisos ? <Permisos value={permisos} onChange={setPermisos} /> : <Loader />}
          <button className={'btn full my-3 ' + (p.activo ? 'bad' : 'sec')} onClick={()=>setConfirm(true)}>{p.activo ? 'Desactivar empleado' : 'Activar empleado'}</button>
        </>
      )}
      {confirm&&<ConfirmAction title={p.activo?'Desactivar empleado':'Activar empleado'} label="Confirmar estado" onClose={()=>setConfirm(false)} onConfirm={alternar}>Se conserva el historial. El empleado desactivado no podra iniciar sesion.</ConfirmAction>}
      {isDemoMode&&<section><h4 className="section-heading">Ventas y comisiones</h4><p className="text-sm">Mes actual: {money(sales.filter(f=>f.estado==='emitida'&&f.fecha.slice(0,7)===hoyBogota().slice(0,7)).reduce((n,f)=>n+(f.total_neto||0),0))}</p>{sales.map(f=><div className="row" key={f.id}><span className="flex-1 text-sm">{f.prefijo}-{f.numero} - {f.estado}</span><span className="text-xs">{money(f.total_neto)} / Comision {money(f.estado==='emitida'?f.comision_neta:0)}</span></div>)}</section>}
      <h4 className="text-sm text-muted uppercase mt-3 mb-1">Historial de actividad</h4>
      {!act ? <Loader /> : act.length === 0 ? <Empty text="Sin actividad" /> : act.map((a) => (
        <div key={a.id} className="row"><div className="flex-1"><p className="m-0 text-sm">{a.accion}{a.entidad ? ` · ${a.entidad} ${a.entidad_id ?? ''}` : ''}</p><p className="m-0 text-xs text-muted">{fechaHora(a.fecha)}</p></div></div>
      ))}
    </Modal>
  )
}
