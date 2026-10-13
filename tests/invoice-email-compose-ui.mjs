// Prior iOS primary smoke now exercises transactional delivery; manual cases remain below.
if(process.env.EMAIL_IOS_SMOKE==='1'){await import('./invoice-email-transactional-ui.mjs');process.exit(process.exitCode||0)}
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
const artifacts = join(root, 'artifacts', process.env.UI_ARTIFACTS || 'invoice-email-compose')
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
        } else if (process.env.POST_SALE_REAL_FIXTURE === '1' && url.pathname === '/src/lib/supabase.js') {
          const fixture = "import {createDemoClient} from '/src/lib/demo/client.js'; export const isDemoMode=false; export const supabaseConfigurationError=''; export const supabase=createDemoClient(); supabase.storage={from:()=>({upload:async()=>{window.__uploadCalls=(window.__uploadCalls||0)+1;if(window.__UPLOAD_MODE__==='hang')return new Promise(()=>{});return{error:window.__UPLOAD_MODE__==='success'?null:{message:'Bucket not found'}}},getPublicUrl:()=>({data:{publicUrl:'https://example.test/invoice.pdf'}})})}; export async function conAutorizacionAdmin(){window.__adminAuthCalls=(window.__adminAuthCalls||0)+1;throw Error('No administrator authentication in this local fixture')}";
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
  const manualSelected=async()=>{await click('.email-more-options');if(!await evaluate("document.querySelector('#invoice-email-recipient').value.trim()"))return;const p=await evaluate("localStorage.getItem('angie:email-provider')||'gmail'");await click(p==='system'?'.email-open':p==='outlook'?'.email-outlook':'.email-gmail');if(!await evaluate("document.querySelector('.invoice-email-preview [role=alert]')?.textContent"))await click('.email-preview-cancel')};
  const noFallback=()=>evaluate("!document.querySelector('.invoice-email-preview,.email-provider-picker')");
  const lastWeb=()=>evaluate('window.__webCalls.at(-1)');
  const verifyUrl=(call,provider,sold)=>{assert.equal(call.activation,true);assert.equal(call.args[1],'_blank');const u=new URL(call.args[0]);assert.equal(u.origin,provider==='gmail'?'https://mail.google.com':'https://outlook.live.com');assert.equal(u.searchParams.get('to'),sold.clientes.correo);assert.equal(u.searchParams.get(provider==='gmail'?'su':'subject'),'Factura '+sold.prefijo+'-'+String(sold.numero).padStart(4,'0')+' - Angie Tech');assert.ok(u.searchParams.get('body').includes('Gracias por tu compra'));assert.ok(u.searchParams.get('body').includes(sold.prefijo+'-'+String(sold.numero).padStart(4,'0')));if(provider==='gmail'){assert.equal(u.searchParams.get('view'),'cm');assert.equal(u.searchParams.get('fs'),'1')}else assert.equal(u.pathname,'/mail/0/deeplink/compose')};
  const leaveReturn=()=>evaluate("window.dispatchEvent(new Event('blur'));Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));delete document.visibilityState");
  await send('Page.navigate',{url:base+'/login'});await waitFor("!!document.querySelector('#login-email')");await field('#login-email','ana@angietech.demo');await field('#login-password','AngieDemo123!');await click('.login-submit');await waitFor("!!document.querySelector('.seller-home')");
  const product=await api("return (await supabase.from('productos_venta').select('*')).data.find(p=>!p.maneja_serial&&p.stock>=10)");
  const sale=async(name)=>{await send('Page.navigate',{url:base+'/vender?q='+encodeURIComponent(product.codigo)});await waitFor("!!document.querySelector('.pos-tile .pos-add')");await click('.pos-tile .pos-add');await click('.pos-bar');await click('.pos-who2 button');await waitFor("!!document.querySelector('.client-picker-sheet .row')");if(name)await evaluate("[...document.querySelectorAll('.client-picker-sheet .row')].find(e=>e.textContent.includes("+JSON.stringify(name)+")).click()");else await click('.client-picker-sheet .row');await waitFor("!document.querySelector('.client-picker-sheet')");await click('.pos-pay2');await waitFor("!!document.querySelector('.seller-sale-complete')");await configure()};
  await sale();const sold=await api("return (await supabase.from('facturas').select('*').eq('vendedor_id','demo-ana').order('id',{ascending:false}).limit(1)).data[0]");const before=await api('return supabase.demo.snapshot().tables');const number=sold.prefijo+'-'+String(sold.numero).padStart(4,'0');
  await click('.email-change-provider');await waitFor("!!document.querySelector('.email-provider-picker')");assert.equal(await evaluate("document.querySelectorAll('.email-provider-choice').length"),3);await click('.email-provider-choice[data-provider=gmail]');assert.equal(await evaluate("localStorage.getItem('angie:email-provider')"),'gmail');check('Manual provider preference remains available as a secondary action');
  await click('.email-more-options'); await click('.email-gmail');verifyUrl(await lastWeb(),'gmail',sold);await click('.email-preview-cancel');let count=await evaluate('window.__webCalls.length');check('Manual Gmail composer remains available without replacing transactional email');
  if(process.env.EMAIL_IOS_SMOKE === '1') {
    await send('Network.setUserAgentOverride',{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',platform:'iPhone'});await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    const verifyGmailApp=async()=>{const call=await evaluate('window.__gmailUrls.at(-1)');const u=new URL(call.url);assert.equal(call.activation,true);assert.equal(u.protocol,'googlegmail:');assert.equal(u.pathname,'/co');assert.equal(u.searchParams.get('to'),sold.clientes.correo);assert.equal(u.searchParams.get('subject'),'Factura '+number+' - Angie Tech');assert.ok(u.searchParams.get('body').includes(number))};
    count=await evaluate('window.__webCalls.length');await manualSelected();await verifyGmailApp();assert.equal(await noFallback(),true);assert.equal(await evaluate('window.__webCalls.length'),count);check('iPhone Gmail requests populated app compose from a real gesture without web or empty tabs');
    await evaluate("Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'))");await delay(1900);assert.equal(await noFallback(),true);assert.equal(await evaluate("document.querySelector('.seller-sale-complete .fd-num').textContent"),number);assert.equal(await evaluate("document.activeElement.matches('input,textarea,select')"),false);check('Return from app preserves invoice and clean focus without delayed fallback');
    await manualSelected();await waitFor("!!document.querySelector('.invoice-email-preview')");assert.ok(await evaluate("document.querySelector('[role=alert]').textContent.includes('Si Gmail no se abri')"));assert.equal(await evaluate('window.__webCalls.length'),count);assert.ok(await evaluate("!!document.querySelector('.email-open,.email-download,.email-copy-actions,.email-preview-cancel,.email-gmail-web')"));check('Safari staying visible offers existing alternatives with no automatic Gmail web navigation');
    await click('.email-gmail-web');verifyUrl(await lastWeb(),'gmail',sold);assert.ok(await evaluate("document.querySelector('.invoice-email-preview').textContent.includes('No garantiza un mensaje nuevo preparado')"));check('Gmail web opens only by explicit manual action with honest iOS notice');
    await click('.email-open');const mail=new URL(await evaluate('window.__mailUrls.at(-1)'));assert.equal(mail.protocol,'mailto:');assert.equal(mail.searchParams.get('subject'),'Factura '+number+' - Angie Tech');check('iOS fallback system email retains populated mailto');
    await evaluate("window.__gmailMode='throws'");await click('.email-gmail');await waitFor("document.querySelector('[role=alert]')?.textContent.includes('No se pudo abrir')");assert.equal(await evaluate("document.body.innerText.includes('Scheme unavailable')"),false);check('Immediate Gmail scheme rejection stays recoverable without technical diagnostics');
    await click('.email-preview-cancel');await evaluate("window.__gmailMode='ok';Object.defineProperty(navigator,'canShare',{configurable:true,value:d=>d.files[0]?.type==='application/pdf'});Object.defineProperty(navigator,'share',{configurable:true,value:async d=>{window.__shared={type:d.files[0].type,title:d.title,header:new TextDecoder().decode((await d.files[0].arrayBuffer()).slice(0,5))};throw new DOMException('Cancel','AbortError')}})");await click('.email-more-options');await waitFor("!!document.querySelector('.email-share')");await click('.email-share');await waitFor('!!window.__shared');assert.equal(await evaluate('window.__shared.header'),'%PDF-');assert.equal(await evaluate('window.__shared.title'),'Factura '+number+' - Angie Tech');assert.ok(await evaluate("document.querySelector('.email-preview-info').textContent.includes('cancelado')"));check('Fallback shares a real PDF and cancellation preserves post-sale');
    assert.deepEqual(await api('return supabase.demo.snapshot().tables'),before);assert.equal(await evaluate("!!document.querySelector('.fd-auth,[type=password]')"),false);check('iOS attempts and alternatives leave sale, invoice, session and customer unchanged');
    await click('.email-preview-cancel');await manualSelected();await click('.post-sale-footer .fd-finish');await free();await delay(1900);await free();check('New sale cancels pending Gmail observation without stale modals or loading');
  } else {
  await click('.email-change-provider');await waitFor("!!document.querySelector('.email-provider-picker')");count=await evaluate('window.__webCalls.length');await click('.email-provider-choice[data-provider=outlook]');assert.equal(await evaluate('window.__webCalls.length'),count);assert.equal(await evaluate("localStorage.getItem('angie:email-provider')"),'outlook');await manualSelected();verifyUrl(await lastWeb(),'outlook',sold);assert.equal(await noFallback(),true);check('Changing preference does not send; the next email opens Outlook composition directly');
  await leaveReturn();assert.equal(await noFallback(),true);assert.equal(await evaluate("document.querySelector('.seller-sale-complete .fd-num').textContent"),number);assert.equal(await evaluate("!!document.querySelector('.fd-auth,[type=password]')"),false);assert.equal(await evaluate("document.activeElement.matches('input,textarea,select')"),false);check('Returning from web providers preserves invoice, post-sale and clean focus without admin');
  await click('.email-change-provider');await click('.email-provider-choice[data-provider=system]');count=await evaluate('window.__webCalls.length');await manualSelected();assert.equal(await evaluate('window.__webCalls.length'),count);const uri=new URL(await evaluate('window.__mailUrls.at(-1)'));assert.equal(uri.protocol,'mailto:');assert.equal(decodeURIComponent(uri.pathname),sold.clientes.correo);assert.equal(uri.searchParams.get('subject'),'Factura '+number+' - Angie Tech');assert.ok(uri.searchParams.get('body').includes(number));assert.equal(await noFallback(),true);check('System preference dispatches filled mailto without creating a blank tab');
  await evaluate("window.__mailMode='no-account'");await manualSelected();await leaveReturn();assert.equal(await noFallback(),true);assert.ok(await evaluate("!!document.querySelector('.email-more-options')"));assert.equal(await evaluate("document.querySelector('.seller-sale-complete .fd-num').textContent"),number);check('Mail with no account or silent cancellation leaves the sale and More options usable');
  await evaluate("window.__mailMode='throws'");await manualSelected();await waitFor("!!document.querySelector('.invoice-email-preview')");assert.ok(await evaluate("document.querySelector('.invoice-email-preview [role=alert]').textContent.includes('No se pudo abrir')"));assert.equal(await evaluate("document.body.innerText.includes('OS diagnostic')"),false);check('Rejected system handoff opens the retained fallback with a safe message');
  await click('.email-preview-cancel');await click('.email-change-provider');await click('.email-provider-choice[data-provider=gmail]');await evaluate("window.__webMode='blocked'");await manualSelected();await waitFor("!!document.querySelector('.invoice-email-preview')");assert.ok(await evaluate("!!document.querySelector('.email-gmail,.email-outlook,.email-open')"));assert.equal(await evaluate("!!document.querySelector('.email-provider-picker')"),false);check('Blocked web composer opens fallback instead of another prompt or a loading state');
  await evaluate("window.__webMode='ok'");await click('.email-outlook');verifyUrl(await lastWeb(),'outlook',sold);assert.equal(await evaluate("localStorage.getItem('angie:email-provider')"),'gmail');assert.equal(await evaluate("!!document.querySelector('.invoice-email-preview')"),true);check('Fallback can open another populated provider without silently changing the preference');
  for(const [label,selector]of [['correo','.email-copy-actions button:nth-child(1)'],['asunto','.email-copy-actions button:nth-child(2)'],['mensaje','.email-copy-actions button:nth-child(3)']]){await click(selector);assert.ok(await evaluate('window.__copied?.length>0'));check('Fallback copies '+label+' with no external request')}
  await click('.email-download');let file;for(let i=0;i<60&&!file;i++){file=readdirSync(downloads).find(f=>f.endsWith('.pdf'));if(!file)await delay(150)}assert.ok(file);const bytes=readFileSync(join(downloads,file));assert.ok(bytes.toString('latin1').startsWith('%PDF-'));assert.ok(bytes.toString('latin1').includes(number));check('Fallback downloads the unchanged real invoice PDF');await click('.email-preview-cancel');assert.equal(await noFallback(),true);check('Cancel restores the direct post-sale surface');
  await click('.email-more-options');await waitFor("!!document.querySelector('.invoice-email-preview')");assert.equal(await evaluate("document.querySelectorAll('.email-secondary-actions button').length"),4);await click('.email-preview-cancel');check('More options explicitly opens all provider and manual alternatives');
  const after=await api('return supabase.demo.snapshot().tables');for(const table of ['facturas','factura_items','movimientos','productos','clientes','factura_envios','perfiles'])assert.deepEqual(after[table],before[table]);check('Composer flows preserve sales, stock, customers, session records and invoice sends');
  await send('Page.navigate',{url:base+'/facturas?factura='+sold.id});await waitFor("!!document.querySelector('.invoice-detail-sheet .fd-act.mail')");await configure();await manualSelected();assert.equal(await noFallback(),true);verifyUrl(await lastWeb(),'gmail',sold);check('Preference survives reload/navigation and existing invoice opens composer directly');
  await send('Network.setUserAgentOverride',{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',platform:'iPhone'});await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await evaluate("window.__shareMode='ok';window.__shareCalls=0;Object.defineProperty(navigator,'canShare',{configurable:true,value:d=>d.files[0]?.type==='application/pdf'});Object.defineProperty(navigator,'share',{configurable:true,value:async d=>{window.__shareCalls++;window.__shared={type:d.files[0].type,name:d.files[0].name,title:d.title,text:d.text,activation:navigator.userActivation.isActive,header:new TextDecoder().decode((await d.files[0].arrayBuffer()).slice(0,5))};if(window.__shareMode==='cancel')throw new DOMException('Cancel','AbortError');if(window.__shareMode==='error')throw Error('Native diagnostic');if(window.__shareMode==='pending')return new Promise(resolve=>{window.__finishShare=resolve})}})");await click('.email-more-options');await click('.email-preview-cancel');await waitFor("!!document.querySelector('.fd-act.share')");count=await evaluate('window.__webCalls.length');await click('.fd-act.share');await waitFor('!!window.__shared');assert.equal(await evaluate('window.__webCalls.length'),count);assert.equal(await noFallback(),true);const shared=await evaluate('window.__shared');assert.equal(shared.type,'application/pdf');assert.equal(shared.header,'%PDF-');assert.equal(shared.activation,true);assert.equal(shared.title,'Factura '+number+' - Angie Tech');check('Share invoice independently shares real PDF/title/text without opening email or preference panel');
  await evaluate("window.__shareMode='cancel'");await click('.fd-act.share');await waitFor("document.querySelector('.invoice-delivery [role=status]')?.textContent.includes('Compartir cancelado')");assert.equal(await noFallback(),true);check('Canceling native share leaves direct invoice surface available');
  await evaluate("window.__shareMode='pending';window.__finishShare=null");await click('.fd-act.share');await waitFor("typeof window.__finishShare==='function'");await evaluate('window.__oldShare=window.__finishShare');await leaveReturn();await waitFor("!document.querySelector('.fd-act.share').disabled");await evaluate("window.__shareMode='cancel'");await click('.fd-act.share');await waitFor("document.querySelector('.invoice-delivery [role=status]')?.textContent.includes('Compartir cancelado')");await evaluate('window.__oldShare()');await delay(100);assert.ok(await evaluate("document.querySelector('.invoice-delivery [role=status]').textContent.includes('Compartir cancelado')"));check('Returning releases pending share and ignores late responses without losing invoice');
  await evaluate("window.__shareMode='error'");await click('.fd-act.share');await waitFor("!!document.querySelector('.invoice-email-preview')");assert.equal(await evaluate("document.body.innerText.includes('Native diagnostic')"),false);await click('.email-preview-cancel');check('Unsupported/failed native flow uses fallback without technical errors');
  for(const theme of ['dark','light'])for(const[w,h]of [[320,700],[360,800],[390,844],[430,932],[844,390],[932,430],[1280,800]]){await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:w<1000});await evaluate('import("/src/lib/theme.js").then(m=>m.setTheme('+JSON.stringify(theme)+'))');await evaluate("document.querySelector('.invoice-detail-sheet .sheet-body').scrollTop=0");await delay(100);const g=await evaluate("(()=>{const s=document.querySelector('.invoice-detail-sheet'),b=s.querySelector('.sheet-body'),r=s.getBoundingClientRect();return{top:r.top,bottom:r.bottom,scroll:getComputedStyle(b).overflowY,dialogs:document.querySelectorAll('[data-app-dialog]').length,overflow:[...s.querySelectorAll('*')].filter(e=>e.tagName!=='INPUT'&&!e.closest('svg')&&getComputedStyle(e).textOverflow!=='ellipsis'&&e.getBoundingClientRect().width&&e.scrollWidth>e.clientWidth+2).map(e=>({tag:e.tagName,cls:e.className,parent:e.parentElement.className,text:e.textContent.slice(0,50),scroll:e.scrollWidth,width:e.clientWidth})),targets:[...s.querySelectorAll('.fd-act,.email-quick-link')].map(e=>e.getBoundingClientRect().height)}})()");assert.ok(g.top>=0&&g.bottom<=h+1);assert.equal(g.scroll,'auto');assert.equal(g.dialogs,1);if(g.overflow.length){await screenshot('overflow-'+theme+'-'+w);await writeFile(join(artifacts,'overflow.json'),JSON.stringify(g,null,2))}assert.deepEqual(g.overflow,[]);assert.ok(g.targets.every(n=>n>=44));await screenshot('direct-'+theme+'-'+w);check('Direct delivery dark/light single-scroll layout '+theme+' '+w)}
  await click('.invoice-detail-sheet .sheet-x');await free();
  const missing=await api("const r=await supabase.from('clientes').insert({nombre:'Cliente correo temporal',documento:'COMPOSE-NO-EMAIL',tipo_documento:'CC',correo:null,telefono:'3001234567'}).select('*').single();if(r.error)throw Error(r.error.message);return r.data");await sale(missing.nombre);count=await evaluate('window.__webCalls.length');await manualSelected();await waitFor("!!document.querySelector('.invoice-email-preview')");assert.equal(await evaluate('window.__webCalls.length'),count);assert.equal(await evaluate('window.__mailUrls.length'),0);assert.ok(await evaluate("document.querySelector('.invoice-email-preview [role=alert]').textContent.includes('no tiene un correo registrado')"));check('Actual customer without email opens fallback and never an empty composer');
  await field('#invoice-email-recipient','temporal+venta@example.test');await click('.email-gmail');const temporary=new URL(await evaluate('window.__gmailUrls.at(-1).url'));await leaveReturn();assert.equal(temporary.searchParams.get('to'),'temporal+venta@example.test');const persisted=await api('return (await supabase.from("clientes").select("*").eq("id",'+missing.id+').single()).data');assert.equal(persisted.correo,null);check('Temporary recipient fills composer without modifying customer');
  await click('.email-preview-cancel');await click('.seller-sale-complete .sheet-x');await free();await sale();await manualSelected();assert.equal(await noFallback(),true);await click('.post-sale-footer .fd-finish');await free();check('Close, return and New sale remain available after direct composers');
  }
  assert.ok(await evaluate('window.__webCalls.every(c=>c.args[0]&&c.args[0]!=="about:blank")'));assert.deepEqual(externalRequests,[]);assert.deepEqual(browserErrors,[]);await writeFile(join(artifacts,'results.json'),JSON.stringify({status:'PASS',cases:results.length,results,externalRequests,browserErrors,remoteCalls:0,physicalProviderSignInPending:true,physicalSafariPending:true},null,2));console.log(JSON.stringify({status:'PASS',cases:results.length,artifacts}));await send('Browser.close').catch(()=>{});
} catch(error){await writeFile(join(artifacts,'results.json'),JSON.stringify({status:'FAIL',error:error.stack,results,externalRequests,browserErrors},null,2));console.error(error.stack);process.exitCode=1}
finally{socket?.close();browser.kill();await delay(300);if(!profile.startsWith(join(tmpdir(),'angie-tech-ui-')))throw Error('Unexpected profile');await rm(profile,{recursive:true,force:true,maxRetries:20,retryDelay:250}).catch(error=>{console.error('Profile cleanup failed',error.message);process.exitCode=1})}
