import assert from 'node:assert/strict'
import { createInvoicePdf } from '../src/lib/invoicePdf.js'
import { calendarDays, shiftMonth } from '../src/lib/calendar.js'
import { mkdir, writeFile } from 'node:fs/promises'

const invoice = {prefijo:'FV',numero:1245,fecha:'2026-10-07T17:00:00Z',estado:'emitida',subtotal:1200000,descuento:50000,total:1150000,metodo_pago:'Transferencia',clientes:{nombre:'Cliente PDF',documento:'102030',telefono:'3001234567'},perfiles:{nombre:'Vendedor PDF'}}
const items = [{nombre:'Samsung Galaxy S26',cantidad:2,precio_unitario:600000}]
const pdf = createInvoicePdf(invoice,items,{nit:'900123456'},true)
assert.equal(pdf.filename,'ANGIE-TECH-FV-1245.pdf')
assert.equal(pdf.blob.type,'application/pdf')
const bytes=Buffer.from(await pdf.blob.arrayBuffer()),source=bytes.toString('latin1')
assert.ok(source.startsWith('%PDF-'));assert.ok(source.trimEnd().endsWith('%%EOF'))
for(const value of ['ANGIE TECH','FV-1245','900123456','Cliente PDF','102030','3001234567','Vendedor PDF','Transferencia','Samsung Galaxy S26','1.200.000','1.150.000','50.000','/Font','xref','startxref'])assert.ok(source.includes(value),value)
assert.ok(!source.includes('/Subtype /Image'),'PDF uses vector text rather than a screenshot')
const long = createInvoicePdf(invoice,Array.from({length:120},(_,i)=>({...items[0],nombre:'Producto '+i+' con descripción extensa para comprobar el salto de página'})),{},false)
const longSource=Buffer.from(await long.blob.arrayBuffer()).toString('latin1')
assert.ok((longSource.match(/\/Type \/Page\b/g)||[]).length>3)
assert.ok(!longSource.includes('No constituye factura fiscal'))
assert.equal(calendarDays('2026-10')[0],'2026-09-27');assert.equal(calendarDays('2026-10')[41],'2026-11-07')
assert.ok(calendarDays('2024-02').includes('2024-02-29'));assert.equal(shiftMonth('2026-12',1),'2027-01');assert.equal(shiftMonth('2026-01',-1),'2025-12')
await mkdir('artifacts/pdf-finance',{recursive:true});await writeFile('artifacts/pdf-finance/sample-FV-1245.pdf',bytes)
await writeFile('artifacts/pdf-finance/multipage.pdf',Buffer.from(await long.blob.arrayBuffer()))
console.log('PASS: PDF filename, MIME, structure, vector text, invoice fields, amounts, multipage; calendar grid, leap year, year boundaries')
