import { useEffect, useState } from 'react'
import Modal from './Modal'
import { Loader, ErrorBox } from './ui'
import { ProductThumbnail } from './TechVisuals'
import { I } from './InvIcons'
import { supabase } from '../lib/supabase'
import { money, fecha, mensajeError } from '../lib/format'

export default function CompraDetalle({ id, onClose }) {
  const [purchase, setPurchase] = useState(null), [items, setItems] = useState([]), [payments, setPayments] = useState([]), [prov, setProv] = useState(null), [error, setError] = useState('')
  useEffect(() => {
    let live = true
    ;(async () => {
      const [c, it, p] = await Promise.all([
        supabase.from('compras_saldo').select('*').eq('id', id).single(),
        supabase.from('compra_items').select('*').eq('compra_id', id),
        supabase.from('pagos_proveedor').select('*').eq('compra_id', id).order('fecha', { ascending: true }),
      ])
      if (!live) return
      if (c.error) return setError(mensajeError(c.error))
      const ids = [...new Set((it.data || []).map((i) => i.producto_id))]
      const [prods, pv] = await Promise.all([
        ids.length ? supabase.from('productos').select('*').in('id', ids) : Promise.resolve({ data: [] }),
        supabase.from('proveedores').select('nombre,telefono').eq('id', c.data.proveedor_id).maybeSingle(),
      ])
      if (!live) return
      setPurchase(c.data); setProv(pv.data)
      setItems((it.data || []).map((i) => ({ ...i, producto: (prods.data || []).find((p) => p.id === i.producto_id) || { nombre: 'Producto' } })))
      setPayments(p.data || [])
    })()
    return () => { live = false }
  }, [id])
  const unidades = items.reduce((a, i) => a + Number(i.cantidad || 0), 0)
  const pagado = payments.reduce((a, p) => a + Number(p.monto || 0), 0)
  const credito = purchase?.forma_pago === 'credito'
  return <Modal title="Detalle de compra" className="experience-sheet fd-sheet cd-sheet" onClose={onClose}>
    <ErrorBox text={error} />
    {!purchase && !error ? <Loader filas={3} /> : purchase && <>
      <section className="fd-hero">
        <span className="fd-hero-ic"><I n="truckIn" /></span>
        <span className="fd-hero-eyebrow">Compra de mercancía</span>
        <b className="fd-hero-total">{money(purchase.total)}</b>
        <div className="fd-hero-chips">
          <span className="fd-num">{purchase.numero_documento || 'Compra #' + id}</span>
          <span className={'fd-state ' + (purchase.saldo > 0 ? 'bad' : 'good')}>{purchase.saldo > 0 ? 'Debe ' + money(purchase.saldo) : 'Pagada'}</span>
          <span className="fd-pay">{credito ? 'A crédito' : 'De contado'}</span>
        </div>
        <small className="fd-hero-meta">{fecha(purchase.fecha)}{credito && purchase.vence_el ? ' · vence ' + fecha(purchase.vence_el) : ''}</small>
      </section>

      <div className="fd-client">
        <span className="fd-client-av"><I n="truck" /></span>
        <span className="fd-client-txt"><small>Proveedor</small><b>{prov?.nombre || 'Proveedor'}</b>{prov?.telefono && <em>{prov.telefono}</em>}</span>
      </div>

      <h4 className="fd-sec">Qué se compró <span>{unidades} {unidades === 1 ? 'unidad' : 'unidades'}</span></h4>
      <div className="fd-items cd-items">
        {items.map((i) => <div key={i.id} className="fd-item cd-item">
          <ProductThumbnail product={i.producto} />
          <span className="fd-item-txt"><b>{i.producto.nombre}</b><small>{i.cantidad} {Number(i.cantidad) === 1 ? 'unidad' : 'unidades'} × {money(i.costo_unitario)}</small></span>
          <b className="fd-item-total">{money(Number(i.cantidad) * Number(i.costo_unitario))}</b>
        </div>)}
        <div className="fd-line grand"><span>Total</span><b>{money(purchase.total)}</b></div>
      </div>

      <h4 className="fd-sec">Pagos <span>{payments.length}</span></h4>
      {payments.length === 0 ? <p className="cl-empty">{credito ? 'Aún no se ha abonado a esta compra.' : 'Pagada al momento de la compra.'}</p> : <div className="fd-items">
        {payments.map((p) => <div key={p.id} className="fd-item"><span className="fd-item-q cd-pay-ic"><I n="cash" /></span><span className="fd-item-txt"><b>{credito ? "Abono" : "Pago"}</b><small>{fecha(p.fecha)}{p.metodo_pago ? ' · ' + p.metodo_pago : ''}</small></span><b className="fd-item-total">{money(p.monto)}</b></div>)}
        <div className="fd-line"><span>Pagado</span><b>{money(pagado)}</b></div>
        {purchase.saldo > 0 && <div className="fd-line grand"><span>Pendiente</span><b className="cd-due">{money(purchase.saldo)}</b></div>}
      </div>}
    </>}
  </Modal>
}
