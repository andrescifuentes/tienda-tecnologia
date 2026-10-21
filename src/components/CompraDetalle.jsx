import { useEffect, useState } from 'react'
import Modal from './Modal'
import { Loader, ErrorBox } from './ui'
import { ProductThumbnail } from './TechVisuals'
import { I } from './InvIcons'
import { supabase } from '../lib/supabase'
import { money, fecha, mensajeError } from '../lib/format'
import { withDeadline, cancellableQuery, requireData } from '../lib/asyncResult'
import '../styles/supplier-history.css'

const METODO = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia' }

export default function CompraDetalle({ id, onClose }) {
  const [purchase, setPurchase] = useState(null), [items, setItems] = useState([]), [payments, setPayments] = useState([]), [prov, setProv] = useState(null), [error, setError] = useState('')
  useEffect(() => {
    let live = true
    const controller = new AbortController()
    setPurchase(null); setItems([]); setPayments([]); setProv(null); setError('')
    withDeadline(async signal => {
      const query = builder => cancellableQuery(builder, signal)
      const [c, it, p] = await Promise.all([
        query(supabase.from('compras_saldo').select('*').eq('id', id).single()),
        query(supabase.from('compra_items').select('*').eq('compra_id', id)),
        query(supabase.from('pagos_proveedor').select('*').eq('compra_id', id).order('fecha', { ascending: true })),
      ])
      const compra = requireData(c), rows = requireData(it), pagos = requireData(p)
      if (!compra || !Array.isArray(rows) || !Array.isArray(pagos)) throw Error('No se pudo consultar el detalle completo de la compra.')
      const ids = [...new Set(rows.map(i => i.producto_id).filter(value => value != null))]
      const [prods, pv] = await Promise.all([
        ids.length ? query(supabase.from('productos').select('*').in('id', ids)) : Promise.resolve({ data: [] }),
        query(supabase.from('proveedores').select('nombre,telefono').eq('id', compra.proveedor_id).maybeSingle()),
      ])
      const productos = requireData(prods), proveedor = requireData(pv)
      if (!Array.isArray(productos)) throw Error('No se pudieron consultar los productos de la compra.')
      // Optional: serials and who registered it. Hidden when the role cannot read them.
      const optional = builder => query(builder).then(requireData).then(data => data || null).catch(() => null)
      const responsableId = compra.registrado_por ?? compra.creado_por
      const [units, persona] = await Promise.all([
        rows.length ? optional(supabase.from('unidades_serializadas').select('serial,compra_item_id').in('compra_item_id', rows.map(i => i.id))) : null,
        responsableId ? optional(supabase.from('perfiles').select('nombre').eq('id', responsableId).maybeSingle()) : null,
      ])
      return { compra: { ...compra, responsable: persona?.nombre || null }, proveedor, pagos, rows: rows.map(i => ({ ...i, seriales: (units || []).filter(u => u.compra_item_id === i.id).map(u => u.serial), producto: productos.find(p => p.id === i.producto_id) || { nombre: 'Producto no disponible' } })) }
    }, { signal: controller.signal }).then(data => {
      if (!live) return
      setPurchase(data.compra); setProv(data.proveedor); setItems(data.rows); setPayments(data.pagos)
    }).catch(failure => { if (live) setError(mensajeError(failure)) })
    return () => { live = false; controller.abort() }
  }, [id])
  const unidades = items.reduce((a, i) => a + Number(i.cantidad || 0), 0)
  const pagado = payments.reduce((a, p) => a + Number(p.monto || 0), 0)
  const credito = purchase?.forma_pago === 'credito'
  const saldoDisponible = ['number', 'string'].includes(typeof purchase?.saldo) && String(purchase.saldo).trim() !== '' && Number.isFinite(Number(purchase.saldo))
  const saldo = saldoDisponible ? Number(purchase.saldo) : null
  const medios = [...new Set(payments.map(p => METODO[p.metodo_pago] || p.metodo_pago).filter(Boolean))]
  return <Modal title="Detalle de compra" className="experience-sheet fd-sheet cd-sheet" onClose={onClose}>
    <ErrorBox text={error} />
    {!purchase && !error ? <Loader filas={3} /> : purchase && <>
      <section className="fd-hero">
        <span className="fd-hero-ic"><I n="truckIn" /></span>
        <span className="fd-hero-eyebrow">Compra de mercancía</span>
        <b className="fd-hero-total">{money(purchase.total)}</b>
        <div className="fd-hero-chips">
          <span className="fd-num">{purchase.numero_documento || 'Compra #' + id}</span>
          <span className={'fd-state ' + (saldoDisponible ? saldo > 0 ? 'bad' : saldo === 0 ? 'good' : '' : '')}>{!saldoDisponible ? 'Saldo no disponible' : saldo > 0 ? 'Debe ' + money(saldo) : saldo === 0 ? 'Pagada' : 'Saldo ' + money(saldo)}</span>
          {purchase.estado && <span className="fd-state">{purchase.estado}</span>}
          <span className="fd-pay">{credito ? 'A crédito' : purchase.forma_pago === 'contado' ? 'De contado' : purchase.forma_pago || 'Forma de pago no disponible'}</span>
          {medios.length > 0 && <span className="fd-pay">{medios.join(', ')}</span>}
        </div>
        <small className="fd-hero-meta">{fecha(purchase.fecha)}{credito && purchase.vence_el ? ' · vence ' + fecha(purchase.vence_el) : ''}{purchase.responsable ? ' · registró ' + purchase.responsable : ''}</small>
      </section>

      <div className="fd-client">
        <span className="fd-client-av"><I n="truck" /></span>
        <span className="fd-client-txt"><small>Proveedor</small><b>{prov?.nombre || 'Proveedor no disponible'}</b>{prov?.telefono && <em>{prov.telefono}</em>}</span>
      </div>

      <h4 className="fd-sec">Qué se compró <span>{unidades} {unidades === 1 ? 'unidad' : 'unidades'}</span></h4>
      <div className="fd-items cd-items">
        {items.map((i) => <div key={i.id} className="fd-item cd-item">
          <ProductThumbnail product={i.producto} />
          <span className="fd-item-txt"><b>{i.producto.nombre}</b><small>{i.cantidad} {Number(i.cantidad) === 1 ? 'unidad' : 'unidades'} × {money(i.costo_unitario)}</small>{i.seriales?.length > 0 && <span className="cd-serials" aria-label="IMEI o seriales">{i.seriales.map(s => <code key={s}>{s}</code>)}</span>}</span>
          <b className="fd-item-total">{money(Number(i.cantidad) * Number(i.costo_unitario))}</b>
        </div>)}
        <div className="fd-line grand"><span>Total</span><b>{money(purchase.total)}</b></div>
      </div>

      <h4 className="fd-sec">Pagos <span>{payments.length}</span></h4>
      {payments.length === 0 ? <p className="cl-empty">Sin registros de pagos disponibles</p> : <div className="fd-items">
        {payments.map((p) => <div key={p.id} className="fd-item"><span className="fd-item-q cd-pay-ic"><I n="cash" /></span><span className="fd-item-txt"><b>{credito ? "Abono" : "Pago"}</b><small>{fecha(p.fecha)}{p.metodo_pago ? ' · ' + p.metodo_pago : ''}</small></span><b className="fd-item-total">{money(p.monto)}</b></div>)}
        <div className="fd-line"><span>Pagado</span><b>{money(pagado)}</b></div>
        {saldoDisponible && saldo > 0 && <div className="fd-line grand"><span>Pendiente</span><b className="cd-due">{money(purchase.saldo)}</b></div>}
      </div>}
    </>}
  </Modal>
}
