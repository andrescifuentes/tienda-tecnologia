import { numFactura } from './format.js'

const bogotaDate = new Intl.DateTimeFormat('en-CA', { timeZone:'America/Bogota' })

// These are the same sources used by the financial cards: net issued invoices
// and manual movements in demo. Automatic ledger entries must not count twice.
export function financeDetails({ invoices = [], movements = [], period, demo = true }) {
  const within = date => date >= period.ini && date <= period.fin
  const income = invoices.filter(f=>f.estado==='emitida' && within(bogotaDate.format(new Date(f.fecha))))
    .map(f=>({ id:'invoice-'+f.id, date:bogotaDate.format(new Date(f.fecha)), concept:'Venta · '+(f.clientes?.nombre || 'Consumidor final'), origin:'Factura emitida', reference:numFactura(f), amount:Number(f.total_neto ?? f.total), type:'ingreso' }))
  const expenses = []
  for (const m of movements.filter(m=>within(m.fecha) && (!demo || !m.origen))) {
    const invoice = invoices.find(f=>f.id===m.factura_id)
    const row = { id:'movement-'+m.id, date:m.fecha, concept:m.descripcion || m.categoria, origin:m.categoria+(m.origen?' · '+m.origen:' · Manual'), reference:invoice?numFactura(invoice):m.factura_id?String(m.factura_id):'', amount:Number(m.monto), type:m.tipo }
    if (m.tipo==='ingreso') income.push(row)
    if (m.tipo==='gasto') expenses.push(row)
  }
  const sort = rows=>rows.sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id))
  return { ingreso:sort(income), gasto:sort(expenses) }
}
