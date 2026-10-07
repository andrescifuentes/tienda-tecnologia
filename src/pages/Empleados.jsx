import { useEffect, useState } from 'react'
import AppShell from '../components/AppShell'
import Modal from '../components/Modal'
import { Empty, Loader, Badge, Input, ErrorBox } from '../components/ui'
import { supabase } from '../lib/supabase'
import { fechaHora, mensajeError } from '../lib/format'
import { toast } from '../lib/toast'

const PERMISOS = [
  ['vender', 'Vender y facturar'], ['ver_inventario', 'Ver inventario'], ['editar_inventario', 'Modificar inventario'],
  ['editar_precios', 'Cambiar precios'], ['ver_costos', 'Ver costos'], ['crear_clientes', 'Crear clientes'],
  ['hacer_devoluciones', 'Hacer devoluciones'], ['anular_facturas', 'Anular facturas'], ['registrar_compras', 'Registrar compras'], ['ver_finanzas', 'Ver finanzas'],
]
const BASE = ['vender', 'ver_inventario', 'crear_clientes']

export default function Empleados() {
  const [lista, setLista] = useState(null)
  const [nuevo, setNuevo] = useState(false)
  const [sel, setSel] = useState(null)
  const [tick, setTick] = useState(0)
  useEffect(() => { supabase.from('perfiles').select('*').order('nombre').then(({ data }) => setLista(data || [])) }, [tick])
  const refrescar = () => setTick((t) => t + 1)

  return (
    <AppShell title="Empleados" sub="Solo el administrador crea usuarios" right={<button className="btn sm !bg-white !text-brand" onClick={() => setNuevo(true)}>+ Vendedor</button>}>
      {!lista ? <Loader /> : lista.length === 0 ? <Empty /> : (
        <div className="card !p-2">
          {lista.map((p) => (
            <div key={p.id} className="row cursor-pointer" onClick={() => setSel(p)}>
              <div className="flex-1"><p className="m-0 text-sm font-semibold">{p.nombre}</p><p className="m-0 text-xs text-muted">{p.correo}</p></div>
              <div className="flex gap-1"><Badge tone={p.rol === 'admin' ? 'good' : ''}>{p.rol}</Badge>{!p.activo && <Badge tone="bad">inactivo</Badge>}</div>
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
  async function crear() {
    if (!f.nombre.trim() || !f.correo.trim()) return setErr('Nombre y correo son obligatorios.')
    if (f.password.length < 8) return setErr('La contraseña debe tener al menos 8 caracteres.')
    setBusy(true); setErr('')
    const { data, error } = await supabase.functions.invoke('crear-empleado', {
      body: { nombre: f.nombre.trim(), correo: f.correo.trim().toLowerCase(), password: f.password, telefono: f.telefono.trim() || null, rol: 'vendedor', comision_pct: f.comision_pct === '' ? null : Number(f.comision_pct), permisos },
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
    <Modal title="Nuevo vendedor" onClose={onClose} footer={<button className="btn full" onClick={crear} disabled={busy}>{busy ? 'Creando…' : 'Crear usuario'}</button>}>
      <ErrorBox text={err} />
      <Input label="Nombre completo" value={f.nombre} onChange={set('nombre')} />
      <Input label="Correo (con él inicia sesión)" type="email" value={f.correo} onChange={set('correo')} />
      <Input label="Contraseña inicial" type="text" value={f.password} onChange={set('password')} />
      <Input label="Teléfono" value={f.telefono} onChange={set('telefono')} inputMode="tel" />
      <Input label="Comisión % (opcional)" type="number" min="0" max="100" step="0.5" value={f.comision_pct} onChange={set('comision_pct')} />
      <h4 className="text-sm text-muted uppercase mb-1">Permisos</h4>
      <Permisos value={permisos} onChange={setPermisos} />
    </Modal>
  )
}

function Detalle({ p, onClose, onCambio }) {
  const [permisos, setPermisos] = useState(null)
  const [act, setAct] = useState(null)
  const [tel, setTel] = useState(p.telefono || '')
  const [com, setCom] = useState(p.comision_pct ?? '')
  const [err, setErr] = useState('')
  const esAdmin = p.rol === 'admin'

  useEffect(() => {
    supabase.from('perfil_permisos').select('permiso').eq('perfil_id', p.id).then(({ data }) => setPermisos((data || []).map((r) => r.permiso)))
    supabase.from('actividad').select('*').eq('perfil_id', p.id).order('fecha', { ascending: false }).limit(25).then(({ data }) => setAct(data || []))
  }, [p.id])

  async function guardar() {
    setErr('')
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
    if (error) return setErr(mensajeError(error))
    toast(p.activo ? 'Empleado desactivado' : 'Empleado activado'); onCambio()
  }

  return (
    <Modal title={p.nombre} onClose={onClose} footer={<button className="btn full" onClick={guardar}>Guardar cambios</button>}>
      <ErrorBox text={err} />
      <p className="text-sm text-muted mt-0">{p.correo} · {p.rol}</p>
      <Input label="Teléfono" value={tel} onChange={(e) => setTel(e.target.value)} />
      <Input label="Comisión % (vacío = sin comisión)" type="number" min="0" max="100" step="0.5" value={com} onChange={(e) => setCom(e.target.value)} />
      {!esAdmin && (
        <>
          <h4 className="text-sm text-muted uppercase mb-1">Permisos</h4>
          {permisos ? <Permisos value={permisos} onChange={setPermisos} /> : <Loader />}
          <button className={'btn full my-3 ' + (p.activo ? 'bad' : 'sec')} onClick={alternar}>{p.activo ? 'Desactivar empleado' : 'Activar empleado'}</button>
        </>
      )}
      <h4 className="text-sm text-muted uppercase mt-3 mb-1">Historial de actividad</h4>
      {!act ? <Loader /> : act.length === 0 ? <Empty text="Sin actividad" /> : act.map((a) => (
        <div key={a.id} className="row"><div className="flex-1"><p className="m-0 text-sm">{a.accion}{a.entidad ? ` · ${a.entidad} ${a.entidad_id ?? ''}` : ''}</p><p className="m-0 text-xs text-muted">{fechaHora(a.fecha)}</p></div></div>
      ))}
    </Modal>
  )
}
