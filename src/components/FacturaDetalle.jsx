import { useEffect, useMemo, useState } from 'react'
import Modal from './Modal'
import InvoicePreview from './InvoicePreview'
import { createInvoicePdf, invoicePdfFile, canSharePdf, saveInvoicePdf, logoListo } from '../lib/invoicePdf'
import ConfirmAction from './ConfirmAction'
import { useAction } from '../lib/useAction'
import { Loader, Badge, ErrorBox, Input } from './ui'
import { supabase, isDemoMode, conAutorizacionAdmin } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { money, fechaHora, numFactura, mensajeError } from '../lib/format'
import { textoFactura } from '../lib/factura'
import { enlaceWhatsApp } from '../lib/whatsapp'
import { toast } from '../lib/toast'
import { I } from './InvIcons'
import { subirFacturaPdf, mensajeWhatsApp, correoFactura } from '../lib/facturaEnvio'

const soloNum = (t) => String(t || '').replace(/\D/g, '')

export default function FacturaDetalle({ id, onClose, nueva = false, onCambio }) {
  const { can, tienda, perfil } = useAuth()
  const [f, setF] = useState(null)
  const [items, setItems] = useState([])
  const [devs, setDevs] = useState([])
  const [err, setErr] = useState('')
  const [modo, setModo] = useState(null) // 'anular' | 'devolver'
  const [motivo, setMotivo] = useState('')
  const [cants, setCants] = useState({})
  const [reintegra, setReintegra] = useState(true)
  const [tel, setTel] = useState('')
  const [correo, setCorreo] = useState('')
  const [enlacePdf, setEnlacePdf] = useState('')
  const [enviando, setEnviando] = useState('')
  const [editarContacto, setEditarContacto] = useState(false)
  const [enviada, setEnviada] = useState(false)
  const [adminCorreo, setAdminCorreo] = useState(''), [adminClave, setAdminClave] = useState('')
  const necesitaAdmin = !can('anular_facturas')
  const bloqueada = nueva && !enviada
  const cerrar = () => { if (bloqueada) return toast('Envía la factura por WhatsApp o correo para finalizar la venta'); onClose() }
  const [busy, setBusy] = useState(false)
  const [confirmRefund,setConfirmRefund] = useState(false), [newWarranty,setNewWarranty] = useState(false)

  async function cargar() {
    const { data, error } = await supabase.from('facturas').select(isDemoMode ? '*, clientes(*), perfiles(nombre)' : '*, clientes(*), perfiles!facturas_vendedor_id_fkey(nombre,correo,telefono)').eq('id', id).single()
    if (error) return setErr(mensajeError(error))
    const [it, dv] = await Promise.all([
      supabase.from('factura_items').select('*').eq('factura_id', id).order('id'),
      supabase.from('devoluciones').select('id, motivo, total_devuelto, fecha, devolucion_items(factura_item_id, cantidad)').eq('factura_id', id),
    ])
    let lineas = it.data || []
    // Código del producto (las líneas guardan nombre y precio; el código se toma del inventario)
    const sinCodigo = [...new Set(lineas.filter(l => !l.codigo).map(l => l.producto_id))]
    if (sinCodigo.length) {
      let { data: cods } = await supabase.from('productos').select('id,codigo').in('id', sinCodigo)
      if (!cods?.length) ({ data: cods } = await supabase.from('productos_venta').select('id,codigo').in('id', sinCodigo))
      const mapa = Object.fromEntries((cods || []).map(r => [r.id, r.codigo]))
      lineas = lineas.map(l => l.codigo ? l : { ...l, codigo: mapa[l.producto_id] || '' })
    }
    setF(data); setItems(lineas); setDevs(dv.data || [])
    setTel(data.clientes?.telefono || '')
    setCorreo(data.clientes?.correo || '')
  }
  useEffect(() => { cargar() }, [id]) // eslint-disable-line

  const devueltos = (itemId) => devs.flatMap((d) => d.devolucion_items).filter((x) => x.factura_item_id === itemId).reduce((a, x) => a + x.cantidad, 0)
  const texto = () => f && textoFactura(f, items, tienda, f.clientes)

  async function registrarEnvio(canal, destino) {
    await supabase.from('factura_envios').insert({ factura_id: f.id, canal, destino, enviado_por: perfil.id })
  }
  const [preview, setPreview] = useState(null)
  const pdf = useMemo(() => {
    if (!f || preview !== 'pdf') return null
    try { return createInvoicePdf(f, items, tienda, isDemoMode) }
    catch { return null } // Guardar PDF reports generation errors without breaking the detail.
  }, [f, items, tienda, preview])
  async function simulate(canal, destino='Vista local') {
    const { error } = await supabase.from('factura_envios').insert({factura_id:f.id,canal,destino,enviado_por:perfil.id,fecha:new Date().toISOString(),simulado:true,estado:'previsualizado'})
    if(error) return setErr(mensajeError(error))
    setPreview(canal); if (canal === 'whatsapp' || canal === 'correo') setEnviada(true); toast('Vista previa preparada')
  }
  async function obtenerEnlace() {
    if (enlacePdf) return enlacePdf
    const url = await subirFacturaPdf(f, items, tienda)
    setEnlacePdf(url); return url
  }
  async function porWhatsApp() {
    const t = tel.trim()
    if (soloNum(t).length < 10) return setErr('Escribe un número de WhatsApp válido (10 dígitos).')
    if (isDemoMode) return simulate('whatsapp', t)
    setErr(''); setEnviando('whatsapp')
    const ventana = window.open('', '_blank') // se abre antes de la subida para que el navegador no la bloquee
    try {
      const url = await obtenerEnlace()
      const link = enlaceWhatsApp(t, mensajeWhatsApp(f, url))
      if (ventana && !ventana.closed) ventana.location.href = link; else window.location.href = link
      await registrarEnvio('whatsapp', t); setEnviada(true)
      toast('Factura lista para enviar por WhatsApp')
    } catch (error) { ventana?.close(); setErr('No se pudo preparar el envío. ' + mensajeError(error)) }
    finally { setEnviando('') }
  }
  async function porCorreo() {
    const c = correo.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)) return setErr('Escribe un correo válido para el cliente.')
    if (isDemoMode) return simulate('correo', c)
    setErr(''); setEnviando('correo')
    try {
      const url = await obtenerEnlace()
      window.location.href = 'mailto:' + c + correoFactura(f, url)
      await registrarEnvio('correo', c); setEnviada(true)
      if (f.cliente_id && !f.clientes?.correo) supabase.from('clientes').update({ correo: c }).eq('id', f.cliente_id).then(() => {})
      toast('Correo preparado con la factura')
    } catch (error) { setErr('No se pudo preparar el envío. ' + mensajeError(error)) }
    finally { setEnviando('') }
  }
  async function compartir() {
    if(isDemoMode) return simulate('compartir')
    const t = texto().replace(/\*/g, '')
    if (navigator.share) { try { await navigator.share({ title: 'Factura ' + numFactura(f), text: t }) } catch { /* cancelado */ } }
    else { await navigator.clipboard?.writeText(t); toast('Factura copiada') }
  }
  function imprimir() { setPreview('pdf') }
  const esMovil = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  async function guardarPdf(share = false) {
    try { await logoListo; await saveInvoicePdf(createInvoicePdf(f, items, tienda, isDemoMode), share) }
    catch (error) { setErr('No se pudo generar el PDF. ' + mensajeError(error)) }
  }

  const [anular, pendingCancel] = useAction(anularImpl, () => setBusy(false))
  async function anularImpl() {
    if (!motivo.trim()) return setErr('Escribe el motivo.')
    setBusy(true); setErr('')
    if (necesitaAdmin && (!adminCorreo.trim() || !adminClave)) { setBusy(false); return setErr('Escribe el correo y la contraseña del administrador.') }
    let error
    if (necesitaAdmin) {
      try {
        await conAutorizacionAdmin(adminCorreo, adminClave, async (cli, admin) => {
          const r = await cli.rpc('anular_factura', { p_factura_id: f.id, p_motivo: `${motivo.trim()} · Solicitada por ${perfil?.nombre || 'vendedor'}, autorizada por ${admin.nombre}` })
          if (r.error) throw new Error(mensajeError(r.error))
        })
      } catch (e) { error = e }
    } else ({ error } = await supabase.rpc('anular_factura', { p_factura_id: f.id, p_motivo: motivo.trim() }))
    setBusy(false); setAdminClave('')
    if (error) return setErr(error.message || mensajeError(error))
    toast('Factura anulada'); setModo(null); setMotivo(''); cargar(); onCambio?.()
  }
  const [devolver, pendingRefund] = useAction(devolverImpl, () => setBusy(false))
  async function devolverImpl() {
    const lista = Object.entries(cants).filter(([, n]) => n > 0).map(([k, n]) => ({ factura_item_id: Number(k), cantidad: n }))
    if (lista.length === 0) return setErr('Elige al menos un producto a devolver.')
    if (!motivo.trim()) return setErr('Escribe el motivo.')
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('registrar_devolucion', { p_factura_id: f.id, p_items: lista, p_motivo: motivo.trim(), p_reintegra_stock: reintegra })
    setBusy(false)
    if (error) { setErr(mensajeError(error)); throw new Error(mensajeError(error)) }
    toast('Devolución registrada'); setModo(null); setMotivo(''); setCants({}); cargar(); onCambio?.()
  }

  if (!f) return <Modal title="Factura" onClose={onClose}>{err ? <ErrorBox text={err} /> : <Loader />}</Modal>
  const anulada = f.estado === 'anulada'

  return (
    <Modal title={nueva ? 'Venta exitosa' : 'Detalle de factura'} className="invoice-detail-sheet experience-sheet fd-sheet" keyboardAware onClose={cerrar} footer={nueva ? <button type="button" className={'fd-finish' + (enviada ? ' ok' : '')} onClick={cerrar}>{enviada ? <><I n="check" />Finalizar venta</> : <><I n="chat" />Envía la factura para finalizar</>}</button> : undefined}>
      <ErrorBox text={err} />
      {confirmRefund && <ConfirmAction title="Confirmar devolución" label="Confirmar devolución" onClose={()=>setConfirmRefund(false)} onConfirm={devolver}>Se registrará la devolución de los productos elegidos y su reverso de dinero y comisión. {reintegra ? 'El stock disponible aumentará.' : 'El producto dañado no aumentará el stock disponible.'}</ConfirmAction>}
      {preview && <section className={"invoice-preview "+(preview === 'pdf' ? 'invoice-document-preview' : 'invoice-message-preview')}><b>{preview === 'pdf' ? 'Vista previa de factura' : preview === 'whatsapp' ? 'Mensaje de WhatsApp' : preview === 'correo' ? 'Mensaje de correo' : 'Compartir factura'}</b>{preview !== 'pdf' && <p>Revisa el mensaje antes de abrir la aplicación.</p>}
        {preview === 'pdf' ? <InvoicePreview invoice={f} items={items} tienda={tienda} demo={isDemoMode} /> : <><p><b>Destinatario:</b> {preview === 'correo' ? correo : preview === 'whatsapp' ? tel : 'Vista local'}</p>{preview === 'correo' && <p><b>Asunto:</b> Factura {numFactura(f)} de ANGIE TECH</p>}<pre>{preview === 'whatsapp' ? 'Hola ' + (f.clientes?.nombre || 'cliente') + ', te compartimos tu factura de ANGIE TECH.\n\n' : ''}{texto()?.replace(/\*/g,'')}</pre></>}
        <button className="btn sec full" onClick={()=>setPreview(null)}>Cerrar vista previa</button>
        {preview === 'pdf' && <div className="invoice-pdf-actions"><button className="btn" onClick={() => guardarPdf()}>Guardar PDF</button><button className="btn sec" onClick={() => esMovil ? guardarPdf(true) : window.print()}>Imprimir</button>{pdf && canSharePdf(invoicePdfFile(pdf)) && <button className="btn sec" onClick={() => guardarPdf(true)}>Compartir PDF</button>}</div>}
        {preview === 'whatsapp' && <button className="btn full mt-2" onClick={() => window.open(enlaceWhatsApp(tel, 'Hola ' + (f.clientes?.nombre || 'cliente') + ', te compartimos tu factura ' + numFactura(f) + ' de ANGIE TECH.\n' + texto()), '_blank', 'noopener,noreferrer')}>Abrir WhatsApp</button>}
        {preview === 'correo' && <a className="btn full mt-2" href={'mailto:' + encodeURIComponent(correo || '') + '?subject=' + encodeURIComponent('Factura ' + numFactura(f) + ' de ANGIE TECH') + '&body=' + encodeURIComponent(texto().replace(/\*/g,''))}>Abrir correo</a>}
      </section>}
      <section className={'fd-hero' + (nueva ? ' new' : '') + (anulada ? ' void' : '')}>
        {nueva ? <span className="fd-check" aria-hidden="true"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24" /><path d="M15 27l7 7 15-16" /></svg></span> : <span className="fd-hero-ic"><I n="receipt" /></span>}
        <span className="fd-hero-eyebrow">{nueva ? '¡Venta registrada!' : anulada ? 'Factura anulada' : 'Factura de venta'}</span>
        <b className="fd-hero-total">{money(f.total)}</b>
        <div className="fd-hero-chips">
          <span className="fd-num">{numFactura(f)}</span>
          <span className={'fd-state ' + (anulada ? 'bad' : 'good')}>{anulada ? 'Anulada' : 'Emitida'}</span>
          <span className={'fd-pay m-' + f.metodo_pago}><I n={{ efectivo: 'cash', tarjeta: 'card', transferencia: 'bank' }[f.metodo_pago] || 'cash'} />{String(f.metodo_pago || '').charAt(0).toUpperCase() + String(f.metodo_pago || '').slice(1)}</span>
        </div>
        <small className="fd-hero-meta">{fechaHora(f.fecha)} · {f.perfiles?.nombre}</small>
      </section>

      <div className="fd-client">
        <span className="fd-client-av">{f.clientes?.nombre ? f.clientes.nombre.split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase() : <I n="user" />}</span>
        <span className="fd-client-txt"><small>Cliente</small><b>{f.clientes?.nombre || 'Consumidor final'}</b><em>{[f.clientes?.documento && (f.clientes?.tipo_documento || 'CC') + ' ' + f.clientes.documento, f.clientes?.telefono].filter(Boolean).join(' · ')}</em></span>
      </div>

      <h4 className="fd-sec">Productos <span>{items.reduce((a, i) => a + i.cantidad, 0)}</span></h4>
      <div className="fd-items">
        {items.map((i) => (
          <div key={i.id} className="fd-item">
            <span className="fd-item-q">{i.cantidad}×</span>
            <span className="fd-item-txt"><b>{i.nombre}</b><small>{i.codigo ? i.codigo + ' · ' : ''}{money(i.precio_unitario)} c/u</small>{devueltos(i.id) > 0 && <small className="warn">Devueltos: {devueltos(i.id)}</small>}</span>
            <b className="fd-item-total">{money(i.precio_unitario * i.cantidad - i.descuento)}</b>
          </div>
        ))}
        {f.descuento > 0 && <div className="fd-line"><span>Descuento</span><b>−{money(f.descuento)}</b></div>}
        <div className="fd-line grand"><span>Total</span><b>{money(f.total)}</b></div>
        {f.comision != null && <div className="fd-line small"><span>Comisión ({f.comision_pct}%)</span><span>{money(f.comision)}</span></div>}
      </div>
      {anulada && <p className="fd-void-note"><I n="warn" />Motivo de anulación: {f.motivo_anulacion}</p>}

      {!modo && <>
        <h4 className="fd-sec">{anulada ? 'Documento' : 'Enviar factura'}{bloqueada && <em className="fd-req">Obligatorio</em>}{nueva && enviada && <em className="fd-ok">Enviada ✓</em>}</h4>
        {bloqueada && <p className="fd-must"><I n="chat" /><span>Envía la factura al cliente por <b>WhatsApp</b> o <b>correo</b> para finalizar la venta.</span></p>}
        <div className="fd-actions">
          {!anulada && <button type="button" className="fd-act wa" disabled={!!enviando} onClick={porWhatsApp}><span className="fd-act-ic"><I n="chat" /></span><b>{enviando === 'whatsapp' ? 'Preparando…' : 'WhatsApp'}</b><small>{tel ? tel : 'Sin número'}</small></button>}
          {!anulada && <button type="button" className="fd-act mail" disabled={!!enviando} onClick={() => correo ? porCorreo() : setEditarContacto(true)}><span className="fd-act-ic"><I n="mail" /></span><b>{enviando === 'correo' ? 'Preparando…' : 'Correo'}</b><small>{correo || 'Agregar correo'}</small></button>}
          <button type="button" className="fd-act pdf" onClick={imprimir}><span className="fd-act-ic"><I n="receipt" /></span><b>Ver PDF</b><small>Imprimir o guardar</small></button>
        </div>
        {!anulada && (editarContacto ? <div className="fd-contact">
          <Input label="WhatsApp del cliente" value={tel} onChange={(e) => setTel(e.target.value)} inputMode="tel" placeholder="300 123 4567" />
          <Input label="Correo del cliente" value={correo} onChange={(e) => setCorreo(e.target.value)} type="email" inputMode="email" placeholder="cliente@correo.com" />
          <p className="fd-hint">Se envía un enlace seguro para descargar la factura en PDF.</p>
        </div> : <button type="button" className="fd-link" onClick={() => setEditarContacto(true)}><I n="pencil" />Cambiar número o correo de envío</button>)}

        {!anulada && <div className="fd-after">
          {f.estado === 'emitida' && can('hacer_devoluciones') && <button type="button" onClick={() => { setErr(''); setModo('devolver') }}><I n="history" />Registrar devolución</button>}
          <button type="button" className="bad" onClick={() => { setErr(''); setModo('anular') }}><I n="warn" />Anular factura{necesitaAdmin && <small className="fd-lock"><I n="shield" />Requiere administrador</small>}</button>
        </div>}
      </>}

      {modo === 'anular' && (
        <>
          <p className="text-sm text-muted">Al anular, el stock vuelve al inventario y la venta deja de contar.</p>
          <Input label="Motivo de la anulación" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          {necesitaAdmin && <div className="fd-auth">
            <p className="fd-auth-head"><I n="shield" /><span><b>Autorización del administrador</b><small>Solo un administrador puede anular facturas. Pídele que ingrese sus datos.</small></span></p>
            <Input label="Correo del administrador" type="email" inputMode="email" autoComplete="off" value={adminCorreo} onChange={(e) => setAdminCorreo(e.target.value)} />
            <Input label="Contraseña del administrador" type="password" autoComplete="new-password" value={adminClave} onChange={(e) => setAdminClave(e.target.value)} />
          </div>}
          <div className="grid grid-cols-2 gap-2"><button className="btn sec" onClick={() => setModo(null)}>Cancelar</button><button className="btn bad" disabled={busy || pendingCancel} onClick={anular}>Confirmar anulación</button></div>
        </>
      )}
      {modo === 'devolver' && (
        <>
          <p className="text-sm font-semibold mb-1">Cantidad a devolver</p>
          {items.map((i) => {
            const disp = i.cantidad - devueltos(i.id)
            return disp > 0 && (
              <div key={i.id} className="row"><span className="flex-1 text-sm">{i.nombre} <span className="text-muted">(máx. {disp})</span></span>
                <input className="inp !w-16 text-center" type="number" min="0" max={disp} value={cants[i.id] ?? 0} onChange={(e) => setCants({ ...cants, [i.id]: Math.max(0, Math.min(disp, Number(e.target.value) || 0)) })} /></div>
            )
          })}
          <label className="flex items-center gap-2 text-sm my-3"><input type="checkbox" checked={reintegra} onChange={(e) => setReintegra(e.target.checked)} /> Reintegrar al inventario (producto en buen estado)</label>
          <Input label="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          <div className="grid grid-cols-2 gap-2"><button className="btn sec" onClick={() => setModo(null)}>Cancelar</button><button className="btn" disabled={busy || pendingRefund} onClick={()=>{if(!Object.values(cants).some(n=>n>0))return setErr('Elige al menos un producto a devolver.');if(!motivo.trim())return setErr('Escribe el motivo.');setConfirmRefund(true)}}>Registrar devolución</button></div>
        </>
      )}
    </Modal>
  )
}
