import { useEffect, useState } from 'react'
import Modal from './Modal'
import FacturaDetalle from './FacturaDetalle'
import { Badge, Loader, ErrorBox, Input } from './ui'
import { supabase } from '../lib/supabase'
import { useAction } from '../lib/useAction'
import { mensajeError, numFactura, fecha } from '../lib/format'
import { toast } from '../lib/toast'
import { UNIT_ATTRIBUTES, validateUnitAttributes, SERIAL_TYPES } from '../lib/imei'
import '../styles/inventory-units.css'

const ESTADO = { disponible: ['good', 'Disponible'], vendida: ['', 'Vendida'], en_garantia: ['warn', 'En garantía'], devuelta: ['warn', 'Devuelta'], defectuosa: ['bad', 'Defectuosa'], baja: ['bad', 'De baja'] }
const resumen = a => [a?.color, a?.capacidad, a?.imei2 && 'IMEI 2 ' + a.imei2].filter(Boolean).join(' · ')

// Unidades de un producto controlado por IMEI/serial: qué unidad hay, cuál se vendió y en qué factura.
export default function ProductUnits({ producto, editar }) {
  const [units, setUnits] = useState(null), [ventas, setVentas] = useState({}), [q, setQ] = useState(''), [edit, setEdit] = useState(null), [factura, setFactura] = useState(null), [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    supabase.from('unidades_serializadas').select('*').eq('producto_id', producto.id).order('id', { ascending: false }).limit(300).then(async ({ data }) => {
      if (!live) return
      const rows = data || []
      setUnits(rows)
      // Optional trace to the invoice; roles without access simply don't see it.
      const lineIds = rows.map(u => u.factura_item_id).filter(Boolean)
      if (!lineIds.length) return setVentas({})
      const items = (await supabase.from('factura_items').select('id,factura_id').in('id', lineIds)).data || []
      const invoices = items.length ? (await supabase.from('facturas').select('id,prefijo,numero,fecha,estado').in('id', [...new Set(items.map(i => i.factura_id))])).data || [] : []
      if (live) setVentas(Object.fromEntries(items.map(i => [i.id, invoices.find(f => f.id === i.factura_id)]).filter(([, f]) => f)))
    })
    return () => { live = false }
  }, [producto.id, tick])
  const term = q.trim().toLowerCase().replace(/[\s.-]/g, '')
  const visibles = (units || []).filter(u => !term || [u.serial, u.atributos?.imei2, u.atributos?.color, u.atributos?.capacidad].some(v => String(v || '').toLowerCase().replace(/[\s.-]/g, '').includes(term)))
  const disponibles = (units || []).filter(u => u.estado === 'disponible').length
  return <div className="inv-desc pu">
    <small>{producto.tipo_serial ? SERIAL_TYPES[producto.tipo_serial] : 'IMEI / seriales'} · {disponibles} disponibles de {units?.length ?? '…'}</small>
    {units?.length > 5 && <input className="pf-input pu-search" placeholder="Buscar IMEI, serial o color" value={q} onChange={e => setQ(e.target.value)} aria-label="Buscar unidad" inputMode="search" />}
    {!units ? <Loader filas={2} /> : units.length === 0 ? <p>Sin unidades registradas. Usa «Cargar unidades» para registrar cada {producto.tipo_serial === 'imei' ? 'IMEI' : 'serial'} con su compra.</p>
      : visibles.length === 0 ? <p>Sin coincidencias.</p>
      : visibles.map(u => { const [tone, label] = ESTADO[u.estado] || ['', u.estado], venta = ventas[u.factura_item_id]; return <div key={u.id} className="pu-row">
          <button type="button" className="pu-main" disabled={!editar} onClick={() => setEdit(u)} aria-label={editar ? 'Editar datos de la unidad ' + u.serial : undefined}>
            <span className="mono">{u.serial}</span>
            {resumen(u.atributos) && <small>{resumen(u.atributos)}</small>}
            {u.atributos?.nota && <small>{u.atributos.nota}</small>}
          </button>
          <span className="pu-side"><Badge tone={tone}>{label}</Badge>{venta && <button type="button" className="pu-sale" onClick={() => setFactura(venta.id)}>{numFactura(venta)} · {fecha(venta.fecha)}</button>}</span>
        </div> })}
    {edit && <UnitEditor unidad={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); setTick(t => t + 1) }} />}
    {factura && <FacturaDetalle id={factura} onClose={() => setFactura(null)} />}
  </div>
}

function UnitEditor({ unidad, onClose, onSaved }) {
  const [f, setF] = useState(() => Object.fromEntries(UNIT_ATTRIBUTES.map(([k]) => [k, unidad.atributos?.[k] || '']))), [err, setErr] = useState('')
  const [guardar, busy] = useAction(async () => {
    let value
    try { value = validateUnitAttributes(f, unidad.serial) } catch (e) { return setErr(e.message) }
    const { error } = await supabase.rpc('unidad_actualizar_atributos', { p_unidad_id: unidad.id, p_atributos: value })
    if (error) return setErr(error.code === 'PGRST202' ? 'Falta activar los datos por unidad: ejecuta supabase/18_imei_unidades.sql en Supabase.' : mensajeError(error))
    toast('Unidad actualizada'); onSaved()
  })
  return <Modal title="Datos de la unidad" subtitle={unidad.serial} className="admin-sheet settings-edit-sheet" keyboardAware onClose={() => { if (!busy) onClose() }} footer={<button className="btn full" disabled={busy} onClick={guardar}>{busy ? 'Guardando…' : 'Guardar'}</button>}>
    <ErrorBox text={err} />
    <p className="admin-hint">El IMEI/serial principal no se cambia aquí para conservar el historial de compra y venta.</p>
    {UNIT_ATTRIBUTES.map(([k, label]) => <Input key={k} label={label + ' (opcional)'} inputMode={k === 'imei2' ? 'numeric' : undefined} maxLength={k === 'nota' ? 200 : 60} value={f[k]} onChange={e => setF(old => ({ ...old, [k]: e.target.value }))} />)}
  </Modal>
}
