import { numFactura } from './format.js'

const bogotaDate = new Intl.DateTimeFormat('en-CA', { timeZone:'America/Bogota' })

export function invoiceCustomerName(invoice){
 const historical=invoice.cliente_snapshot?.nombre?.trim(),current=invoice.clientes?.nombre?.trim()
 return historical||current||(invoice.cliente_id!=null?'Cliente no disponible':'Consumidor final')
}
export function financePurchaseRows(purchases=[]){
 return purchases.map(c=>({id:'compra-'+c.id,purchaseId:c.id,movement:c,date:c.fecha,concept:'Compra de mercancía · '+(c.proveedores?.nombre||'Proveedor'),origin:c.forma_pago==='credito'?'Compra a crédito':'Compra de contado',reference:c.numero_documento||'Compra #'+c.id,amount:Number(c.total),type:'gasto'}))
}
// These are the same sources used by the financial cards: net issued invoices
// and manual movements in demo. Automatic ledger entries must not count twice.
export function financeDetails({ invoices = [], movements = [], period, demo = true }) {
  const within = date => date >= period.ini && date <= period.fin
  const income = invoices.filter(f=>f.estado==='emitida' && within(bogotaDate.format(new Date(f.fecha))))
    .map(f=>({ id:'invoice-'+f.id, invoiceId:f.id, date:bogotaDate.format(new Date(f.fecha)), concept:'Venta · '+invoiceCustomerName(f), origin:'Factura emitida', reference:numFactura(f), amount:Number(f.total_neto ?? f.total), type:'ingreso' }))
  const expenses = []
  for (const m of movements.filter(m=>within(m.fecha) && (!demo || !m.origen))) {
    const invoice = invoices.find(f=>String(f.id)===String(m.factura_id))
    const row = { id:'movement-'+m.id, movement:m, ...(m.factura_id!=null?{invoiceId:m.factura_id}:{}), ...(m.compra_id!=null?{purchaseId:m.compra_id}:{}), date:m.fecha, concept:m.descripcion || m.categoria, origin:m.categoria+(m.origen?' · '+m.origen:' · Manual'), reference:invoice?numFactura(invoice):m.factura_id?String(m.factura_id):'', amount:Number(m.monto), type:m.tipo }
    if (m.tipo==='ingreso') income.push(row)
    if (m.tipo==='gasto') expenses.push(row)
  }
  const sort = rows=>rows.sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id))
  return { ingreso:sort(income), gasto:sort(expenses) }
}

// Gross issued sales, returns already discounted by facturas_netas, and separate income.
export function incomeBreakdown({invoices=[],movements=[],period,demo=true}){
 const selected=invoices.filter(f=>{const date=bogotaDate.format(new Date(f.fecha));return date>=period.ini&&date<=period.fin})
 const issued=selected.filter(f=>f.estado==='emitida'),cancelled=selected.filter(f=>f.estado==='anulada')
 const grossSales=issued.reduce((n,f)=>n+Number(f.total),0),netSales=issued.reduce((n,f)=>n+Number(f.total_neto??f.total),0)
 const otherIncome=financeDetails({invoices:[],movements,period,demo}).ingreso.reduce((n,m)=>n+m.amount,0)
 return{issuedCount:issued.length,cancelledCount:cancelled.length,cancelledTotal:cancelled.reduce((n,f)=>n+Number(f.total),0),grossSales,returns:grossSales-netSales,netSales,otherIncome,total:netSales+otherIncome}
}
