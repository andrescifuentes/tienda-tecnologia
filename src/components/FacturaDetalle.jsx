import { useEffect, useState } from 'react'
import Modal from './Modal'
import { Loader, Badge, ErrorBox, Input } from './ui'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { money, fechaHora, numFactura, mensajeError } from '../lib/format'
import { textoFactura } from '../lib/factura'
import { enlaceWhatsApp } from '../lib/whatsapp'
import { toast } from '../lib/toast'

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
  const [busy, setBusy] = useState(false)

  async function cargar() {
    const { data, error } = await supabase.from('facturas').select('*, clientes(*), perfiles(nombre)').eq('id', id).single()
    if (error) return setErr(mensajeError(error))
    const [it, dv] = await Promise.all([
      supabase.from('factura_items').select('*').eq('factura_id', id).order('id'),
      supabase.from('devoluciones').select('id, motivo, total_devuelto, fecha, devolucion_items(factura_item_id, cantidad)').eq('factura_id', id),
    ])
    setF(data); setItems(it.data || []); setDevs(dv.data || [])
    setTel(data.clientes?.telefono || '')
  }
  useEffect(() => { cargar() }, [id]) // eslint-disable-line

  const devueltos = (itemId) => devs.flatMap((d) => d.devolucion_items).filter((x) => x.factura_item_id === itemId).reduce((a, x) => a + x.cantidad, 0)
  const texto = () => f && textoFactura(f, items, tienda, f.clientes)

  async function registrarEnvio(canal, destino) {
    await supabase.from('factura_envios').insert({ factura_id: f.id, canal, destino, enviado_por: perfil.id })
  }
  async function porWhatsApp() {
    if (!tel.trim()) return setErr('Escribe el teléfono del cliente.')
    await registrarEnvio('whatsapp', tel.trim())
    window.open(enlaceWhatsApp(tel, texto()), '_blank')
  }
  async function porCorreo() {
    const c = f.clientes?.correo
    if (!c) return setErr('El cliente no tiene correo registrado.')
    await registrarEnvio('correo', c)
    window.location.href = `mailto:${c}?subject=${encodeURIComponent('Factura ' + numFactura(f))}&body=${encodeURIComponent(texto().replace(/\*/g, ''))}`
  }
  async function compartir() {
    const t = texto().replace(/\*/g, '')
    if (navigator.share) { try { await navigator.share({ title: 'Factura ' + numFactura(f), text: t }) } catch { /* cancelado */ } }
    else { await navigator.clipboard?.writeText(t); toast('Factura copiada') }
  }
  function imprimir() {
    const w = window.open('', '_blank')
    if (!w) return
    const filas = items.map((i) => `<tr><td>${i.cantidad}</td><td>${i.nombre}</td><td style="text-align:right">${money(i.precio_unitario * i.cantidad - i.descuento)}</td></tr>`).join('')
    w.document.write(`<html><head><title>${numFactura(f)}</title><style>body{font-family:sans-serif;max-width:380px;margin:20px auto}td{padding:4px 0}</style></head><body><h2>${tienda?.nombre || 'TechStore'}</h2><p>${tienda?.nit ? 'NIT ' + tienda.nit + '<br>' : ''}Factura ${numFactura(f)}<br>${fechaHora(f.fecha)}${f.clientes ? '<br>Cliente: ' + f.clientes.nombre : ''}</p><table width="100%">${filas}</table><hr>${f.descuento > 0 ? '<p>Descuento: -' + money(f.descuento) + '</p>' : ''}<h3>Total: ${money(f.total)}</h3><p>${tienda?.factura_pie || 'Gracias por tu compra.'}</p><script>window.print()</script></body></html>`)
    w.document.close()
  }

  async function anular() {
    if (!motivo.trim()) return setErr('Escribe el motivo.')
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('anular_factura', { p_factura_id: f.id, p_motivo: motivo.trim() })
    setBusy(false)
    if (error) return setErr(mensajeError(error))
    toast('Factura anulada'); setModo(null); setMotivo(''); cargar(); onCambio?.()
  }
  async function devolver() {
    const lista = Object.entries(cants).filter(([, n]) => n > 0).map(([k, n]) => ({ factura_item_id: Number(k), cantidad: n }))
    if (lista.length === 0) return setErr('Elige al menos un producto a devolver.')
    if (!motivo.trim()) return setErr('Escribe el motivo.')
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('registrar_devolucion', { p_factura_id: f.id, p_items: lista, p_motivo: motivo.trim(), p_reintegra_stock: reintegra })
    setBusy(false)
    if (error) return setErr(mensajeError(error))
    toast('Devolución registrada'); setModo(null); setMotivo(''); setCants({}); cargar(); onCambio?.()
  }

  if (!f) return <Modal title="Factura" onClose={onClose}>{err ? <ErrorBox text={err} /> : <Loader />}</Modal>
  const anulada = f.estado === 'anulada'

  return (
    <Modal title={(nueva ? '✓ Venta registrada · ' : '') + numFactura(f)} onClose={onClose}>
      <ErrorBox text={err} />
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-muted">{fechaHora(f.fecha)} · {f.perfiles?.nombre}</span>
        {anulada && <Badge tone="bad">Anulada</Badge>}
      </div>
      <p className="text-sm mt-0 mb-2"><b>Cliente:</b> {f.clientes?.nombre || 'Consumidor final'}</p>

      <div className="card !p-3 mb-3">
        {items.map((i) => (
          <div key={i.id} className="row">
            <div className="flex-1"><p className="m-0 text-sm font-semibold">{i.cantidad} × {i.nombre}</p>{devueltos(i.id) > 0 && <p className="m-0 text-xs text-warn">Devueltos: {devueltos(i.id)}</p>}</div>
            <b className="text-sm">{money(i.precio_unitario * i.cantidad - i.descuento)}</b>
          </div>
        ))}
        {f.descuento > 0 && <div className="flex justify-between text-sm pt-2"><span className="text-muted">Descuento</span><b>-{money(f.descuento)}</b></div>}
        <div className="flex justify-between text-base pt-2"><span>Total ({f.metodo_pago})</span><b>{money(f.total)}</b></div>
        {f.comision != null && <div className="flex justify-between text-xs text-muted pt-1"><span>Comisión ({f.comision_pct}%)</span><span>{money(f.comision)}</span></div>}
      </div>
      {anulada && <p className="text-sm text-bad">Motivo de anulación: {f.motivo_anulacion}</p>}

      {!anulada && !modo && (
        <>
          <Input label="Teléfono para WhatsApp" value={tel} onChange={(e) => setTel(e.target.value)} inputMode="tel" />
          <div className="grid grid-cols-2 gap-2 mb-3">
            <button className="btn" onClick={porWhatsApp}>WhatsApp</button>
            <button className="btn sec" onClick={porCorreo}>Correo</button>
            <button className="btn sec" onClick={compartir}>Compartir</button>
            <button className="btn sec" onClick={imprimir}>PDF / Imprimir</button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {can('hacer_devoluciones') && <button className="btn sec" onClick={() => { setErr(''); setModo('devolver') }}>Devolución</button>}
            {can('anular_facturas') && <button className="btn bad" onClick={() => { setErr(''); setModo('anular') }}>Anular</button>}
          </div>
        </>
      )}

      {modo === 'anular' && (
        <>
          <p className="text-sm text-muted">Al anular, el stock vuelve al inventario y la venta deja de contar.</p>
          <Input label="Motivo de la anulación" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          <div className="grid grid-cols-2 gap-2"><button className="btn sec" onClick={() => setModo(null)}>Cancelar</button><button className="btn bad" disabled={busy} onClick={anular}>Confirmar anulación</button></div>
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
          <div className="grid grid-cols-2 gap-2"><button className="btn sec" onClick={() => setModo(null)}>Cancelar</button><button className="btn" disabled={busy} onClick={devolver}>Registrar devolución</button></div>
        </>
      )}
    </Modal>
  )
}
