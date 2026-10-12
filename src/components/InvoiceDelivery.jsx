import { useEffect, useMemo, useRef, useState } from 'react'
import InvoicePreview from './InvoicePreview'
import { I } from './InvIcons'
import { ErrorBox, Input } from './ui'
import { useAuth } from '../context/AuthContext'
import { supabase, isDemoMode } from '../lib/supabase'
import { textoFactura } from '../lib/factura'
import { createInvoicePdf, invoicePdfFile, canSharePdf, saveInvoicePdf, logoListo } from '../lib/invoicePdf'
import { subirFacturaPdf } from '../lib/facturaEnvio'
import { prepararEnvioFactura, conLimiteEnvio, abrirEnvioFactura, quitarFocoEntrada } from '../lib/invoiceDelivery'
import { mensajeError } from '../lib/format'
import { toast } from '../lib/toast'
import '../styles/invoice-delivery.css'

export default function InvoiceDelivery({ invoice, items, tienda }) {
  const { perfil } = useAuth()
  const [tel, setTel] = useState(invoice.clientes?.telefono || ''), [correo, setCorreo] = useState(invoice.clientes?.correo || '')
  const [editar, setEditar] = useState(false), [preview, setPreview] = useState(null), [error, setError] = useState(''), [info, setInfo] = useState(''), [busy, setBusy] = useState('')
  const epoch = useRef(0), pdfLink = useRef(''), previewRef = useRef(null)
  useEffect(() => {
    ++epoch.current; pdfLink.current = ''; setPreview(null); setBusy(''); setError(''); setInfo('')
    setTel(invoice.clientes?.telefono || ''); setCorreo(invoice.clientes?.correo || '')
    return () => { ++epoch.current }
  }, [invoice.id])
  useEffect(() => { if (preview) previewRef.current?.scrollIntoView({ block: 'nearest' }) }, [preview])
  const text = () => textoFactura(invoice, items, tienda, invoice.clientes)
  const pdf = useMemo(() => {
    if (preview?.canal !== 'pdf') return null
    try { return createInvoicePdf(invoice, items, tienda, isDemoMode) } catch { return null }
  }, [preview, invoice, items, tienda])
  async function registrar(canal, destino) {
    const result = await conLimiteEnvio(() => supabase.from('factura_envios').insert({ factura_id: invoice.id, canal, destino, enviado_por: perfil.id, ...(isDemoMode ? { fecha: new Date().toISOString(), simulado: true, estado: 'previsualizado' } : {}) }))
    if (result.error) throw result.error
  }
  async function preparar(canal) {
    quitarFocoEntrada(); setError(''); setInfo('')
    let mensaje
    try { mensaje = prepararEnvioFactura({ canal, invoice, telefono: tel, correo, detalle: text() }) }
    catch (e) { setError(mensajeError(e)); return }
    const task = ++epoch.current
    setBusy(canal)
    try {
      if (!isDemoMode && !pdfLink.current) {
        try { const link = await conLimiteEnvio(() => subirFacturaPdf(invoice, items, tienda)); if (task !== epoch.current) return; pdfLink.current = link }
        catch { if (task === epoch.current) setInfo('No se pudo preparar el enlace PDF. Descarga el PDF y adjúntalo manualmente.') }
      }
      if (task !== epoch.current) return
      mensaje = prepararEnvioFactura({ canal, invoice, telefono: tel, correo, pdfUrl: pdfLink.current, detalle: text() })
      setPreview(mensaje)
      if (isDemoMode) {
        try { await registrar(canal, mensaje.destino) }
        catch { if (task === epoch.current) setInfo('Vista previa disponible. No se pudo registrar el intento de envío.') }
      }
    } catch (e) { if (task === epoch.current) setError('No se pudo preparar el mensaje. ' + mensajeError(e)) }
    finally { if (task === epoch.current) setBusy('') }
  }
  function cerrarPreview() { quitarFocoEntrada(); ++epoch.current; setBusy(''); setPreview(null); setError(''); setInfo('') }
  function abrirMensaje(event) {
    event?.preventDefault(); quitarFocoEntrada(); setError('')
    try {
      abrirEnvioFactura(preview)
      toast('Mensaje preparado. Confirma el envío en la aplicación.')
      if (!isDemoMode) registrar(preview.canal, preview.destino).catch(() => setInfo('Aplicación abierta. No se pudo registrar el intento de envío.'))
    } catch (e) { setError(mensajeError(e)) }
  }
  async function guardarPdf(share = false) {
    quitarFocoEntrada(); setError('')
    try { await logoListo; const result = await saveInvoicePdf(createInvoicePdf(invoice, items, tienda, isDemoMode), share); if (result === 'cancelled') toast('Compartir cancelado') }
    catch (e) { setError('No se pudo generar el PDF. ' + mensajeError(e)) }
  }
  function verPdf() { quitarFocoEntrada(); ++epoch.current; setBusy(''); setError(''); setInfo(''); setPreview({ canal: 'pdf' }) }
  return <section className="invoice-delivery">
    <h4 className="fd-sec">{invoice.estado === 'anulada' ? 'Documento' : 'Enviar factura'}<small className="delivery-optional">Opcional</small></h4>
    <ErrorBox text={error} />
    {info && <p className="fd-hint" role="status">{info}</p>}
    <div className="fd-actions">
      {invoice.estado !== 'anulada' && <button type="button" className="fd-act wa" aria-label="Enviar por WhatsApp" disabled={!!busy} onClick={() => preparar('whatsapp')}><span className="fd-act-ic"><I n="chat" /></span><b>{busy === 'whatsapp' ? 'Preparando…' : 'WhatsApp'}</b><small>{tel || 'Sin número'}</small></button>}
      {invoice.estado !== 'anulada' && <button type="button" className="fd-act mail" aria-label="Enviar por correo" disabled={!!busy} onClick={() => preparar('correo')}><span className="fd-act-ic"><I n="mail" /></span><b>{busy === 'correo' ? 'Preparando…' : 'Correo'}</b><small>{correo || 'Sin correo'}</small></button>}
      <button type="button" className="fd-act pdf" onClick={verPdf}><span className="fd-act-ic"><I n="receipt" /></span><b>Ver PDF</b><small>Imprimir o guardar</small></button>
    </div>
    {preview && <section ref={previewRef} className={'invoice-preview ' + (preview.canal === 'pdf' ? 'invoice-document-preview' : 'invoice-message-preview')}>
      <b>{preview.canal === 'pdf' ? 'Vista previa de factura' : preview.canal === 'whatsapp' ? 'Mensaje de WhatsApp' : 'Mensaje de correo'}</b>
      {preview.canal === 'pdf' ? <InvoicePreview invoice={invoice} items={items} tienda={tienda} demo={isDemoMode} /> : <>
        <p><b>Destinatario:</b> {preview.destino}</p>{preview.canal === 'correo' && <p><b>Asunto:</b> {preview.asunto}</p>}
        <pre>{preview.cuerpo}</pre>
        <p className="delivery-attachment">{preview.adjuntoManual ? 'Descarga el PDF y adjúntalo manualmente en la aplicación.' : 'El mensaje incluye un enlace al PDF; no lleva un archivo adjunto automático.'}</p>
        {preview.adjuntoManual && <button type="button" className="btn sec full" onClick={() => guardarPdf()}>Descargar PDF para adjuntar</button>}
      </>}
      <button type="button" className="btn sec full" onClick={cerrarPreview}>Cerrar vista previa</button>
      {preview.canal === 'pdf' && <div className="invoice-pdf-actions"><button type="button" className="btn" onClick={() => guardarPdf()}>Guardar PDF</button><button type="button" className="btn sec" onClick={() => { quitarFocoEntrada(); window.print() }}>Imprimir</button>{pdf && canSharePdf(invoicePdfFile(pdf)) && <button type="button" className="btn sec" onClick={() => guardarPdf(true)}>Compartir PDF</button>}</div>}
      {preview.canal === 'whatsapp' && <button type="button" className="btn full mt-2" onClick={abrirMensaje}>Abrir WhatsApp</button>}
      {preview.canal === 'correo' && <a className="btn full mt-2" href={preview.url} onClick={abrirMensaje}>Abrir correo</a>}
    </section>}
    {invoice.estado !== 'anulada' && (editar ? <div className="fd-contact">
      <Input label="WhatsApp del cliente" value={tel} onChange={e => setTel(e.target.value)} inputMode="tel" placeholder="300 123 4567" />
      <Input label="Correo del cliente" value={correo} onChange={e => setCorreo(e.target.value)} type="email" inputMode="email" placeholder="cliente@correo.com" />
      <p className="fd-hint">Estos datos se usan para preparar este envío.</p>
    </div> : <button type="button" className="fd-link" onClick={() => setEditar(true)}><I n="pencil" />Cambiar número o correo de envío</button>)}
  </section>
}
