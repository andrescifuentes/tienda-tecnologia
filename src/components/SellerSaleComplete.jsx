import { cloneElement, isValidElement, useState } from 'react'
import Modal from './Modal'
import { I } from './InvIcons'
import { money, numFactura, fechaHora } from '../lib/format'
import { quitarFocoEntrada } from '../lib/invoiceDelivery'
import { toast } from '../lib/toast'

// Post-sale surface: la venta solo se cierra después de enviar la factura (WhatsApp o correo).
export default function SellerSaleComplete({ invoice, onClose, onViewInvoice, onNewSale, children }) {
  const anulada = invoice.estado === 'anulada'
  const [enviada, setEnviada] = useState(false)
  const bloqueada = !anulada && !enviada
  const aviso = () => toast('Envía la factura por WhatsApp o correo para finalizar la venta')
  const action = callback => { quitarFocoEntrada(); if (bloqueada) return aviso(); callback?.() }
  const delivery = isValidElement(children) ? cloneElement(children, { obligatorio: !anulada, onEnviado: () => setEnviada(true) }) : children
  return <Modal title={anulada ? 'Factura anulada' : 'Venta exitosa'} subtitle={anulada ? 'El documento se conserva en el historial' : 'La venta ya quedó registrada'} className="seller-sale-complete experience-sheet fd-sheet" keyboardAware validateFooter={false} restoreInputFocus={false} onClose={() => action(onClose)} footer={bloqueada
    ? <div className="post-sale-footer"><button type="button" className="fd-finish locked" onClick={aviso}><I n="chat" />Envía la factura para finalizar</button></div>
    : <div className="post-sale-footer"><button type="button" className="btn sec" onClick={() => action(onClose)}>Cerrar</button><button type="button" className="fd-finish ok" onClick={() => action(onNewSale || onClose)}><I n="plus" />Nueva venta</button></div>}>
    <section className={'fd-hero' + (anulada ? ' void' : ' new')}><span className="fd-hero-ic"><I n="check" /></span><span className="fd-hero-eyebrow">{anulada ? 'Factura anulada' : '¡Venta registrada!'}</span><b className="fd-hero-total">{money(invoice.total)}</b><div className="fd-hero-chips"><span className="fd-num">{numFactura(invoice)}</span><span className={'fd-state ' + (anulada ? 'bad' : 'good')}>{anulada ? 'Anulada' : 'Emitida'}</span></div><small className="fd-hero-meta">{fechaHora(invoice.fecha)}</small></section>
    <div className="fd-client"><span className="fd-client-av"><I n="user" /></span><span className="fd-client-txt"><small>Cliente</small><b>{invoice.clientes?.nombre || 'Consumidor final'}</b></span></div>
    <p className="post-sale-note">{anulada ? 'Puedes consultar el documento o continuar vendiendo.' : enviada ? 'Factura enviada. Ya puedes finalizar la venta.' : 'Envía la factura al cliente por WhatsApp o correo para finalizar la venta.'}</p>
    {onViewInvoice && !bloqueada && <button type="button" className="btn sec full post-sale-view" onClick={() => action(onViewInvoice)}><I n="receipt" />Abrir factura</button>}
    {delivery}
  </Modal>
}
