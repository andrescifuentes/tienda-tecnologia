import assert from 'node:assert/strict'
import { financeDetails } from '../src/lib/financeDetails.js'

const period={ini:'2026-10-01',fin:'2026-10-31'}
const invoice=(id,fecha,total,extra={})=>({id,fecha,total,estado:'emitida',prefijo:'AT',numero:id,...extra})
const invoices=[invoice(1,'2026-10-01T05:00:00Z',200,{total_neto:150,clientes:{nombre:'Ana'}}),invoice(2,'2026-11-01T04:59:59Z',300),invoice(3,'2026-10-02T10:00:00Z',500,{estado:'anulada'}),invoice(4,'2026-10-01T04:59:59Z',900),invoice(5,'2026-11-01T05:00:00Z',1000),invoice(6,'2026-10-20T10:00:00Z',100,{total_neto:0})]
const movements=[{id:1,tipo:'ingreso',fecha:'2026-10-10',monto:50,categoria:'Servicio',descripcion:'Reparación'}, {id:2,tipo:'gasto',fecha:'2026-10-09',monto:70,categoria:'Arriendo'}, {id:3,tipo:'ingreso',fecha:'2026-10-10',monto:200,categoria:'Ventas',origen:'venta',factura_id:1}, {id:4,tipo:'gasto',fecha:'2026-10-10',monto:50,categoria:'Devolución',origen:'devolucion'}, {id:5,tipo:'gasto',fecha:'2026-09-30',monto:1000,categoria:'Otros'}, {id:6,tipo:'ingreso',fecha:'2026-11-01',monto:1000,categoria:'Otros'}]
const snapshot=JSON.stringify({invoices,movements})
const d=financeDetails({invoices,movements,period})
assert.equal(d.ingreso.length,4)
assert.equal(d.gasto.length,1)
assert.equal(d.ingreso.reduce((n,r)=>n+r.amount,0),500)
assert.equal(d.gasto.reduce((n,r)=>n+r.amount,0),70)
assert.ok(d.ingreso.some(r=>r.amount===0))
assert.equal(d.ingreso.find(r=>r.id==='invoice-1').reference,'AT-0001')
assert.equal(d.ingreso.find(r=>r.id==='invoice-1').concept,'Venta · Ana')
assert.equal(d.ingreso.find(r=>r.id==='invoice-2').date,'2026-10-31')
assert.equal(d.ingreso.find(r=>r.id==='movement-1').concept,'Reparación')
assert.equal(d.gasto[0].concept,'Arriendo')
assert.equal(d.gasto[0].origin,'Arriendo · Manual')
assert.ok(!d.ingreso.some(r=>['invoice-3','invoice-4','invoice-5','movement-3','movement-6'].includes(r.id)))
assert.ok(!d.gasto.some(r=>r.id==='movement-4'))
assert.equal(JSON.stringify({invoices,movements}),snapshot)
assert.deepEqual(financeDetails({period}),{ingreso:[],gasto:[]})
const real=financeDetails({invoices,movements,period,demo:false})
assert.equal(real.ingreso.reduce((n,r)=>n+r.amount,0),700)
assert.equal(real.gasto.reduce((n,r)=>n+r.amount,0),120)
assert.equal(real.ingreso.find(r=>r.id==='movement-3').reference,'AT-0001')
const next=financeDetails({invoices,movements,period:{ini:'2026-11-01',fin:'2026-11-30'}})
assert.equal(next.ingreso.reduce((n,r)=>n+r.amount,0),2000)
assert.ok(d.ingreso.every((r,i)=>!i||d.ingreso[i-1].date>=r.date))
console.log('PASS 20 finance detail checks: net refunds, cancellations, manual sources, period, Bogota boundaries, references, empty, immutability')
