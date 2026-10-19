import {loadInvoiceMessageStore} from '../lib/invoiceMessageTemplates'
import InvoiceEmailSend from './InvoiceEmailSend'
import InvoiceEmailProviderPicker from './InvoiceEmailProviderPicker'
import { esProveedorCorreo, EMAIL_PROVIDER_KEY, EMAIL_PROVIDERS, leerProveedorCorreo, guardarProveedorCorreo, validarCorreoFactura, crearBorradorCorreoFactura, abrirCompositorCorreo, esIOSCorreo, vigilarAperturaGmailIOS, puedeCompartirFactura, compartirFacturaPorSistema } from '../lib/invoiceEmail'
import '../styles/invoice-email.css'
import InvoiceEmailPreview from './InvoiceEmailPreview'
import { useEffect, useMemo, useRef, useState } from 'react'
import InvoicePreview from './InvoicePreview'
import { I } from './InvIcons'
import { ErrorBox, Input } from './ui'
import { useAuth } from '../context/AuthContext'
import { supabase, isDemoMode, isInvoiceEmailEnabled } from '../lib/supabase'
import { textoFactura } from '../lib/factura'
import { createInvoicePdf, invoicePdfFile, canSharePdf, saveInvoicePdf, logoListo } from '../lib/invoicePdf'
import { enlaceFactura } from '../lib/facturaEnvio'
import { invoiceBrand } from '../../supabase/functions/_shared/invoice-brand.js'
import { prepararEnvioFactura, conLimiteEnvio, abrirEnvioFactura, quitarFocoEntrada } from '../lib/invoiceDelivery'
import { mensajeError } from '../lib/format'

// El envío desde el servidor (con PDF adjunto) se activa con VITE_CORREO_SERVIDOR=true cuando el servicio de correo esté configurado.
// Mientras tanto, «Correo» abre el correo del celular con el enlace al PDF de la factura.
const CORREO_SERVIDOR = isInvoiceEmailEnabled && import.meta.env.VITE_CORREO_SERVIDOR === 'true'
// El envío por correo está en pausa hasta definir el correo del negocio. Se activa con VITE_CORREO_ACTIVO=true.
const CORREO_ACTIVO = isDemoMode || import.meta.env.VITE_CORREO_ACTIVO === 'true'
import { toast } from '../lib/toast'
import '../styles/invoice-delivery.css'

export default function InvoiceDelivery({ invoice, items, tienda, obligatorio = false, onEnviado }) {
  const { perfil } = useAuth()
  const [messageStore,setMessageStore]=useState(tienda),[messagesReady,setMessagesReady]=useState(false),[messagesError,setMessagesError]=useState(''),[messageRetry,setMessageRetry]=useState(0)
  const [enlace, setEnlace] = useState('')
  const [tel, setTel] = useState(invoice.clientes?.telefono || ''), [correo, setCorreo] = useState(invoice.clientes?.correo || '')
  const [editar, setEditar] = useState(false), [preview, setPreview] = useState(null), [error, setError] = useState(''), [info, setInfo] = useState(''), [busy, setBusy] = useState('')
  const [provider, setProvider] = useState(leerProveedorCorreo), [providerChoice, setProviderChoice] = useState(null), [emailNotice, setEmailNotice] = useState(''), [sharing, setSharing] = useState(false), [logoReady, setLogoReady] = useState(false)
  const alive = useRef(true), gmailWatch = useRef(null), handoff = useRef(null), shareSequence = useRef(0), shareLocked = useRef(false)
  const epoch = useRef(0), pdfLink = useRef(''), previewRef = useRef(null)
  useEffect(() => {
    gmailWatch.current?.(); ++epoch.current; pdfLink.current = ''; setEnlace(''); setPreview(null); setBusy(''); setError(''); setInfo('')
    setTel(invoice.clientes?.telefono || ''); setCorreo(invoice.clientes?.correo || ''); setProviderChoice(null); setEmailNotice(''); setSharing(false); handoff.current = null; ++shareSequence.current; shareLocked.current = false
    return () => { ++epoch.current }
  }, [invoice.id])
  useEffect(() => { if (preview) previewRef.current?.scrollIntoView({ block: 'nearest' }) }, [preview])
  useEffect(() => {
    alive.current = true
    logoListo.then(() => { if (alive.current) setLogoReady(true) })
    const preference = event => { if (!event.key || event.key === EMAIL_PROVIDER_KEY) setProvider(leerProveedorCorreo()) }
    const leave = event => { if (handoff.current) { handoff.current.left = true; if (event.type === 'pagehide' || document.visibilityState === 'hidden') handoff.current.backgrounded = true } }
    const resume = event => {
      if (document.visibilityState === 'hidden') { leave(event); return }
      if (!handoff.current || (!handoff.current.left && !(event.type === 'pageshow' && event.persisted))) return
      const trip = handoff.current, kind = trip.kind
      handoff.current = null; ++shareSequence.current; shareLocked.current = false
      quitarFocoEntrada(); setSharing(false)
      if (trip.iosGmail && !trip.backgrounded) { gmailWatch.current?.(); masOpciones('Si Gmail no se abrió, comparte el PDF o elige otra opción.'); return }
      if (kind === 'email') setEmailNotice('Adjunta el PDF descargado antes de enviar.')
      else setInfo('La factura sigue disponible. Puedes compartirla o continuar vendiendo.')
    }
    window.addEventListener('storage', preference); window.addEventListener('email-provider-change', preference)
    window.addEventListener('blur', leave); window.addEventListener('pagehide', leave)
    window.addEventListener('focus', resume); window.addEventListener('pageshow', resume); document.addEventListener('visibilitychange', resume)
    return () => {
      gmailWatch.current?.(); alive.current = false; handoff.current = null; ++shareSequence.current
      window.removeEventListener('storage', preference); window.removeEventListener('email-provider-change', preference)
      window.removeEventListener('blur', leave); window.removeEventListener('pagehide', leave)
      window.removeEventListener('focus', resume); window.removeEventListener('pageshow', resume); document.removeEventListener('visibilitychange', resume)
    }
  }, [])
  useEffect(()=>{
    let live=true;const controller=new AbortController()
    const refresh=()=>loadInvoiceMessageStore(supabase,controller.signal,tienda?.id??invoice.negocio_id).then(store=>{if(live){setMessageStore(previous=>JSON.stringify(previous)===JSON.stringify(store)?previous:store);setMessagesReady(true);setMessagesError('')}}).catch(()=>{if(live){setMessagesReady(false);setMessagesError('No se pudieron cargar los mensajes de la tienda. Usa el PDF o reintenta.')}})
    const resume=()=>{if(document.visibilityState!=='hidden')void refresh()}
    const stored=event=>{if(!event.key||event.key.startsWith('angie'))void refresh()}
    setMessagesReady(false);setMessagesError('');void refresh()
    window.addEventListener('invoice-message-templates-change',refresh);window.addEventListener('storage',stored);window.addEventListener('focus',resume);document.addEventListener('visibilitychange',resume)
    return()=>{live=false;controller.abort();window.removeEventListener('invoice-message-templates-change',refresh);window.removeEventListener('storage',stored);window.removeEventListener('focus',resume);document.removeEventListener('visibilitychange',resume)}
  },[invoice.id,tienda?.id,messageRetry])
  const text = () => textoFactura(invoice, items, tienda, invoice.clientes)
  const pdf = useMemo(() => {
    if (preview?.canal !== 'pdf') return null
    try { return createInvoicePdf(invoice, items, tienda, isDemoMode) } catch { return null }
  }, [preview, invoice, items, tienda])
  const readyPdf = useMemo(() => { try { return createInvoicePdf(invoice, items, tienda, isDemoMode) } catch { return null } }, [invoice, items, tienda, logoReady])
  const readyFile = useMemo(() => { try { return readyPdf ? invoicePdfFile(readyPdf) : null } catch { return null } }, [readyPdf])
  const shareable = puedeCompartirFactura(readyFile)
  const providerName = EMAIL_PROVIDERS.find(p => p.id === provider)?.label || 'Elegir proveedor'
  function masOpciones(reason = '') {
    gmailWatch.current?.(); quitarFocoEntrada(); ++epoch.current; setBusy(''); setProviderChoice(null); setEditar(false)
    setError(''); setPreview({ canal: 'correo', reason, fallbackId: epoch.current })

  }
  function pedirCorreo() {
    gmailWatch.current?.(); handoff.current = null; quitarFocoEntrada(); ++epoch.current; setBusy(''); setError(''); setInfo(''); setEmailNotice(''); setProviderChoice(null); setEditar(false); setPreview({canal:'correo-directo'})
  }
  function abrirCorreo(chosen, keepFallback = false, gmailWeb = false) {
    gmailWatch.current?.(); quitarFocoEntrada(); setError(''); setInfo(''); setProviderChoice(null); setEmailNotice('')
    try {
      const draft = crearBorradorCorreoFactura({ invoice, correo, detalle: text(), tienda:messageStore, items, pdfUrl: pdfLink.current || '' })
      const invalid = validarCorreoFactura(correo)
      if (invalid) return masOpciones(invalid)
      ++epoch.current; setBusy(''); ++shareSequence.current; shareLocked.current = false; setSharing(false)
      const trip = { kind: 'email', left: false, iosGmail: chosen === 'gmail' && esIOSCorreo() && !gmailWeb }
      handoff.current = trip
      const task = epoch.current
      if (trip.iosGmail) gmailWatch.current = vigilarAperturaGmailIOS(() => {
        if (alive.current && task === epoch.current && handoff.current === trip) { handoff.current = null; masOpciones('Si Gmail no se abrió, comparte el PDF o elige otra opción.') }
      })
      const result = abrirCompositorCorreo(draft, chosen, { gmailWeb })
      if (result !== 'requested' && result !== 'attempted') { handoff.current = null; return masOpciones('No se pudo abrir el correo. Elige otra opción para compartir tu factura.') }
      onEnviado?.('correo')
      if (!keepFallback) setPreview(null)
      if (draft.adjuntoManual === false) setEmailNotice(trip.iosGmail ? 'Intentamos abrir Gmail. Si no aparece, usa Más opciones. El correo ya lleva el enlace al PDF.' : 'Correo listo con el enlace al PDF. Revisa y presiona Enviar.')
      else setEmailNotice(trip.iosGmail ? 'Intentamos abrir Gmail. Si no aparece el compositor, usa Más opciones. Adjunta el PDF descargado antes de enviar.' : gmailWeb && esIOSCorreo() ? 'Gmail web en iOS puede mostrar la bandeja. Crea el mensaje y adjunta el PDF manualmente.' : 'Adjunta el PDF descargado antes de enviar.')
    } catch { handoff.current = null; masOpciones('No se pudo preparar el correo. Revisa el destinatario o elige otra opción.') }
  }
  function elegirProveedor(chosen) {
    const send = providerChoice === 'send'
    try {
      const saved = guardarProveedorCorreo(chosen)
      setProvider(chosen); setProviderChoice(null)
      if (saved) window.dispatchEvent(new Event('email-provider-change'))
      if (send) abrirCorreo(chosen)
      else setInfo('Proveedor de correo actualizado. Tu próximo envío usará ' + EMAIL_PROVIDERS.find(p => p.id === chosen).label + '.')
    } catch { masOpciones('Elige un proveedor de correo para continuar.') }
  }
  async function compartirDirecto(message) {
    if(!shareable){quitarFocoEntrada();setInfo('Este navegador no permite compartir archivos. Guarda el PDF y adjúntalo desde tu aplicación.');return guardarPdf()}
    if (shareLocked.current) return
    shareLocked.current = true
    const token = ++shareSequence.current, trip = { kind: 'share', left: false }
    handoff.current = trip
    quitarFocoEntrada(); setError(''); setInfo(''); setEmailNotice(''); setSharing(true)
    const result = await compartirFacturaPorSistema(readyFile, navigator, { title: 'Factura ' + invoice.prefijo + '-' + String(invoice.numero).padStart(4, '0') + ' - ' + invoiceBrand(invoice.tienda_snapshot || tienda), text: typeof message==='string'?message:crearBorradorCorreoFactura({invoice,tienda:messageStore,items,pdfUrl:pdfLink.current||''}).cuerpo })
    if (!alive.current || token !== shareSequence.current) return
    shareLocked.current = false; setSharing(false)
    if (result !== 'shared' && !trip.left) handoff.current = null
    if (result === 'shared') onEnviado?.('compartir')
    if (result === 'unavailable') return masOpciones('No se pudo compartir desde el dispositivo. Puedes descargar el PDF o copiar el mensaje.')
    setInfo(result === 'cancelled' ? 'Compartir cancelado. La factura sigue disponible.' : 'Confirma el envío en la aplicación que elegiste.')
  }
  async function registrar(canal, destino) {
    const result = await conLimiteEnvio(() => supabase.from('factura_envios').insert({ factura_id: invoice.id, canal, destino, enviado_por: perfil.id, ...(isDemoMode ? { fecha: new Date().toISOString(), simulado: true, estado: 'previsualizado' } : {}) }))
    if (result.error) throw result.error
  }
  async function preparar(canal) {
    quitarFocoEntrada();setError('');setInfo('');const task=++epoch.current;setBusy(canal)
    try{
      const current=await loadInvoiceMessageStore(supabase,undefined,tienda?.id??invoice.negocio_id)
      if(!alive.current||task!==epoch.current)return
      setMessageStore(current);setMessagesReady(true);setMessagesError('')
      if(canal==='correo'&&!CORREO_ACTIVO)return
      if(canal==='correo'&&CORREO_SERVIDOR)return pedirCorreo()
      if(!isDemoMode&&!pdfLink.current){
        try{const link=await conLimiteEnvio(()=>enlaceFactura(invoice,items,tienda));if(!alive.current||task!==epoch.current)return;pdfLink.current=link;setEnlace(link)}
        catch{if(task===epoch.current)setInfo('No se pudo preparar el enlace de la factura. Comparte el PDF real o descárgalo para adjuntarlo.')}
      }
      if(!alive.current||task!==epoch.current)return
      if(canal==='correo'||canal==='manual')return masOpciones()
      const message=prepararEnvioFactura({canal,invoice,telefono:tel,correo,pdfUrl:pdfLink.current,detalle:text(),tienda:current,items})
      setPreview(message)
      if(isDemoMode)try{await registrar(canal,message.destino)}catch{if(task===epoch.current)setInfo('Vista previa disponible. No se pudo registrar el intento de envío.')}
    }catch(e){if(alive.current&&task===epoch.current)setError('No se pudo preparar el mensaje vigente. '+mensajeError(e))}
    finally{if(alive.current&&task===epoch.current)setBusy('')}
  }
  function cerrarPreview() { gmailWatch.current?.(); handoff.current = null; quitarFocoEntrada(); ++epoch.current; setBusy(''); setProviderChoice(null); setEmailNotice(''); setPreview(null); setError(''); setInfo('') }
  function abrirMensaje(event) {
    event?.preventDefault(); quitarFocoEntrada(); setError('')
    try {
      abrirEnvioFactura(preview)
      toast('Mensaje preparado. Confirma el envío en la aplicación.')
      onEnviado?.(preview.canal)
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
    <ErrorBox text={error||messagesError}/>{messagesError&&<button type="button" className="btn sec full" onClick={()=>setMessageRetry(n=>n+1)}>Reintentar mensajes</button>}
    {info && <p className="fd-hint" role="status">{info}</p>}
    <div className="fd-actions has-share">
      {invoice.estado !== 'anulada' && <button type="button" className="fd-act wa" aria-label="Enviar por WhatsApp" disabled={!!busy||!messagesReady} onClick={() => preparar('whatsapp')}><span className="fd-act-ic"><I n="chat" /></span><b>{busy === 'whatsapp' ? 'Preparando…' : 'WhatsApp'}</b><small>{tel || 'Sin número'}</small></button>}
      {invoice.estado !== 'anulada' && <button type="button" className={'fd-act mail' + (CORREO_ACTIVO ? '' : ' is-off')} aria-label={CORREO_ACTIVO ? 'Enviar factura por correo' : 'Correo: próximamente'} disabled={!!busy || !CORREO_ACTIVO || !messagesReady} onClick={() => preparar('correo')}><span className="fd-act-ic"><I n="mail" /></span><b>{busy === 'correo' ? 'Preparando…' : 'Correo'}</b><small>{CORREO_ACTIVO ? (correo || 'Sin correo') : 'Próximamente'}</small></button>}
      {<button type="button" className="fd-act share" aria-label="Compartir el PDF de la factura por cualquier aplicación" disabled={sharing || !!busy} onClick={compartirDirecto}><span className="fd-act-ic"><I n="truckIn" /></span><b>{sharing ? 'Compartiendo…' : 'Compartir PDF'}</b><small>Archivo · eliges la app</small></button>}
      <button type="button" className="fd-act pdf" onClick={verPdf}><span className="fd-act-ic"><I n="receipt" /></span><b>Ver PDF</b><small>Imprimir o guardar</small></button>
    </div>
    {invoice.estado !== 'anulada' && CORREO_ACTIVO && <p className="email-composer-reminder">{CORREO_SERVIDOR ? 'Envío desde la app con PDF adjunto · confirma el destinatario.' : 'El correo lleva el enlace a la factura en PDF · confirma el destinatario.'}</p>}
    {invoice.estado !== 'anulada' && CORREO_ACTIVO && <div className="email-quick-options"><button type="button" className="email-quick-link email-more-options" disabled={!messagesReady||!!busy} onClick={() => preparar('manual')}><I n="dots" />Más opciones</button><button type="button" className="email-quick-link email-change-provider" onClick={() => { quitarFocoEntrada(); ++epoch.current; setBusy(''); setPreview(null); setProviderChoice('change') }}>Correo: {providerName}<I n="chevDown" /></button></div>}
    {emailNotice && <div className="email-direct-status" role="status"><p>{emailNotice}</p><button type="button" className="btn sec" onClick={() => guardarPdf()}>Descargar PDF</button><button type="button" className="btn sec" onClick={() => masOpciones()}>Más opciones de correo</button></div>}
    {providerChoice && <InvoiceEmailProviderPicker changing={providerChoice === 'change'} preferred={provider} onPick={elegirProveedor} onCancel={() => { quitarFocoEntrada(); setProviderChoice(null) }} />}
    {preview?.canal === 'correo-directo' && <InvoiceEmailSend key={invoice.id} invoice={invoice} items={items} tienda={messageStore} onCancel={cerrarPreview} onShare={compartirDirecto} onManual={() => preparar('manual')} onSent={() => onEnviado?.('correo')} />}
    {preview?.canal === 'correo' && <InvoiceEmailPreview key={invoice.id + ':' + preview.fallbackId} pdfUrl={enlace || pdfLink.current || ''} invoice={invoice} items={items} tienda={messageStore} correo={correo} onCorreo={setCorreo} detalle={text()} reason={preview.reason} onOpenProvider={p => abrirCorreo(p, true)} onOpenGmailWeb={() => abrirCorreo('gmail', true, true)} onCancel={cerrarPreview} />}
    {preview && !['correo','correo-directo'].includes(preview.canal) && <section ref={previewRef} className={'invoice-preview ' + (preview.canal === 'pdf' ? 'invoice-document-preview' : 'invoice-message-preview')}>
      <b>{preview.canal === 'pdf' ? 'Vista previa de factura' : preview.canal === 'correo-listo' ? 'Correo para el cliente' : 'Mensaje de WhatsApp'}</b>
      {preview.canal === 'pdf' ? <InvoicePreview invoice={invoice} items={items} tienda={tienda} demo={isDemoMode} /> : <>
        <p><b>Destinatario:</b> {preview.destino}</p>
        <pre>{preview.cuerpo}</pre>
        <p className="delivery-attachment">{preview.adjuntoManual ? 'Descarga el PDF y adjúntalo manualmente en la aplicación.' : 'El mensaje lleva el enlace a la factura: el cliente la ve y la descarga en PDF.'}</p>
        {shareable&&<button type="button" className="btn full whatsapp-share-pdf" onClick={()=>compartirDirecto(preview.cuerpo)}>Compartir PDF y mensaje</button>}
        {preview.adjuntoManual && <button type="button" className="btn sec full" onClick={() => guardarPdf()}>Descargar PDF para adjuntar</button>}
      </>}
      <button type="button" className="btn sec full" onClick={cerrarPreview}>Cerrar vista previa</button>
      {preview.canal === 'pdf' && <div className="invoice-pdf-actions"><button type="button" className="btn" onClick={() => guardarPdf()}>Guardar PDF</button><button type="button" className="btn sec" onClick={() => { quitarFocoEntrada(); window.print() }}>Imprimir</button>{pdf && canSharePdf(invoicePdfFile(pdf)) && <button type="button" className="btn sec" onClick={() => guardarPdf(true)}>Compartir PDF</button>}</div>}
      {preview.canal === 'whatsapp' && <button type="button" className="btn full mt-2" onClick={abrirMensaje}>Abrir WhatsApp</button>}
      {preview.canal === 'correo-listo' && <button type="button" className="btn full mt-2" onClick={() => esProveedorCorreo(provider) ? abrirCorreo(provider) : (quitarFocoEntrada(), setProviderChoice('send'))}>{esProveedorCorreo(provider) ? 'Abrir ' + providerName : 'Elegir app de correo'}</button>}
    </section>}
    {invoice.estado !== 'anulada' && (editar ? <div className="fd-contact">
      <Input label="WhatsApp del cliente" value={tel} onChange={e => setTel(e.target.value)} inputMode="tel" placeholder="300 123 4567" />
      <Input label="Correo del cliente" value={correo} onChange={e => setCorreo(e.target.value)} type="email" inputMode="email" placeholder="cliente@correo.com" />
      <p className="fd-hint">Estos datos se usan para preparar este envío.</p>
    </div> : <button type="button" className="fd-link" onClick={() => setEditar(true)}><I n="pencil" />Cambiar número o correo de envío</button>)}
  </section>
}
