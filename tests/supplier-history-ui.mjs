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
const artifacts = join(root, 'artifacts', process.env.UI_ARTIFACTS || 'supplier-history-ui')
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
let socket; let simulateMissing=false
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
          const fixture="export {supabase,isDemoMode,isInvoiceEmailEnabled,supabaseConfigurationError,conAutorizacionAdmin} from '/tests/fixtures/finance-schema.js?demo="+(simulateMissing?'0':'1')+"'";
          await send('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/javascript'}],body:Buffer.from(fixture+(simulateMissing?"\nimport {supabase as cashMock} from '/tests/fixtures/finance-schema.js?demo=0';const baseRpc=cashMock.rpc.bind(cashMock);cashMock.rpc=(name,args)=>name.startsWith('caja_')?Promise.resolve({data:null,error:{code:'PGRST202',message:'Could not find function'}}):baseRpc(name,args);":'')).toString('base64')});
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

  // ---- Proveedores → historial de mercancía → detalle de compra (táctil, iPhone/iPad) ----
  const tables=()=>api("return supabase.demo.snapshot().tables");
  const ledger=async()=>{const t=await tables();return JSON.stringify(['compras','compra_items','pagos_proveedor','movimientos','movimientos_inventario','unidades_serializadas','productos'].map(k=>t[k]))};
  const detail=()=>evaluate("document.querySelector('.cd-sheet')?.innerText||''");
  const closeDetail=async()=>{await tap('.cd-sheet .sheet-x');await waitFor("!document.querySelector('.cd-sheet')&&!!document.querySelector('.pv-sheet')")};
  await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  await login('admin@angietech.demo','.ah-duo');await metrics(390);
  // Compra a crédito con IMEI y abono parcial, como «Claro SAS» del reporte.
  const credit=await api("const r=await supabase.rpc('registrar_compra',{p_proveedor_id:1,p_numero_documento:'CLARO-0001',p_forma_pago:'credito',p_vence_el:'2026-12-31',p_metodo_pago:'transferencia',p_items:[{producto_id:1,cantidad:2,costo_unitario:5000000}],p_seriales:[{producto_id:1,serial:'356938035643809'},{producto_id:1,serial:'490154203237518'}],p_request_id:'ui-credit-1'});if(r.error)throw Error(r.error.message);const p=await supabase.rpc('registrar_pago_proveedor',{p_compra_id:r.data,p_monto:1000000,p_metodo_pago:'transferencia'});if(p.error)throw Error(p.error.message);return r.data");
  const provider=await api("return (await supabase.from('proveedores').select('nombre').eq('id',1).single()).data.nombre");
  await navigate('/proveedores');await waitFor("!!document.querySelector('.pv-card')");
  await evaluate("[...document.querySelectorAll('.pv-card')].find(e=>e.textContent.includes("+JSON.stringify(provider)+")).setAttribute('data-ui','prov')");await tap('[data-ui=prov]');
  await waitFor("document.querySelectorAll('.sh-buy').length>=2");
  // Filtros: período y producto; luego desplazamiento dentro de la ficha.
  await evaluate("[...document.querySelectorAll('.sh-chips button')].find(e=>e.textContent==='12 meses').click()");await waitFor("[...document.querySelectorAll('.sh-chips button.on')].some(e=>e.textContent==='12 meses')&&!!document.querySelector('.sh-buy')");
  await evaluate("(()=>{const s=document.querySelector('.sh-filter select');s.value='1';s.dispatchEvent(new Event('change',{bubbles:true}))})()");await waitFor("[...document.querySelectorAll('.sh-buy')].every(e=>e.textContent.includes('iPhone 15 Pro'))&&[...document.querySelectorAll('.sh-buy')].some(e=>e.textContent.includes('CLARO-0001'))&&!document.querySelector('.sh-lines li:not(:has(b))')");await evaluate("[...document.querySelectorAll('.sh-buy')].find(e=>e.textContent.includes('CLARO-0001')).setAttribute('data-ui','target')");
  const before=await ledger();
  await evaluate("document.querySelector('[data-ui=target] .sh-lines li').scrollIntoView({block:'center'})");await delay(250);
  const scroll=await evaluate("document.querySelector('.pv-sheet .sheet-body').scrollTop");assert.ok(scroll>0,'the supplier sheet is scrolled to the history');await screenshot('history-card-390');
  // Toque sobre el producto (zona central de la tarjeta), no solo la cabecera.
  await tap('[data-ui=target] .sh-lines li');await waitFor("!!document.querySelector('.cd-sheet')&&document.querySelector('.cd-sheet').innerText.includes('CLARO-0001')");
  await screenshot('purchase-detail-390');let text=await detail();
  for(const expected of [provider,'CLARO-0001','iPhone 15 Pro 128GB','2 unidades','$5.000.000','$10.000.000','356938035643809','490154203237518','Transferencia','A crédito','Debe $9.000.000','registró Valentina Gómez'])assert.ok(text.includes(expected),'detail shows '+expected);
  check('Tapping the product area of a purchase card opens CompraDetalle with provider, reference, lines, IMEI, payment and responsible');
  await closeDetail();
  assert.ok(await evaluate("[...document.querySelectorAll('.sh-chips button.on')].some(e=>e.textContent==='12 meses')&&document.querySelector('.sh-filter select').value==='1'"),'filters preserved');
  const after=await evaluate("document.querySelector('.pv-sheet .sheet-body').scrollTop");assert.ok(Math.abs(after-scroll)<=2,'scroll preserved '+scroll+' → '+after);
  check('Closing returns to the same supplier with filters and scroll intact');
  // Varias compras seguidas: quitar filtro de producto, abrir pagada y luego la de crédito.
  await evaluate("(()=>{const s=document.querySelector('.sh-filter select');s.value='';s.dispatchEvent(new Event('change',{bubbles:true}))})()");await waitFor("document.querySelectorAll('.sh-buy').length>=2");
  await evaluate("[...document.querySelectorAll('.sh-buy')].find(e=>!e.textContent.includes('CLARO-0001')).setAttribute('data-ui','paid')");await tap('[data-ui=paid] .sh-buy-head');
  await waitFor("!!document.querySelector('.cd-sheet .fd-hero')");text=await detail();assert.ok(text.includes('Pagada')||text.includes('Debe'),'paid/credit state shown');assert.ok(!text.includes('CLARO-0001'));await closeDetail();
  await evaluate("[...document.querySelectorAll('.sh-buy')].find(e=>e.textContent.includes('CLARO-0001')).setAttribute('data-ui','credit')");await tap('[data-ui=credit] .sh-meta');
  await waitFor("!!document.querySelector('.cd-sheet')&&document.querySelector('.cd-sheet').innerText.includes('CLARO-0001')");await closeDetail();
  await tap('[data-ui=credit] .sh-open');await waitFor("!!document.querySelector('.cd-sheet')&&document.querySelector('.cd-sheet').innerText.includes('CLARO-0001')");await closeDetail();
  check('Several purchases (paid and credit) open consecutively');
  // «Pagar» sigue siendo una acción propia y no abre el detalle.
  await tap('[data-ui=credit] .pv-pay');await waitFor("!!document.querySelector('.pv-paybox')");assert.equal(await evaluate("!!document.querySelector('.cd-sheet')"),false);await tap('.sheet:last-of-type .sheet-x');await waitFor("!document.querySelector('.pv-paybox')");
  // Teclado: Enter sobre la tarjeta enfocada.
  await evaluate("document.querySelector('[data-ui=credit]').focus()");await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await waitFor("!!document.querySelector('.cd-sheet')");await closeDetail();
  assert.equal(await ledger(),before,'viewing purchases never changes stock, payments or accounting');check('Consulting purchases does not alter inventory or financial records');
  for(const [w,h] of [[390,844],[820,1180]]){await metrics(w,h);await geometry('Supplier history '+w,w,h,false)}
  // Enlace directo existente (actividad/Finanzas): /proveedores?compra=ID abre la misma compra.
  await metrics(390);await send('Page.navigate',{url:base+'/proveedores?compra='+credit});await waitFor("!!document.querySelector('.cd-sheet')&&document.querySelector('.cd-sheet').innerText.includes('CLARO-0001')");await closeDetail();
  check('Direct purchase links keep opening CompraDetalle');
  assert.deepEqual(externalRequests,[]);assert.deepEqual(browserErrors,[]);console.log(JSON.stringify({status:'PASS',checks:results.length}));await writeFile(join(artifacts,'results.json'),JSON.stringify({status:'PASS',cases:results.length,results,remoteCalls:0,physicalSafariPending:true},null,2));
} catch(error){await writeFile(join(artifacts,'results.json'),JSON.stringify({status:'FAIL',error:error.stack,results},null,2));throw error} finally{socket?.close();browser.kill();await delay(500);await rm(profile,{recursive:true,force:true,maxRetries:4,retryDelay:500})}
