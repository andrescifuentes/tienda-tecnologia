import { useEffect, useState } from 'react'
import DateField from './DateField'
import { I } from './InvIcons'
import { Loader, ErrorBox } from './ui'
import { supabase } from '../lib/supabase'
import { money, fecha, hoyBogota, mensajeError } from '../lib/format'
import { loadSupplierHistory, supplierHistoryTotals, supplierPeriod, SUPPLIER_HISTORY_LIMIT } from '../lib/supplierHistory'

const PERIODOS = [['todo', 'Todo'], ['mes', 'Este mes'], ['3m', '3 meses'], ['12m', '12 meses'], ['rango', 'Fechas']]
const METODO = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia' }

// Proveedor → historial de mercancía: qué se compró, cuándo, a qué costo y cómo se pagó.
export default function SupplierHistory({ proveedorId, reload = 0, onOpen, onPay }) {
  const hoy = hoyBogota()
  const [periodo, setPeriodo] = useState('todo'), [rango, setRango] = useState({ desde: hoy.slice(0, 8) + '01', hasta: hoy }), [producto, setProducto] = useState('')
  const [data, setData] = useState(null), [error, setError] = useState('')
  const { desde, hasta } = periodo === 'rango' ? rango : supplierPeriod(periodo, hoy)
  useEffect(() => {
    const controller = new AbortController()
    setError(''); setData(null)
    loadSupplierHistory(supabase, { proveedorId, desde, hasta, productoId: producto || null, signal: controller.signal })
      .then(setData).catch(e => { if (!controller.signal.aborted) setError(mensajeError(e)) })
    return () => controller.abort()
  }, [proveedorId, desde, hasta, producto, reload])
  const totales = data ? supplierHistoryTotals(data.compras, producto || null) : null
  return <section className="sh">
    <h3 className="cl-section">Historial de mercancía</h3>
    <div className="inv-chips sh-chips" role="group" aria-label="Período">{PERIODOS.map(([k, l]) => <button key={k} type="button" className={periodo === k ? 'on' : ''} onClick={() => setPeriodo(k)}>{l}</button>)}</div>
    {periodo === 'rango' && <div className="sh-range"><DateField label="Desde" value={rango.desde} onChange={v => setRango(r => ({ ...r, desde: v }))} /><DateField label="Hasta" value={rango.hasta} min={rango.desde} onChange={v => setRango(r => ({ ...r, hasta: v }))} /></div>}
    <label className="sh-filter"><span>Producto</span><select className="pf-input" value={producto} onChange={e => setProducto(e.target.value)}><option value="">Todos los productos comprados</option>{(data?.productos || []).map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
    <ErrorBox text={error} />
    {!data && !error ? <Loader filas={2} /> : data && <>
      <div className="sh-totals"><span><small>Compras</small><b>{totales.compras}</b></span><span><small>Unidades</small><b>{totales.unidades}</b></span><span><small>Costo total</small><b>{money(totales.costo)}</b></span><span className={totales.saldo > 0 ? 'due' : ''}><small>Saldo pendiente</small><b>{money(totales.saldo)}</b></span></div>
      {data.compras.length === 0 ? <p className="cl-empty">{producto || desde ? 'Sin compras con estos filtros.' : 'Aún no hay compras a este proveedor.'}</p> : <div className="sh-list">
        {data.compras.map(c => {
          const vencida = c.saldo > 0 && c.vence_el && String(c.vence_el).slice(0, 10) < hoy
          // Whole card opens the existing CompraDetalle; only «Pagar» is a separate action.
          // Pointer presses don't focus the card: focusing would scroll the sheet and lose the user's place.
          const nombre = c.numero_documento ? 'Factura ' + c.numero_documento : 'Compra #' + c.id
          return <article key={c.id} role="button" tabIndex={0} aria-label={'Ver detalle de ' + nombre + ' del ' + fecha(c.fecha)} className={'sh-buy' + (c.saldo > 0 ? ' due' : '') + (vencida ? ' late' : '') + (c.estado === 'anulada' ? ' void' : '')}
            onMouseDown={e => e.preventDefault()} onClick={() => onOpen(c.id)} onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(c.id) } }}>
            <div className="sh-buy-head">
              <span className="sh-date"><b>{fecha(c.fecha)}</b><small>{nombre}</small></span>
              <span className="sh-amount"><b>{money(c.total)}</b><small className={c.estado_pago === 'Pagada' ? 'good' : c.estado_pago === 'Anulada' ? '' : vencida ? 'bad' : 'warn'}>{vencida ? 'Vencida · ' : ''}{c.estado_pago}{c.saldo > 0 ? ' · debe ' + money(c.saldo) : ''}</small></span>
            </div>
            <ul className="sh-lines">{c.lineas.filter(l => !producto || String(l.producto_id) === String(producto)).map(l => <li key={l.id}><span><b>{l.nombre}</b><small>{l.cantidad} × {money(l.costo_unitario)}{l.seriales.length ? ' · ' + l.seriales.length + ' IMEI/serial' : ''}</small></span><em>{money(l.subtotal)}</em></li>)}</ul>
            <p className="sh-meta">{c.forma_pago === 'credito' ? 'A crédito' + (c.vence_el ? ' · vence ' + fecha(c.vence_el) : '') : 'De contado'}{c.metodos.length ? ' · ' + c.metodos.map(m => METODO[m] || m).join(', ') : ''} · {c.responsable ? 'Registró ' + c.responsable : 'Responsable no disponible'}</p>
            <div className="sh-actions"><span className="sh-open" aria-hidden="true"><I n="receipt" />Ver detalle<I n="back" className="flip" /></span>{c.saldo > 0 && c.estado !== 'anulada' && onPay && <button type="button" className="pv-pay" onClick={e => { e.stopPropagation(); onPay(c) }}><I n="cash" />Pagar {money(c.saldo)}</button>}</div>
          </article>
        })}
      </div>}
      {data.limitado && <p className="cash-note">Se muestran las {SUPPLIER_HISTORY_LIMIT} compras más recientes del período. Ajusta las fechas para ver compras anteriores.</p>}
    </>}
  </section>
}
