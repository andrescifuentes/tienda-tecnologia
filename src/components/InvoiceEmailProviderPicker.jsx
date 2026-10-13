import { useEffect, useRef } from 'react'
import { EMAIL_PROVIDERS, esIOSCorreo } from '../lib/invoiceEmail'
import { quitarFocoEntrada } from '../lib/invoiceDelivery'
import { I } from './InvIcons'

export default function InvoiceEmailProviderPicker({ changing, preferred, onPick, onCancel }) {
  const ref = useRef(null)
  useEffect(() => { quitarFocoEntrada(); ref.current?.scrollIntoView({ block: 'start' }) }, [])
  return <section ref={ref} className="email-provider-picker" aria-label="Proveedor de correo preferido">
    <span className="email-preview-eyebrow">CORREO DE FACTURA</span>
    <h4>{changing ? 'Cambiar proveedor' : 'Elige tu correo'}</h4>
    <p>{changing ? 'Tu próximo envío se abrirá directamente aquí.' : 'Elige una opción para abrir el mensaje. Guardaremos tu preferencia en este navegador.'}</p>
    {EMAIL_PROVIDERS.map(p => <button key={p.id} type="button" className="email-provider-choice" data-provider={p.id} aria-pressed={preferred === p.id} onClick={() => onPick(p.id)}><span><I n="mail" /></span><div><b>{p.label}</b><small>{p.id === 'gmail' && esIOSCorreo() ? 'Intentar abrir el mensaje en la app Gmail' : p.detail}</small></div><I n={preferred === p.id ? 'check' : 'chevDown'} /></button>)}
    <button type="button" className="email-preview-cancel" onClick={onCancel}>Cancelar</button>
  </section>
}
