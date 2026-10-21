import Modal from './Modal'
import { I } from './InvIcons'
import { money, numFactura, fechaHora } from '../lib/format'
import { quitarFocoEntrada } from '../lib/invoiceDelivery'
import { esConsumidorFinal } from '../lib/consumidorFinal'
import '../styles/venta-finalizada.css'

// Andres' gold celebration stays inside the receipt, so every exit remains immediate.
function SaleCelebration() {
  return <span className="vf-badge" aria-hidden="true">
    {Array.from({length:14},(_,i)=><span key={i} className="vf-spark" style={{'--a':i*360/14+'deg','--d':i%3*60+'ms'}}/>)}
    <svg viewBox="0 0 120 120" className="vf-svg"><defs><linearGradient id="post-sale-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#f3dcae"/><stop offset=".55" stopColor="#d6b06a"/><stop offset="1" stopColor="#a8782f"/></linearGradient></defs><circle className="vf-ring-bg" cx="60" cy="60" r="52"/><circle className="vf-ring" cx="60" cy="60" r="52" stroke="url(#post-sale-gold)"/><path className="vf-check" d="M38 62 L54 77 L83 45" stroke="url(#post-sale-gold)"/></svg>
  </span>
}

// Confirmed invoices stay registered: delivery and administrative cancellation are separate actions.
export default function SellerSaleComplete({ invoice, onClose, onViewInvoice, onNewSale, children }) {
  const anulada = invoice?.estado === 'anulada', sinDatos = esConsumidorFinal(invoice?.clientes)
  const action = callback => { quitarFocoEntrada(); callback?.() }
  return <Modal title={anulada ? 'Factura anulada' : 'Venta exitosa'} subtitle={anulada ? 'El documento se conserva en el historial' : 'La venta ya quedó registrada'} className="seller-sale-complete experience-sheet fd-sheet" keyboardAware validateFooter={false} restoreInputFocus={false} onClose={() => action(onClose)} footer={<div className="post-sale-footer"><button type="button" className="btn sec" onClick={() => action(onClose)}>Cerrar</button><button type="button" className="fd-finish ok" onClick={() => action(onNewSale || onClose)}><I n="plus" />Nueva venta</button></div>}>
    {invoice && <><section className={'fd-hero' + (anulada ? ' void' : ' new')}>{anulada ? <span className="fd-hero-ic"><I n="check"/></span> : <SaleCelebration/>}<span className="fd-hero-eyebrow">{anulada ? 'Factura anulada' : '¡Venta registrada!'}</span><b className="fd-hero-total">{money(invoice.total)}</b><div className="fd-hero-chips"><span className="fd-num">{numFactura(invoice)}</span><span className={'fd-state ' + (anulada ? 'bad' : 'good')}>{anulada ? 'Anulada' : 'Emitida'}</span></div><small className="fd-hero-meta">{fechaHora(invoice.fecha)}</small></section>
    <div className="fd-client"><span className="fd-client-av"><I n="user" /></span><span className="fd-client-txt"><small>Cliente</small><b>{invoice.clientes?.nombre || 'Consumidor final'}</b></span></div></>}
    <p className="post-sale-note">{anulada ? 'Puedes consultar el documento o continuar vendiendo.' : sinDatos ? 'Venta sin datos del cliente. Puedes consultar o compartir el PDF después y continuar vendiendo.' : 'Puedes compartir la factura ahora o continuar vendiendo.'}</p>
    {onViewInvoice && <button type="button" className="btn sec full post-sale-view" onClick={() => action(onViewInvoice)}><I n="receipt" />Abrir factura</button>}
    {children}
  </Modal>
}
