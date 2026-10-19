import { cloneElement, isValidElement, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Modal from './Modal'
import { I } from './InvIcons'
import { money, numFactura, fechaHora } from '../lib/format'
import { quitarFocoEntrada } from '../lib/invoiceDelivery'
import { esConsumidorFinal } from '../lib/consumidorFinal'
import { toast } from '../lib/toast'
import { supabase, conAutorizacionAdmin } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { mensajeError } from '../lib/format'
import '../styles/venta-finalizada.css'

// Celebración al cerrar la venta: anillo dorado que se dibuja, check, destellos y el total.
function VentaFinalizada({ invoice, cancelada = false, onListo: alTerminar }) {
  const cb = useRef(alTerminar), hecho = useRef(false)
  cb.current = alTerminar
  const onListo = () => { if (hecho.current) return; hecho.current = true; cb.current?.() }
  useEffect(() => {
    try { navigator.vibrate?.([18, 40, 28]) } catch { /* opcional */ }
    const t = setTimeout(onListo, 3200)
    return () => clearTimeout(t)
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  const chispas = Array.from({ length: 14 }, (_, i) => i)
  return createPortal(<div className={'vf-overlay' + (cancelada ? ' vf-cancel' : '')} role="status" aria-live="assertive" onClick={onListo}>
    <div className="vf-glow" aria-hidden="true" />
    <div className="vf-card" onClick={e => e.stopPropagation()}>
      <div className="vf-badge" aria-hidden="true">
        {chispas.map(i => <span key={i} className="vf-spark" style={{ '--a': (i * 360 / 14) + 'deg', '--d': (i % 3) * 60 + 'ms' }} />)}
        <svg viewBox="0 0 120 120" className="vf-svg">
          <defs><linearGradient id="vf-oro" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#f3dcae" /><stop offset=".55" stopColor="#d6b06a" /><stop offset="1" stopColor="#a8782f" /></linearGradient></defs>
          <circle className="vf-ring-bg" cx="60" cy="60" r="52" />
          <circle className="vf-ring" cx="60" cy="60" r="52" stroke="url(#vf-oro)" />
          {cancelada ? <path className="vf-check" d="M44 44 L76 76 M76 44 L44 76" stroke="url(#vf-oro)" /> : <path className="vf-check" d="M38 62 L54 77 L83 45" stroke="url(#vf-oro)" />}
        </svg>
      </div>
      <span className="vf-eyebrow">{cancelada ? 'VENTA CANCELADA' : 'VENTA FINALIZADA'}</span>
      <b className="vf-total">{money(invoice.total)}</b>
      <p className="vf-meta">{numFactura(invoice)} · {invoice.clientes?.nombre || 'Consumidor final'}</p>
      <button type="button" className="vf-btn" onClick={onListo}><I n="plus" />Nueva venta</button>
      <span className="vf-bar" aria-hidden="true" />
    </div>
  </div>, document.body)
}

// Cancelar la venta = anular su factura (devuelve el stock). El vendedor sin permiso necesita al administrador.
function CancelarVenta({ invoice, onCancelada, onVolver }) {
  const { can, perfil } = useAuth()
  const necesitaAdmin = !can('anular_facturas')
  const [motivo, setMotivo] = useState(''), [correo, setCorreo] = useState(''), [clave, setClave] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  async function cancelar() {
    if (!motivo.trim()) return setErr('Escribe por qué se cancela la venta.')
    if (necesitaAdmin && (!correo.trim() || !clave)) return setErr('Escribe el correo y la contraseña del administrador que autoriza.')
    setBusy(true); setErr('')
    try {
      if (necesitaAdmin) await conAutorizacionAdmin(correo, clave, async (cli, admin) => {
        const r = await cli.rpc('anular_factura', { p_factura_id: invoice.id, p_motivo: 'Venta cancelada: ' + motivo.trim() + ' · Vendedor ' + (perfil?.nombre || '') + ', autorizó ' + admin.nombre })
        if (r.error) throw new Error(mensajeError(r.error))
      })
      else { const r = await supabase.rpc('anular_factura', { p_factura_id: invoice.id, p_motivo: 'Venta cancelada: ' + motivo.trim() }); if (r.error) throw new Error(mensajeError(r.error)) }
      onCancelada()
    } catch (e) { setErr(e.message || mensajeError(e)) }
    finally { setBusy(false); setClave('') }
  }
  return <Modal title="Cancelar venta" subtitle={numFactura(invoice) + ' · ' + money(invoice.total)} className="experience-sheet cancel-sale-sheet" keyboardAware onClose={onVolver} footer={<div className="post-sale-footer"><button type="button" className="btn sec" disabled={busy} onClick={onVolver}>Volver</button><button type="button" className="btn cancel-sale-go" disabled={busy} onClick={cancelar}>{busy ? 'Cancelando…' : 'Cancelar venta'}</button></div>}>
    <p className="cancel-sale-note">La factura queda <b>anulada</b> en el historial y los productos vuelven al inventario.</p>
    {err && <div role="alert" className="bg-badbg text-bad rounded-xl p-3 text-sm mb-3">{err}</div>}
    <label className="cancel-sale-label" htmlFor="cancel-motivo">Motivo</label>
    <input id="cancel-motivo" className="inp" placeholder="Ej. El cliente se arrepintió" value={motivo} onChange={e => { setMotivo(e.target.value); setErr('') }} autoFocus />
    {necesitaAdmin && <>
      <p className="cancel-sale-label">Autorización del administrador</p>
      <input className="inp" type="email" inputMode="email" autoCapitalize="none" autoComplete="off" placeholder="Correo del administrador" value={correo} onChange={e => { setCorreo(e.target.value); setErr('') }} />
      <input className="inp mt-2" type="password" autoComplete="off" placeholder="Contraseña del administrador" value={clave} onChange={e => { setClave(e.target.value); setErr('') }} />
    </>}
  </Modal>
}

// Después de vender hay que decidir: «Finalizar venta» o «Cancelar venta». No se puede empezar otra antes.
export default function SellerSaleComplete({ invoice, onClose, onViewInvoice, onNewSale, children }) {
  const anulada = invoice.estado === 'anulada'
  const sinDatos = esConsumidorFinal(invoice.clientes)
  const [enviada, setEnviada] = useState(false), [fin, setFin] = useState(false), [cancelando, setCancelando] = useState(false), [cancelada, setCancelada] = useState(false)
  const pendiente = () => toast('Primero finaliza o cancela esta venta')
  // Al volver de WhatsApp: recordar que falta tocar «Finalizar venta»
  useEffect(() => {
    if (!enviada) return
    const volver = () => { if (document.visibilityState === 'visible') toast('Factura enviada. Toca «Finalizar venta» para terminar.') }
    document.addEventListener('visibilitychange', volver)
    return () => document.removeEventListener('visibilitychange', volver)
  }, [enviada])
  const action = callback => { quitarFocoEntrada(); callback?.() }
  const finalizar = () => { quitarFocoEntrada(); if (anulada) return onClose?.(); setFin(true) }
  const delivery = isValidElement(children) ? cloneElement(children, { obligatorio: false, onEnviado: () => setEnviada(true) }) : children
  return <>
    <Modal title={anulada ? 'Factura anulada' : 'Venta exitosa'} subtitle={anulada ? 'El documento se conserva en el historial' : 'La venta ya quedó registrada'} className="seller-sale-complete experience-sheet fd-sheet" keyboardAware validateFooter={false} restoreInputFocus={false} onClose={() => anulada ? action(onClose) : pendiente()} footer={
      <div className="post-sale-footer">{anulada ? <button type="button" className="btn sec" onClick={() => action(onClose)}>Cerrar</button> : <button type="button" className="btn sec cancel-sale-open" onClick={() => { quitarFocoEntrada(); setCancelando(true) }}>Cancelar venta</button>}<button type="button" className={'fd-finish ok' + (enviada ? ' vf-ready' : '')} onClick={finalizar}><I n="check" />{anulada ? 'Listo' : 'Finalizar venta'}</button></div>}>
      <section className={'fd-hero' + (anulada ? ' void' : ' new')}><span className="fd-hero-ic"><I n="check" /></span><span className="fd-hero-eyebrow">{anulada ? 'Factura anulada' : '¡Venta registrada!'}</span><b className="fd-hero-total">{money(invoice.total)}</b><div className="fd-hero-chips"><span className="fd-num">{numFactura(invoice)}</span><span className={'fd-state ' + (anulada ? 'bad' : 'good')}>{anulada ? 'Anulada' : 'Emitida'}</span></div><small className="fd-hero-meta">{fechaHora(invoice.fecha)}</small></section>
      <div className="fd-client"><span className="fd-client-av"><I n="user" /></span><span className="fd-client-txt"><small>Cliente</small><b>{invoice.clientes?.nombre || 'Consumidor final'}</b></span></div>
      <p className="post-sale-note">{anulada ? 'Puedes consultar el documento o continuar vendiendo.' : enviada ? 'Factura enviada. Ya puedes finalizar la venta.' : sinDatos ? 'Venta sin datos del cliente. Si el cliente la pide, muéstrale o compártele el PDF.' : 'Si quieres, envía la factura al cliente. Luego toca «Finalizar venta».'}</p>
      {onViewInvoice && <button type="button" className="btn sec full post-sale-view" onClick={() => action(onViewInvoice)}><I n="receipt" />Abrir factura</button>}
      {delivery}
    </Modal>
    {cancelando && <CancelarVenta invoice={invoice} onVolver={() => setCancelando(false)} onCancelada={() => { setCancelando(false); setCancelada(true); setFin(true) }} />}
    {fin && <VentaFinalizada invoice={invoice} cancelada={cancelada} onListo={() => { setFin(false); (onNewSale || onClose)?.() }} />}
  </>
}
