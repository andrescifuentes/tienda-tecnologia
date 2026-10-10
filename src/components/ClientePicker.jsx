import { useEffect, useState } from 'react'
import Modal from './Modal'
import { SearchBar, Empty, Input, Select, ErrorBox } from './ui'
import { supabase, isDemoMode } from '../lib/supabase'
import { limpiarBusqueda, mensajeError } from '../lib/format'
import { useAction } from '../lib/useAction'
import { useAuth } from '../context/AuthContext'
import { I } from './InvIcons'

export function ClienteForm({ inicial, onSaved, onClose }) {
  const [f, setF] = useState({ tipo_documento: 'CC', documento: '', nombre: '', telefono: '', correo: '', direccion: '', ...(inicial || {}) })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const [guardar, pendingSave] = useAction(guardarImpl, () => setBusy(false))
  async function guardarImpl() {
    if (!f.nombre.trim() || (!isDemoMode && !f.documento?.trim())) return setErr('Nombre y documento son obligatorios.')
    const tel = String(f.telefono || '').replace(/\D/g, '')
    if (!tel) return setErr('El número de WhatsApp es obligatorio.')
    if (tel.length < 10) return setErr('Escribe un número de WhatsApp válido (10 dígitos).')
    setBusy(true); setErr('')
    const datos = { tipo_documento: f.tipo_documento, documento: (f.documento?.trim() || null), nombre: f.nombre.trim(), telefono: f.telefono?.trim() || null, correo: f.correo?.trim() || null, direccion: f.direccion?.trim() || null }
    if(isDemoMode) { datos.ciudad=f.ciudad?.trim()||null; datos.notas=f.notas?.trim()||null; datos.documento=(f.documento?.trim() || null)||null }
    const q = inicial?.id ? supabase.from('clientes').update(datos).eq('id', inicial.id).select().single() : supabase.from('clientes').insert(datos).select().single()
    const { data, error } = await q
    setBusy(false)
    if (error) return setErr(mensajeError(error))
    onSaved(data)
  }
  const ini = (f.nombre || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase()
  const campo = (k, label, icon, props = {}) => <label className={'cf-field' + (f[k] ? ' filled' : '')}>
    <span className="cf-label">{label}{props.required && <em>*</em>}</span>
    <span className="cf-box"><span className="cf-ic"><I n={icon} /></span>{props.prefix && <span className="cf-prefix">{props.prefix}</span>}<input value={f[k] || ''} onChange={set(k)} placeholder={props.placeholder} inputMode={props.inputMode} type={props.type || 'text'} autoComplete="off" /></span>
  </label>
  return (
    <Modal title={inicial?.id ? 'Editar cliente' : 'Nuevo cliente'} subtitle="Sus datos quedan guardados para próximas ventas" className="experience-sheet client-form-sheet cf-sheet" keyboardAware onClose={onClose} footer={<button className="cf-save" onClick={guardar} disabled={busy || pendingSave}><I n="check" />{busy ? 'Guardando…' : inicial?.id ? 'Guardar cambios' : 'Guardar cliente'}</button>}>
      <div className="cf-hero">
        <span className={'cf-avatar' + (ini ? ' on' : '')}>{ini || <I n="user" />}</span>
        <span className="cf-hero-txt"><b>{f.nombre?.trim() || 'Nombre del cliente'}</b><small>{f.documento ? f.tipo_documento + ' ' + f.documento : 'Documento sin registrar'}</small></span>
      </div>
      <ErrorBox text={err} />
      <h4 className="cf-sec"><span>1</span>Identificación</h4>
      <div className="cf-doc-types" role="radiogroup" aria-label="Tipo de documento">
        {[['CC', 'Cédula'], ['NIT', 'NIT'], ['CE', 'Extranjería'], ['PASAPORTE', 'Pasaporte']].map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={f.tipo_documento === v} className={f.tipo_documento === v ? 'on' : ''} onClick={() => setF({ ...f, tipo_documento: v })}>{l}</button>)}
      </div>
      {campo('documento', 'Número de documento', 'idcard', { required: !isDemoMode, inputMode: 'numeric', placeholder: 'Ej. 1023456789' })}
      {campo('nombre', 'Nombre completo', 'user', { required: true, placeholder: 'Ej. Pepito Perez' })}
      <h4 className="cf-sec"><span>2</span>Contacto <small>para enviarle la factura</small></h4>
      {campo('telefono', 'WhatsApp', 'chat', { required: true, inputMode: 'tel', prefix: '+57', placeholder: '300 123 4567' })}
      {campo('correo', 'Correo electrónico', 'mail', { type: 'email', inputMode: 'email', placeholder: 'cliente@correo.com' })}
      {campo('direccion', 'Dirección', 'pin', { placeholder: 'Opcional' })}
      {isDemoMode && campo('ciudad', 'Ciudad', 'pin', { placeholder: 'Opcional' })}
      {isDemoMode && campo('notas', 'Notas', 'pencil', { placeholder: 'Opcional' })}
    </Modal>
  )
}

export default function ClientePicker({ onPick, onClose, sinConsumidor = false }) {
  const { can } = useAuth()
  const [q, setQ] = useState('')
  const [lista, setLista] = useState([])
  const [nuevo, setNuevo] = useState(false)
  useEffect(() => {
    const t = setTimeout(async () => {
      const s = limpiarBusqueda(q)
      let qq = supabase.from('clientes').select('*').order('nombre').limit(25)
      if(isDemoMode) qq=qq.eq('activo',true)
      if (s) qq = qq.or(`nombre.ilike.%${s}%,documento.ilike.%${s}%,telefono.ilike.%${s}%`)
      const { data } = await qq
      setLista(data || [])
    }, 250)
    return () => clearTimeout(t)
  }, [q])
  if (nuevo) return <ClienteForm onClose={() => setNuevo(false)} onSaved={(c) => onPick(c)} />
  return (
    <Modal title="Elegir cliente" className="experience-sheet client-picker-sheet" keyboardAware onClose={onClose}>
      <SearchBar value={q} onChange={setQ} placeholder="Nombre, documento o teléfono" />
      {!sinConsumidor && <button className="btn sec full mb-2" onClick={() => onPick(null)}>Consumidor final</button>}
      {can('crear_clientes') && <button className="btn sec full mb-3" onClick={() => setNuevo(true)}>+ Nuevo cliente</button>}
      {lista.length === 0 ? <Empty text="Sin clientes" /> : lista.map((c) => (
        <div key={c.id} className="row cursor-pointer" onClick={() => onPick(c)}>
          <div className="flex-1"><p className="m-0 text-sm font-semibold">{c.nombre}</p><p className="m-0 text-xs text-muted">{c.tipo_documento} {c.documento}{c.telefono ? ' · ' + c.telefono : ''}</p></div>
        </div>
      ))}
    </Modal>
  )
}
