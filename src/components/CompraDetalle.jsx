import { useEffect, useState } from 'react'
import Modal from './Modal'
import { Loader, ErrorBox, Badge } from './ui'
import { supabase } from '../lib/supabase'
import { money, fecha, mensajeError } from '../lib/format'

export default function CompraDetalle({ id, onClose }) {
  const [purchase,setPurchase]=useState(null),[items,setItems]=useState([]),[payments,setPayments]=useState([]),[error,setError]=useState('')
  useEffect(()=>{let live=true;(async()=>{
    const [c,it,p,prods]=await Promise.all([supabase.from('compras_saldo').select('*').eq('id',id).single(),supabase.from('compra_items').select('*').eq('compra_id',id),supabase.from('pagos_proveedor').select('*').eq('compra_id',id),supabase.from('productos').select('id,nombre')])
    if(!live)return
    if(c.error)return setError(mensajeError(c.error))
    setPurchase(c.data);setItems((it.data||[]).map(i=>({...i,nombre:(prods.data||[]).find(p=>p.id===i.producto_id)?.nombre||'Producto'})));setPayments(p.data||[])
  })();return()=>{live=false}},[id])
  return <Modal title="Detalle de compra" onClose={onClose}><ErrorBox text={error}/>{!purchase&&!error?<Loader/>:purchase&&<><p className="text-sm">{purchase.numero_documento||'Compra #'+id} · {fecha(purchase.fecha)}</p><Badge tone={purchase.saldo>0?'warn':'good'}>{purchase.saldo>0?'Saldo pendiente':'Pagada'}</Badge>{items.map(i=><div className="row" key={i.id}><span className="flex-1 text-sm">{i.cantidad} × {i.nombre}<span className="block text-xs text-muted">Costo unitario {money(i.costo_unitario)}</span></span><b className="text-sm">{money(i.cantidad*i.costo_unitario)}</b></div>)}<p className="text-sm">Total: <b>{money(purchase.total)}</b> · {purchase.forma_pago}</p>{purchase.notas&&<p className="text-sm">{purchase.notas}</p>}<p className="text-sm">Saldo: {money(purchase.saldo)}</p><h4 className="section-heading">Pagos registrados</h4>{payments.map(p=><div className="row" key={p.id}><span className="flex-1 text-xs">{fecha(p.fecha)} · {p.metodo_pago}</span><b className="text-sm">{money(p.monto)}</b></div>)}</>}</Modal>
}
