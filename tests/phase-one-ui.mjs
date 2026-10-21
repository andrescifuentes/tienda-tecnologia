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
let socket, fault = null, closeBrowser = () => Promise.resolve()
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
  closeBrowser = () => socket.readyState === 1 ? send('Browser.close') : Promise.resolve()
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
        if (url.pathname === '/src/lib/authSession.js' || url.pathname === '/src/lib/saleCompletion.js' || url.pathname === '/src/lib/asyncResult.js') {
          let source = await (await fetch(request.url)).text();
          source = source.replace('SALE_TIMEOUT = 15000','SALE_TIMEOUT = 1500').replace('SALE_VERIFY_TIMEOUT = 10000','SALE_VERIFY_TIMEOUT = 1500');
          if(fault?.startsWith('auth-'))source=source.replace('AUTH_TIMEOUT = 10000','AUTH_TIMEOUT = 1500');
          await send('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/javascript'}],body:Buffer.from(source).toString('base64')}); return;
        }
        if (url.pathname === '/src/lib/supabase.js' && fault) {
          const original=await (await fetch(request.url)).text();let extra;
          if(fault==='auth-hang')extra='supabase.auth.getSession=()=>new Promise(()=>{});';
          else if(fault==='auth-reject')extra="supabase.auth.getSession=async()=>{throw Error('AUDIT offline')};";
          else if(fault==='profile-error')extra="const old=supabase.from.bind(supabase);supabase.from=t=>{const q=old(t);if(t==='perfiles')q.then=(a,b)=>Promise.resolve({data:null,error:{message:'HTTP 503'}}).then(a,b);return q};";
          else extra="window.__phaseCustomerFault=true;const old=supabase.from.bind(supabase);supabase.from=t=>{const q=old(t);if(t==='clientes'){const then=q.then.bind(q);q.then=(a,b)=>window.__phaseCustomerFault?Promise.resolve({data:null,error:{message:'HTTP 500'}}).then(a,b):then(a,b)}return q};";
          await send('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/javascript'}],body:Buffer.from(original+'\n'+extra).toString('base64')});return;
        }
        if (process.env.POST_SALE_REAL_FIXTURE === '1' && url.pathname === '/src/lib/supabase.js') {
          const fixture = "import {createDemoClient} from '/src/lib/demo/client.js'; export const isDemoMode=false; export const isInvoiceEmailEnabled=false; export const supabaseConfigurationError=''; export const supabase=createDemoClient(); supabase.storage={from:()=>({upload:async()=>{window.__uploadCalls=(window.__uploadCalls||0)+1;if(window.__UPLOAD_MODE__==='hang')return new Promise(()=>{});return{error:window.__UPLOAD_MODE__==='success'?null:{message:'Bucket not found'}}},getPublicUrl:()=>({data:{publicUrl:'https://example.test/invoice.pdf'}})})}; export async function conAutorizacionAdmin(){window.__adminAuthCalls=(window.__adminAuthCalls||0)+1;throw Error('No administrator authentication in this local fixture')}";
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





  await send('Page.enable');await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});await send('Page.bringToFront');await send('Runtime.enable');await send('Log.enable');await send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  const check=name=>{results.push({name,status:'PASS'});console.log('PASS '+name)};
  const go=async(path,selector='.nav')=>{await send('Page.navigate',{url:base+path});await waitFor('!!document.querySelector('+JSON.stringify(selector)+')');await delay(350)};
  const api=expression=>evaluate("import(performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/lib/supabase.js')?.name || '/src/lib/supabase.js').then(async({supabase})=>{"+expression+'})');
  const field=async(selector,value)=>{await evaluate('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');Object.getOwnPropertyDescriptor(e.tagName==="SELECT"?HTMLSelectElement.prototype:HTMLInputElement.prototype,"value").set.call(e,'+JSON.stringify(value)+');e.dispatchEvent(new Event(e.tagName==="SELECT"?"change":"input",{bubbles:true}))})()');await delay(50)};
  const click=async selector=>{await evaluate('document.querySelector('+JSON.stringify(selector)+').click()');await delay(100)};
  const button=async text=>{await evaluate('(()=>{const scope=[...document.querySelectorAll("[role=dialog]")].at(-1)||document;const b=[...scope.querySelectorAll("button")].find(e=>e.textContent.trim()==='+JSON.stringify(text)+');if(!b)throw Error("Missing button "+'+JSON.stringify(text)+');b.click()})()');await delay(100)};
  const pf=async(label,value)=>{await evaluate('(()=>{const e=[...document.querySelectorAll(".inv-form .pf-field")].find(e=>e.querySelector("label")?.textContent.trim().startsWith('+JSON.stringify(label)+')).querySelector("input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,'+JSON.stringify(value)+');e.dispatchEvent(new Event("input",{bubbles:true}))})()');await delay(50)};
  const login=async email=>{await go('/login','.login-form');const r=await api('return supabase.auth.signInWithPassword({email:'+JSON.stringify(email)+',password:"AngieDemo123!"})');assert.equal(r.error,null);await go('/')};await login('admin@angietech.demo');
  await go('/inventario');await button('Agregar producto');await waitFor("!!document.querySelector('.inv-form .pf-trigger')");assert.equal(await evaluate("!!document.querySelector('.inv-form [role=alert]')"),false);check('AUD-16 product form opens without .not crash');
  await pf('Nombre del producto','Phase one normal photo');await pf('Precio de compra','10000');await pf('Precio de venta','25000');await pf('Cantidad','3');await field('.pf-sku input','PHASE1-PHOTO');await evaluate("[...document.querySelectorAll('.inv-form .pf-field')].find(e=>e.querySelector('label')?.textContent.startsWith('Categoría')).querySelector('button').click()");await waitFor("!!document.querySelector('.opt-row')");await evaluate("[...document.querySelectorAll('.opt-row')].find(e=>e.textContent.includes('Accesorios')).querySelector('.opt-pick').click()");await waitFor("!document.querySelector('.opt-sheet')");
  await evaluate("(()=>{const canvas=document.createElement('canvas');canvas.width=40;canvas.height=30;const ctx=canvas.getContext('2d');ctx.fillStyle='#d4a85c';ctx.fillRect(0,0,40,30);const raw=atob(canvas.toDataURL('image/png').split(',')[1]);const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([bytes],'phase-one.png',{type:'image/png'}));const input=[...document.querySelectorAll('.inv-form input[type=file]')].find(e=>!e.capture);input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()");await waitFor("!!document.querySelector('.pf-photo.has img')");await button('Guardar producto');await waitFor("!document.querySelector('.inv-form')");const created=await api("return (await supabase.from('productos').select('*').eq('codigo','PHASE1-PHOTO').single()).data");assert.equal(created.stock,3);assert.equal(created.precio_compra,10000);assert.ok(created.image_ref);check('AUD-16 create normal product, stock, SKU, prices and real PNG IndexedDB reference');
  await go('/inventario?producto='+created.id);await waitFor("!!document.querySelector('.inv-detail')");await button('Editar');await waitFor("!!document.querySelector('.inv-form')");await pf('Nombre del producto','Phase one edited');await pf('Cantidad','4');await button('Guardar cambios');await waitFor("!document.querySelector('.inv-form')");const updated=await api('return (await supabase.from("productos").select("*").eq("id",'+created.id+').single()).data');assert.equal(updated.stock,4);assert.equal(updated.image_ref,created.image_ref);check('AUD-16 edit normal product preserves image and stock relation');
  await go('/inventario?producto='+created.id);const image=await evaluate("import('/src/lib/demo/images.js').then(async m=>{const b=await m.loadImage('"+created.image_ref+"');return{type:b.type,size:b.size}})");assert.equal(image.type,'image/png');assert.ok(image.size>0);check('AUD-16 product photo binary and reference survive reload');
  await waitFor("!!document.querySelector('.inv-detail')");await button('Editar');await waitFor("!!document.querySelector('.inv-form')");await pf('Nombre del producto','Cancelled edit');await click('.inv-form .fp-head button');const cancelled=await api('return (await supabase.from("productos").select("*").eq("id",'+created.id+').single()).data');assert.equal(cancelled.nombre,updated.nombre);check('AUD-16 cancel leaves stored product unchanged');
  const serialProduct=await api("return (await supabase.from('productos').select('*')).data.find(p=>p.maneja_serial)");await go('/inventario?producto='+serialProduct.id);await waitFor("!!document.querySelector('.inv-detail')");await button('Editar');await waitFor("!!document.querySelector('.inv-form')");assert.ok(await evaluate("[...document.querySelectorAll('.inv-form .pf-field')].find(e=>e.querySelector('label')?.textContent.startsWith('Cantidad')).querySelector('input').disabled"));await pf('Nombre del producto',serialProduct.nombre+' edited');await button('Guardar cambios');await waitFor("!document.querySelector('.inv-form')");const serialAfter=await api('return (await supabase.from("productos").select("*").eq("id",'+serialProduct.id+').single()).data');assert.equal(serialAfter.maneja_serial,true);assert.equal(serialAfter.stock,serialProduct.stock);assert.equal(serialAfter.proveedor_id,serialProduct.proveedor_id);assert.equal(serialAfter.garantia_meses,serialProduct.garantia_meses);check('AUD-16 serialized product edit preserves units, supplier and warranty');
  await go('/inventario');await api("window.__oldFrom=supabase.from.bind(supabase);supabase.from=t=>{const q=window.__oldFrom(t);if(t==='categorias')q.then=(a,b)=>Promise.resolve({data:null,error:{message:'Simulated option error'}}).then(a,b);return q};return true");await button('Agregar producto');await waitFor("document.querySelector('.inv-form [role=alert]')?.textContent.includes('opciones')");assert.ok(await evaluate("!!document.querySelector('.inv-form')"));await api('supabase.from=window.__oldFrom;return true');await button('Reintentar opciones');await waitFor("!document.querySelector('.inv-form [role=alert]')");await click('.inv-form .fp-head button');check('AUD-16 controlled option error and retry retain the page');

  await go('/');await waitFor("!!document.querySelector('.nav')");assert.equal(await evaluate("!!document.querySelector('[role=alert]')"),false);check('Admin Inicio renders after product recovery');
  await go('/proveedores');await waitFor("!!document.querySelector('.pv-card')");await click('.pv-card');await button('Registrar compra');await waitFor("!!document.querySelector('.cp-sheet')");await click('.cp-sheet .pos-more');await waitFor("!!document.querySelector('.product-picker-sheet .product-pick')");
  const purchaseProduct=await api("return (await supabase.from('productos').select('*')).data.find(p=>!p.maneja_serial&&p.activo)");await evaluate("(()=>{const scope=[...document.querySelectorAll('.sheet')].at(-1);const b=[...scope.querySelectorAll('button')].find(b=>b.textContent.includes("+JSON.stringify(purchaseProduct.nombre)+"));if(!b)throw Error('Missing purchase product');b.click()})()");await waitFor("document.querySelectorAll('.cp-item').length===1");await field('.cp-item input','1000');await click('.cp-sheet .sheet-foot button');await waitFor("!document.querySelector('.cp-sheet')");
  const bought=await api("return (await supabase.from('productos').select('*').eq('id',"+purchaseProduct.id+").single()).data");assert.equal(bought.stock,purchaseProduct.stock+1);assert.equal(bought.precio_compra,1000);assert.equal(await evaluate("!!document.querySelector('.pv-sheet')"),true);check('Admin purchase increases inventory, retains costs and returns to supplier');
  fault='customers';await go('/clientes');await waitFor("!!document.querySelector('[role=alert]')");assert.equal(await evaluate("document.body.innerText.includes('No hay clientes para mostrar')"),false);await field('[aria-label="Buscar cliente"]','Juan');await waitFor("!!document.querySelector('[role=alert]')");await evaluate('window.__phaseCustomerFault=false');await button('Reintentar clientes');await waitFor("!!document.querySelector('.cl-card')");assert.equal(await evaluate("document.querySelector('[aria-label=\"Buscar cliente\"]').value"),'Juan');check('AUD-08 customer errors/retry preserve search and never show false empty state');
  await go('/vender?q='+created.codigo);await waitFor("!!document.querySelector('.pos-tile .pos-add')");await click('.pos-tile .pos-add');await click('.pos-bar');await click('.pos-who2 button');await waitFor("!!document.querySelector('.client-picker-sheet [role=alert]')");assert.equal(await evaluate("document.querySelector('.client-picker-sheet').innerText.includes('Sin clientes')"),false);await evaluate('window.__phaseCustomerFault=false');await button('Reintentar clientes');await waitFor("!!document.querySelector('.client-picker-sheet .row')");await click('.client-picker-sheet .row');check('AUD-08 sale customer picker recovers without losing cart');fault=null;
  await api("window.__oldRpc=supabase.rpc.bind(supabase);window.__saleCalls=0;supabase.rpc=(name,...args)=>{if(name==='emitir_factura'){window.__saleCalls++;return new Promise(()=>{})}return window.__oldRpc(name,...args)};return true");await click('.pos-pay2');await waitFor("!document.querySelector('.pos-pay2').disabled");assert.ok(await evaluate("document.querySelector('.pos-pay2').innerText.includes('Reintentar')"));await click('.checkout-sheet .sheet-x');const lockedCart=await evaluate("document.querySelector('.pos-bar').getAttribute('aria-label')");await click('.pos-tile .pos-tile-img');await waitFor("!!document.querySelector('.pos-detail')");await click('.pos-detail .inv-btn-gold');await waitFor("!document.querySelector('.pos-detail')");assert.equal(await evaluate("document.querySelector('.pos-bar').getAttribute('aria-label')"),lockedCart);check('AUD-10 pending sale keeps cart immutable from product detail');await click('.pos-bar');assert.ok(await evaluate("!document.querySelector('.pos-pay2').disabled"));const attempt=await evaluate("JSON.parse(sessionStorage.getItem('angie:sale:demo-admin'))");assert.ok(attempt.id);await go('/vender');await waitFor("!!document.querySelector('.pos-bar')");await click('.pos-bar');assert.equal(await evaluate("JSON.parse(sessionStorage.getItem('angie:sale:demo-admin')).id"),attempt.id);await click('.pos-pay2');await waitFor("!!document.querySelector('.seller-sale-complete')");const matched=await api('return (await supabase.from("facturas").select("*").eq("request_id",'+JSON.stringify(attempt.id)+')).data');assert.equal(matched.length,1);check('AUD-10 timeout, close/reopen and reload recover with same identity and one invoice');await click('.seller-sale-complete .sheet-x');
  await go('/vender?q='+created.codigo);await waitFor("!!document.querySelector('.pos-tile .pos-add')");await click('.pos-tile .pos-add');await click('.pos-bar');await click('.pos-who2 button');await waitFor("!!document.querySelector('.client-picker-sheet .row')");await click('.client-picker-sheet .row');await api("window.__oldRpc=supabase.rpc.bind(supabase);window.__saleCalls=0;supabase.rpc=async(name,...args)=>{if(name==='emitir_factura'){window.__saleCalls++;await window.__oldRpc(name,...args);throw TypeError('Failed to fetch')}return window.__oldRpc(name,...args)};return true");await click('.pos-pay2');await waitFor("!!document.querySelector('.seller-sale-complete')");assert.equal(await evaluate('window.__saleCalls'),1);assert.equal(await evaluate("sessionStorage.getItem('angie:sale:demo-admin')"),null);check('AUD-10 persisted sale with lost reply reaches post-sale without a second RPC');await click('.seller-sale-complete .sheet-x');

  // Cross-tab logout and subsequent login use actual storage/auth listeners.
  const peerTarget=await (await fetch('http://'+debugUrl.host+'/json/new?about:blank',{method:'PUT'})).json(),peer=new WebSocket(peerTarget.webSocketDebuggerUrl);await new Promise((a,b)=>{peer.addEventListener('open',a,{once:true});peer.addEventListener('error',b,{once:true})});let ps=0;const pp=new Map();const peerSend=(method,params={})=>new Promise((a,b)=>{const id=++ps,t=setTimeout(()=>b(Error('Peer timeout')),30000);pp.set(id,{a,b,t});peer.send(JSON.stringify({id,method,params}))});peer.addEventListener('message',async({data})=>{const e=JSON.parse(data);if(e.id){const p=pp.get(e.id);if(p){clearTimeout(p.t);pp.delete(e.id);e.error?p.b(Error(JSON.stringify(e.error))):p.a(e.result)}}else if(e.method==='Fetch.requestPaused'){const r=e.params,u=new URL(r.request.url);await peerSend(u.origin===new URL(base).origin?'Fetch.continueRequest':'Fetch.failRequest',{requestId:r.requestId,...(u.origin===new URL(base).origin?{}:{errorReason:'BlockedByClient'})})}});const pe=async e=>{const r=await peerSend('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value};await peerSend('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});await peerSend('Page.navigate',{url:base+'/'});for(let i=0;i<150&&!await pe("!!document.querySelector('.nav')");i++)await delay(100);assert.ok(await pe("!!document.querySelector('.nav')"));await go('/finanzas');await peerSend('Page.bringToFront');await pe("import('/src/lib/supabase.js').then(m=>m.supabase.auth.signOut())");await waitFor("location.pathname==='/login' && !!document.querySelector('.login-form')");assert.equal(await evaluate("!!document.querySelector('.nav')"),false);check('AUD-06 logout in peer clears administrator UI and redirects to login');await send('Page.bringToFront');await send('Page.navigate',{url:base+'/finanzas'});await waitFor("location.pathname==='/login'");await send('Page.reload');await waitFor("!!document.querySelector('.login-form')");check('AUD-06 direct route/back/reload cannot restore protected UI after logout');await send('Target.closeTarget',{targetId:peerTarget.id});peer.close();
  await login('ana@angietech.demo');await go('/inventario');assert.equal(await evaluate("document.body.innerText.includes('Precio de compra')"),false);check('AUD-06 new seller login has no previous administrator role');
  fault='auth-hang';await send('Page.navigate',{url:base+'/'});await waitFor("document.body.innerText.includes('Reintentar conexión')");assert.ok(await evaluate("document.body.innerText.includes('tardó')"));await api('supabase.auth.getSession=async()=>({data:{session:JSON.parse(localStorage.getItem("angie-tech:demo:v1")).session},error:null});return true');await button('Reintentar conexión');await waitFor("!!document.querySelector('.seller-home')");check('AUD-09 auth timeout shows recovery and retry restores seller');
  fault='auth-reject';await send('Page.navigate',{url:base+'/'});await waitFor("document.body.innerText.includes('Reintentar conexión')");await go('/login','.login-form');await waitFor("!!document.querySelector('.login-form [role=alert]')");await field('#login-email','ana@angietech.demo');await field('#login-password','AngieDemo123!');await click('.login-submit');await waitFor("!!document.querySelector('.seller-home')");check('AUD-09 rejected initialization and valid subsequent login recover');fault=null;
  assert.deepEqual(externalRequests,[]);assert.deepEqual(browserErrors,[]);await writeFile(join(artifacts,'results.json'),JSON.stringify({status:'PASS',cases:results.length,results,externalRequests,browserErrors,remoteCalls:0,physicalSafariPending:true},null,2));console.log(JSON.stringify({status:'PASS',cases:results.length,artifacts}));await send('Browser.close').catch(()=>{});
} catch(error){await writeFile(join(artifacts,'results.json'),JSON.stringify({status:'FAIL',error:error.stack,results,externalRequests,browserErrors},null,2));console.error(error.stack);process.exitCode=1}
finally{await closeBrowser().catch(()=>{});socket?.close();browser.kill();await delay(300);if(!profile.startsWith(join(tmpdir(),'angie-tech-ui-')))throw Error('Unexpected profile');await rm(profile,{recursive:true,force:true,maxRetries:20,retryDelay:250}).catch(()=>{})}
