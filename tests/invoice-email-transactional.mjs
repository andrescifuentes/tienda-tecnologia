import { prepararEnvioFactura } from '../src/lib/invoiceDelivery.js'
﻿import test,{before,beforeEach,after} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {jsPDF} from 'jspdf'
import {createInvoiceEmailHandler,emailTemplate} from '../supabase/functions/enviar-factura-correo/handler.js'
import {renderInvoicePdf} from '../supabase/functions/_shared/invoice-pdf-core.js'
import {invoiceLogo} from '../supabase/functions/_shared/invoice-logo.js'
import {invoiceBrand} from '../supabase/functions/_shared/invoice-brand.js'
import {requestInvoiceEmail} from '../src/lib/invoiceEmailService.js'
const ana='11111111-1111-4111-8111-111111111111',bob='22222222-2222-4222-8222-222222222222',admin='33333333-3333-4333-8333-333333333333',inactive='44444444-4444-4444-8444-444444444444'
let db
before(async()=>{
 db=new PGlite()
 await db.exec(`create role anon; create role authenticated; create role service_role;
 create table perfiles(id uuid primary key,nombre text,rol text,activo boolean);
 create table perfil_permisos(perfil_id uuid,permiso text);
 create table clientes(id bigint primary key,nombre text,tipo_documento text,documento text,telefono text,correo text,direccion text);
 create table tienda(id int primary key,nombre text default 'TechStore',nit text,telefono text,direccion text,correo text,factura_pie text,factura_prefijo text,ultimo_numero_factura int);
 create table productos(id bigint primary key,codigo text,nombre text);
 create table unidades_serializadas(id bigint primary key,serial text);
 create table facturas(id bigint primary key,prefijo text,numero int,cliente_id bigint,vendedor_id uuid,subtotal numeric,descuento numeric,total numeric,costo_total numeric,comision numeric,comision_pct numeric,estado text,fecha timestamptz,metodo_pago text,notas text);
 create table factura_items(id bigint primary key,factura_id bigint,producto_id bigint,unidad_id bigint,nombre text,cantidad int,precio_unitario numeric,descuento numeric);
 create table factura_envios(id bigint generated always as identity primary key,factura_id bigint,canal text,destino text,enviado_por uuid,fecha timestamptz default now());
 insert into perfiles values ('${ana}','Ana','vendedor',true),('${bob}','Bob','vendedor',true),('${admin}','Admin','admin',true),('${inactive}','Inactivo','vendedor',false);
 insert into perfil_permisos values ('${ana}','vender'),('${bob}','vender');
 insert into clientes values (1,'José Pérez','CC','102030','3001234567','jose@example.test','Bogotá');
 insert into tienda values(1,'TechZone','900123456','3001234567','Bogotá','tienda@example.test','Conserva tu factura','FV',27);
 insert into productos values(1,'REF-HIST','TechStore cable legítimo'); insert into unidades_serializadas values(1,'IMEI-321555');
 insert into facturas values(1,'FV',27,1,'${ana}',700000,10000,690000,100000,0,0,'emitida','2026-10-13T15:00:00Z','efectivo','Histórico'),(2,'FV',28,1,'${bob}',700000,0,700000,100000,0,0,'emitida','2026-10-13T15:00:00Z','efectivo',null);
 insert into factura_items values(1,1,1,1,'TechStore cable legítimo',2,350000,0),(2,2,1,1,'Producto histórico',2,350000,0);`)
 await db.exec(readFileSync('supabase/07_correo_facturas.sql','utf8'))
 await db.exec(`insert into facturas values(3,'FV',29,1,'${ana}',700000,10000,690000,100000,0,0,'emitida','2026-10-13T15:00:00Z','efectivo',null,null,null,null);
 insert into factura_items values(3,3,1,1,'Nombre guardado al vender',2,350000,0,null,null);
 update clientes set nombre='Otro nombre',correo='actual@example.test'; update tienda set nombre='Negocio personalizado'; update productos set codigo='REF-NUEVA'; update unidades_serializadas set serial='IMEI-NUEVO';`)
})
// Truncate is exclusively inside this in-memory database, never a remote connection.
beforeEach(async()=>{await db.exec('truncate factura_correo_intentos,factura_correo_envios,factura_envios restart identity')})
after(async()=>{await db?.close()})
const rpc=async(name,args)=>{try{const values=Object.values(args).map(v=>v&&typeof v==='object'?JSON.stringify(v):v);const result=await db.query('select public.'+name+'('+values.map((_,i)=>'$'+(i+1)).join(',')+') as data',values);return{data:result.rows[0].data,error:null}}catch(e){return{data:null,error:{message:e.message}}}}
const doc=async(id=3,actor=ana)=>{const r=await rpc('correo_factura_documento',{p_actor:actor,p_factura:id});if(r.error)throw Error(r.error.message);return r.data}
const req=(body,actor=ana)=>new Request('http://local.test',{method:'POST',headers:{Authorization:actor?'Bearer '+actor:'','Content-Type':'application/json'},body:JSON.stringify(body)})
const make=(fetchImpl,overrides={})=>createInvoiceEmailHandler({authenticate:async r=>r.headers.get('Authorization')?.split(' ')[1]||null,rpc,env:n=>({RESEND_API_KEY:'test-server-key',INVOICE_EMAIL_FROM:'Angie Tech <facturas@example.test>'}[n]),renderPdf:async d=>{const pdf=renderInvoicePdf(d.invoice,d.items,d.tienda,{jsPDF,logo:invoiceLogo});return{bytes:new Uint8Array(await pdf.blob.arrayBuffer())}},fetchImpl,logger:{error(){}},...overrides})
const sendBody={action:'send',facturaId:3,destinatario:'jose@example.test'}
const success=async()=>new Response(JSON.stringify({id:'provider-acceptance-fixture'}),{status:200})

test('SQL enforces seller ownership, active role, selling permission and administrator access',async()=>{
 assert.equal((await doc(1)).invoice.total,690000);await assert.rejects(()=>doc(2),/FORBIDDEN/);assert.equal((await doc(2,admin)).invoice.numero,28);await assert.rejects(()=>doc(1,inactive),/FORBIDDEN/)
 await db.exec("delete from perfil_permisos where perfil_id='"+ana+"'");await assert.rejects(()=>doc(1),/FORBIDDEN/);await db.exec("insert into perfil_permisos values('"+ana+"','vender')")
})
test('Browser roles cannot access payloads or privileged RPC',async()=>{
 await db.exec('set role authenticated');try{await assert.rejects(()=>db.query('select * from factura_correo_envios'),/permission denied/);await assert.rejects(()=>db.query('select correo_factura_documento($1,1)',[ana]),/permission denied/)}finally{await db.exec('reset role')}
})
test('Future invoice preserves original customer, business, code, serial and amounts after edits',async()=>{
 const d=await doc();assert.equal(d.invoice.clientes.nombre,'José Pérez');assert.equal(d.invoice.clientes.correo,'jose@example.test');assert.equal(d.tienda.nombre,'TechZone');assert.equal(d.items[0].codigo,'REF-HIST');assert.equal(d.items[0].serial,'IMEI-321555');assert.equal(d.items[0].precio_unitario,350000);assert.equal(d.invoice.total,690000);assert.equal(d.identidad_historica,true);assert.equal((await doc(1)).identidad_historica,false)
})
test('PDF contains actual logo, persisted number/amounts/customer/product and serial',async()=>{
 const d=await doc(),pdf=renderInvoicePdf(d.invoice,d.items,d.tienda,{jsPDF,logo:invoiceLogo}),source=Buffer.from(await pdf.blob.arrayBuffer()).toString('latin1')
 for(const value of ['%PDF-','/Subtype /Image','FV-0029','ANGIE TECH','690.000','700.000','10.000','REF-HIST','IMEI-321555','Nombre guardado al vender'])assert.ok(source.includes(value),value)
 assert.ok(!source.includes('TechZone'));assert.ok(!source.includes('IMEI-NUEVO'))
})
test('Business legacy branding defaults normalize; custom and third-party names remain; HTML escapes customer',async()=>{
 for(const nombre of ['', 'TechZone','TechStore',' ANGIE TECH '])assert.ok(/Angie Tech/i.test(invoiceBrand({nombre})))
 assert.equal(invoiceBrand({nombre:'Negocio personalizado'}),'Negocio personalizado');assert.ok(prepararEnvioFactura({canal:'whatsapp',invoice:{prefijo:'FV',numero:29,total:690000},telefono:'3001234567',tienda:{nombre:'Negocio personalizado'}}).cuerpo.includes('NEGOCIO PERSONALIZADO'));assert.equal(invoiceBrand({nombre:'TechStore',nombre_personalizado:true}),'TechStore');assert.equal((await doc(1)).items[0].nombre,'TechStore cable legítimo')
 const d=await doc();d.invoice.clientes.nombre='<script>José</script>';const template=emailTemplate(d);assert.ok(template.text.includes('$690.000 COP'));assert.ok(template.subject.includes('Angie Tech'));assert.ok(template.html.includes('&lt;script&gt;'));assert.ok(!template.html.includes('<script>'))
})
test('Preview verifies invoice data and makes no provider call',async()=>{
 let calls=0;const response=await make(async()=>{calls++;return success()})(req({action:'preview',facturaId:3,total:1,invoice:{prefijo:'EVIL'}}));const r=await response.json();assert.equal(r.numero,'FV-0029');assert.equal(r.total,690000);assert.equal(r.destinatario,'jose@example.test');assert.equal(calls,0);assert.equal(r.accepted,undefined)
})
test('Valid send attaches real PDF with correct recipient/text/HTML and only confirms provider acceptance',async()=>{
 let sent;const handler=make(async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');sent=JSON.parse(options.body);assert.ok(options.headers['Idempotency-Key']);return success()});const response=await handler(req({...sendBody,invoice:{total:1},pdf:'fake'})),r=await response.json();assert.equal(response.status,200);assert.equal(r.accepted,true);assert.deepEqual(sent.to,['jose@example.test']);assert.equal(sent.subject,'Factura FV-0029 | Angie Tech');assert.equal(sent.attachments[0].filename,'Factura-FV-0029-Angie-Tech.pdf');assert.ok(Buffer.from(sent.attachments[0].content,'base64').toString('latin1').includes('690.000'));assert.equal((await db.query('select count(*) as n from factura_envios')).rows[0].n,1)
})
test('Double click blocks concurrent sending; accepted retry never calls provider again',async()=>{
 let calls=0,release;const handler=make(async()=>{calls++;await new Promise(r=>release=r);return success()});const first=handler(req(sendBody));while(!release)await new Promise(r=>setTimeout(r,5));const second=await handler(req(sendBody));assert.equal(second.status,409);assert.equal((await second.json()).code,'SEND_IN_PROGRESS');release();assert.equal((await first).status,200);assert.equal((await (await handler(req(sendBody))).json()).alreadyAccepted,true);assert.equal(calls,1)
})
test('Provider error is recorded safely; retry reuses exact payload/key',async()=>{
 const calls=[];let fail=true;const handler=make(async(_,options)=>{calls.push(options);return fail?new Response(JSON.stringify({message:'raw confidential diagnostics'}),{status:403}):success()});const first=await handler(req(sendBody));assert.equal((await first.json()).code,'PROVIDER_REJECTED');fail=false;assert.equal((await handler(req(sendBody))).status,200);assert.equal(calls[0].body,calls[1].body);assert.equal(calls[0].headers['Idempotency-Key'],calls[1].headers['Idempotency-Key'])
})
test('Ambiguous network result preserves payload/key; after expiry retry requires review',async()=>{
 const calls=[];const handler=make(async(_,options)=>{calls.push(options);throw Error('network confidential diagnostics')});assert.equal((await (await handler(req(sendBody))).json()).code,'RESULT_UNKNOWN');assert.equal((await (await handler(req(sendBody))).json()).accepted,false);assert.equal(calls[0].body,calls[1].body);assert.equal(calls[0].headers['Idempotency-Key'],calls[1].headers['Idempotency-Key']);await db.exec("update factura_correo_envios set proveedor_inicio=now()-interval '24 hours',estado='incierto'");assert.equal((await (await handler(req(sendBody))).json()).code,'MANUAL_REVIEW_REQUIRED');assert.equal(calls.length,2);await db.exec("update factura_correo_envios set estado='error'");assert.equal((await (await handler(req(sendBody))).json()).code,'MANUAL_REVIEW_REQUIRED');assert.equal(calls.length,2)
})
test('Invalid recipient, foreign invoice, inactive and anonymous actor never send',async()=>{
 let calls=0;const handler=make(async()=>{calls++;return success()});for(const [body,actor]of [[{...sendBody,destinatario:'bad'},ana],[{...sendBody,facturaId:2},ana],[sendBody,inactive],[sendBody,null]])assert.ok((await handler(req(body,actor))).status>=400);assert.equal(calls,0)
})
test('Missing configuration, invalid/oversized PDF or missing provider id cannot produce success',async()=>{
 for(const options of [{env:()=>null},{renderPdf:async()=>({bytes:new Uint8Array([1,2,3])})},{renderPdf:async()=>({bytes:new Uint8Array(3*1024*1024+1)})},{fetchImpl:async()=>new Response('{}',{status:200})}]){await db.exec('truncate factura_correo_intentos,factura_correo_envios,factura_envios restart identity');const response=await make(success,options)(req(sendBody));assert.ok(response.status>=400);assert.equal((await response.json()).accepted,false)}
})
test('Database limits reject fourth recipient and sixth rapid retry',async()=>{
 for(let i=0;i<3;i++)assert.equal((await rpc('correo_factura_reservar',{p_actor:ana,p_factura:3,p_destino:'person'+i+'@example.test'})).error,null)
 assert.match((await rpc('correo_factura_reservar',{p_actor:ana,p_factura:3,p_destino:'fourth@example.test'})).error.message,/RATE_LIMIT/)
 const handler=make(async()=>new Response('{}',{status:403}));for(let i=0;i<5;i++)await handler(req({...sendBody,destinatario:'person0@example.test'}));assert.equal((await (await handler(req({...sendBody,destinatario:'person0@example.test'}))).json()).code,'RATE_LIMIT')
})
test('Frontend rejects false success or unavailable service and requires provider id',async()=>{
 await assert.rejects(()=>requestInvoiceEmail({functions:{invoke:async()=>({data:{ok:true,accepted:false,estado:'aceptado'}})}},sendBody),/confirmar/);await assert.rejects(()=>requestInvoiceEmail({},sendBody),/configurar/);assert.equal((await requestInvoiceEmail({functions:{invoke:async()=>({data:{ok:true,accepted:true,estado:'aceptado',proveedorId:'confirmed'}})}},sendBody)).proveedorId,'confirmed')
})
