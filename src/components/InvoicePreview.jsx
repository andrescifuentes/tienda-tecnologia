import { invoiceBrand, isAngieBrand, camposEmpresa } from '../../supabase/functions/_shared/invoice-brand.js'
import { businessNit, validateBusinessLogo } from '../../supabase/functions/_shared/business-settings.js'
import { money, numFactura } from '../lib/format'
import { invoiceBusiness, invoiceIdentity } from '../lib/invoiceSnapshot'
import logoGold from '../assets/brand/angie-tech-logo-gold.png'

// Vista previa premium (mismo diseño que el PDF)
export default function InvoicePreview({ invoice, items, tienda, demo = false }) {
  invoice = invoiceIdentity(invoice)
  tienda = invoiceBusiness(invoice, tienda) || {}
  const marca = invoiceBrand(tienda)
  const c = invoice.clientes || {}, v = invoice.perfiles || {}
  const f = new Date(invoice.fecha)
  const fecha = f.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' })
  const hora = f.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' })
  const datosTienda = [
    ...(tienda.razon_social ? [['Razón social', tienda.razon_social]] : []),
    ...camposEmpresa({ ...tienda, nit:businessNit(tienda), direccion:[tienda.direccion,tienda.ciudad].filter(Boolean).join(', ') }),
    ...(tienda.whatsapp ? [['WhatsApp', tienda.whatsapp]] : []),
  ]
  let logo = isAngieBrand(tienda) ? logoGold : null
  if (tienda.logo_data_url) { try { logo = validateBusinessLogo(tienda.logo_data_url) } catch { /* Keep this business' own branding if a historical image is invalid. */ } }
  const unidades = items.reduce((a, i) => a + Number(i.cantidad || 0), 0)
  const Dato = ({ k, v }) => v ? <div className="fx-dato"><dt>{k}</dt><dd>{v}</dd></div> : null
  return <article className="print-invoice fx" data-print-invoice>
    <header className="fx-head">
      {logo ? <img src={logo} alt={marca} className="fx-logo" /> : <span className="fx-logo fx-logo-txt">{marca}</span>}
      <div className="fx-ref">
        <small>FACTURA DE VENTA</small>
        <h2>{numFactura(invoice)}</h2>
        <p>{fecha} · {hora}</p>
        <span className={'fx-state' + (invoice.estado === 'anulada' ? ' bad' : '')}>{invoice.estado === 'anulada' ? 'Anulada' : 'Emitida'}</span>
      </div>
    </header>
    <div className="fx-store"><div className="fx-store-head"><span className="fx-store-eyebrow">EMPRESA</span><b>{marca}</b></div>{datosTienda.length ? <dl className="fx-store-grid">{datosTienda.map(([k, v]) => <div key={k + v} className={k === 'Dirección' ? 'wide' : ''}><dt>{k}</dt><dd>{v}</dd></div>)}</dl> : <span className="fx-store-empty">Tecnología, celulares y accesorios</span>}</div>
    <div className="fx-parties">
      <section>
        <small className="fx-tag">CLIENTE</small>
        <h3>{c.nombre || 'Consumidor final'}</h3>
        {c.nombre ? <dl>
          <Dato k="Documento" v={c.documento && `${c.tipo_documento || 'CC'} ${c.documento}`} /><Dato k="Teléfono" v={c.telefono} /><Dato k="Correo" v={c.correo} /><Dato k="Dirección" v={c.direccion} />
        </dl> : <p className="fx-muted">Venta de mostrador · sin datos de contacto</p>}
      </section>
      <span className="fx-divider" aria-hidden="true" />
      <section>
        <small className="fx-tag">ATENDIDO POR</small>
        <h3>{v.nombre || 'Vendedor'}</h3>
        <dl>
          {/* Siempre el correo del negocio, nunca el personal del vendedor */}<Dato k="Correo" v={tienda.correo} /><Dato k="Teléfono" v={v.telefono} /><Dato k="Método de pago" v={invoice.metodo_pago && invoice.metodo_pago.charAt(0).toUpperCase() + invoice.metodo_pago.slice(1)} />
        </dl>
      </section>
    </div>
    <div className="fx-table">
      <div className="fx-row fx-th"><span>#</span><span>Descripción</span><span>Cant.</span><span>Total</span></div>
      {items.map((it, i) => <div className="fx-row" key={it.id || i}>
        <span className="fx-n">{String(i + 1).padStart(2, '0')}</span>
        <span className="fx-desc"><b>{it.nombre}</b>{it.serial && <small className="fx-meta">Serial/IMEI: {it.serial}</small>}{it.codigo && <small className="fx-meta"><span className="fx-ref-tag">REF.</span> <span className="fx-code">{it.codigo}</span></small>}<small className="fx-meta fx-unit">{it.cantidad} × {money(it.precio_unitario)}</small></span>
        <span className="fx-q">{it.cantidad}</span>
        <span className="fx-t">{money(it.cantidad * it.precio_unitario - (Number(it.descuento) || 0))}</span>
      </div>)}
    </div>
    <div className="fx-sum">
      <p className="fx-count">{items.length} {items.length === 1 ? 'producto' : 'productos'} · {unidades} {unidades === 1 ? 'unidad' : 'unidades'}</p>
      <div className="fx-totals">
        <p><span>Subtotal</span><b>{money(invoice.subtotal)}</b></p>
        {Number(invoice.descuento) > 0 && <p className="disc"><span>Descuento</span><b>-{money(invoice.descuento)}</b></p>}
        <div className="fx-total"><span>TOTAL<small>COP</small></span><b>{money(invoice.total)}</b></div>
      </div>
    </div>
    {invoice.notas && <p className="fx-notes">Notas: {invoice.notas}</p>}
    <footer className="fx-foot"><i />
      <h4>Gracias por tu compra</h4>
      <p>{tienda.factura_pie || 'Conserva este documento para cambios y soporte.'}</p>
      <small>{marca} · Documento de venta interno{demo ? ' · Demostración local' : ''}</small>
    </footer>
  </article>
}
