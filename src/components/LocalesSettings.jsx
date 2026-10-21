import { useEffect, useState } from 'react'
import Modal from './Modal'
import ConfirmAction from './ConfirmAction'
import { I } from './InvIcons'
import { Input, ErrorBox } from './ui'
import { useAuth } from '../context/AuthContext'
import { useAction } from '../lib/useAction'
import { supabase } from '../lib/supabase'
import { mensajeError } from '../lib/format'
import { toast } from '../lib/toast'
import { useLocales, avisarCambioLocales, cargarStockLocales } from '../lib/locales'
import '../styles/locales.css'

// Más › Configuración › Locales: sedes del negocio (nombre, dirección, número de local, teléfono)
export default function LocalesSettings() {
  const { perfil } = useAuth()
  const loc = useLocales(perfil)
  const [editar, setEditar] = useState(null), [desactivar, setDesactivar] = useState(null)
  const [stats, setStats] = useState({}), [tick, setTick] = useState(0)
  useEffect(() => {
    if (!loc.habilitado) return
    let vivo = true
    Promise.all([cargarStockLocales(supabase, null), supabase.from('perfiles').select('id,local_id,activo')]).then(([sl, pf]) => {
      if (!vivo) return
      const s = {}
      for (const porLocal of Object.values(sl || {})) for (const [id, n] of Object.entries(porLocal)) (s[id] ||= { unidades: 0, equipo: 0 }).unidades += n
      for (const p of pf.data || []) if (p.activo && p.local_id != null) (s[p.local_id] ||= { unidades: 0, equipo: 0 }).equipo++
      setStats(s)
    })
    return () => { vivo = false }
  }, [loc.habilitado, loc.todos, tick])
  useEffect(() => { if (loc.habilitado && window.location.hash === '#locales') setTimeout(() => document.getElementById('locales')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 250) }, [loc.habilitado])
  if (!loc.habilitado) return null
  const listo = () => { avisarCambioLocales(); setTick(t => t + 1) }
  const cambiarEstado = async l => {
    const { error } = await supabase.from('locales').update({ activo: !l.activo }).eq('id', l.id)
    if (error) throw new Error(mensajeError(error))
    toast(l.activo ? 'Local desactivado' : 'Local activado'); listo()
  }
  return <section className="settings-group" id="locales">
    <h2 className="admin-group-title">Locales</h2>
    <p className="admin-hint">Catálogo, precios, proveedores y clientes son compartidos. Cada local lleva su inventario, sus ventas y su equipo. La factura muestra la dirección del local que vende.</p>
    <div className="loc-lista">
      {loc.todos.map(l => <div key={l.id} className={'loc-card' + (l.activo ? '' : ' off')}>
        <span className="loc-card-ic"><I n="store" /></span>
        <div className="loc-card-body">
          <b>{l.nombre}{!l.activo && ' · inactivo'}</b>
          <small>{[l.direccion, l.numero && 'Local ' + l.numero].filter(Boolean).join(' · ') || 'Sin dirección registrada'}</small>
          {l.telefono && <small>{l.telefono}</small>}
          <div className="loc-card-stats">
            <span className="loc-tag">{stats[l.id]?.unidades || 0} unidades en stock</span>
            <span className="loc-tag">{stats[l.id]?.equipo || 0} {stats[l.id]?.equipo === 1 ? 'persona' : 'personas'}</span>
          </div>
        </div>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button type="button" className="btn sec sm" onClick={() => setEditar(l)}>Editar</button>
          {(l.activo ? loc.locales.length > 1 : true) && <button type="button" className="btn sec sm" onClick={() => l.activo ? setDesactivar(l) : cambiarEstado(l).catch(e => toast(e.message))}>{l.activo ? 'Desactivar' : 'Activar'}</button>}
        </span>
      </div>)}
    </div>
    <button type="button" className="btn sec full mt-3" onClick={() => setEditar({})}><I n="plus" />Agregar local</button>
    {editar && <EditarLocal l={editar} onClose={() => setEditar(null)} onSaved={() => { setEditar(null); listo() }} />}
    {desactivar && <ConfirmAction title="Desactivar local" label="Desactivar" onClose={() => setDesactivar(null)} onConfirm={() => cambiarEstado(desactivar)}>«{desactivar.nombre}» dejará de aparecer para vender. Su historial se conserva. Antes traslada su inventario y cambia de local a su equipo.</ConfirmAction>}
  </section>
}

function EditarLocal({ l, onClose, onSaved }) {
  const nuevo = !l.id
  const [f, setF] = useState({ nombre: l.nombre || '', direccion: l.direccion || '', numero: l.numero || '', telefono: l.telefono || '' })
  const [err, setErr] = useState('')
  const set = k => e => { setF({ ...f, [k]: e.target.value }); setErr('') }
  const [guardar, pending] = useAction(async () => {
    if (!f.nombre.trim()) return setErr('Escribe el nombre del local.')
    const datos = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || null]))
    const { error } = nuevo ? await supabase.from('locales').insert(datos) : await supabase.from('locales').update(datos).eq('id', l.id)
    if (error) return setErr(/duplicate|unique/i.test(error.message || '') ? 'Ya existe un local con ese nombre.' : mensajeError(error))
    toast(nuevo ? 'Local creado' : 'Local actualizado'); onSaved()
  })
  return <Modal title={nuevo ? 'Nuevo local' : 'Editar local'} subtitle="Sale en las facturas de este local" className="admin-sheet settings-edit-sheet" keyboardAware onClose={onClose} footer={<button className="btn full" disabled={pending} onClick={guardar}>{pending ? 'Guardando…' : nuevo ? 'Crear local' : 'Guardar local'}</button>}>
    <ErrorBox text={err} />
    <Input autoFocus required label="Nombre del local" placeholder="Ej: Local Centro" maxLength={60} value={f.nombre} onChange={set('nombre')} />
    <Input label="Dirección" placeholder="Ej: Cra 10 #12-30, C.C. Unicentro" maxLength={160} value={f.direccion} onChange={set('direccion')} />
    <Input label="Número de local" placeholder="Ej: 105" maxLength={30} value={f.numero} onChange={set('numero')} />
    <Input label="Teléfono" type="tel" inputMode="tel" maxLength={40} value={f.telefono} onChange={set('telefono')} />
    <p className="admin-hint">Si dejas la dirección o el teléfono vacíos, la factura usa los datos generales de la empresa.</p>
  </Modal>
}
