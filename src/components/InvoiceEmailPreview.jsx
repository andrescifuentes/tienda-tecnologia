import { useEffect, useMemo, useRef, useState } from 'react'
import { I } from './InvIcons'
import { ErrorBox } from './ui'
import { createInvoicePdf, invoicePdfFile, saveInvoicePdf, logoListo } from '../lib/invoicePdf'
import { invoiceBrand } from '../../supabase/functions/_shared/invoice-brand.js'
import { crearBorradorCorreoFactura, copiarTextoFactura, puedeCompartirFactura, compartirFacturaPorSistema } from '../lib/invoiceEmail'
import { quitarFocoEntrada } from '../lib/invoiceDelivery'
import { isDemoMode } from '../lib/supabase'
import { numFactura } from '../lib/format'
import '../styles/invoice-email.css'

export default function InvoiceEmailPreview({ pdfUrl = '', invoice, items, tienda, correo, onCorreo, detalle, reason, onOpenProvider, onOpenGmailWeb, onCancel }) {
  const [error, setError] = useState(reason || ''), [info, setInfo] = useState(''), [manual, setManual] = useState(null)
  const [copying, setCopying] = useState(''), [sharing, setSharing] = useState(false), [logoReady, setLogoReady] = useState(false)
  const alive = useRef(true), copyGeneration = useRef(0), manualRef = useRef(null), headingRef = useRef(null), handoff = useRef(null), shareGeneration = useRef(0), shareLocked = useRef(false)
  useEffect(() => { alive.current = true; headingRef.current?.scrollIntoView({ block: 'start' }); logoListo.then(() => { if (alive.current) setLogoReady(true) }); return () => { alive.current = false; handoff.current = null; ++shareGeneration.current; ++copyGeneration.current } }, [])
  useEffect(() => {
    if (!manual || !manualRef.current) return
    try { const range = document.createRange(); range.selectNodeContents(manualRef.current); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range) } catch { /* Text remains selectable by touch or keyboard. */ }
  }, [manual])
  useEffect(() => {
    const leave = () => { if (handoff.current) handoff.current.left = true }
    const resume = event => {
      if (document.visibilityState === 'hidden') { leave(); return }
      if (!handoff.current || (!handoff.current.left && !(event.type === 'pageshow' && event.persisted))) return
      handoff.current = null; ++shareGeneration.current; shareLocked.current = false
      quitarFocoEntrada(); setSharing(false); headingRef.current?.scrollIntoView({ block: 'start' })
      setInfo('Tu factura sigue lista. Puedes compartirla, descargar el PDF o copiar los datos.')
    }
    window.addEventListener('blur', leave); window.addEventListener('pagehide', leave)
    window.addEventListener('focus', resume); window.addEventListener('pageshow', resume)
    document.addEventListener('visibilitychange', resume)
    return () => {
      window.removeEventListener('blur', leave); window.removeEventListener('pagehide', leave)
      window.removeEventListener('focus', resume); window.removeEventListener('pageshow', resume)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [])
  const draft = useMemo(() => crearBorradorCorreoFactura({ invoice, correo, detalle, tienda, pdfUrl }), [invoice, correo, detalle, tienda, pdfUrl])
  const pdf = useMemo(() => { try { return createInvoicePdf(invoice, items, tienda, isDemoMode) } catch { return null } }, [invoice, items, tienda, logoReady])
  const file = useMemo(() => { try { return pdf ? invoicePdfFile(pdf) : null } catch { return null } }, [pdf])
  const shareable = puedeCompartirFactura(file)
  async function copy(kind, text) {
    quitarFocoEntrada(); setError(''); setInfo(''); setManual(null)
    if (!text?.trim()) return setError('Escribe un destinatario o descarga la factura para compartirla.')
    const generation = ++copyGeneration.current
    setCopying(kind)
    const result = await copiarTextoFactura(text)
    if (!alive.current || generation !== copyGeneration.current) return
    setCopying('')
    if (result === 'copied') setInfo(kind === 'correo' ? 'Correo copiado.' : kind === 'asunto' ? 'Asunto copiado.' : 'Mensaje copiado.')
    else { setInfo('Selecciona y copia el texto de abajo. También puedes hacerlo manteniéndolo pulsado.'); setManual({ kind, text }) }
  }
  async function download() {
    quitarFocoEntrada(); setError(''); setInfo('')
    if (!pdf) return setError('No se pudo preparar el documento. Cierra esta vista y vuelve a abrirla.')
    try {
      const result = await saveInvoicePdf(pdf)
      if (alive.current) setInfo(result === 'cancelled' ? 'Puedes descargar o compartir el PDF cuando quieras.' : 'El PDF está listo. Adjunta el archivo desde tu aplicación de correo.')
    } catch { if (alive.current) setError('No se pudo guardar el PDF. Inténtalo de nuevo; la factura sigue disponible.') }
  }
  async function share() {
    if (shareLocked.current) return
    shareLocked.current = true
    const generation = ++shareGeneration.current
    const trip = { kind: 'share', left: false }
    handoff.current = trip
    quitarFocoEntrada(); setError(''); setInfo(''); setSharing(true)
    // File and metadata are ready before this tap, preserving Safari user activation.
    const result = await compartirFacturaPorSistema(file, navigator, { title: draft.asunto, text: 'Tu factura ' + numFactura(invoice) + ' de ' + invoiceBrand(invoice.tienda_snapshot || tienda) + '. Gracias por tu compra.' })
    if (!alive.current || generation !== shareGeneration.current) return
    shareLocked.current = false; setSharing(false)
    if (result !== 'shared' && !trip.left) handoff.current = null
    setInfo(result === 'shared' ? 'Confirma el envío en la aplicación que elegiste.' : result === 'cancelled' ? 'Compartir cancelado. Puedes copiar el mensaje o descargar el PDF.' : 'Descarga el PDF y adjúntalo desde tu aplicación de correo.')
  }
  return <section className="invoice-preview invoice-email-preview email-simple" aria-label="Enviar factura por correo">
    <header ref={headingRef} className="email-preview-head"><span className="email-preview-icon"><I n="mail" /></span><div><span className="email-preview-eyebrow">FACTURA {numFactura(invoice)}</span><h4>Enviar por correo</h4><p>Revisa el correo del cliente y elige cómo enviarla.</p></div></header>
    <div className="email-preview-recipient"><label htmlFor="invoice-email-recipient">Correo del cliente</label><input id="invoice-email-recipient" aria-label="Destinatario" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} value={correo} onChange={event => { ++copyGeneration.current; setCopying(''); onCorreo(event.target.value); setError(''); setInfo(''); setManual(null) }} placeholder="cliente@correo.com" />{!correo.trim() && <small>Sin correo registrado. Escríbelo aquí o usa «Compartir PDF».</small>}</div>
    <ErrorBox text={error} />
    {info && <p className="email-preview-info" role="status">{info}</p>}
    <div className="email-preview-actions">
      {shareable && <button type="button" className="btn email-share" disabled={sharing} onClick={share}><svg className="inv-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 15V3m-4 4 4-4 4 4M5 11v8a2 2 0 002 2h10a2 2 0 002-2v-8" /></svg><span className="email-share-label"><b>{sharing ? 'Abriendo compartir…' : 'Compartir PDF'}</b><small>Con el archivo adjunto · eliges Gmail o Correo</small></span></button>}
      <div className="email-secondary-actions email-two">
        <button type="button" className="btn sec email-gmail" disabled={!correo.trim()} onClick={() => { quitarFocoEntrada(); onOpenProvider('gmail') }}><I n="mail" />Abrir Gmail</button>
        <button type="button" className="btn sec email-open" disabled={!correo.trim()} onClick={() => { quitarFocoEntrada(); onOpenProvider('system') }}><I n="mail" />Abrir Correo</button>
      </div>
      <p className="email-simple-note">Gmail y Correo se abren con el mensaje y el enlace a la factura listos.</p>
      <div className="email-simple-links">
        <button type="button" className="email-quick-link email-download" onClick={download}><I n="receipt" />Descargar PDF</button>
        <button type="button" className="email-quick-link" disabled={!!copying} onClick={() => copy('mensaje', draft.cuerpo)}><I n="copy" />{copying === 'mensaje' ? 'Copiando…' : 'Copiar mensaje'}</button>
      </div>
      {manual && <div className="email-manual-copy"><span>Mensaje para copiar</span><pre ref={manualRef} tabIndex={0}>{manual.text}</pre></div>}
    </div>
    <details className="email-simple-preview"><summary>Ver el mensaje</summary>
      <div className="email-preview-subject"><span>Asunto</span><p>{draft.asunto}</p></div>
      <div className="email-preview-message"><span>Mensaje</span><pre>{draft.cuerpo}</pre></div>
    </details>
    <button type="button" className="email-preview-cancel" onClick={() => { quitarFocoEntrada(); onCancel() }}>Cancelar</button>
  </section>
}
