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
const artifacts = join(root, 'artifacts', process.env.UI_ARTIFACTS || 'post-sale')
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
        if (process.env.POST_SALE_REAL_FIXTURE === '1' && url.pathname === '/src/lib/supabase.js') {
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




  await send('Page.enable');await send('Runtime.enable');await send('Log.enable');await send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  const downloads=join(artifacts,'downloads-'+Date.now());await mkdir(downloads,{recursive:true});await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads})
  const check=name=>{results.push({name,status:'PASS'});console.log('PASS '+name)}
  const field=async(selector,value)=>{await evaluate('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,'+JSON.stringify(value)+');e.dispatchEvent(new Event("input",{bubbles:true}))})()');await delay(50)}
  const byLabel=label=>'document.getElementById([...document.querySelectorAll(".sheet label")].find(l=>l.textContent.trim()==='+JSON.stringify(label)+').htmlFor)'
  const labeled=async(label,value)=>{await evaluate('(()=>{const e='+byLabel(label)+';Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,'+JSON.stringify(value)+');e.dispatchEvent(new Event("input",{bubbles:true}))})()');await delay(50)}
  const clickText=async text=>{await evaluate('(()=>{const b=[...document.querySelectorAll(".sheet button")].find(b=>b.textContent.trim()==='+JSON.stringify(text)+');if(!b)throw Error("Missing button "+'+JSON.stringify(text)+');b.click()})()');await delay(100)}
  const noAdmin=async name=>{assert.equal(await evaluate("!!document.querySelector('.fd-auth,[type=password]')"),false,name);assert.equal(await evaluate("(window.__sensitiveRequests||[]).length"),0,name);check(name)}
  const free=async()=>{await waitFor("!document.querySelector('[data-app-dialog]')");assert.equal(await evaluate("document.getElementById('root').inert"),false);assert.equal(await evaluate("document.activeElement.matches('input,textarea,select')"),false)}
  await send('Page.navigate',{url:base+'/login'});await waitFor("!!document.getElementById('login-email')");await field('#login-email','ana@angietech.demo');await field('#login-password','AngieDemo123!');await tap('.login-form .btn');await waitFor("!!document.querySelector('.seller-total')")
  await evaluate("import('/src/lib/supabase.js').then(m=>{window.__sensitiveRequests=[];const original=m.supabase.rpc.bind(m.supabase);m.supabase.rpc=(name,...args)=>{if(name==='anular_factura')window.__sensitiveRequests.push(name);return original(name,...args)};const login=m.supabase.auth.signInWithPassword.bind(m.supabase.auth);m.supabase.auth.signInWithPassword=(...args)=>{window.__sensitiveRequests.push('auth');return login(...args)}})")
  const product=await evaluate("import('/src/lib/supabase.js').then(async m=>(await m.supabase.from('productos_venta').select('*')).data.find(p=>!p.maneja_serial&&p.stock>=12))")
  const sale=async()=>{
    await send('Page.navigate',{url:base+'/vender?q='+encodeURIComponent(product.codigo)});await waitFor("!!document.querySelector('.pos-tile .pos-add')");await evaluate("import('/src/lib/supabase.js').then(m=>{if(window.__postSaleInstrumented)return;window.__postSaleInstrumented=true;window.__sensitiveRequests=[];const original=m.supabase.rpc.bind(m.supabase);m.supabase.rpc=(name,...args)=>{if(name==='anular_factura')window.__sensitiveRequests.push(name);return original(name,...args)};const login=m.supabase.auth.signInWithPassword.bind(m.supabase.auth);m.supabase.auth.signInWithPassword=(...args)=>{window.__sensitiveRequests.push('auth');return login(...args)}})");await tap('.pos-tile .pos-add');await waitFor("!!document.querySelector('.pos-bar')");await tap('.pos-bar');await waitFor("!!document.querySelector('.pos-who2')");await tap('.pos-who2 button');await waitFor("!!document.querySelector('.client-picker-sheet .row')");await tap('.client-picker-sheet .row');await waitFor("!document.querySelector('.client-picker-sheet')");await tap('.checkout-sheet .pos-pay2');await waitFor("!!document.querySelector('.seller-sale-complete .fd-num')");await noAdmin('Sale success is read-only sharing surface');assert.equal(await evaluate("!!document.querySelector('.seller-sale-complete .fd-after')"),false)
  }
  await sale();await tap('.seller-sale-complete .sheet-x');await free();check('X closes successful sale before any optional delivery')
  await sale();await tap('.fd-act.wa');await waitFor("!!document.querySelector('.invoice-message-preview')");await noAdmin('WhatsApp preparation never requests administrator');assert.ok(await evaluate("document.querySelector('.delivery-attachment').textContent.includes('manualmente')"));check('WhatsApp preview uses customer number and explains PDF attachment')
  await evaluate("window.open=(...args)=>{window.__outbound=args;return{opener:window}}")
  await clickText('Abrir WhatsApp');assert.ok((await evaluate('window.__outbound[0]')).startsWith('https://wa.me/57'));await noAdmin('Opening WhatsApp does not request auth or cancel invoice')
  await clickText('Cerrar vista previa');assert.ok(await evaluate("!!document.querySelector('.seller-sale-complete')"));check('Cancel/return from WhatsApp preserves sale success')
  await tap('.fd-act.mail');await waitFor("!!document.querySelector('.invoice-email-send')");assert.equal(await evaluate("!!document.querySelector('.email-provider-picker')"),false);assert.equal(await evaluate("document.querySelector('.email-confirm-send').disabled"),true);if(process.env.POST_SALE_REAL_FIXTURE!=='1')assert.ok(await evaluate("document.querySelector('.invoice-email-send').textContent.includes('Modo demo local')"));await noAdmin('Transactional email confirmation needs no admin and demo cannot send');await tap('.email-more-options');await waitFor("!!document.querySelector('.invoice-email-preview')");assert.ok(await evaluate("!!document.querySelector('.email-copy-actions')&&!!document.querySelector('.email-download')"));await tap('.email-preview-cancel')
  await tap('.fd-act.pdf');await waitFor("!!document.querySelector('[data-print-invoice]')");await noAdmin('PDF preview requires no administrator')
  await clickText('Guardar PDF');const deadline=Date.now()+10000;let downloaded;while(Date.now()<deadline){downloaded=readdirSync(downloads).find(f=>f.endsWith('.pdf'));if(downloaded)break;await delay(150)}assert.ok(downloaded,'PDF download');assert.ok(readFileSync(join(downloads,downloaded)).toString('latin1').startsWith('%PDF-'));check('Real PDF download succeeds')
  await clickText('Cerrar vista previa');await evaluate("Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.__sharedFiles=data.files.map(f=>({name:f.name,type:f.type}));throw new DOMException('Cancelado','AbortError')}})");await tap('.fd-act.pdf');await waitFor("[...document.querySelectorAll('.invoice-pdf-actions button')].some(b=>b.textContent==='Compartir PDF')");await clickText('Compartir PDF');assert.equal((await evaluate('window.__sharedFiles[0].type')),'application/pdf');await noAdmin('Cancelling native PDF share leaves seller in control');await clickText('Cerrar vista previa')
  await clickText('Abrir factura');await waitFor("!!document.querySelector('.invoice-detail-sheet .fd-num')");await noAdmin('Opening own invoice does not request admin');await tap('.fd-after .bad');await waitFor("!!document.querySelector('.fd-auth')");assert.ok(await evaluate("document.querySelector('.fd-auth').innerText.includes('Autorización del administrador')"));check('Only explicit Anular factura opens administrator authorization')
  await labeled('Motivo de la anulación','Solicitud de prueba local');await clickText('Confirmar anulación');assert.ok(await evaluate("document.querySelector('[role=alert]').textContent.includes('administrador')"));assert.equal(await evaluate('window.__sensitiveRequests.length'),0);check('Missing administrator credentials do not execute cancellation')
  await labeled('Correo del administrador','admin@example.test');await labeled('Contraseña del administrador','NoEnviar123!');await clickText('Cancelar');await noAdmin('Cancelling annulment clears sensitive form and returns to sharing')
  await tap('.fd-act.wa');await waitFor("!!document.querySelector('.invoice-message-preview')");await noAdmin('WhatsApp after cancelling annulment cannot reopen admin form');await clickText('Cerrar vista previa');await tap('.invoice-detail-sheet .sheet-x');await waitFor("!!document.querySelector('.seller-sale-complete')");await noAdmin('Back from invoice returns to success with clean state')
  await tap('.fd-act.wa');await waitFor("!!document.querySelector('.invoice-message-preview')");await evaluate('window.open=()=>null');await clickText('Abrir WhatsApp');assert.ok(await evaluate("document.querySelector('.invoice-delivery [role=alert]').textContent.includes('no abrió')"));await noAdmin('Blocked WhatsApp opening is recoverable without authorization');await clickText('Cerrar vista previa')
  await tap('.fd-link');await waitFor("!!document.querySelector('.fd-contact')");await labeled('WhatsApp del cliente','');await tap('.fd-act.wa');assert.ok(await evaluate("document.querySelector('.invoice-delivery [role=alert]').textContent.includes('cliente no tiene un número de WhatsApp')"));await noAdmin('Missing phone shows ordinary validation and leaves exit available')
  await labeled('Correo del cliente','');await tap('.fd-act.mail');await waitFor("!!document.querySelector('.invoice-email-preview')");assert.ok(await evaluate("document.querySelector('.email-preview-recipient').textContent.includes('Sin correo registrado')"));await noAdmin('Missing email still offers PDF and message without an administrator');await tap('.email-preview-cancel');await tap('.fd-link');await waitFor("!!document.querySelector('.fd-contact')")
  await labeled('WhatsApp del cliente','3001234567');await labeled('Correo del cliente','correo-invalido');await evaluate(byLabel('Correo del cliente')+'.focus()');await tap('.fd-act.wa');await waitFor("!!document.querySelector('.invoice-message-preview')");assert.equal(await evaluate("document.activeElement.matches('input,textarea,select')"),false);await noAdmin('Sharing blurs optional contact field instead of keeping keyboard open');await clickText('Cerrar vista previa')
  if(process.env.POST_SALE_REAL_FIXTURE==='1'){
    assert.ok(await evaluate('(window.__uploadCalls||0)>0'));check('Real-mode PDF link failure falls back to manual attachment')
    await labeled('Correo del cliente','cliente@example.test');await evaluate("window.__UPLOAD_MODE__='success'");const uploadsBefore=await evaluate('window.__uploadCalls||0');await tap('.fd-act.mail');await waitFor("!!document.querySelector('.invoice-email-preview')");assert.equal(await evaluate('window.__uploadCalls||0'),uploadsBefore);assert.ok(await evaluate("document.querySelector('.email-preview-attachment').textContent.includes('manualmente')"));await noAdmin('Email preparation needs no storage upload or administrative auth');await tap('.email-preview-cancel');await tap('.fd-link');await waitFor("!!document.querySelector('.fd-contact')");await labeled('Correo del cliente','correo-invalido')
  }else{
    for(const theme of ['dark','light'])for(const[width,height]of [[320,700],[360,800],[390,844],[430,932]]){
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await evaluate('import("/src/lib/theme.js").then(m=>m.setTheme('+JSON.stringify(theme)+'))');await evaluate("document.querySelector('.seller-sale-complete .sheet-body').scrollTop=0");await evaluate('document.fonts.ready.then(()=>true)')
      const g=await evaluate("(()=>{const s=document.querySelector('.seller-sale-complete'),r=s.getBoundingClientRect(),b=s.querySelector('.sheet-body'),br=b.getBoundingClientRect(),f=s.querySelector('.sheet-foot'),fr=f.getBoundingClientRect();return{top:r.top,bottom:r.bottom,bodyBottom:br.bottom,footerTop:fr.top,footerBottom:fr.bottom,background:getComputedStyle(f).backgroundColor,scroll:getComputedStyle(b).overflowY,overflow:[...s.querySelectorAll('*')].filter(e=>!e.closest('svg')&&e.getBoundingClientRect().width&&e.scrollWidth>e.clientWidth+2).map(e=>e.className),targets:[...s.querySelectorAll('.sheet-x,.post-sale-footer button,.fd-act,.post-sale-view')].map(e=>e.getBoundingClientRect().height),dialogs:document.querySelectorAll('[data-app-dialog]').length}})()")
      assert.ok(g.top>=0&&g.bottom<=height+1&&g.bodyBottom<=g.footerTop+1&&g.footerBottom<=height+1);assert.equal(g.scroll,'auto');assert.equal(g.dialogs,1);assert.deepEqual(g.overflow,[]);assert.ok(g.targets.every(h=>h>=44));assert.notEqual(g.background,'rgba(0, 0, 0, 0)');await screenshot(theme+'-'+width+'-post-sale');check('Post-sale layout/one scroll/protected footer '+theme+' '+width)
    }
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await evaluate("Object.defineProperty(visualViewport,'height',{configurable:true,value:450});Object.defineProperty(visualViewport,'offsetTop',{configurable:true,value:12});visualViewport.dispatchEvent(new Event('resize'))");await delay(200)
    const k=await evaluate("(()=>{const r=document.querySelector('.seller-sale-complete').getBoundingClientRect();return{top:r.top,bottom:r.bottom}})()");assert.equal(k.top,12);assert.equal(k.bottom,462);await noAdmin('Reduced keyboard viewport does not expose administrative form');await screenshot('390-keyboard-post-sale');await evaluate("delete visualViewport.height;delete visualViewport.offsetTop;visualViewport.dispatchEvent(new Event('resize'))");await delay(200)
  }
  await clickText('Nueva venta');await free();check('New sale closes success even with invalid optional email')
  await sale();await tap('.fd-act.wa');await waitFor("!!document.querySelector('.invoice-message-preview')");await evaluate("window.open=()=>{throw Error('Aplicación no disponible')}");await clickText('Abrir WhatsApp');assert.ok(await evaluate("document.querySelector('.invoice-delivery [role=alert]').textContent.includes('Aplicación no disponible')"));await clickText('Cerrar');await free();check('Opening failure never blocks Close')
  await sale();
  if(process.env.POST_SALE_REAL_FIXTURE==='1'){
    await evaluate("window.__UPLOAD_MODE__='hang'");await tap('.fd-act.wa');assert.ok(await evaluate("document.querySelector('.fd-act.wa').textContent.includes('Preparando')"));await clickText('Nueva venta');await free();check('Hanging PDF preparation cannot block new sale')
  }else{await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await free();check('Escape/back closes post-sale without sending')}
  await sale();await send('Page.navigate',{url:base+'/'});await waitFor("!!document.querySelector('.seller-total')");assert.equal(await evaluate("!!document.querySelector('[data-app-dialog]') || document.getElementById('root').inert"),false);assert.equal(await evaluate('window.__sensitiveRequests?.length||0'),0);check('Navigation leaves no blocking dialogs or administrator requests')

  await evaluate("import('/src/lib/supabase.js').then(m=>m.supabase.auth.signOut())");await waitFor("location.pathname==='/login'");await field('#login-email','admin@angietech.demo');await field('#login-password','AngieDemo123!');await tap('.login-form .btn');await waitFor("!!document.querySelector('.ah-sales')")
  await sale();await clickText('Abrir factura');await waitFor("!!document.querySelector('.fd-after .bad')");await tap('.fd-after .bad');assert.equal(await evaluate("!!document.querySelector('.fd-auth')"),false);await labeled('Motivo de la anulación','Regresión administrativa local');await clickText('Confirmar anulación');await waitFor("document.querySelector('.invoice-detail-sheet .fd-state')?.textContent==='Anulada'");check('Administrator retains explicit cancellation without credential prompt')
  await tap('.invoice-detail-sheet .sheet-x');await waitFor("!!document.querySelector('.seller-sale-complete')");assert.equal(await evaluate("document.querySelector('.seller-sale-complete .fd-state').textContent"),'Anulada');assert.equal(await evaluate("!!document.querySelector('.fd-act.wa,.fd-act.mail')"),false);assert.ok(await evaluate("!!document.querySelector('.fd-act.pdf')"));await clickText('Nueva venta');await free();check('Returning from cancelled invoice preserves status and document access')
  assert.deepEqual(externalRequests,[]);assert.deepEqual(browserErrors,[]);await writeFile(join(artifacts,'results.json'),JSON.stringify({status:'PASS',cases:results.length,results,remoteCalls:0,physicalSafariPending:true},null,2));console.log(JSON.stringify({status:'PASS',cases:results.length,artifacts}));await send('Browser.close').catch(()=>{})
} catch (error) {
  await writeFile(join(artifacts,'results.json'),JSON.stringify({status:'FAIL',error:error.stack,results,externalRequests,browserErrors},null,2)+'\n')
  console.error(error.stack)
  process.exitCode = 1
} finally {
  socket?.close(); browser.kill()
  // This path comes from mkdtemp under the OS temporary directory, never the workspace.
  if (!profile.startsWith(join(tmpdir(),'angie-tech-ui-'))) throw new Error('Unexpected test profile path')
  await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{})
}
