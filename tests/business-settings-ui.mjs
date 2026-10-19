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
const artifacts = join(root, 'artifacts', process.env.UI_ARTIFACTS || 'business-settings')
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
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 60000)
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
  async function waitFor(expression, timeout = 60000) {
    const deadline = Date.now() + timeout
    do { if (await evaluate(expression)) return; await delay(150) } while (Date.now() < deadline)
    await screenshot("failure"); await writeFile(join(artifacts,"failure.json"),JSON.stringify(await evaluate("({url:location.href,ready:document.readyState,alerts:[...document.querySelectorAll(\"[role=alert]\")].map(e=>e.textContent),body:document.body.innerText})"),null,2));
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
  const login=async(email,selector)=>{await send('Page.navigate',{url:base+'/login'});await waitFor("!!document.querySelector('#login-email')");await click('.login-role button:nth-child('+(email.startsWith('admin@')?1:2)+')');await field('#login-email',email);await field('#login-password','AngieDemo123!');await click('.login-submit');await waitFor('!!document.querySelector('+JSON.stringify(selector)+')')};
  const logout=async()=>{await api('await supabase.auth.signOut()');await waitFor("!!document.querySelector('#login-email')")};
  const openSettings=async()=>{await navigate('/configuracion');await evaluate("[...document.querySelectorAll('.settings-row')].find(e=>e.textContent.includes('Plantillas de mensajes')).click()");await waitFor("!!document.querySelector('.invoice-message-settings input')")};
  const tab=async(label)=>{await evaluate("[...document.querySelectorAll('.invoice-message-settings .sales-periods button')].find(e=>e.textContent==="+JSON.stringify(label)+").click()");await delay(100)};



  await login('admin@angietech.demo','.ah-duo');
  const openBusiness=async()=>{await navigate('/configuracion');await click('.empresa-edit-btn');await waitFor("!!document.querySelector('.business-settings [name=nombre]')")};
  const pristine=await api('return supabase.demo.snapshot().tables');await openBusiness();
  for(const [width,height] of [[390,844],[768,1024]])for(const theme of ['dark','light']){await metrics(width,height);await evaluate("import('/src/lib/theme.js').then(m=>m.setTheme('"+theme+"'))");const shape=await evaluate("(()=>{const e=document.querySelector('.business-settings'),r=e.getBoundingClientRect(),f=e.querySelector('.sheet-foot').getBoundingClientRect(),b=e.querySelector('.sheet-body');return{left:r.left,right:r.right,bottom:r.bottom,footer:f.bottom,doc:document.documentElement.scrollWidth,width:innerWidth,scroll:getComputedStyle(b).overflowY,font:Math.min(...[...e.querySelectorAll('input:not([type=file]),textarea')].map(i=>parseFloat(getComputedStyle(i).fontSize)))}})()");assert.ok(shape.left>=-1&&shape.right<=width+1);assert.ok(shape.doc<=width+1);assert.ok(shape.footer<=height+1);assert.equal(shape.scroll,'auto');assert.ok(shape.font>=16);check('Company editor '+width+' '+theme+' has one scroll, accessible text and protected footer')}
  await metrics(390);await evaluate("document.querySelector('.business-settings [name=nombre]').focus();Object.defineProperty(visualViewport,'height',{configurable:true,value:450});Object.defineProperty(visualViewport,'offsetTop',{configurable:true,value:12});visualViewport.dispatchEvent(new Event('resize'))");await delay(250);const keyboard=await evaluate("(()=>{const e=document.querySelector('.business-settings'),r=e.getBoundingClientRect(),f=e.querySelector('.sheet-foot');return{top:r.top,bottom:r.bottom,footer:f.getBoundingClientRect().bottom,color:getComputedStyle(f).backgroundColor}})()");assert.ok(Math.abs(keyboard.bottom-462)<=1);assert.ok(Math.abs(keyboard.footer-462)<=1);assert.notEqual(keyboard.color,'rgba(0, 0, 0, 0)');await evaluate("document.activeElement.blur();delete visualViewport.height;delete visualViewport.offsetTop;visualViewport.dispatchEvent(new Event('resize'))");check('Company editor simulated iPhone keyboard keeps solid footer without background gap');
  const value={nombre:'Angie Tech Empresa',razon_social:'Angie SAS',nit:'900123456',nit_dv:'7',direccion:'Calle 1 # 2-3',ciudad:'Bogotá',telefono:'+57 601 1234567',whatsapp:'3001234567',correo:'correo-invalido'};
  for(const [name,v]of Object.entries(value))await type('.business-settings [name='+name+']',v);await type('#business-footer','Información comercial válida');await click('.business-settings .sheet-foot button');await waitFor("document.querySelector('.business-settings [role=alert]')?.textContent.toLowerCase().includes('correo')");check('Invalid business email blocks save without closing the editor');await type('.business-settings [name=correo]','ventas@example.test');
  await evaluate("(()=>{const input=document.querySelector('.business-logo input'),transfer=new DataTransfer(),bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII='),c=>c.charCodeAt(0));transfer.items.add(new File([bytes],'logo.png',{type:'image/png'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()");await waitFor("!!document.querySelector('.business-logo img')&&!document.querySelector('.business-settings .sheet-foot button').disabled");check('Selected PNG logo is decoded, normalized and previewed locally');
  await click('.business-settings .sheet-foot button');await waitFor("!document.querySelector('.business-settings')");const saved=await api("return (await supabase.from('tienda').select('*').eq('id',1).single()).data");assert.equal(saved.razon_social,'Angie SAS');assert.equal(saved.correo,'ventas@example.test');assert.ok(saved.logo_data_url.startsWith('data:image/png;base64,'));for(const key of ['facturas','factura_items','productos','clientes','movimientos'])assert.deepEqual(await api('return supabase.demo.snapshot().tables['+JSON.stringify(key)+']'),pristine[key]);check('Administrator saves complete company settings without modifying financial or invoice records');
  await openBusiness();assert.equal(await evaluate("document.querySelector('.business-settings [name=razon_social]').value"),'Angie SAS');assert.ok(await evaluate("document.querySelector('.business-logo img').src.startsWith('data:image/png;base64,')"));await click('.business-settings .sheet-x');check('Reloaded editor restores business identity and logo');
  await logout();await login('ana@angietech.demo','.seller-home');await navigate('/configuracion');assert.equal(await evaluate("!!document.querySelector('.empresa-edit-btn')"),false);const denied=await api("return (await supabase.rpc('guardar_datos_empresa',{p_datos:"+JSON.stringify({...saved,...value,correo:'ventas@example.test'})+"})).error");assert.ok(denied);check('Seller cannot access company editor or mutate company settings');
  const sold=await api("const product=(await supabase.from('productos').select('*')).data.find(p=>p.activo&&!p.maneja_serial&&p.stock>0);const result=await supabase.rpc('emitir_factura',{p_cliente_id:null,p_metodo_pago:'efectivo',p_descuento:0,p_items:[{producto_id:product.id,cantidad:1}]});if(result.error)throw Error(result.error.message);return (await supabase.from('facturas').select('*').eq('id',result.data).single()).data");assert.equal(sold.tienda_snapshot.razon_social,'Angie SAS');assert.equal(sold.tienda_snapshot.logo_data_url,saved.logo_data_url);await send('Page.navigate',{url:base+'/facturas?factura='+sold.id});await waitFor("!!document.querySelector('.fd-act.pdf')");await click('.fd-act.pdf');await waitFor("!!document.querySelector('.invoice-document-preview .fx-store')");const preview=await evaluate("document.querySelector('.invoice-document-preview .fx-store').textContent");for(const label of ['Angie Tech Empresa','Angie SAS','900123456-7','ventas@example.test','3001234567'])assert.ok(preview.includes(label),label);check('Future invoice preview uses saved name, legal identity, contacts and historical logo');
  assert.deepEqual(externalRequests,[]);assert.deepEqual(browserErrors,[]);await writeFile(join(artifacts,'results.json'),JSON.stringify({status:'PASS',cases:results.length,results,remoteCalls:0,physicalSafariPending:true},null,2));console.log(JSON.stringify({status:'PASS',cases:results.length,artifacts}));await send('Browser.close').catch(()=>{});
} catch(error){await writeFile(join(artifacts,'results.json'),JSON.stringify({status:'FAIL',error:error.stack,results,externalRequests,browserErrors},null,2));console.error(error.stack);process.exitCode=1}
finally{socket?.close();browser.kill();await delay(300);if(!profile.startsWith(join(tmpdir(),'angie-tech-ui-')))throw Error('Unexpected profile');await rm(profile,{recursive:true,force:true,maxRetries:20,retryDelay:250}).catch(error=>{console.error('Profile cleanup failed',error.message);process.exitCode=1})}
