import { useEffect, useRef, useState } from 'react'
import ConfirmAction from '../components/ConfirmAction'
import { useAction } from '../lib/useAction'
import AppShell from '../components/AppShell'
import Modal from '../components/Modal'
import { FormSection, PremiumSwitch, RoleField, PasswordField } from '../components/AdminPrimitives'
import { Empty, Loader, Badge, Input, ErrorBox, SearchBar, Select } from '../components/ui'
import { supabase, isDemoMode } from '../lib/supabase'
import { fechaHora, mensajeError, money, hoyBogota, rangoMes } from '../lib/format'
import { describirActividad } from '../lib/actividadTexto'
import { Icon } from '../components/Icons'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLocales } from '../lib/locales'
import LocalSelector, { LocalTag } from '../components/LocalSelector'

// Una línea del historial, escrita para personas (no códigos internos)
function ActividadFila({ a }) {
  const navigate = useNavigate()
  const x = describirActividad(a)
  const Tag = x.to ? 'button' : 'div'
  return <Tag {...(x.to ? { type: 'button', onClick: () => navigate(x.to) } : {})} className={'emp-act' + (x.to ? ' is-link' : '')}>
    <span className={'emp-act-ic ' + x.tono}><Icon name={x.icono} /></span>
    <span className="emp-act-main"><b>{x.titulo}</b>{x.detalle && <small>{x.detalle}</small>}</span>
    <span className="emp-act-time">{fechaHora(a.fecha)}</span>
  </Tag>
}
import { toast } from '../lib/toast'
import { createEmployee, loadEmployees, normalizeEmployeeInput } from '../lib/employeeCreation'

const PERMISOS = [
  ['vender', 'Vender y facturar'], ['ver_inventario', 'Ver inventario'], ['editar_inventario', 'Modificar inventario'],
  ['editar_precios', 'Cambiar precios'], ['ver_costos', 'Ver costos'], ['crear_clientes', 'Crear clientes'],
  ['hacer_devoluciones', 'Hacer devoluciones'], ['anular_facturas', 'Anular facturas'], ['registrar_compras', 'Registrar compras'], ['ver_finanzas', 'Ver finanzas'],
]
const BASE = ['vender', 'ver_inventario', 'crear_clientes']

export default function Empleados() {
  const { perfil } = useAuth()
  const loc = useLocales(perfil)
  const [q, setQ] = useState('')
  const [lista, setLista] = useState(null)
  const [listError, setListError] = useState('')
  const [nuevo, setNuevo] = useState(false)
  const [sel, setSel] = useState(null)
  const [tick, setTick] = useState(0)
  const [sales, setSales] = useState({day:[],month:[]})
  useEffect(()=>{if(!isDemoMode)return;const today=hoyBogota(),m=rangoMes();Promise.all([supabase.rpc('ventas_por_empleado',{p_desde:today,p_hasta:today}),supabase.rpc('ventas_por_empleado',{p_desde:m.ini,p_hasta:m.fin})]).then(([day,month])=>setSales({day:day.data||[],month:month.data||[]}))},[tick])
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
  // Con un local elegido se ven sus vendedores (y los administradores que ven todos los locales)
  const delLocal = p => !loc.filtro || p.local_id === loc.filtro || (p.rol === 'admin' && p.local_id == null)
  const visible = (lista||[]).filter(p=>delLocal(p)&&[p.nombre,p.correo,p.rol].some(v=>String(v||'').toLocaleLowerCase().includes(q.toLocaleLowerCase())))
  const refrescar = () => { setTick((t) => t + 1) }
  const creado = profile => {
    setNuevo(false); setQ('')
    setLista(previous => [...(previous || []).filter(p => p.id !== profile.id), profile].sort((a,b) => a.nombre.localeCompare(b.nombre)))
    refrescar()
  }

  return (
    <div className="admin-premium admin-employees"><AppShell title="Empleados" sub="Equipo, acceso y permisos" right={<button className="btn sm" onClick={() => setNuevo(true)}>+ Vendedor</button>}>
      <ErrorBox text={listError} />
      {listError && <button className="btn sec sm" onClick={refrescar}>Actualizar lista</button>}
      <LocalSelector loc={loc} />
      <SearchBar value={q} onChange={setQ} placeholder="Buscar empleado o correo" />
      {!lista ? <Loader /> : visible.length === 0 ? <Empty /> : (
        <div className="admin-list entity-list">
          {visible.map((p) => (
            <button type="button" key={p.id} className="row card admin-list-card employee-card" onClick={() => setSel(p)}>
              <div className="employee-card-heading"><span className="entity-avatar">{p.nombre.slice(0,1)}</span><div className="employee-card-copy"><p className="admin-card-title">{p.nombre}</p><p className="admin-card-secondary">{p.rol==='admin'?'Administrador':'Vendedor'}</p></div><Badge tone={p.activo?'good':'bad'}>{p.activo?'Activo':'Inactivo'}</Badge></div>
              <p className="admin-card-secondary mt-2">{p.correo}</p>{loc.multi && <p className="mt-2"><LocalTag nombre={p.local_id != null ? loc.nombre(p.local_id) : p.rol === 'admin' ? 'Todos los locales' : 'Sin local'} /></p>}{isDemoMode&&<div className="employee-summary"><div className="employee-summary-grid"><span><small>Ventas mes</small><b>{money(sales.month.find(s=>s.vendedor_id===p.id)?.total_vendido||0)}</b></span><span><small>Facturas mes</small><b>{sales.month.find(s=>s.vendedor_id===p.id)?.facturas||0}</b></span></div><div className="employee-aux"><span>Hoy {money(sales.day.find(s=>s.vendedor_id===p.id)?.total_vendido||0)} · {sales.month.find(s=>s.vendedor_id===p.id)?.facturas||0} facturas mes</span><span className="admin-chevron" aria-hidden="true">›</span></div></div>}
            </button>
          ))}
        </div>
      )}
      {nuevo && <Nuevo loc={loc} onClose={() => setNuevo(false)} onSaved={creado} />}
      {sel && <Detalle loc={loc} p={sel} onClose={() => setSel(null)} onCambio={() => { refrescar(); setSel(null) }} />}
    </AppShell></div>
  )
}

function Permisos({ value, onChange }) {
  return PERMISOS.map(([k, t]) => (
    <PremiumSwitch key={k} label={t} checked={value.includes(k)} onChange={checked=>onChange(checked ? [...value, k] : value.filter((x) => x !== k))}/>
  ))
}

function Nuevo({ loc, onClose, onSaved }) {
  const [localId, setLocalId] = useState(loc?.filtro || loc?.miLocal || loc?.locales[0]?.id || null)
  const [f, setF] = useState({ nombre: '', correo: '', password: '', telefono: '' })
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
      let profile = await createEmployee(supabase, input, { demo: isDemoMode })
      // El vendedor queda asignado al local elegido
      if (loc?.multi && localId != null && profile?.id && profile.local_id !== localId) {
        const r = isDemoMode ? await supabase.rpc('guardar_empleado_demo', { id: profile.id, datos: { local_id: localId }, permisos: input.permisos || [] }) : await supabase.from('perfiles').update({ local_id: localId }).eq('id', profile.id)
        if (!r.error) profile = { ...profile, local_id: localId }
      }
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
      {loc?.multi && <FormSection number="03" title="Local donde trabaja"><Select label="Local" value={localId || ''} onChange={e => setLocalId(Number(e.target.value))}>{loc.locales.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}</Select><p className="admin-hint">Vende en este local. Puede ver el stock del otro local y vender desde allá.</p></FormSection>}
      <FormSection number={loc?.multi ? '04' : '03'} title="Permisos" collapsible detail={`${permisos.length} activos`}><Permisos value={permisos} onChange={setPermisos}/></FormSection>
    </Modal>
  )
}

function Detalle({ p, loc, onClose, onCambio }) {
  const [localId, setLocalId] = useState(p.local_id ?? '')
  const [permisos, setPermisos] = useState(null)
  const [act, setAct] = useState(null)
  const [name,setName] = useState(p.nombre), [documento,setDocumento] = useState(p.documento||''), [rol,setRol] = useState(p.rol), [confirm,setConfirm] = useState(false), [sales,setSales] = useState([])
  const [tel, setTel] = useState(p.telefono || '')
  const [err, setErr] = useState('')
  const esAdmin = p.rol === 'admin'
  // Restablecer acceso del vendedor (correo y/o contraseña nuevos)
  const [acceso, setAcceso] = useState({ correo: p.correo || '', clave: '' }), [accesoErr, setAccesoErr] = useState(''), [confirmAcceso, setConfirmAcceso] = useState(false), [listo, setListo] = useState(null)
  const correoNuevo = acceso.correo.trim().toLowerCase() !== String(p.correo || '').toLowerCase()
  function pedirAcceso() {
    setAccesoErr('')
    if (!correoNuevo && !acceso.clave) return setAccesoErr('Escribe un correo nuevo o una contraseña nueva.')
    if (correoNuevo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(acceso.correo.trim())) return setAccesoErr('Escribe un correo válido.')
    if (acceso.clave && acceso.clave.length < 8) return setAccesoErr('La contraseña debe tener al menos 8 caracteres.')
    setConfirmAcceso(true)
  }
  async function restablecerAcceso() {
    const { error } = await supabase.rpc('admin_actualizar_acceso', { p_perfil: p.id, p_correo: correoNuevo ? acceso.correo.trim() : null, p_clave: acceso.clave || null })
    if (error) { const m = error.code === 'PGRST202' ? 'Falta activar esta opción: ejecuta el script 09 en Supabase.' : mensajeError(error); setAccesoErr(m); throw new Error(m) }
    setListo({ correo: correoNuevo ? acceso.correo.trim().toLowerCase() : p.correo, clave: acceso.clave }); setAcceso({ correo: correoNuevo ? acceso.correo.trim().toLowerCase() : p.correo, clave: '' })
    toast('Acceso restablecido')
  }

  useEffect(() => {
    if(isDemoMode) supabase.from('facturas_netas').select('*').eq('vendedor_id',p.id).order('fecha',{ascending:false}).then(({data})=>setSales(data||[]))
    supabase.from('perfil_permisos').select('permiso').eq('perfil_id', p.id).then(({ data }) => setPermisos((data || []).map((r) => r.permiso)))
    supabase.from('actividad').select('*').eq('perfil_id', p.id).order('fecha', { ascending: false }).limit(25).then(({ data }) => setAct(data || []))
  }, [p.id])

  const [guardar, pendingSave] = useAction(guardarImpl)
  async function guardarImpl() {
    setErr('')
    if(isDemoMode){ const {error}=await supabase.rpc('guardar_empleado_demo',{id:p.id,datos:{nombre:name.trim(),documento:documento.trim()||null,telefono:tel.trim()||null,rol,comision_pct:null,...(loc?.multi?{local_id:localId===''?null:Number(localId)}:{})},permisos:permisos||[]});if(error)return setErr(mensajeError(error));toast('Cambios guardados');onCambio();return }
    const { error } = await supabase.from('perfiles').update({ telefono: tel.trim() || null, comision_pct: null, ...(loc?.multi ? { local_id: localId === '' ? null : Number(localId) } : {}) }).eq('id', p.id)
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
      {loc?.multi && <FormSection title="Local"><Select label="Local donde trabaja" value={localId} onChange={e => setLocalId(e.target.value)}>{esAdmin && <option value="">Todos los locales</option>}{loc.locales.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}</Select><p className="admin-hint">{esAdmin ? 'Un administrador sin local ve y vende en todos.' : 'Sus ventas quedan en este local. Puede vender productos del otro local y se descuentan de allá.'}</p></FormSection>}
      {isDemoMode&&<FormSection title="Rol"><RoleField label="Rol empleado" value={rol} onChange={e=>setRol(e.target.value)}/></FormSection>}
      {!esAdmin && !isDemoMode && <FormSection title="Acceso del vendedor">
        <p className="admin-hint">Si el vendedor olvidó su correo o contraseña, asígnale unos nuevos aquí. Sus sesiones abiertas se cerrarán.</p>
        <ErrorBox text={accesoErr} />
        {listo && <div className="access-done" role="status"><b>Acceso actualizado</b><span>Correo: {listo.correo}</span>{listo.clave && <span>Contraseña: <code>{listo.clave}</code></span>}<small>Compártelos con el vendedor por un medio privado.</small></div>}
        <Input label="Correo para iniciar sesión" type="email" autoComplete="off" value={acceso.correo} onChange={e => { setListo(null); setAcceso({ ...acceso, correo: e.target.value }) }} />
        <PasswordField label="Nueva contraseña (opcional)" value={acceso.clave} onChange={e => { setListo(null); setAcceso({ ...acceso, clave: e.target.value }) }} generate />
        <button type="button" className="btn sec full" onClick={pedirAcceso}>Restablecer acceso</button>
      </FormSection>}
      {confirmAcceso && <ConfirmAction title="Restablecer acceso" label="Restablecer" onClose={() => setConfirmAcceso(false)} onConfirm={restablecerAcceso}>{p.nombre} {correoNuevo ? `entrará con el correo ${acceso.correo.trim().toLowerCase()}` : 'conservará su correo'}{acceso.clave ? ' y con la nueva contraseña' : ''}. Sus sesiones abiertas se cerrarán.</ConfirmAction>}
      {!esAdmin && (
        <>
          <FormSection title="Permisos" collapsible detail={permisos?`${permisos.length} activos`:'Cargando…'}>{permisos ? <Permisos value={permisos} onChange={setPermisos} /> : <Loader />}</FormSection>
          <div className="admin-discreet-action"><button className={p.activo?'admin-reset':'btn sec full'} onClick={()=>setConfirm(true)}>{p.activo ? 'Desactivar empleado' : 'Activar empleado'}</button></div>
        </>
      )}
      {confirm&&<ConfirmAction title={p.activo?'Desactivar empleado':'Activar empleado'} label="Confirmar estado" onClose={()=>setConfirm(false)} onConfirm={alternar}>Se conserva el historial. El empleado desactivado no podra iniciar sesion.</ConfirmAction>}
      {isDemoMode&&<details className="admin-history"><summary>Ventas</summary><p className="text-sm">Mes actual: {money(sales.filter(f=>f.estado==='emitida'&&f.fecha.slice(0,7)===hoyBogota().slice(0,7)).reduce((n,f)=>n+(f.total_neto||0),0))}</p>{sales.map(f=><div className="row" key={f.id}><span className="flex-1 text-sm">{f.prefijo}-{f.numero} - {f.estado}</span><span className="text-xs">{money(f.total_neto)}</span></div>)}</details>}
      <details className="admin-history"><summary>Historial de actividad</summary>
      {!act ? <Loader /> : act.length === 0 ? <Empty text="Sin actividad" /> : act.map((a) => (
        <ActividadFila key={a.id} a={a} />
      ))}
      </details>
    </Modal>
  )
}
