import assert from 'node:assert/strict'
import { esEntornoDemoPermitido } from '../src/lib/demo/environment.js'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// No npm dependencies, production accounts, real camera, or remote requests.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const artifacts = join(root, 'artifacts', process.env.UI_ARTIFACTS || 'invoice-message-templates')
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5173'
assert.ok(new URL(base).protocol === 'http:' && esEntornoDemoPermitido(new URL(base)), 'Use HTTP localhost or a private LAN server for these tests')
const browserPath = process.env.UI_BROWSER_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome',
].find(existsSync)
assert.ok(browserPath, 'Chrome/Edge is required. You can set UI_BROWSER_PATH.')

const profile = await mkdtemp(join(tmpdir(), 'angie-tech-ui-'))
await mkdir(artifacts, { recursive: true })
const results = [], externalRequests = [], browserErrors = []
const browser = spawn(browserPath, [
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--disable-background-networking', '--disable-component-update', '--disable-sync',
  '--disable-default-apps', '--no-first-run', '--no-default-browser-check',
  '--metrics-recording-only', '--disable-features=MediaRouter', 'about:blank',
], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
let socket
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
try {
  const browserSocket = await new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => reject(new Error('Browser startup timed out')), 20000)
    browser.on('error', reject)
    browser.stderr.on('data', (chunk) => {
      output += chunk
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (match) { clearTimeout(timer); resolve(match[1]) }
    })
  })
  const debugUrl = new URL(browserSocket)
  const target = await (await fetch(`http://${debugUrl.host}/json/new?about:blank`, { method: 'PUT' })).json()
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  let seq = 0
  const pending = new Map()
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++seq
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 30000)
      pending.set(id, { resolve, reject, timer })
      socket.send(JSON.stringify({ id, method, params }))
    })
  }
  socket.addEventListener('message', async ({ data }) => {
    const event = JSON.parse(data)
    if (event.id) {
      const task = pending.get(event.id)
      if (!task) return
      pending.delete(event.id); clearTimeout(task.timer)
      if (event.error) task.reject(new Error(JSON.stringify(event.error)))
      else task.resolve(event.result)
    } else if (event.method === 'Fetch.requestPaused') {
      const { requestId, request } = event.params
      try {
        const url = new URL(request.url)
        if (url.pathname === '/src/lib/invoiceEmail.js') {
          const original=await (await fetch(request.url)).text();
          const instrumented=original.replace('navigate = globalThis.window?.location?.assign.bind(globalThis.window.location)', 'navigate = url => { (window.__mailUrls ||= []).push(url); if(window.__mailMode === "throws")throw Error("OS diagnostic not configured"); }').replace('navigate === undefined ? globalThis.window?.location?.assign.bind(globalThis.window.location) : navigate', 'navigate === undefined ? url => { (window.__gmailUrls ||= []).push({url,activation:navigator.userActivation.isActive}); if(window.__gmailMode === "throws")throw Error("Scheme unavailable"); } : navigate');
          assert.notEqual(instrumented,original,'Mail handoff fixture must intercept actual navigation without launching OS apps');
          await send('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/javascript'}],body:Buffer.from(instrumented).toString('base64')});
        } else if (url.pathname === '/src/lib/supabase.js') {
          const fixture = "import {createDemoClient} from '/src/lib/demo/client.js'; export const isDemoMode=false; export const isInvoiceEmailEnabled=false; export const supabaseConfigurationError=''; export const supabase=createDemoClient();supabase.functions={invoke:async(name,{body})=>{(window.__emailRequests||=[]).push(body);if(body.action==='preview'){const f=(await supabase.from('facturas').select('*').eq('id',body.facturaId).single()).data;return {data:{ok:true,configured:window.__emailMode!=='missing',numero:f.prefijo+'-'+String(f.numero).padStart(4,'0'),total:f.total,destinatario:f.clientes?.correo||'',nombreComercial:'Angie Tech',identidadHistorica:true}}}window.__sendCalls=(window.__sendCalls||0)+1;if(window.__emailMode==='hold')await new Promise(resolve=>window.__releaseEmail=resolve);if(window.__emailMode==='reject')return {error:{context:new Response(JSON.stringify({code:'PROVIDER_REJECTED'}))}};return {data:{ok:true,estado:'aceptado',accepted:window.__emailMode!=='unconfirmed',proveedorId:window.__emailMode==='unconfirmed'?null:'fixture-accepted'}}}};const rpc=supabase.rpc.bind(supabase);supabase.rpc=(name,args)=>sessionStorage.getItem('ui-missing-migration')==='true'&&name==='guardar_plantillas_factura'?Promise.resolve({error:{code:'PGRST202',message:'schema cache'}}):rpc(name,args);export async function conAutorizacionAdmin(){throw Error('No admin access in fixture')}";
          await send('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/javascript'}],body:Buffer.from(fixture).toString('base64')});
        } else if (url.origin !== new URL(base).origin && url.protocol !== 'data:') {
          externalRequests.push(request.url)
          await send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' })
        } else await send('Fetch.continueRequest', { requestId })
      } catch (error) {
        // Navigation can cancel an already intercepted request in Chrome's CDP.
        // Keep application exceptions and every other interception failure visible.
        if (error.message !== JSON.stringify({code:-32602,message:'Invalid InterceptionId.'})) browserErrors.push(error.message)
      }
    } else if (event.method === 'Runtime.exceptionThrown') {
      browserErrors.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text)
    } else if (event.method === 'Log.entryAdded' && event.params.entry.level === 'error') {
      browserErrors.push(event.params.entry.text)
    }
  })
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  async function waitFor(expression, timeout = 25000) {
    const deadline = Date.now() + timeout
    do { if (await evaluate(expression)) return; await delay(150) } while (Date.now() < deadline)
    await screenshot("failure"); await writeFile(join(artifacts,"failure.json"),JSON.stringify(await evaluate("({alerts:[...document.querySelectorAll(\"[role=alert]\")].map(e=>e.textContent),body:document.body.innerText})"),null,2));
    throw new Error(`Timed out waiting for ${expression}`)
  }
  async function navigate(path, role = 'admin') {
    await evaluate(`sessionStorage.setItem('ui-test-role', ${JSON.stringify(role)})`)
    await send('Page.navigate', { url: base + path })
    await waitFor(`location.pathname === ${JSON.stringify(path)} && document.readyState === 'complete'`)
    await waitFor(role === 'login' ? "!!document.querySelector('.login-form')" : "!!document.querySelector('.nav')")
  }
  async function tap(selector) {
    const point = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('Missing touch target'); el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`)
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await delay(180)
  }
  async function screenshot(name) {
    const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    await writeFile(join(artifacts, name + '.png'), Buffer.from(result.data, 'base64'))
  }
  async function geometry(name, width, height, hasNav = true) {
    const measurements = await evaluate(`(() => {
      const failures = [];
      for (const el of document.querySelectorAll('.device,.top,.top-title,.view,.page-content,.card,.row,.sheet,.sheet-body,.login-layout,.login-form,.stat-value,.search-bar,.cart-bar-button,h1,.row p,.badge')) {
        const r = el.getBoundingClientRect();
        if (r.width && (r.left < -1 || r.right > innerWidth + 1 || el.scrollWidth > el.clientWidth + 2)) failures.push({element:el.className || el.tagName,left:r.left,right:r.right,scroll:el.scrollWidth,client:el.clientWidth});
      }
      const nav = document.querySelector('.nav'), nr = nav?.getBoundingClientRect();
      return {width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,failures,themeButtons:document.querySelectorAll('[aria-label="Cambiar tema"]').length,nav:nr?{top:nr.top,bottom:nr.bottom,count:nav.children.length,minimumTarget:Math.min(...[...nav.children].map(el=>el.getBoundingClientRect().height))}:null};
    })()`)
    if (measurements.failures.length) await screenshot('failure-' + name)
    assert.equal(measurements.width, width)
    assert.ok(measurements.documentWidth <= width + 1, `${name}: horizontal document scroll`)
    assert.deepEqual(measurements.failures, [], `${name}: overflow or clipped text`)
    if (hasNav) {
      assert.ok(measurements.nav.top >= 0 && measurements.nav.bottom <= height + 1, `${name}: bottom nav offscreen`)
      assert.equal(measurements.nav.count, 5)
      assert.ok(measurements.themeButtons >= 1)
      assert.ok(measurements.nav.minimumTarget >= 44)
    }
    results.push({ name, width, height, status: 'PASS' })
  }






  await send('Page.enable');await send('Runtime.enable');await send('Log.enable');await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});await send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  const downloads=join(artifacts,'downloads');await mkdir(downloads,{recursive:true});await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
  const check=name=>{results.push({name,status:'PASS'});console.log('PASS '+name)};
  const api=expression=>evaluate("import(performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/lib/supabase.js')?.name||'/src/lib/supabase.js').then(async({supabase})=>{"+expression+"})");
  const field=async(selector,value)=>{await evaluate('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,'+JSON.stringify(value)+');e.dispatchEvent(new Event("input",{bubbles:true}))})()');await delay(70)};
  const click=async(selector)=>{await send('Page.bringToFront');const pos=await evaluate('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');if(!e)throw Error("Missing click target");e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()');await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...pos});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...pos});await delay(120)};
  const free=async()=>{await waitFor("!document.querySelector('[data-app-dialog]')");assert.equal(await evaluate("document.getElementById('root').inert"),false)};
  const configure=()=>evaluate("window.__webCalls=[];window.__mailUrls=[];window.__webMode='ok';window.__mailMode='ok';window.open=(...args)=>{window.__webCalls.push({args,activation:navigator.userActivation.isActive});if(window.__webMode==='blocked')return null;if(window.__webMode==='throws')throw Error('Technical popup diagnostic');return{opener:window}};Object.defineProperty(navigator,'share',{configurable:true,value:undefined});Object.defineProperty(navigator,'canShare',{configurable:true,value:undefined});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copied=text}}})");
  const noFallback=()=>evaluate("!document.querySelector('.invoice-email-preview,.email-provider-picker')");
  const lastWeb=()=>evaluate('window.__webCalls.at(-1)');
  const verifyUrl=(call,provider,sold)=>{assert.equal(call.activation,true);assert.equal(call.args[1],'_blank');const u=new URL(call.args[0]);assert.equal(u.origin,provider==='gmail'?'https://mail.google.com':'https://outlook.live.com');assert.equal(u.searchParams.get('to'),sold.clientes.correo);assert.equal(u.searchParams.get(provider==='gmail'?'su':'subject'),'Factura '+sold.prefijo+'-'+String(sold.numero).padStart(4,'0')+' - Angie Tech');assert.ok(u.searchParams.get('body').includes('Gracias por tu compra'));assert.ok(u.searchParams.get('body').includes(sold.prefijo+'-'+String(sold.numero).padStart(4,'0')));if(provider==='gmail'){assert.equal(u.searchParams.get('view'),'cm');assert.equal(u.searchParams.get('fs'),'1')}else assert.equal(u.pathname,'/mail/0/deeplink/compose')};
  const leaveReturn=()=>evaluate("window.dispatchEvent(new Event('blur'));Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));delete document.visibilityState");

  const type=async(selector,value)=>{await evaluate('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');if(!e)throw Error("Missing field");Object.getOwnPropertyDescriptor(e.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,"value").set.call(e,'+JSON.stringify(value)+');e.dispatchEvent(new Event("input",{bubbles:true}))})()');await delay(100)};
  const metrics=async(width,height=844)=>{await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<768});await delay(220)};
  const login=async(email,selector)=>{await send('Page.navigate',{url:base+'/login'});await waitFor("!!document.querySelector('#login-email')");await field('#login-email',email);await field('#login-password','AngieDemo123!');await click('.login-submit');await waitFor('!!document.querySelector('+JSON.stringify(selector)+')')};
  const logout=async()=>{await api('await supabase.auth.signOut()');await waitFor("!!document.querySelector('#login-email')")};
  const openSettings=async()=>{await navigate('/configuracion');await evaluate("[...document.querySelectorAll('.settings-row')].find(e=>e.textContent.includes('Plantillas de mensajes')).click()");await waitFor("!!document.querySelector('.invoice-message-settings input')")};
  const tab=async(label)=>{await evaluate("[...document.querySelectorAll('.invoice-message-settings .sales-periods button')].find(e=>e.textContent==="+JSON.stringify(label)+").click()");await delay(100)};
  await login('admin@angietech.demo','.ah-duo');
  const pristine=await api('return supabase.demo.snapshot().tables');
  await metrics(390);await openSettings();
  assert.equal(await evaluate("document.querySelectorAll('.template-variables code').length"),6);
  const custom={asunto_correo:'Tu compra {numero_factura} | {nombre_negocio}',mensaje_correo:'Hola {cliente}. Factura {numero_factura}, fecha {fecha}, total {total}. Gracias de {nombre_negocio}.\n{productos}',mensaje_whatsapp:'Hola {cliente}, tu factura {numero_factura}: {total}. {nombre_negocio}. {productos}'};
  await type('.invoice-message-settings input',custom.asunto_correo);await type('#template-email-body',custom.mensaje_correo);
  assert.ok(await evaluate("document.querySelector('.template-preview').textContent.includes('FV-0028')&&document.querySelector('.template-preview').textContent.includes('$55.000 COP')"));
  assert.equal(await evaluate("document.querySelector('.template-preview pre').textContent.includes('{cliente}')"),false);check('Administrator edits subject/body; six variables resolve in an explicitly unsent example');
  await tab('WhatsApp');await type('#template-whatsapp-body',custom.mensaje_whatsapp);assert.ok(await evaluate("document.querySelector('.template-preview pre').textContent.includes('FV-0028')"));
  await evaluate("document.querySelector('#template-whatsapp-body').focus();Object.defineProperty(visualViewport,'height',{configurable:true,value:450});Object.defineProperty(visualViewport,'offsetTop',{configurable:true,value:30});visualViewport.dispatchEvent(new Event('resize'))");await delay(300);
  const kb=await evaluate("(()=>{const s=document.querySelector('.invoice-message-settings'),r=s.getBoundingClientRect(),b=s.querySelector('.sheet-body'),f=s.querySelector('.sheet-foot');return{top:r.top,bottom:r.bottom,footer:f.getBoundingClientRect().bottom,body:b.getBoundingClientRect().bottom,footerTop:f.getBoundingClientRect().top,color:getComputedStyle(f).backgroundColor,scroll:getComputedStyle(b).overflowY,font:getComputedStyle(s.querySelector('textarea')).fontSize}})()");
  assert.ok(Math.abs(kb.top-30)<=1&&Math.abs(kb.bottom-480)<=1&&Math.abs(kb.footer-480)<=1,JSON.stringify(kb));assert.ok(kb.body<=kb.footerTop+1);assert.notEqual(kb.color,'rgba(0, 0, 0, 0)');assert.equal(kb.scroll,'auto');assert.ok(parseFloat(kb.font)>=16);check('390x844 simulated keyboard: one scroll, solid footer and no gap above keyboard');
  await evaluate("document.activeElement.blur();delete visualViewport.height;delete visualViewport.offsetTop;visualViewport.dispatchEvent(new Event('resize'))");
  await metrics(844,390);await geometry('Template editor landscape',844,390);await metrics(390);
  await click('.invoice-message-settings .sheet-foot button');await waitFor("!document.querySelector('.invoice-message-settings')");
  assert.deepEqual(await api("return (await supabase.from('tienda').select('*').eq('id',1).single()).data.plantillas_factura"),custom);check('Admin saves both channels through permission-checked configuration RPC');
  await openSettings();assert.equal(await evaluate("document.querySelector('.invoice-message-settings input').value"),custom.asunto_correo);await click('.invoice-message-settings .sheet-x');await free();check('Hard reload preserves saved subject and templates');
  await openSettings();await type('.invoice-message-settings input','Not saved {numero_factura}');await evaluate("sessionStorage.setItem('ui-missing-migration','true')");await click('.invoice-message-settings .sheet-foot button');await waitFor("document.querySelector('.invoice-message-settings [role=alert]')?.textContent.includes('no se guardaron')");assert.deepEqual(await api("return (await supabase.from('tienda').select('*').eq('id',1).single()).data.plantillas_factura"),custom);await evaluate("sessionStorage.removeItem('ui-missing-migration')");await click('.invoice-message-settings .sheet-x');check('Unactivated real migration reports no save and preserves original templates');
  await navigate('/');await waitFor("document.querySelectorAll('.ah-duo .ah-mini').length===2");
  const initialCards=await evaluate("[...document.querySelectorAll('.ah-duo .ah-mini b')].map(e=>e.textContent)");
  for(const [device,width,height] of [['small',320,700],['smallAndroid',360,800],['iPhone',390,844],['Android',412,915],['iPhoneLarge',430,932],['desktop',1440,900]])for(const theme of ['dark','light']){
    await metrics(width,height);await evaluate("import('/src/lib/theme.js').then(m=>m.setTheme('"+theme+"'))");await delay(180);
    const boxes=await evaluate("[...document.querySelectorAll('.ah-duo .ah-mini')].map(e=>{const r=e.getBoundingClientRect(),i=e.querySelector('.ah-mini-icon'),s=e.querySelector('svg'),b=e.querySelector('b'),a=e.querySelector('.fit-amount');return{left:r.left,right:r.right,height:r.height,icon:i.getBoundingClientRect().width,svg:s.getBoundingClientRect().width,overflow:a.scrollWidth-a.clientWidth,amount:b.textContent,amountTop:b.getBoundingClientRect().top,title:e.querySelector('.ah-mini-top').getBoundingClientRect().top}})");
    assert.equal(boxes.length,2);for(const b of boxes){assert.ok(b.left>=0&&b.right<=width+1);assert.equal(b.icon,26);assert.equal(b.svg,15);assert.ok(b.overflow<=1,JSON.stringify(b));assert.ok(b.amountTop>b.title)}assert.ok(Math.abs(boxes[0].height-boxes[1].height)<=1);assert.deepEqual(boxes.map(b=>b.amount),initialCards);assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);check('Compact income/expense cards '+device+' '+width+' '+theme);
  }
  await metrics(390);await click('.ah-duo .ah-mini:first-child');await waitFor("location.pathname==='/finanzas'&&location.search.includes('detalle=ingreso')");await navigate('/');await click('.ah-duo .ah-mini:last-child');await waitFor("location.pathname==='/finanzas'&&location.search.includes('detalle=gasto')");check('Income and expense cards keep their original finance drill-down routes');
  await logout();await login('ana@angietech.demo','.seller-home');await navigate('/configuracion');assert.equal(await evaluate("document.body.textContent.includes('Plantillas de mensajes')"),false);check('Seller has no global message editor after logout/login');
  const invoice=await api("return (await supabase.from('facturas').select('*').eq('vendedor_id','demo-ana')).data.find(f=>f.estado==='emitida'&&f.clientes?.correo&&f.clientes?.telefono)");assert.ok(invoice);
  await send('Page.navigate',{url:base+'/facturas?factura='+invoice.id});await waitFor("!!document.querySelector('.fd-num')&&!document.querySelector('.fd-act.mail').disabled");await configure();
  const expected=await api("const tienda=(await supabase.from('tienda').select('*').eq('id',1).single()).data;const f=(await supabase.from('facturas').select('*').eq('id',"+JSON.stringify(invoice.id)+").single()).data;const items=(await supabase.from('factura_items').select('*').eq('factura_id',f.id)).data;const m=await import('/src/lib/invoiceMessageTemplates.js');return m.renderInvoiceMessages({invoice:f,items,tienda,templates:tienda.plantillas_factura})");
  await click('.fd-act.mail');await waitFor("!!document.querySelector('#invoice-email-send-recipient')");assert.equal(await evaluate("document.querySelector('#invoice-email-send-recipient').value"),invoice.clientes.correo);assert.equal(await evaluate("document.querySelector('.email-preview-subject p').textContent"),expected.asunto);assert.equal(await evaluate("document.querySelector('.email-preview-message pre').textContent"),expected.correo);assert.equal(await evaluate("document.querySelector('.email-confirm-send').disabled"),true);assert.ok(await evaluate("document.querySelector('.invoice-email-send').textContent.includes('pendiente de activaci')"));assert.equal(await evaluate("window.__webCalls.length+(window.__emailRequests?.length||0)"),0);check('Seller receives configured real invoice text and recipient; inactive mail makes no provider/Gmail call');
  await field('#invoice-email-send-recipient','corregido@example.test');assert.equal(await evaluate("document.querySelector('#invoice-email-send-recipient').value"),'corregido@example.test');await click('.invoice-email-send .email-preview-cancel');check('Recipient is editable for this send without updating the client');
  await click('.fd-act.wa');await waitFor("!!document.querySelector('.invoice-message-preview pre')");assert.equal(await evaluate("document.querySelector('.invoice-message-preview pre').textContent"),expected.whatsapp);await evaluate("[...document.querySelectorAll('.invoice-message-preview button')].find(e=>e.textContent==='Cerrar vista previa').click()");check('WhatsApp preview uses the same saved administrator template with actual invoice variables');
  await evaluate("window.__shared=[];Object.defineProperty(navigator,'canShare',{configurable:true,value:({files})=>files?.[0]?.type==='application/pdf'});Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{const f=data.files[0];window.__shared.push({name:f.name,type:f.type,size:f.size,magic:await f.slice(0,5).text(),title:data.title,text:data.text})}})");
  await click('.fd-act.mail');await waitFor("!!document.querySelector('.invoice-email-send .email-preview-actions .btn')");await click('.invoice-email-send .email-preview-actions .btn');await waitFor('window.__shared.length===1');const shared=await evaluate('window.__shared[0]');assert.equal(shared.type,'application/pdf');assert.equal(shared.magic,'%PDF-');assert.ok(shared.size>1000);assert.ok(shared.name.includes(String(invoice.numero).padStart(4,'0')));check('Inactive service fallback shares the real invoice PDF with title/text without a mail application');
  await evaluate("Object.defineProperty(navigator,'share',{configurable:true,value:async()=>{throw new DOMException('Cancelled','AbortError')}})");await click('.fd-act.share');await waitFor("!document.querySelector('.fd-act.share').disabled");await leaveReturn();await click('.fd-act.mail');await waitFor("!!document.querySelector('#invoice-email-send-recipient')");await click('.invoice-email-send .email-preview-cancel');assert.equal(await evaluate("document.activeElement.matches('input,textarea')"),false);assert.equal(await evaluate("!!document.querySelector('.fd-auth,[type=password]')"),false);check('Cancelled share and return preserve session, invoice, usable controls and clean keyboard focus');
  const tables=await api('return supabase.demo.snapshot().tables');for(const key of ['facturas','factura_items','clientes','productos','movimientos'])assert.deepEqual(tables[key],pristine[key]);check('Configuration, email preview and PDF sharing preserve invoices, clients, stock and financial tables');
  await send('Page.navigate',{url:base+'/configuracion'});await waitFor("!!document.querySelector('.settings-panel')");await logout();await login('admin@angietech.demo','.ah-duo');await openSettings();await click('.template-restore');await click('.invoice-message-settings .sheet-foot button');await waitFor("!document.querySelector('.invoice-message-settings')");const defaults=await evaluate("import('/src/lib/invoiceMessageTemplates.js').then(m=>m.DEFAULT_INVOICE_MESSAGES)");assert.deepEqual(await api("return (await supabase.from('tienda').select('*').eq('id',1).single()).data.plantillas_factura"),defaults);await openSettings();assert.equal(await evaluate("document.querySelector('.invoice-message-settings input').value"),defaults.asunto_correo);await click('.invoice-message-settings .sheet-x');check('Restore defaults requires save and persists across a new page load');
  assert.deepEqual(externalRequests,[]);assert.deepEqual(browserErrors,[]);await writeFile(join(artifacts,'results.json'),JSON.stringify({status:'PASS',cases:results.length,results,remoteCalls:0,physicalSafariPending:true},null,2));console.log(JSON.stringify({status:'PASS',cases:results.length,artifacts}));await send('Browser.close').catch(()=>{});
} catch(error){await writeFile(join(artifacts,'results.json'),JSON.stringify({status:'FAIL',error:error.stack,results,externalRequests,browserErrors},null,2));console.error(error.stack);process.exitCode=1}
finally{socket?.close();browser.kill();await delay(300);if(!profile.startsWith(join(tmpdir(),'angie-tech-ui-')))throw Error('Unexpected profile');await rm(profile,{recursive:true,force:true,maxRetries:20,retryDelay:250}).catch(error=>{console.error('Profile cleanup failed',error.message);process.exitCode=1})}
