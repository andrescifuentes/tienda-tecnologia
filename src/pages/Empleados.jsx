import EmployeeSales from '../components/EmployeeSales'
import FitAmount from '../components/FitAmount'
import { withDeadline, requireData, cancellableQuery } from '../lib/asyncResult'
import ActivityTimeline from '../components/ActivityTimeline'
import { loadActivity } from '../lib/activityPresentation'
import { useEffect, useRef, useState } from 'react'
import ConfirmAction from '../components/ConfirmAction'
import { useAction } from '../lib/useAction'
import AppShell from '../components/AppShell'
import Modal from '../components/Modal'
import { FormSection, PremiumSwitch, RoleField, PasswordField } from '../components/AdminPrimitives'
import { Empty, Loader, Badge, Input, ErrorBox, SearchBar, Select } from '../components/ui'
import { supabase, isDemoMode } from '../lib/supabase'
import { fechaHora, mensajeError, money, hoyBogota, rangoMes } from '../lib/format'
import { toast } from '../lib/toast'
import { createEmployee, loadEmployees, normalizeEmployeeInput } from '../lib/employeeCreation'

const PERMISOS = [
  ['vender', 'Vender y facturar'], ['ver_inventario', 'Ver inventario'], ['editar_inventario', 'Modificar inventario'],
  ['editar_precios', 'Cambiar precios'], ['ver_costos', 'Ver costos'], ['crear_clientes', 'Crear clientes'],
  ['hacer_devoluciones', 'Hacer devoluciones'], ['anular_facturas', 'Anular facturas'], ['registrar_compras', 'Registrar compras'], ['ver_finanzas', 'Ver finanzas'],
]
const BASE = ['vender', 'ver_inventario', 'crear_clientes']

export default function Empleados() {
  const [q, setQ] = useState('')
  const [lista, setLista] = useState(null)
  const [listError, setListError] = useState('')
  const [nuevo, setNuevo] = useState(false)
  const [sel, setSel] = useState(null)
  const [tick, setTick] = useState(0)
  const [sales,setSales]=useState(null),[salesError,setSalesError]=useState('')
  useEffect(()=>{let live=true;const controller=new AbortController();setSalesError('');setSales(null);const today=hoyBogota(),m=rangoMes()
    withDeadline(async signal=>{const results=await Promise.all([cancellableQuery(supabase.rpc('ventas_por_empleado',{p_desde:today,p_hasta:today}),signal),cancellableQuery(supabase.rpc('ventas_por_empleado',{p_desde:m.ini,p_hasta:m.fin}),signal)]);return{day:requireData(results[0])||[],month:requireData(results[1])||[]}}, {signal:controller.signal}).then(data=>{if(live)setSales(data)}).catch(()=>{if(live)setSalesError('No se pudo consultar el rendimiento del equipo. Actualiza la lista para reintentar.')});return()=>{live=false;controller.abort()}
  },[tick])
  useEffect(() => {
    let current = true
    setListError('')
    loadEmployees(supabase).then(data => { if (current) setLista(data) }).catch(error => {
      if (!current) return
      setLista(previous => previous || [])
      setListError(error.message)
      console.error('[crear-empleado]', { stage: 'lista', code: error.code })
    })
    return () => { current = false }
  }, [tick])
  const visible = (lista||[]).filter(p=>[p.nombre,p.correo,p.rol].some(v=>String(v||'').toLocaleLowerCase().includes(q.toLocaleLowerCase())))
  const refrescar = () => { setTick((t) => t + 1) }
  const creado = profile => {
    setNuevo(false); setQ('')
    setLista(previous => [...(previous || []).filter(p => p.id !== profile.id), profile].sort((a,b) => a.nombre.localeCompare(b.nombre)))
    refrescar()
  }

  return (
    <div className="admin-premium admin-employees"><AppShell title="Empleados" sub="Equipo, acceso y comisiones" right={<button className="btn sm" onClick={() => setNuevo(true)}>+ Vendedor</button>}>
      <ErrorBox text={listError||salesError} />
      {(listError||salesError) && <button className="btn sec sm" onClick={refrescar}>Actualizar lista</button>}
      <SearchBar value={q} onChange={setQ} placeholder="Buscar empleado o correo" />
      {!lista ? <Loader /> : visible.length === 0 ? <Empty /> : (
        <div className="admin-list entity-list">
          {visible.map((p) => (
            <button type="button" key={p.id} className="row card admin-list-card employee-card" onClick={() => setSel(p)}>
              <div className="employee-card-heading"><span className="entity-avatar">{p.nombre.slice(0,1)}</span><div className="employee-card-copy"><p className="admin-card-title">{p.nombre}</p><p className="admin-card-secondary">{p.rol==='admin'?'Administrador':'Vendedor'}</p></div><Badge tone={p.activo?'good':'bad'}>{p.activo?'Activo':'Inactivo'}</Badge></div>
              <p className="admin-card-secondary mt-2">{p.correo}</p>{sales&&<div className="employee-summary"><div className="employee-summary-grid"><span><small>Ventas mes</small><b><FitAmount>{money(sales.month.find(s=>s.vendedor_id===p.id)?.total_vendido||0)}</FitAmount></b></span><span><small>Comisión {p.comision_pct!=null?`(${p.comision_pct}%)`:''}</small><b><FitAmount>{money(sales.month.find(s=>s.vendedor_id===p.id)?.comision||0)}</FitAmount></b></span></div><div className="employee-aux"><span>Hoy {money(sales.day.find(s=>s.vendedor_id===p.id)?.total_vendido||0)} · {sales.month.find(s=>s.vendedor_id===p.id)?.facturas||0} facturas mes</span><span className="admin-chevron" aria-hidden="true">›</span></div></div>}
            </button>
          ))}
        </div>
      )}
      {nuevo && <Nuevo onClose={() => setNuevo(false)} onSaved={creado} />}
      {sel && <Detalle p={sel} onSalesChange={refrescar} onClose={() => setSel(null)} onCambio={() => { refrescar(); setSel(null) }} />}
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
  const sending = useRef(false), mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [crear, pendingCreate] = useAction(crearImpl)
  const cerrar = () => {
    if (sending.current) { toast('La creaci\u00f3n sigue en curso. Espera su resultado antes de cerrar.'); return }
    onClose()
  }
  async function crearImpl() {
    if (sending.current) return
    let input
    try {
      input = normalizeEmployeeInput({ ...f, rol: isDemoMode ? (f.rol || 'vendedor') : 'vendedor', permisos }, { demo: isDemoMode })
    } catch (error) { setErr(error.message); return }
    sending.current = true
    setBusy(true); setErr('')
    try {
      const profile = await createEmployee(supabase, input, { demo: isDemoMode })
      if (mounted.current) { toast('Empleado creado'); onSaved(profile) }
    } catch (error) {
      if (mounted.current) setErr(error.message)
    } finally {
      sending.current = false
      if (mounted.current) setBusy(false)
    }
  }
  return (
    <Modal title="Nuevo vendedor" subtitle="Acceso y perfil de tu equipo" className="admin-sheet employee-create-sheet" keyboardAware onClose={cerrar} footer={<button className="btn full" onClick={crear} disabled={busy || pendingCreate}>{busy ? 'Creando…' : 'Crear usuario'}</button>}>
      <ErrorBox text={err} />
      <FormSection number="01" title="Identidad"><div className="admin-form-grid"><div className="admin-span"><Input required label="Nombre completo" value={f.nombre} onChange={set('nombre')}/></div>{isDemoMode&&<Input label="Documento empleado" value={f.documento||''} onChange={set('documento')}/>}<Input label="Teléfono" value={f.telefono} onChange={set('telefono')} inputMode="tel"/></div></FormSection>
      <FormSection number="02" title="Acceso"><Input label="Correo (con él inicia sesión)" type="email" value={f.correo} onChange={set('correo')}/>{isDemoMode&&<RoleField label="Rol" value={f.rol||'vendedor'} onChange={set('rol')}/>}<PasswordField value={f.password} onChange={set('password')} generate={isDemoMode}/></FormSection>
      <FormSection number="03" title="Comisiones"><div className="commission-field"><Input label="Comisión % (opcional)" type="number" min="0" max="100" step="0.01" value={f.comision_pct} onChange={set('comision_pct')}/></div></FormSection>
      <FormSection number="04" title="Permisos" collapsible detail={`${permisos.length} activos`}><Permisos value={permisos} onChange={setPermisos}/></FormSection>
    </Modal>
  )
}

function Detalle({ p, onClose, onCambio, onSalesChange }) {
  const [permisos, setPermisos] = useState(null)
  const [act, setAct] = useState(null),[actError,setActError]=useState(''),[auditTick,setAuditTick]=useState(0),[salesExpanded,setSalesExpanded]=useState(false)
  const [name,setName] = useState(p.nombre), [documento,setDocumento] = useState(p.documento||''), [rol,setRol] = useState(p.rol), [confirm,setConfirm] = useState(false)
  const [tel, setTel] = useState(p.telefono || '')
  const [com, setCom] = useState(p.comision_pct ?? '')
  const [err, setErr] = useState('')
  const esAdmin = p.rol === 'admin'

  useEffect(() => {
    supabase.from('perfil_permisos').select('permiso').eq('perfil_id', p.id).then(({ data }) => setPermisos((data || []).map((r) => r.permiso)))
  }, [p.id])

  useEffect(()=>{let live=true;const controller=new AbortController();setAct(null);setActError('');loadActivity(supabase,{perfilId:p.id,esAdmin:false,limit:25,signal:controller.signal}).then(rows=>{if(live)setAct(rows)}).catch(()=>{if(live)setActError('No se pudo cargar la actividad del empleado.')});return()=>{live=false;controller.abort()}},[p.id,auditTick])

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
      <details className="admin-history employee-sales-history" onToggle={e=>setSalesExpanded(e.currentTarget.open)}><summary>Ventas y comisiones</summary>{salesExpanded&&<EmployeeSales embedded employee={{vendedor_id:p.id,nombre:p.nombre}} onChange={()=>{setAuditTick(n=>n+1);onSalesChange?.()}}/>}</details>
      <details className="admin-history"><summary>Historial de actividad</summary>{actError?<><ErrorBox text={actError}/><button type="button" className="btn sec full" onClick={()=>setAuditTick(n=>n+1)}>Reintentar actividad</button></>:act?<ActivityTimeline items={act}/>:<Loader/>}</details>
    </Modal>
  )
}
