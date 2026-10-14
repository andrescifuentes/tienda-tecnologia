import test from 'node:test'
import assert from 'node:assert/strict'
import { EMAIL_PROVIDER_KEY, EMAIL_PROVIDERS, leerProveedorCorreo, guardarProveedorCorreo, enlaceCompositorCorreo, abrirCompositorCorreo, crearBorradorCorreoFactura, esIOSCorreo, vigilarAperturaGmailIOS } from '../src/lib/invoiceEmail.js'
const invoice={prefijo:'FV',numero:2042,total:1234567,clientes:{nombre:'María García',correo:'maria+ventas@example.test'}}
const draft=crearBorradorCorreoFactura({invoice,correo:invoice.clientes.correo,detalle:'*Cable* · $10.000'})
const memory=()=>{const m=new Map();return{getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),m}}
for(const p of EMAIL_PROVIDERS)test('Preference saves only enum and survives a new read: '+p.id,()=>{const s=memory();assert.equal(leerProveedorCorreo(s),null);assert.equal(guardarProveedorCorreo(p.id,s),true);assert.equal(leerProveedorCorreo(s),p.id);assert.deepEqual([...s.m],[[EMAIL_PROVIDER_KEY,p.id]])})
test('Preference change replaces provider without retaining customer, invoice or credentials',()=>{const s=memory();guardarProveedorCorreo('gmail',s);guardarProveedorCorreo('outlook',s);assert.equal(leerProveedorCorreo(s),'outlook');assert.equal(s.m.size,1);assert.equal(JSON.stringify([...s.m]).includes(invoice.clientes.correo),false)})
for(const invalid of ['',null,'javascript:bad','maria@example.test','unknown'])test('Invalid preference is ignored and cannot be written: '+invalid,()=>{const s=memory();s.setItem(EMAIL_PROVIDER_KEY,invalid);assert.equal(leerProveedorCorreo(s),null);assert.throws(()=>guardarProveedorCorreo(invalid,s),/válido/)})
test('Unavailable local storage never blocks provider selection',()=>{const s={getItem(){throw Error('Denied')},setItem(){throw Error('Denied')}};assert.equal(leerProveedorCorreo(s),null);assert.equal(guardarProveedorCorreo('gmail',s),false)})
for(const p of ['gmail','outlook'])test('Direct '+p+' URL carries actual recipient, subject and complete message',()=>{const u=new URL(enlaceCompositorCorreo(draft,p));assert.equal(u.origin,p==='gmail'?'https://mail.google.com':'https://outlook.live.com');assert.equal(u.pathname,p==='gmail'?'/mail/':'/mail/0/deeplink/compose');if(p==='gmail'){assert.equal(u.searchParams.get('view'),'cm');assert.equal(u.searchParams.get('fs'),'1')}assert.equal(u.searchParams.get('to'),draft.destino);assert.equal(u.searchParams.get(p==='gmail'?'su':'subject'),draft.asunto);assert.equal(u.searchParams.get('body'),draft.cuerpo);assert.equal(u.hash,'');assert.equal(u.username,'');assert.equal(u.searchParams.has('attachment'),false)})
test('System composer uses encoded mailto and no empty window',()=>{const u=new URL(enlaceCompositorCorreo(draft,'system'));assert.equal(u.protocol,'mailto:');assert.equal(decodeURIComponent(u.pathname),draft.destino);assert.equal(u.searchParams.get('subject'),draft.asunto);assert.equal(u.searchParams.get('body'),draft.cuerpo);const nav=[];assert.equal(abrirCompositorCorreo(draft,'system',{open(){throw Error('Forbidden popup')},navigate:url=>nav.push(url)}),'requested');assert.deepEqual(nav,[u.href])})
for(const p of ['gmail','outlook'])test('Single synchronous gesture opens complete '+p+' compose URL and detaches opener',()=>{const calls=[],popup={opener:'parent'};assert.equal(abrirCompositorCorreo(draft,p,{open:(...args)=>{calls.push(args);return popup}}),'requested');assert.deepEqual(calls,[[enlaceCompositorCorreo(draft,p),'_blank']]);assert.equal(popup.opener,null);assert.ok(calls.every(args=>args[0]&&args[0]!=='about:blank'))})
for(const p of ['gmail','outlook','system'])test('Blocked '+p+' opens safe fallback result without technical diagnostics',()=>{const options={open:()=>null,navigate:()=>{throw Error('No account / OS diagnostic')}};assert.equal(abrirCompositorCorreo(draft,p,options),'unavailable');assert.equal(abrirCompositorCorreo(draft,p,{open:()=>{throw Error('Popup denied')},navigate:null}),'unavailable')})
for(const p of ['gmail','outlook','system'])test('Missing customer email cannot launch an empty '+p+' composer',()=>{let calls=0;const d=crearBorradorCorreoFactura({invoice,correo:''});assert.throws(()=>abrirCompositorCorreo(d,p,{open:()=>calls++,navigate:()=>calls++}),/correo registrado/);assert.equal(calls,0)})
test('Invalid provider or CRLF recipient cannot open arbitrary destinations',()=>{assert.throws(()=>enlaceCompositorCorreo(draft,'bad'));assert.throws(()=>enlaceCompositorCorreo({...draft,destino:'a@b.test\r\nBcc:c@d.test'},'gmail'))})
test('Native handler availability is not fabricated when OS navigation returns silently',()=>{assert.equal(abrirCompositorCorreo(draft,'system',{navigate:()=>{}}),'requested');assert.equal(draft.adjuntoManual,true)})


test('iOS detection includes iPhone, iPad and desktop-mode iPad but excludes Windows, Android and Mac',()=>{
 for(const n of [{userAgent:'iPhone'},{userAgent:'iPad'},{userAgent:'iPod'},{userAgent:'Mozilla/5.0 Macintosh',platform:'MacIntel',maxTouchPoints:5}])assert.equal(esIOSCorreo(n),true)
 for(const n of [{userAgent:'Windows',platform:'Win32',maxTouchPoints:5},{userAgent:'Android',maxTouchPoints:5},{userAgent:'Macintosh',platform:'MacIntel',maxTouchPoints:0},{}])assert.equal(esIOSCorreo(n),false)
})
test('iOS Gmail deep link encodes real recipient, subject, accents and full message',()=>{
 const d={...draft,destino:'maria+ventas@example.test',asunto:'Factura FV-2042 · María & Angie',cuerpo:'Hola María,\nTotal: $1.234.567\n? & # + /'}
 const url=enlaceCompositorCorreo(d,'gmail',{ios:true});assert.ok(url.startsWith('googlegmail:///co?'))
 const u=new URL(url);assert.equal(u.searchParams.get('to'),d.destino);assert.equal(u.searchParams.get('subject'),d.asunto);assert.equal(u.searchParams.get('body'),d.cuerpo);assert.equal(u.hash,'')
 const calls=[];assert.equal(abrirCompositorCorreo(d,'gmail',{ios:true,navigate:url=>calls.push(url),open:()=>{throw Error('No popups')}}),'attempted');assert.deepEqual(calls,[url])
})
test('iOS missing/denied Gmail handler returns fallback without web redirect or empty popup',()=>{
 let webCalls=0;for(const navigate of [null,()=>{throw Error('Scheme unavailable')}])assert.equal(abrirCompositorCorreo(draft,'gmail',{ios:true,navigate,open:()=>webCalls++}),'unavailable')
 assert.equal(webCalls,0)
})
test('Windows Gmail URL and desktop dispatch remain exactly unchanged',()=>{
 const expected='https://mail.google.com/mail/?view=cm&fs=1&to='+encodeURIComponent(draft.destino)+'&su='+encodeURIComponent(draft.asunto)+'&body='+encodeURIComponent(draft.cuerpo)
 assert.equal(enlaceCompositorCorreo(draft,'gmail',{ios:false}),expected);const calls=[];assert.equal(abrirCompositorCorreo(draft,'gmail',{ios:false,open:(...args)=>{calls.push(args);return{}},navigate:()=>{throw Error('No app handoff')}}),'requested');assert.deepEqual(calls,[[expected,'_blank']])
})
test('Manual Gmail web remains opt-in on iOS; Outlook and system are unchanged',()=>{
 assert.equal(enlaceCompositorCorreo(draft,'gmail',{ios:true,gmailWeb:true}),enlaceCompositorCorreo(draft,'gmail',{ios:false}))
 for(const provider of ['outlook','system'])assert.equal(enlaceCompositorCorreo(draft,provider,{ios:true}),enlaceCompositorCorreo(draft,provider,{ios:false}))
})
test('Visible Safari after a Gmail attempt offers alternatives once and removes observers',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const document=new EventTarget(),window=new EventTarget();document.visibilityState='visible';let count=0
 vigilarAperturaGmailIOS(()=>count++,{document,window});t.mock.timers.tick(1799);assert.equal(count,0);t.mock.timers.tick(1);assert.equal(count,1);t.mock.timers.tick(10000);assert.equal(count,1)
})
test('Backgrounding, pagehide or explicit cancel prevents stale Gmail fallback on return',t=>{
 t.mock.timers.enable({apis:['setTimeout']});for(const mode of ['hidden','pagehide','cancel']){const document=new EventTarget(),window=new EventTarget();document.visibilityState='visible';let count=0
 const stop=vigilarAperturaGmailIOS(()=>count++,{document,window});if(mode==='hidden'){document.visibilityState='hidden';document.dispatchEvent(new Event('visibilitychange'));document.visibilityState='visible'}else if(mode==='pagehide')window.dispatchEvent(new Event('pagehide'));else stop()
 t.mock.timers.tick(10000);assert.equal(count,0)}
})
