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
const artifacts = join(root, 'artifacts', process.env.UI_ARTIFACTS || 'post-sale-nonblocking')
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
        if (url.pathname === '/src/lib/supabase.js') {
          const fixture = "import {createDemoClient} from '/src/lib/demo/client.js';\nexport const isDemoMode=false,isInvoiceEmailEnabled=false,supabaseConfigurationError='';\nexport const supabase=createDemoClient();\nwindow.__saleCalls=0;window.__adminAuthCalls=0;window.__receipt=false;\nconst originalFrom=supabase.from.bind(supabase),originalRpc=supabase.rpc.bind(supabase);\nsupabase.from=table=>{const query=originalFrom(table),then=query.then.bind(query);query.then=(resolve,reject)=>{\n if(window.__receipt&&table==='factura_items'){\n  window.__detailStarted=true;\n  if(window.__detailMode==='hang')return new Promise(()=>{});\n  if(window.__detailMode==='error')return Promise.resolve({data:null,error:{code:'42501',message:'Permiso de detalle denegado (prueba local)'}}).then(resolve,reject);\n }\n if(window.__receipt&&table==='tienda'&&window.__messageMode==='hang')return new Promise(()=>{});\n return then(resolve,reject);\n};return query};\nsupabase.rpc=(name,args)=>{\n if(name==='anular_factura'){window.__adminAuthCalls++;return originalRpc(name,args)}\n if(!['emitir_factura','emitir_factura_segura'].includes(name))return originalRpc(name,args);\n window.__saleCalls++;\n const execute=()=>originalRpc(name,args).then(result=>{if(!result.error){window.__receipt=true;window.__lastInvoiceId=result.data}return result});\n if(window.__holdSale)return new Promise(resolve=>{window.__releaseSale=()=>execute().then(resolve)});\n return execute();\n};\nexport async function conAutorizacionAdmin(){window.__adminAuthCalls++;throw Error('No administrator authentication in this local fixture')}\n";
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





  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]})
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5})
  const check=name=>{results.push({name,status:'PASS'});console.log('PASS '+name)}
  const clickText=async text=>{await evaluate('(()=>{const b=[...document.querySelectorAll(".sheet button")].find(b=>b.textContent.trim()==='+JSON.stringify(text)+');if(!b)throw Error("Missing button");b.click()})()');await delay(100)}
  const field=async(selector,value)=>{await evaluate('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,'+JSON.stringify(value)+');e.dispatchEvent(new Event("input",{bubbles:true}))})()');await delay(50)}
  const noAdmin=async()=>{assert.equal(await evaluate("!!document.querySelector('.fd-auth,[type=password]')"),false);assert.equal(await evaluate('window.__adminAuthCalls||0'),0)}
  const free=async()=>{await waitFor("!document.querySelector('[data-app-dialog]')");assert.equal(await evaluate("document.getElementById('root').inert"),false);assert.equal(await evaluate("document.activeElement.matches('input,textarea,select')"),false)}
  const exitReady=async()=>{
    const exits=await evaluate("(()=>{const s=document.querySelector('.seller-sale-complete');return [...s.querySelectorAll('.sheet-x,.post-sale-footer button')].map(b=>{const r=b.getBoundingClientRect(),p=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{text:b.textContent,disabled:b.disabled,visible:r.height>=44&&r.top>=0&&r.bottom<=innerHeight+1,reachable:p===b||b.contains(p)}})})()")
    assert.equal(exits.length,3);assert.ok(exits.every(b=>!b.disabled&&b.visible&&b.reachable),JSON.stringify(exits));await noAdmin()
  }
  const state=async()=>evaluate("import('/src/lib/supabase.js').then(async({supabase:s})=>({invoices:(await s.from('facturas').select('*')).data.map(f=>({id:f.id,total:f.total,estado:f.estado})),products:(await s.from('productos_venta').select('*')).data.map(p=>({id:p.id,stock:p.stock})),movements:(await s.from('movimientos').select('*')).data.map(m=>({id:m.id,monto:m.monto,tipo:m.tipo})),stock:(await s.from('movimientos_inventario').select('*')).data.map(m=>({id:m.id,cantidad:m.cantidad}))}))")
  const session=async()=>{await send('Page.navigate',{url:base+'/login'});await waitFor("!!document.getElementById('login-email')");await tap('.login-role button:nth-child(2)');await field('#login-email','ana@angietech.demo');await field('#login-password','AngieDemo123!');await tap('.login-form .btn');await waitFor("!!document.querySelector('.seller-total')")}
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await session()
  const product=await evaluate("import('/src/lib/supabase.js').then(async({supabase:s})=>(await s.from('productos_venta').select('*')).data.find(p=>!p.maneja_serial&&p.stock>=12))")
  assert.ok(product,'Local fixture needs stock for focused post-sale checks')
  const begin=async({detailMode='',messageMode='',hold=false}={})=>{
    await send('Page.navigate',{url:base+'/vender?q='+encodeURIComponent(product.codigo)});await waitFor("!!document.querySelector('.pos-tile .pos-add')")
    await evaluate('window.__detailMode='+JSON.stringify(detailMode)+';window.__messageMode='+JSON.stringify(messageMode)+';window.__holdSale='+hold+';window.__receipt=false;window.__detailStarted=false')
    await tap('.pos-tile .pos-add');await tap('.pos-bar');await waitFor("!!document.querySelector('.pos-who2')");await tap('.pos-who2 button');await waitFor("!!document.querySelector('.client-picker-sheet .row')");await tap('.client-picker-sheet .row');await waitFor("!document.querySelector('.client-picker-sheet')")
    await tap('.checkout-sheet .pos-pay2')
  }
  for(const device of [{name:'iPhone',width:390,height:844,landscapeWidth:844,landscapeHeight:390,ua:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'},{name:'iPad',width:820,height:1180,landscapeWidth:1180,landscapeHeight:820,ua:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'}]){
    await send('Emulation.setDeviceMetricsOverride',{width:device.width,height:device.height,deviceScaleFactor:1,mobile:true});await send('Network.setUserAgentOverride',{userAgent:device.ua,platform:device.name==='iPad'?'MacIntel':'iPhone'})
    await begin({detailMode:'hang',hold:true});await waitFor('!!window.__releaseSale')
    assert.equal(await evaluate("!!document.querySelector('.seller-sale-complete')"),false)
    assert.equal(await evaluate("document.querySelector('.checkout-sheet .pos-pay2').disabled"),true)
    await evaluate("document.querySelector('.checkout-sheet .pos-pay2').click();document.querySelector('.checkout-sheet .pos-pay2').click()")
    assert.equal(await evaluate('window.__saleCalls'),1);check(device.name+': saving state cannot trigger duplicate sale or premature success')
    await evaluate('window.__releaseSale()');await waitFor("!!document.querySelector('.seller-sale-complete')&&window.__detailStarted")
    await exitReady();assert.ok(await evaluate("document.querySelector('.seller-sale-complete').textContent.includes('La venta ya está registrada')"));assert.equal(await evaluate("!!document.querySelector('.seller-sale-complete .fd-after')"),false)
    const saved=await state(),savedId=await evaluate('window.__lastInvoiceId')
    await tap('.seller-sale-complete .sheet-x');await free();await delay(200);assert.deepEqual(await state(),saved);assert.equal(await evaluate('window.__saleCalls'),1);check(device.name+': X exits while receipt detail hangs; persisted invoice, stock and movements stay unchanged')
    await evaluate("window.__detailMode=''");await send('Page.navigate',{url:base+'/facturas?factura='+savedId});await waitFor("!!document.querySelector('.invoice-detail-sheet .fd-num')");await noAdmin()
    assert.ok(await evaluate("document.querySelector('.invoice-detail-sheet .fd-state').textContent==='Emitida'"));await tap('.fd-act.pdf');await waitFor("!!document.querySelector('[data-print-invoice]')");assert.ok(await evaluate("document.querySelector('[data-print-invoice]').textContent.includes('FV-')"));await clickText('Cerrar vista previa')
    await evaluate("Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{const f=data.files[0];window.__pdfShared={type:f.type,name:f.name,magic:new TextDecoder().decode((await f.arrayBuffer()).slice(0,5))};throw new DOMException('Cancelado','AbortError')}})")
    await tap('.fd-act.pdf');await waitFor("[...document.querySelectorAll('.invoice-pdf-actions button')].some(b=>b.textContent==='Compartir PDF')");await clickText('Compartir PDF');await waitFor('!!window.__pdfShared');assert.equal(await evaluate('window.__pdfShared.type'),'application/pdf');assert.equal(await evaluate('window.__pdfShared.magic'),'%PDF-');await noAdmin();await clickText('Cerrar vista previa');await tap('.invoice-detail-sheet .sheet-x');await free();assert.deepEqual(await state(),saved);check(device.name+': persisted invoice remains in Facturas and real PDF can be shared later/cancelled without mutations')
    await begin({detailMode:'error'});await waitFor("!!document.querySelector('.seller-sale-complete [role=alert]')");await exitReady();assert.ok(await evaluate("document.querySelector('.seller-sale-complete [role=alert]').textContent.includes('denegado')"));const errorSaved=await state();await clickText('Cerrar');await free();assert.deepEqual(await state(),errorSaved);check(device.name+': permission/error preparing receipt never blocks Close or changes accounting')
    await begin({detailMode:'hang'});await waitFor("!!document.querySelector('.seller-sale-complete .post-sale-retry')",15000);await exitReady();assert.ok(await evaluate("document.querySelector('.seller-sale-complete [role=alert]').textContent.includes('a tiempo')"));check(device.name+': receipt query deadline produces an honest retry state with exits available')
    await evaluate("window.__detailMode=''");await tap('.post-sale-retry');await waitFor("!!document.querySelector('.seller-sale-complete .fd-num')");await exitReady();assert.equal(await evaluate('window.__saleCalls'),1);check(device.name+': retry only loads the same persisted invoice and does not charge again')
    await tap('.fd-link');await waitFor("!!document.querySelector('.fd-contact')");await field('.fd-contact input[inputmode=tel]','');await field('.fd-contact input[type=email]','invalid-email')
    await waitFor("!document.querySelector('.fd-act.wa').disabled");await tap('.fd-act.wa');await waitFor("!!document.querySelector('.invoice-delivery [role=alert]')");await exitReady();const noDelivery=await state()
    await send('Emulation.setDeviceMetricsOverride',{width:device.landscapeWidth,height:device.landscapeHeight,deviceScaleFactor:1,mobile:true});await delay(200);await exitReady();assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth+1'),false);check(device.name+': missing phone, invalid optional email and landscape preserve all post-sale exits')
    await clickText('Nueva venta');await free();assert.deepEqual(await state(),noDelivery);assert.equal(await evaluate('window.__saleCalls'),1);assert.equal(await evaluate("!!document.querySelector('.pos-bar')"),false);check(device.name+': New sale ignores optional delivery validation and keeps the confirmed invoice exactly once')
    await send('Emulation.setDeviceMetricsOverride',{width:device.width,height:device.height,deviceScaleFactor:1,mobile:true})
    await begin({messageMode:'hang'});await waitFor("!!document.querySelector('.seller-sale-complete .fd-num')");await exitReady();assert.equal(await evaluate("document.querySelector('.fd-act.mail').disabled"),true);const messageSaved=await state();await clickText('Nueva venta');await free();assert.deepEqual(await state(),messageSaved);check(device.name+': unavailable message configuration cannot block continuing without WhatsApp/email')
  }
  assert.deepEqual(externalRequests,[]);assert.deepEqual(browserErrors,[])
  await writeFile(join(artifacts,'results.json'),JSON.stringify({status:'PASS',cases:results.length,results,remoteCalls:0,physicalSafariPending:true},null,2));console.log(JSON.stringify({status:'PASS',cases:results.length,artifacts}));await send('Browser.close').catch(()=>{})
} catch(error){
  await writeFile(join(artifacts,'results.json'),JSON.stringify({status:'FAIL',error:error.stack,results,externalRequests,browserErrors},null,2)+'\n');console.error(error.stack);process.exitCode=1
} finally {
  try{if(socket?.readyState===1)socket.send(JSON.stringify({id:2147483000,method:'Browser.close'}))}catch{}await delay(1200);socket?.close();if(browser.exitCode===null)browser.kill()
  if(!profile.startsWith(join(tmpdir(),'angie-tech-ui-')))throw Error('Unexpected test profile path')
  await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{})
}
