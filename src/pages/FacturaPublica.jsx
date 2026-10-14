import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { money } from '../lib/format'
import InvoicePreview from '../components/InvoicePreview'
import { createInvoicePdf, invoicePdfFile, canSharePdf, saveInvoicePdf, logoListo } from '../lib/invoicePdf'
import { invoiceBrand } from '../../supabase/functions/_shared/invoice-brand.js'
import '../styles/factura-publica.css'

// Página que abre el cliente desde el enlace de WhatsApp o correo: /f/<código>
export default function FacturaPublica() {
  const { token } = useParams()
  const [estado, setEstado] = useState('cargando'), [doc, setDoc] = useState(null), [aviso, setAviso] = useState(''), [logo, setLogo] = useState(false)
  useEffect(() => {
    let vivo = true
    logoListo.then(() => { if (vivo) setLogo(true) })
    supabase?.rpc('factura_publica', { p_token: String(token || '') }).then(({ data, error }) => {
      if (!vivo) return
      if (error || !data?.factura) return setEstado('invalido')
      setDoc(data); setEstado('listo')
    }).catch(() => { if (vivo) setEstado('error') })
    return () => { vivo = false }
  }, [token])
  const datos = useMemo(() => doc && {
    invoice: { ...doc.factura, clientes: doc.cliente, perfiles: doc.vendedor },
    items: doc.items || [],
    tienda: doc.tienda || {},
  }, [doc])
  useEffect(() => { if (datos) document.title = `Factura ${datos.invoice.prefijo}-${String(datos.invoice.numero).padStart(4, '0')} · ${invoiceBrand(datos.tienda)}` }, [datos])
  const pdf = useMemo(() => { try { return datos ? createInvoicePdf(datos.invoice, datos.items, datos.tienda) : null } catch { return null } }, [datos, logo])
  const compartible = useMemo(() => { try { return pdf ? canSharePdf(invoicePdfFile(pdf)) : false } catch { return false } }, [pdf])
  async function descargar(compartir = false) {
    setAviso('')
    try { await logoListo; await saveInvoicePdf(createInvoicePdf(datos.invoice, datos.items, datos.tienda), compartir) }
    catch { setAviso('No se pudo generar el PDF. Inténtalo de nuevo.') }
  }
  if (estado === 'cargando') return <main className="fp-page"><div className="fp-loading" role="status"><span className="fp-spinner" />Cargando tu factura…</div></main>
  if (estado !== 'listo') return <main className="fp-page"><section className="fp-empty">
    <span className="fp-eyebrow">FACTURA</span>
    <h1>{estado === 'error' ? 'No pudimos cargar tu factura' : 'Este enlace no está disponible'}</h1>
    <p>{estado === 'error' ? 'Revisa tu conexión a internet e inténtalo de nuevo.' : 'Puede que haya vencido o esté incompleto. Pide a la tienda que te envíe la factura otra vez.'}</p>
    {estado === 'error' && <button type="button" className="fp-btn" onClick={() => window.location.reload()}>Reintentar</button>}
  </section></main>
  const marca = invoiceBrand(datos.tienda)
  const devuelto = Number(datos.invoice.devuelto) || 0
  return <main className="fp-page">
    <header className="fp-head">
      <span className="fp-eyebrow">{marca.toUpperCase()}</span>
      <h1>Gracias por tu compra{datos.invoice.clientes?.nombre ? ', ' + datos.invoice.clientes.nombre.trim().split(/\s+/)[0] : ''}</h1>
      <p>Esta es tu factura. Puedes descargarla en PDF cuando quieras.</p>
    </header>
    <div className="fp-actions">
      <button type="button" className="fp-btn" onClick={() => descargar(false)}>Descargar PDF</button>
      {compartible && <button type="button" className="fp-btn sec" onClick={() => descargar(true)}>Compartir</button>}
    </div>
    {aviso && <p className="fp-aviso" role="alert">{aviso}</p>}
    {devuelto > 0 && <p className="fp-nota">Esta factura tiene devoluciones por {money(devuelto)}. Total final: <b>{money(datos.invoice.total - devuelto)}</b></p>}
    <div className="fp-doc"><InvoicePreview invoice={datos.invoice} items={datos.items} tienda={datos.tienda} /></div>
    <footer className="fp-foot">{marca}{datos.tienda.telefono ? ' · ' + datos.tienda.telefono : ''}{datos.tienda.direccion ? ' · ' + datos.tienda.direccion : ''}</footer>
  </main>
}
