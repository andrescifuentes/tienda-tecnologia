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
const artifacts = join(root, 'artifacts', process.env.UI_ARTIFACTS || 'finance-document-links')
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
          const fixture="export {supabase,isDemoMode,isInvoiceEmailEnabled,supabaseConfigurationError,conAutorizacionAdmin} from '/tests/fixtures/finance-schema.js?demo="+(process.env.UI_FINANCE_DEMO==='1'?'1':'0')+"'";
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



  await login('admin@angietech.demo','.ah-duo');await metrics(390);await send('Network.setUserAgentOverride',{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1',platform:'iPhone'});
  await evaluate("import('/src/lib/demo/writeCoordinator.js').then(m=>m.coordinateDemoWrite((raw,save)=>{const state=JSON.parse(raw),t=state.tables,model=t.facturas[0],line=t.factura_items[0];t.facturas=Array.from({length:30},(_,i)=>({...model,id:i+1,prefijo:'FV',numero:i+1,vendedor_id:'demo-ana',fecha:'2026-10-15T15:00:00Z',estado:i<7?'anulada':'emitida',total:i===29?11993000:4000000,subtotal:i===29?11993000:4000000,descuento:0,costo_total:1000}));t.factura_items=t.facturas.map(f=>({...line,id:f.id,factura_id:f.id,cantidad:1,precio_unitario:f.total,descuento:0,costo_unitario:1000}));t.devoluciones=[{id:1,factura_id:30,total_devuelto:13000,comision_revertida:0,reintegra_stock:false,fecha:'2026-10-15T15:00:00Z',devolucion_items:[]}];t.devolucion_items=[];t.movimientos=[{id:1,fecha:'2026-10-15',tipo:'gasto',categoria:'Servicio',monto:12500}];t.compras=[{id:1,proveedor_id:t.proveedores[0].id,fecha:'2026-10-15',creado_en:'2026-10-15T15:00:00Z',estado:'recibida',forma_pago:'contado',total:20000000}];const data=JSON.stringify(state);save(data);localStorage.setItem('angie-tech:demo:v1',data)}))");
  await evaluate("import('/src/lib/demo/writeCoordinator.js').then(m=>m.coordinateDemoWrite((raw,save)=>{const s=JSON.parse(raw),t=s.tables,customer={...t.clientes[0],id:601,nombre:'Luisa',correo:'luisa@example.test'};t.clientes.push(customer);const f=t.facturas.find(f=>f.numero===30);f.cliente_id=601;f.cliente_snapshot={...customer};t.proveedores.find(p=>p.id===t.compras[0].proveedor_id).nombre='Claro SAS';t.compras[0]={...t.compras[0],forma_pago:'credito',numero_documento:'COMPRA-CLARO',vence_el:'2026-11-15'};t.compra_items=[{id:1,compra_id:1,producto_id:t.productos[0].id,cantidad:2,costo_unitario:10000000}];t.pagos_proveedor=[{id:1,compra_id:1,fecha:'2026-10-16',monto:5000000,metodo_pago:'transferencia'}];t.movimientos[0]={...t.movimientos[0],categoria:'Proveedores',descripcion:'Compra de mercancía · QA Proveedor Pruebas',metodo_pago:'efectivo'};const value=JSON.stringify(s);save(value);localStorage.setItem('angie-tech:demo:v1',value)}))");
  const go=async path=>{await send('Page.navigate',{url:base+path});await waitFor("!!document.querySelector('.fz-kpis')||!!document.querySelector('[role=alert]')");await waitFor("!document.querySelector('.loading-state')")};
  const sum=()=>evaluate("[...document.querySelectorAll('.finance-detail-row')].reduce((n,e)=>n+Number(e.dataset.amount),0)");
  const topClose=()=>evaluate("[...document.querySelectorAll('[data-app-dialog]')].at(-1).querySelector('.sheet-x').click()");
  const assertReturn=async(query,top)=>{await waitFor("document.querySelectorAll('[data-app-dialog]').length===1&&!document.querySelector('.finance-detail-sheet').inert");assert.equal(await evaluate("document.querySelector('.finance-detail-sheet .search-bar input').value"),query);assert.ok(await evaluate("document.querySelector('.finance-detail-period b').textContent.toLowerCase().includes('octubre')"));if(top!==undefined)assert.ok(Math.abs(await evaluate("document.querySelector('.finance-detail-sheet .sheet-body').scrollTop")-top)<=1)};
  await go('/finanzas?detalle=ingreso&mes=2026-10');await waitFor("!!document.querySelector('[aria-label=\"Ver factura FV-0030\"]')");assert.equal(await sum(),99980000);assert.equal(await evaluate("document.querySelector('[aria-label=\"Ver factura FV-0030\"] h4').textContent"),'Venta · Luisa');check('Income FV-0030 displays Luisa with original financial totals');
  const before=await api('return supabase.demo.snapshot().tables');await field('.finance-detail-sheet .search-bar input','FV');await click('[aria-label="Ver factura FV-0030"]');await waitFor("document.querySelector('.invoice-detail-sheet .fd-num')?.textContent==='FV-0030'");const incomeScroll=await evaluate("document.querySelector('.finance-detail-sheet .sheet-body').scrollTop");assert.equal(await evaluate("document.querySelector('.invoice-detail-sheet .fd-client-txt b').textContent"),'Luisa');for(const selector of ['.fd-items','.fd-pay','.fd-hero-meta','.fd-act.pdf'])assert.ok(await evaluate("!!document.querySelector('.invoice-detail-sheet "+selector+"')"));assert.equal(await evaluate("document.querySelector('.finance-detail-sheet').inert"),true);check('Income opens the existing complete invoice dialog with customer, products, payment and PDF');
  await click('.invoice-detail-sheet .fd-act.pdf');await waitFor("!!document.querySelector('.invoice-document-preview')");assert.ok(await evaluate("document.querySelector('.invoice-document-preview').textContent.includes('FV-0030')&&document.querySelector('.invoice-document-preview').textContent.includes('Luisa')"));await evaluate("[...document.querySelectorAll('.invoice-document-preview button')].find(e=>e.textContent==='Cerrar vista previa').click()");await click('.invoice-detail-sheet .sheet-x');await assertReturn('FV',incomeScroll);check('Closing PDF and invoice returns to Income with search, month and exact scroll preserved');
  await field('.finance-detail-sheet .search-bar input','FV-0029');await click('[aria-label="Ver factura FV-0029"]');await waitFor("document.querySelector('.invoice-detail-sheet .fd-num')?.textContent==='FV-0029'");await topClose();await assertReturn('FV-0029');check('Other income rows open their own invoice, never a stale selected ID');
  await field('.finance-detail-sheet .search-bar input','FV-0030');await evaluate("sessionStorage.setItem('finance-test-error','invoice-denied')");await click('[aria-label="Ver factura FV-0030"]');await waitFor("document.querySelectorAll('[data-app-dialog]').length===2&&!![...document.querySelectorAll('[data-app-dialog]')].at(-1).querySelector('[role=alert]')");assert.equal(await evaluate("!![...document.querySelectorAll('[data-app-dialog]')].at(-1).querySelector('.fd-hero-total')"),false);await topClose();await assertReturn('FV-0030');await evaluate("sessionStorage.removeItem('finance-test-error')");check('Denied invoice access is explained without bypassing permissions or losing Income');
  await click('.finance-detail-sheet .sheet-x');await click('.fz-kpi.out');await waitFor("!!document.querySelector('.finance-detail-hero')");assert.equal(await sum(),20012500);await field('.finance-detail-sheet .search-bar input','Claro');await click('[aria-label="Ver compra COMPRA-CLARO"]');await waitFor("!!document.querySelector('.cd-sheet .fd-hero-total')");const expenseScroll=await evaluate("document.querySelector('.finance-detail-sheet .sheet-body').scrollTop");const purchaseText=await evaluate("document.querySelector('.cd-sheet').textContent");for(const value of ['Claro SAS','COMPRA-CLARO','20.000.000','15.000.000','transferencia','A crédito'])assert.ok(purchaseText.includes(value),value);assert.equal(await evaluate("document.querySelectorAll('.cd-sheet .cd-item').length"),1);await click('.cd-sheet .sheet-x');await assertReturn('Claro',expenseScroll);check('Expenses opens existing purchase with supplier, items, payments, credit and balance; returns with filter/scroll');
  await field('.finance-detail-sheet .search-bar input','QA');await evaluate("[...document.querySelectorAll('.finance-detail-row')].find(e=>e.textContent.includes('QA Proveedor')).click()");await waitFor("!!document.querySelector('.finance-movement-detail')");const manual=await evaluate("document.querySelector('.finance-movement-detail').textContent");for(const text of ['QA Proveedor Pruebas','12.500','efectivo','no tiene una compra o factura vinculada'])assert.ok(manual.includes(text),text);assert.equal(await evaluate("!!document.querySelector('.cd-sheet')"),false);await topClose();await assertReturn('QA');check('Unlinked expense shows only its registered data, without inventing products or purchase status');
  await field('.finance-detail-sheet .search-bar input','Claro');await evaluate("sessionStorage.setItem('finance-test-error','purchase-denied')");await click('[aria-label="Ver compra COMPRA-CLARO"]');await waitFor("!!document.querySelector('.cd-sheet [role=alert]')");assert.equal(await evaluate("!!document.querySelector('.cd-sheet .fd-hero-total')"),false);assert.equal(await evaluate("document.querySelector('.cd-sheet').textContent.includes('Pagada')"),false);await click('.cd-sheet .sheet-x');await assertReturn('Claro');await evaluate("sessionStorage.removeItem('finance-test-error')");check('Denied purchase items/payment access never appears as Paid or an empty complete purchase');
  await field('.finance-detail-sheet .search-bar input','');assert.equal(await sum(),20012500);await click('.finance-detail-sheet .sheet-x');await click('.fz-kpi.in');await waitFor("!!document.querySelector('.finance-detail-hero')");assert.equal(await sum(),99980000);assert.deepEqual(await api('return supabase.demo.snapshot().tables'),before);check('All document views preserve original invoice, purchase, stock, refund and movement records');
  for(const width of [360,390,430,1440]){await metrics(width,width===1440?900:844);assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'));await field('.finance-detail-sheet .search-bar input','FV-0030');await click('[aria-label="Ver factura FV-0030"]');await waitFor("!!document.querySelector('.invoice-detail-sheet .fd-num')");assert.ok(await evaluate("document.querySelector('.invoice-detail-sheet').getBoundingClientRect().right<=innerWidth+1"));await topClose();await assertReturn('FV-0030');check('Nested finance/invoice layout and return '+width+'px')}
  await click('.finance-detail-sheet .sheet-x');await openSettings();await type('#template-email-body','Gracias por elegir Angie tech. {cliente} · {numero_factura} · {total}');await tab('WhatsApp');await type('#template-whatsapp-body','Gracias por elegir Angie tech. {numero_factura} · {total}');await click('.invoice-message-settings .sheet-foot button');await waitFor("!document.querySelector('.invoice-message-settings')");await logout();await login('ana@angietech.demo','.seller-home');await send('Page.navigate',{url:base+'/facturas?factura=30'});await waitFor("!!document.querySelector('.fd-num')&&!document.querySelector('.fd-act.mail').disabled");await click('.fd-act.mail');await waitFor("document.querySelector('.email-preview-message pre')?.textContent.includes('Gracias por elegir Angie tech')");assert.equal(await evaluate("document.querySelector('.email-preview-message pre').textContent.split('Gracias por elegir Angie tech').length-1"),1);await click('.invoice-email-send .email-preview-cancel');await click('.fd-act.wa');await waitFor("document.querySelector('.invoice-message-preview pre')?.textContent.includes('Gracias por elegir Angie tech')");await evaluate("[...document.querySelectorAll('.invoice-message-preview button')].find(e=>e.textContent==='Cerrar vista previa').click()");check('Administrator saved phrase is used once in seller email and WhatsApp after a separate login');
  await send('Page.navigate',{url:base+'/configuracion'});await waitFor("!!document.querySelector('.settings-panel')");assert.equal(await evaluate("document.body.textContent.includes('Plantillas de mensajes')"),false);check('Seller still cannot edit global message templates');
  assert.deepEqual(externalRequests,[]);assert.deepEqual(browserErrors,[]);await writeFile(join(artifacts,'results.json'),JSON.stringify({status:'PASS',cases:results.length,results,remoteCalls:0,physicalSafariPending:true},null,2));console.log(JSON.stringify({status:'PASS',cases:results.length,artifacts}));await send('Browser.close').catch(()=>{});
} catch(error){await writeFile(join(artifacts,'results.json'),JSON.stringify({status:'FAIL',error:error.stack,results,externalRequests,browserErrors},null,2));console.error(error.stack);process.exitCode=1}
finally{socket?.close();browser.kill();await delay(300);if(!profile.startsWith(join(tmpdir(),'angie-tech-ui-')))throw Error('Unexpected profile');await rm(profile,{recursive:true,force:true,maxRetries:20,retryDelay:250}).catch(error=>{console.error('Profile cleanup failed',error.message);process.exitCode=1})}
