import { useEffect, useRef, useState } from 'react'
import Modal from './Modal'
import ConfirmAction from './ConfirmAction'
import { PremiumSwitch } from './AdminPrimitives'
import { I } from './InvIcons'
import { MedioLogo } from './TransferenciaQR'
import { Input, ErrorBox, Loader } from './ui'
import { supabase } from '../lib/supabase'
import { useAction } from '../lib/useAction'
import { mensajeError } from '../lib/format'
import { toast } from '../lib/toast'
import { TRANSFER_LIMITS, loadTransferMethods, validateTransferMethod, readTransferImage, looksLikeQr, transferSchemaMissing } from '../lib/transferMethods'
import '../styles/transfer-qr.css'

const pendiente = 'Códigos QR pendientes de activación: falta ejecutar el script 16_medios_transferencia.sql en Supabase. No se guardó ningún cambio.'
const errorTexto = e => transferSchemaMissing(e) ? pendiente : String(e?.code) === '23503' || /usó en ventas|foreign key/i.test(e?.message || '') ? 'Este medio ya se usó en ventas. Desactívalo para conservar el historial.' : /duplicate|medios_transferencia_nombre/i.test(e?.message || '') ? 'Ya existe un medio con ese nombre.' : mensajeError(e)

// Configuración → Métodos de pago → Códigos QR. Solo administradores (RLS en SQL 16).
export default function TransferMethodsSettings({ onClose }) {
  const [rows, setRows] = useState(null), [error, setError] = useState(''), [tick, setTick] = useState(0), [edit, setEdit] = useState(null)
  useEffect(() => {
    const controller = new AbortController()
    setError('')
    loadTransferMethods(supabase, { soloActivos: false, signal: controller.signal }).then(setRows).catch(e => { if (!controller.signal.aborted) { setRows([]); setError(errorTexto(e)) } })
    return () => controller.abort()
  }, [tick])
  const refresh = () => setTick(t => t + 1)
  const [mover, moving] = useAction(async (index, delta) => {
    const next = [...rows], [item] = next.splice(index, 1)
    next.splice(index + delta, 0, item)
    for (const [i, m] of next.entries()) if (m.orden !== i * 10) {
      const { error: e } = await supabase.from('medios_transferencia').update({ orden: i * 10 }).eq('id', m.id)
      if (e) { setError(errorTexto(e)); return refresh() }
    }
    refresh()
  })
  const [alternar, toggling] = useAction(async m => {
    const { error: e } = await supabase.from('medios_transferencia').update({ activo: !m.activo }).eq('id', m.id)
    if (e) return setError(errorTexto(e))
    toast(m.activo ? 'Medio desactivado: los vendedores ya no lo ven' : 'Medio activado'); refresh()
  })
  return <Modal title="Códigos QR" subtitle="Métodos de pago por transferencia" className="admin-sheet settings-edit-sheet tm-sheet" onClose={onClose} footer={<button className="btn full" disabled={!rows || (rows.length >= TRANSFER_LIMITS.medios)} onClick={() => setEdit({ activo: true, orden: (rows?.length || 0) * 10 })}><I n="plus" />Agregar medio de transferencia</button>}>
    <ErrorBox text={error} />
    <p className="admin-hint">Los vendedores ven estos códigos al cobrar por transferencia, en este orden. Solo se muestra la imagen que cargues: verifica que el QR corresponda a la cuenta correcta. Desactivar un medio no altera las ventas anteriores.</p>
    {!rows ? <Loader filas={2} /> : rows.length === 0 ? !error && <div className="tqr-empty"><span className="tqr-empty-ic"><I n="bank" /></span><b>Sin medios configurados</b><p>Agrega Nequi, Daviplata, tu banco u otra billetera con su código QR.</p></div>
      : <div className="tm-list">{rows.map((m, i) => <div key={m.id} className={'tm-row' + (m.activo ? '' : ' off')}>
          <button type="button" className="tm-row-main" onClick={() => setEdit(m)}><MedioLogo medio={m} size="sm" /><span className="tm-row-txt"><b>{m.nombre}</b><small>{m.activo ? 'Visible para vendedores' : 'Desactivado'}{m.numero_cuenta ? ' · ' + m.numero_cuenta : ''}</small></span></button>
          <PremiumSwitch label="Visible" checked={m.activo} disabled={toggling} onChange={() => alternar(m)} />
          <span className="tm-order"><button type="button" aria-label={'Subir ' + m.nombre} disabled={i === 0 || moving} onClick={() => mover(i, -1)}>▲</button><button type="button" aria-label={'Bajar ' + m.nombre} disabled={i === rows.length - 1 || moving} onClick={() => mover(i, 1)}>▼</button></span>
        </div>)}</div>}
    {edit && <Editor inicial={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); refresh() }} />}
  </Modal>
}

function Editor({ inicial, onClose, onSaved }) {
  const [f, setF] = useState({ nombre: '', titular: '', numero_cuenta: '', detalle: '', logo_data_url: '', qr_data_url: '', ...inicial })
  const [err, setErr] = useState(''), [aviso, setAviso] = useState(''), [reading, setReading] = useState(''), [borrar, setBorrar] = useState(false)
  const generation = useRef(0)
  const set = k => e => setF(old => ({ ...old, [k]: e.target.value }))
  async function imagen(event, kind) {
    const file = event.target.files?.[0]; event.target.value = ''
    if (!file) return
    const token = ++generation.current
    setReading(kind); setErr(''); if (kind === 'qr') setAviso('')
    try {
      const data = await readTransferImage(file, kind)
      if (token !== generation.current) return
      setF(old => ({ ...old, [kind === 'qr' ? 'qr_data_url' : 'logo_data_url']: data }))
      if (kind === 'qr' && await looksLikeQr(data) === false) setAviso('No se detectó un código QR en la imagen. Revisa que sea la imagen correcta antes de guardar.')
    } catch (e) { setErr(e.message) } finally { if (token === generation.current) setReading('') }
  }
  const [guardar, saving] = useAction(async () => {
    let value
    try { value = validateTransferMethod(f) } catch (e) { return setErr(e.message) }
    const query = inicial.id ? supabase.from('medios_transferencia').update(value).eq('id', inicial.id) : supabase.from('medios_transferencia').insert(value)
    const { error } = await query
    if (error) return setErr(errorTexto(error))
    toast(inicial.id ? 'Medio actualizado' : 'Medio agregado'); onSaved()
  })
  async function eliminar() {
    const { error } = await supabase.from('medios_transferencia').delete().eq('id', inicial.id)
    if (error) { const m = errorTexto(error); setErr(m); throw Error(m) }
    toast('Medio eliminado'); onSaved()
  }
  return <Modal title={inicial.id ? 'Editar medio' : 'Nuevo medio'} subtitle="Transferencia con código QR" className="admin-sheet settings-edit-sheet" keyboardAware onClose={() => { if (!saving) onClose() }} footer={<button className="btn full" disabled={saving || !!reading} onClick={guardar}>{saving ? 'Guardando…' : 'Guardar medio'}</button>}>
    <ErrorBox text={err} />
    <Input label="Nombre (ej. Nequi, Daviplata, Bancolombia)" required maxLength={TRANSFER_LIMITS.nombre} value={f.nombre} onChange={set('nombre')} />
    <div className="tm-images">
      <div className="tm-image"><small>Código QR *</small><div className="tm-preview">{f.qr_data_url ? <img src={f.qr_data_url} alt="Vista previa del código QR" /> : <span>Sin código QR</span>}</div><label className="btn sec sm">{reading === 'qr' ? 'Preparando…' : f.qr_data_url ? 'Reemplazar QR' : 'Subir QR'}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={!!reading} onChange={e => imagen(e, 'qr')} /></label></div>
      <div className="tm-image"><small>Logo (opcional)</small><div className="tm-preview">{f.logo_data_url ? <img src={f.logo_data_url} alt="Vista previa del logo" /> : <span>Se usarán las iniciales</span>}</div><label className="btn sec sm">{reading === 'logo' ? 'Preparando…' : f.logo_data_url ? 'Cambiar logo' : 'Subir logo'}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={!!reading} onChange={e => imagen(e, 'logo')} /></label>{f.logo_data_url && <button type="button" className="admin-reset" onClick={() => setF(old => ({ ...old, logo_data_url: '' }))}>Quitar logo</button>}</div>
    </div>
    {aviso && <p className="tm-warn" role="status">{aviso}</p>}
    <p className="admin-hint">PNG, JPG o WebP de hasta 8 MB. Se adapta para guardar como máximo {TRANSFER_LIMITS.qrBytes / 1024} KB (QR) y {TRANSFER_LIMITS.logoBytes / 1024} KB (logo).</p>
    <Input label="Titular (opcional)" maxLength={TRANSFER_LIMITS.titular} value={f.titular || ''} onChange={set('titular')} />
    <Input label="Número de cuenta o celular (opcional)" maxLength={TRANSFER_LIMITS.numero_cuenta} value={f.numero_cuenta || ''} onChange={set('numero_cuenta')} />
    <Input label="Detalle (ej. Cuenta de ahorros, llave)" maxLength={TRANSFER_LIMITS.detalle} value={f.detalle || ''} onChange={set('detalle')} />
    <PremiumSwitch label="Visible para vendedores" checked={f.activo !== false} onChange={activo => setF(old => ({ ...old, activo }))} />
    {inicial.id && <div className="admin-discreet-action"><button type="button" className="admin-reset" onClick={() => setBorrar(true)}>Eliminar medio</button></div>}
    {borrar && <ConfirmAction title="Eliminar medio" label="Eliminar" onClose={() => setBorrar(false)} onConfirm={eliminar}>Solo se puede eliminar si nunca se usó en una venta. Si ya se usó, desactívalo para conservar el historial.</ConfirmAction>}
  </Modal>
}
