import test from 'node:test'
import assert from 'node:assert/strict'
import { prepararEnvioFactura, abrirEnvioFactura, conLimiteEnvio, quitarFocoEntrada } from '../src/lib/invoiceDelivery.js'
const invoice={prefijo:'FV',numero:2042,total:1234567,clientes:{nombre:'María García'}}
const prepare=options=>prepararEnvioFactura({invoice,...options})
test('WhatsApp uses the customer phone and actual invoice; manual attachment is explicit',()=>{
 const r=prepare({canal:'whatsapp',telefono:'300 123 4567',detalle:'*Producto*'})
 assert.equal(r.destino,'300 123 4567');assert.ok(r.url.startsWith('https://wa.me/573001234567?text='))
 assert.ok(r.cuerpo.includes('Hola María,'));assert.ok(r.cuerpo.includes('FV-2042'));assert.ok(r.cuerpo.includes('$1.234.567'));assert.ok(r.cuerpo.includes('adjuntarse manualmente'));assert.ok(!r.cuerpo.includes('*'));assert.equal(r.adjuntoManual,true)
})
for(const phone of ['+57 3001234567','+1 2025550123'])test('International phone '+phone,()=>assert.ok(prepare({canal:'whatsapp',telefono:phone}).url.startsWith('https://wa.me/')))
for(const phone of ['',null,undefined])test('Missing phone '+phone,()=>assert.throws(()=>prepare({canal:'whatsapp',telefono:phone}),/cliente no tiene un número de WhatsApp/))
for(const phone of ['12','abcdef','1234567890123456'])test('Invalid phone '+phone,()=>assert.throws(()=>prepare({canal:'whatsapp',telefono:phone})))
test('Email encodes recipient, subject and body without administrator data',()=>{
 const r=prepare({canal:'correo',correo:'maria+ventas@example.test'})
 assert.ok(r.url.startsWith('mailto:maria%2Bventas%40example.test?subject='));assert.ok(decodeURIComponent(r.url).includes(r.asunto));assert.ok(decodeURIComponent(r.url).includes('María'));assert.equal(r.adjuntoManual,true)
})
for(const email of ['',null,'sin-arroba','nombre@','correo con espacio@example.test'])test('Missing/invalid email '+email,()=>assert.throws(()=>prepare({canal:'correo',correo:email})))
test('An existing PDF link requires no manual attachment',()=>{
 const r=prepare({canal:'whatsapp',telefono:'3001234567',pdfUrl:'https://example.test/factura.pdf'})
 assert.equal(r.adjuntoManual,false);assert.ok(r.cuerpo.includes('https://example.test/factura.pdf'));assert.ok(!r.cuerpo.includes('adjuntarse manualmente'))
})
test('Unsupported administrative actions cannot enter delivery helper',()=>assert.throws(()=>prepare({canal:'anular',telefono:'3001234567'}),/Acción de envío/))
test('Opening is a synchronous user action and keeps caller page unchanged',()=>{
 const envio=prepare({canal:'whatsapp',telefono:'3001234567'}),calls=[],popup={opener:'parent'}
 assert.equal(abrirEnvioFactura(envio,(...args)=>{calls.push(args);return popup}),true);assert.deepEqual(calls,[[envio.url,'_blank']]);assert.equal(popup.opener,null)
})
test('Blocked/cancelled popup returns an actionable error instead of changing page',()=>assert.throws(()=>abrirEnvioFactura(prepare({canal:'whatsapp',telefono:'3001234567'}),()=>null),/navegador no abrió/))
test('Opening failure stays visible to UI',()=>assert.throws(()=>abrirEnvioFactura(prepare({canal:'correo',correo:'a@example.test'}),()=>{throw Error('App unavailable')}),/App unavailable/))
test('Opening requires prepared sharing action',()=>assert.throws(()=>abrirEnvioFactura({canal:'anular',url:'https://example.test'},()=>({})),/No hay un mensaje/))
test('Optional PDF preparation cannot wait indefinitely',async()=>await assert.rejects(conLimiteEnvio(()=>new Promise(()=>{}),20),/tardó demasiado/))
test('Preparation success and failure preserve result/error',async()=>{assert.equal(await conLimiteEnvio(async()=>42,100),42);await assert.rejects(conLimiteEnvio(()=>Promise.reject(Error('Storage unavailable')),100),/Storage unavailable/)})
test('Post-sale action dismisses input keyboard; does not steal focus from buttons',()=>{
 const previous=globalThis.document;let calls=0
 try{globalThis.document={activeElement:{matches:()=>true,blur:()=>calls++}};quitarFocoEntrada();assert.equal(calls,1);globalThis.document={activeElement:{matches:()=>false,blur:()=>calls++}};quitarFocoEntrada();assert.equal(calls,1)}finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous}
})
