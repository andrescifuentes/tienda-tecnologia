import { useEffect, useState } from 'react'
import Modal from './Modal'
import Scanner from './Scanner'
import { Input, Select, ErrorBox } from './ui'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { mensajeError } from '../lib/format'

export default function ProductoForm({ inicial, onClose, onSaved }) {
  const { can } = useAuth()
  const editando = !!inicial?.id
  const [f, setF] = useState({ codigo: '', codigo_barras: '', nombre: '', marca: '', categoria_id: '', proveedor_id: '', precio_compra: 0, precio_venta: 0, stock_min: 3, maneja_serial: false, garantia_meses: 0, ...(inicial || {}) })
  const [cats, setCats] = useState([]); const [provs, setProvs] = useState([])
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [scan, setScan] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const precios = can('editar_precios')

  useEffect(() => {
    supabase.from('categorias').select('id,nombre').eq('activa', true).order('nombre').then(({ data }) => setCats(data || []))
    supabase.from('proveedores').select('id,nombre').eq('activo', true).order('nombre').then(({ data }) => setProvs(data || []))
  }, [])

  async function guardar() {
    if (!f.codigo.trim() || !f.nombre.trim()) return setErr('Código y nombre son obligatorios.')
    setBusy(true); setErr('')
    const d = {
      codigo: f.codigo.trim(), codigo_barras: f.codigo_barras?.trim() || null, nombre: f.nombre.trim(), marca: f.marca?.trim() || null,
      categoria_id: f.categoria_id ? Number(f.categoria_id) : null, proveedor_id: f.proveedor_id ? Number(f.proveedor_id) : null,
      stock_min: Number(f.stock_min) || 0, garantia_meses: Number(f.garantia_meses) || 0,
    }
    if (precios) { d.precio_compra = Number(f.precio_compra) || 0; d.precio_venta = Number(f.precio_venta) || 0 }
    if (!editando) d.maneja_serial = !!f.maneja_serial
    const q = editando ? supabase.from('productos').update(d).eq('id', inicial.id) : supabase.from('productos').insert(d)
    const { error } = await q
    setBusy(false)
    if (error) return setErr(mensajeError(error))
    onSaved()
  }

  return (
    <Modal title={editando ? 'Editar producto' : 'Nuevo producto'} onClose={onClose} footer={<button className="btn full" onClick={guardar} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>}>
      <ErrorBox text={err} />
      <Input label="Código único (SKU)" value={f.codigo} onChange={set('codigo')} />
      <div className="flex gap-2 items-end"><div className="flex-1"><Input label="Código de barras" value={f.codigo_barras || ''} onChange={set('codigo_barras')} /></div><button className="btn sec mb-3" onClick={() => setScan(true)}>Escanear</button></div>
      <Input label="Nombre" value={f.nombre} onChange={set('nombre')} />
      <Input label="Marca" value={f.marca || ''} onChange={set('marca')} />
      <Select label="Categoría" value={f.categoria_id || ''} onChange={set('categoria_id')}><option value="">Sin categoría</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</Select>
      <Select label="Proveedor" value={f.proveedor_id || ''} onChange={set('proveedor_id')}><option value="">Sin proveedor</option>{provs.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</Select>
      <div className="grid grid-cols-2 gap-2">
        <Input label="Precio compra" type="number" min="0" value={f.precio_compra} onChange={set('precio_compra')} disabled={!precios} />
        <Input label="Precio venta" type="number" min="0" value={f.precio_venta} onChange={set('precio_venta')} disabled={!precios} />
        <Input label="Stock mínimo" type="number" min="0" value={f.stock_min} onChange={set('stock_min')} />
        <Input label="Garantía (meses)" type="number" min="0" value={f.garantia_meses} onChange={set('garantia_meses')} />
      </div>
      <label className="flex items-center gap-2 text-sm mb-2"><input type="checkbox" checked={!!f.maneja_serial} onChange={set('maneja_serial')} disabled={editando} /> Maneja IMEI / serial por unidad{editando ? ' (no se cambia después)' : ''}</label>
      {!editando && <p className="text-xs text-muted">El stock inicial se carga con “Ingreso de mercancía”, así queda registrado en el historial.</p>}
      {scan && <Scanner onClose={() => setScan(false)} onScan={(c) => { setF({ ...f, codigo_barras: c }); setScan(false) }} />}
    </Modal>
  )
}
