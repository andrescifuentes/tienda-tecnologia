import { useRef, useState } from 'react'
import Modal from './Modal'
import { ErrorBox } from './ui'
import { mensajeError } from '../lib/format'

export default function ConfirmAction({ title = 'Confirmar acción', children, label = 'Confirmar', onConfirm, onClose }) {
  const lock = useRef(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function confirm() {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try { const result = await onConfirm(); if (result?.error) throw new Error(result.error.message); onClose() }
    catch (err) { setError(mensajeError(err)) }
    finally { lock.current = false; setBusy(false) }
  }
  return <Modal title={title} onClose={() => !busy && onClose()} footer={<div className="grid grid-cols-2 gap-2"><button className="btn sec" disabled={busy} onClick={onClose}>Cancelar</button><button className="btn bad" disabled={busy} onClick={confirm}>{busy ? 'Procesando…' : label}</button></div>}><ErrorBox text={error} /><p className="text-sm">{children}</p></Modal>
}
