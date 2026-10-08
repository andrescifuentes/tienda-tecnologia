import { useEffect, useState } from 'react'
import ConfirmAction from '../components/ConfirmAction'
import { useAction } from '../lib/useAction'
import AppShell from '../components/AppShell'
import Modal from '../components/Modal'
import { FormSection, PremiumSwitch, RoleField, PasswordField } from '../components/AdminPrimitives'
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
    <div className="admin-premium admin-employees"><AppShell title="Empleados" sub="Equipo, acceso y comisiones" right={<button className="btn sm" onClick={() => setNuevo(true)}>+ Vendedor</button>}>
      <SearchBar value={q} onChange={setQ} placeholder="Buscar empleado o correo" />
      {!lista ? <Loader /> : visible.length === 0 ? <Empty /> : (
        <div className="admin-list entity-list">
          {visible.map((p) => (
            <button type="button" key={p.id} className="row card admin-list-card employee-card" onClick={() => setSel(p)}>
              <div className="employee-card-heading"><span className="entity-avatar">{p.nombre.slice(0,1)}</span><div className="employee-card-copy"><p className="admin-card-title">{p.nombre}</p><p className="admin-card-secondary">{p.rol==='admin'?'Administrador':'Vendedor'}</p></div><Badge tone={p.activo?'good':'bad'}>{p.activo?'Activo':'Inactivo'}</Badge></div>
              <p className="admin-card-secondary mt-2">{p.correo}</p>{isDemoMode&&<div className="employee-summary"><div className="employee-summary-grid"><span><small>Ventas mes</small><b>{money(sales.month.find(s=>s.vendedor_id===p.id)?.total_vendido||0)}</b></span><span><small>Comisión {p.comision_pct!=null?`(${p.comision_pct}%)`:''}</small><b>{p.comision_pct!=null?money(sales.month.find(s=>s.vendedor_id===p.id)?.comision||0):'Sin comisión'}</b></span></div><div className="employee-aux"><span>Hoy {money(sales.day.find(s=>s.vendedor_id===p.id)?.total_vendido||0)} · {sales.month.find(s=>s.vendedor_id===p.id)?.facturas||0} facturas mes</span><span className="admin-chevron" aria-hidden="true">›</span></div></div>}
            </button>
          ))}
        </div>
      )}
      {nuevo && <Nuevo onClose={() => setNuevo(false)} onSaved={() => { setNuevo(false); refrescar() }} />}
      {sel && <Detalle p={sel} onClose={() => setSel(null)} onCambio={() => { refrescar(); setSel(null) }} />}
    </AppShell></div>
  )
}

function Permisos({ value, onChange }) {
  return PERMISOS.map(([k, t]) => (
    <PremiumSwitch key={k} label={t} checked={value.includes(k)} onChange={checked=>onChange(checked ? [...value, k] : value.filter((x) => x !== k))}/>
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
    <Modal title="Nuevo vendedor" subtitle="Acceso y perfil de tu equipo" className="admin-sheet employee-create-sheet" keyboardAware onClose={onClose} footer={<button className="btn full" onClick={crear} disabled={busy || pendingCreate}>{busy ? 'Creando…' : 'Crear usuario'}</button>}>
      <ErrorBox text={err} />
      <FormSection number="01" title="Identidad"><div className="admin-form-grid"><div className="admin-span"><Input required label="Nombre completo" value={f.nombre} onChange={set('nombre')}/></div>{isDemoMode&&<Input label="Documento empleado" value={f.documento||''} onChange={set('documento')}/>}<Input label="Teléfono" value={f.telefono} onChange={set('telefono')} inputMode="tel"/></div></FormSection>
      <FormSection number="02" title="Acceso"><Input label="Correo (con él inicia sesión)" type="email" value={f.correo} onChange={set('correo')}/>{isDemoMode&&<RoleField label="Rol" value={f.rol||'vendedor'} onChange={set('rol')}/>}<PasswordField value={f.password} onChange={set('password')} generate={isDemoMode}/></FormSection>
      <FormSection number="03" title="Comisiones"><div className="commission-field"><Input label="Comisión % (opcional)" type="number" min="0" max="100" step="0.01" value={f.comision_pct} onChange={set('comision_pct')}/></div></FormSection>
      <FormSection number="04" title="Permisos" collapsible detail={`${permisos.length} activos`}><Permisos value={permisos} onChange={setPermisos}/></FormSection>
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
    <Modal title={p.nombre} className="admin-sheet employee-edit-sheet" keyboardAware onClose={onClose} footer={<button className="btn full" onClick={guardar} disabled={pendingSave}>{pendingSave?'Guardando...':'Guardar cambios'}</button>}>
      <ErrorBox text={err} />
      <div className="employee-detail-identity"><span className="entity-avatar">{p.nombre.slice(0,1)}</span><div className="flex-1 min-w-0"><b>{p.nombre}</b><p>{p.rol==='admin'?'Administrador':'Vendedor'}</p><p>{p.correo}</p></div><Badge tone={p.activo?'good':'bad'}>{p.activo?'Activo':'Inactivo'}</Badge></div>
      <FormSection title="Datos personales"><div className="admin-form-grid">{isDemoMode&&<><div className="admin-span"><Input required label="Nombre empleado" value={name} onChange={e=>setName(e.target.value)}/></div><Input label="Documento empleado" value={documento} onChange={e=>setDocumento(e.target.value)}/></>}<Input label="Teléfono" value={tel} onChange={e=>setTel(e.target.value)}/></div></FormSection>
      <FormSection title="Rol y comisiones">{isDemoMode&&<RoleField label="Rol empleado" value={rol} onChange={e=>setRol(e.target.value)}/>}<div className="commission-field"><Input label="Comisión % (vacío = sin comisión)" type="number" min="0" max="100" step="0.01" value={com} onChange={e=>setCom(e.target.value)}/></div></FormSection>
      {!esAdmin && (
        <>
          <FormSection title="Permisos" collapsible detail={permisos?`${permisos.length} activos`:'Cargando…'}>{permisos ? <Permisos value={permisos} onChange={setPermisos} /> : <Loader />}</FormSection>
          <div className="admin-discreet-action"><button className={p.activo?'admin-reset':'btn sec full'} onClick={()=>setConfirm(true)}>{p.activo ? 'Desactivar empleado' : 'Activar empleado'}</button></div>
        </>
      )}
      {confirm&&<ConfirmAction title={p.activo?'Desactivar empleado':'Activar empleado'} label="Confirmar estado" onClose={()=>setConfirm(false)} onConfirm={alternar}>Se conserva el historial. El empleado desactivado no podra iniciar sesion.</ConfirmAction>}
      {isDemoMode&&<details className="admin-history"><summary>Ventas y comisiones</summary><p className="text-sm">Mes actual: {money(sales.filter(f=>f.estado==='emitida'&&f.fecha.slice(0,7)===hoyBogota().slice(0,7)).reduce((n,f)=>n+(f.total_neto||0),0))}</p>{sales.map(f=><div className="row" key={f.id}><span className="flex-1 text-sm">{f.prefijo}-{f.numero} - {f.estado}</span><span className="text-xs">{money(f.total_neto)} / Comision {money(f.estado==='emitida'?f.comision_neta:0)}</span></div>)}</details>}
      <details className="admin-history"><summary>Historial de actividad</summary>
      {!act ? <Loader /> : act.length === 0 ? <Empty text="Sin actividad" /> : act.map((a) => (
        <div key={a.id} className="row"><div className="flex-1"><p className="m-0 text-sm">{a.accion}{a.entidad ? ` · ${a.entidad} ${a.entidad_id ?? ''}` : ''}</p><p className="m-0 text-xs text-muted">{fechaHora(a.fecha)}</p></div></div>
      ))}
      </details>
    </Modal>
  )
}
