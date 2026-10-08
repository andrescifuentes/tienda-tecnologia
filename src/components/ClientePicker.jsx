import { useEffect, useState } from 'react'
import Modal from './Modal'
import { SearchBar, Empty, Input, Select, ErrorBox } from './ui'
import { supabase, isDemoMode } from '../lib/supabase'
import { limpiarBusqueda, mensajeError } from '../lib/format'
import { useAction } from '../lib/useAction'
import { useAuth } from '../context/AuthContext'

export function ClienteForm({ inicial, onSaved, onClose }) {
  const [f, setF] = useState({ tipo_documento: 'CC', documento: '', nombre: '', telefono: '', correo: '', direccion: '', ...(inicial || {}) })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const [guardar, pendingSave] = useAction(guardarImpl, () => setBusy(false))
  async function guardarImpl() {
    if (!f.nombre.trim() || (!isDemoMode && !f.documento?.trim())) return setErr('Nombre y documento son obligatorios.')
    if (!isDemoMode && !f.telefono?.trim() && !f.correo?.trim()) return setErr('Indica teléfono o correo para poder enviar la factura.')
    setBusy(true); setErr('')
    const datos = { tipo_documento: f.tipo_documento, documento: (f.documento?.trim() || null), nombre: f.nombre.trim(), telefono: f.telefono?.trim() || null, correo: f.correo?.trim() || null, direccion: f.direccion?.trim() || null }
    if(isDemoMode) { datos.ciudad=f.ciudad?.trim()||null; datos.notas=f.notas?.trim()||null; datos.documento=(f.documento?.trim() || null)||null }
    const q = inicial?.id ? supabase.from('clientes').update(datos).eq('id', inicial.id).select().single() : supabase.from('clientes').insert(datos).select().single()
    const { data, error } = await q
    setBusy(false)
    if (error) return setErr(mensajeError(error))
    onSaved(data)
  }
  return (
    <Modal title={inicial?.id ? 'Editar cliente' : 'Nuevo cliente'} onClose={onClose} footer={<button className="btn full" onClick={guardar} disabled={busy || pendingSave}>{busy ? 'Guardando…' : 'Guardar'}</button>}>
      <ErrorBox text={err} />
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-1"><Select label="Tipo" value={f.tipo_documento} onChange={set('tipo_documento')}>{['CC', 'NIT', 'CE', 'PASAPORTE'].map((t) => <option key={t}>{t}</option>)}</Select></div>
        <div className="col-span-2"><Input label="Documento" value={f.documento || ''} onChange={set('documento')} inputMode="numeric" /></div>
      </div>
      <Input required label="Nombre" value={f.nombre} onChange={set('nombre')} />
      <Input label="Teléfono (WhatsApp)" value={f.telefono || ''} onChange={set('telefono')} inputMode="tel" />
      <Input label="Correo" type="email" value={f.correo || ''} onChange={set('correo')} />
      <Input label="Dirección" value={f.direccion || ''} onChange={set('direccion')} />
      {isDemoMode&&<Input label="Notas" value={f.notas||''} onChange={set('notas')} />}
      {isDemoMode&&<Input label="Ciudad" value={f.ciudad||''} onChange={set('ciudad')} />}
    </Modal>
  )
}

export default function ClientePicker({ onPick, onClose }) {
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
    <Modal title="Elegir cliente" onClose={onClose}>
      <SearchBar value={q} onChange={setQ} placeholder="Nombre, documento o teléfono" />
      <button className="btn sec full mb-2" onClick={() => onPick(null)}>Consumidor final</button>
      {can('crear_clientes') && <button className="btn sec full mb-3" onClick={() => setNuevo(true)}>+ Nuevo cliente</button>}
      {lista.length === 0 ? <Empty text="Sin clientes" /> : lista.map((c) => (
        <div key={c.id} className="row cursor-pointer" onClick={() => onPick(c)}>
          <div className="flex-1"><p className="m-0 text-sm font-semibold">{c.nombre}</p><p className="m-0 text-xs text-muted">{c.tipo_documento} {c.documento}{c.telefono ? ' · ' + c.telefono : ''}</p></div>
        </div>
      ))}
    </Modal>
  )
}
