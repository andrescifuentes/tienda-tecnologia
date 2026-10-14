import assert from 'node:assert/strict'
import { esEntornoDemoPermitido } from '../src/lib/demo/environment.js'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// No npm dependencies, production accounts, real camera, or remote requests.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const artifacts = join(root, 'artifacts', process.env.UI_ARTIFACTS || 'search-keyboard')
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
        if (url.origin !== new URL(base).origin && url.protocol !== 'data:') {
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


﻿  await send('Page.enable');await send('Page.bringToFront');await send('Runtime.enable');await send('Log.enable');await send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await send('Page.navigate',{url:base+'/login'});await waitFor("!!document.querySelector('.login-form')");await evaluate("document.querySelector('.login-form .btn').click()");await waitFor("!!document.querySelector('.stat-card')");
  const evidence=[];
  const go=async path=>{await send('Page.navigate',{url:base+path});await waitFor("!!document.querySelector('.nav') && document.readyState==='complete'");await delay(600)};
  const rpc=(name,args)=>evaluate(`import('/src/lib/supabase.js').then(async({supabase})=>{const r=await supabase.rpc(${JSON.stringify(name)},${JSON.stringify(args)});if(r.error)throw Error(r.error.message);return r.data})`);
  const state=()=>evaluate("JSON.parse(localStorage.getItem('angie-tech:demo:v1')).tables");
  const record=(id,data)=>{const status=['AT-01','AT-03'].includes(id)?'FIXED':'REPRODUCED';evidence.push({id,status,...data});results.push({name:id+' '+status,status:'PASS'});console.log(id+' '+status)};
  const button=async text=>{await evaluate(`(()=>{const scope=[...document.querySelectorAll('.sheet')].at(-1)||document;const b=[...scope.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Missing '+${JSON.stringify(text)});b.click()})()`);await delay(120)};
  const peerTarget=await (await fetch(`http://${debugUrl.host}/json/new?about:blank`,{method:'PUT'})).json(),peer=new WebSocket(peerTarget.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{peer.addEventListener('open',resolve,{once:true});peer.addEventListener('error',reject,{once:true})});
  let peerSeq=0;const peerPending=new Map();
  const peerSend=(method,params={})=>new Promise((resolve,reject)=>{const id=++peerSeq,timer=setTimeout(()=>reject(Error('Peer CDP timeout '+method)),30000);peerPending.set(id,{resolve,reject,timer});peer.send(JSON.stringify({id,method,params}))});
  peer.addEventListener('message',async({data})=>{const event=JSON.parse(data);if(event.id){const p=peerPending.get(event.id);if(p){clearTimeout(p.timer);peerPending.delete(event.id);event.error?p.reject(Error(JSON.stringify(event.error))):p.resolve(event.result)}}else if(event.method==='Fetch.requestPaused'){const{requestId,request}=event.params;const url=new URL(request.url);if(url.origin!==new URL(base).origin&&url.protocol!=='data:'){externalRequests.push(request.url);await peerSend('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'})}else await peerSend('Fetch.continueRequest',{requestId})}});
  const peerEval=async expression=>{const r=await peerSend('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value};
  const peerQuery=(table,method,data,id)=>peerEval(`import('/src/lib/supabase.js').then(async({supabase})=>{let q=supabase.from(${JSON.stringify(table)})[${JSON.stringify(method)}](${JSON.stringify(data)});${id===undefined?'':`q=q.eq('id',${JSON.stringify(id)});`}const r=await q.select();if(r.error)throw Error(r.error.message);return r.data})`);
  try{
    await peerSend('Page.enable');await peerSend('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});await peerSend('Page.navigate',{url:base+'/'});for(let i=0;i<100&&!(await peerEval("!!document.querySelector('.nav')"));i++)await delay(100);
    const p=(await state()).productos.find(p=>p.codigo==='USBC2M');
    await go('/vender');await waitFor("!!document.querySelector('[aria-label=\"Agregar Cable USB-C trenzado 2 metros\"]')");await evaluate("document.querySelector('[aria-label=\"Agregar Cable USB-C trenzado 2 metros\"]').click()");await waitFor("!!document.querySelector('.cart-bar-button')");
    const displayed=await evaluate("document.querySelector('.cart-bar-button strong').textContent");await peerQuery('productos','update',{precio_venta:p.precio_venta+1000},p.id);await delay(450);assert.equal(await evaluate("document.querySelector('.cart-bar-button strong').textContent"),displayed);
    await evaluate("document.querySelector('.cart-bar-button').click()");await waitFor("!!document.querySelector('.checkout-sheet')");const confirm=await evaluate("document.querySelector('.checkout-sheet .sheet-foot button').textContent");await evaluate("document.querySelector('.checkout-sheet .sheet-foot button').click()");await waitFor("!!document.querySelector('.invoice-detail-sheet')");const latest=(await state()).facturas.at(-1);assert.equal(latest.total,p.precio_venta);record('AT-01',{displayed,confirmation:confirm,invoiced:latest.total,expected:p.precio_venta});
    await go('/clientes');await waitFor("!!document.querySelector('.entity-list .row')");const customer=(await state()).clientes[0];await peerQuery('clientes','update',{nombre:'AUDIT other-tab customer'},customer.id);await delay(700);assert.equal(await evaluate("document.body.innerText.includes('AUDIT other-tab customer')"),false);await go('/clientes');await waitFor("document.body.innerText.includes('AUDIT other-tab customer')");record('AT-05',{customer:customer.id,otherTabUpdateVisibleBeforeReload:false,afterReload:true});
    const customerHistory=(await peerQuery('clientes','insert',{nombre:'AUDIT history 31'}))[0];for(let i=0;i<31;i++){if(i===0)await rpc('ajustar_stock_fisico_demo',{id:p.id,stock:100,motivo:'Audit history fixture'});await rpc('emitir_factura',{p_cliente_id:customerHistory.id,p_metodo_pago:'efectivo',p_items:[{producto_id:p.id,cantidad:1}],p_request_id:'audit-history-'+i})}
    await go('/clientes');await waitFor("[...document.querySelectorAll('.entity-list .row')].some(r=>r.textContent.includes('AUDIT history 31'))");await evaluate("[...document.querySelectorAll('.entity-list .row')].find(r=>r.textContent.includes('AUDIT history 31')).click()");await waitFor("document.querySelector('.sheet')?.textContent.includes('Total comprado')");const history=await evaluate("({rows:document.querySelectorAll('.sheet .row.cursor-pointer').length,total:document.querySelector('.sheet .card p').textContent})");assert.equal(history.rows,31);assert.equal(history.total.replace(/[^0-9]/g,''),String(31*(p.precio_venta+1000)));record('AT-03',{storedInvoices:31,visibleInvoices:history.rows,detailTotal:history.total,expectedTotal:31*(p.precio_venta+1000)});
    const wp=await rpc('crear_producto_demo',{producto:{codigo:'AUDIT-W',nombre:'Audit warranty',precio_compra:10,precio_venta:20,garantia_meses:12},stock:2});const wf=await rpc('emitir_factura',{p_metodo_pago:'efectivo',p_items:[{producto_id:wp.id,cantidad:1}]});const wg=(await state()).garantias.at(-1);await rpc('actualizar_garantia_demo',{id:wg.id,estado:'vigente',nota:'Audit note'});await rpc('anular_factura',{p_factura_id:wf,p_motivo:'Audit cancellation'});await go('/garantias');await waitFor("!!document.querySelector('.warranty-card')");const badge=await evaluate("[...document.querySelectorAll('.warranty-card')].find(r=>r.textContent.includes('Audit warranty'))?.querySelector('.badge').textContent");assert.equal(badge,'Vigente');record('AT-04',{storedStatus:'resuelta',visibleBadge:badge,invoiceCancelled:true});
    const products=Array.from({length:80},(_,i)=>({codigo:'AUDIT-A-'+i,nombre:'AAA audit product '+String(i).padStart(3,'0'),precio_compra:1,precio_venta:2,categoria_id:1,stock_min:0,garantia_meses:0}));await peerQuery('productos','insert',products);await rpc('crear_producto_demo',{producto:{codigo:'AUDIT-ZZ',nombre:'ZZZ audit unique category',precio_compra:1,precio_venta:2,categoria_id:7,stock_min:0,garantia_meses:0},stock:10});await go('/inventario');await waitFor("document.querySelectorAll('.product-card').length===80");await button('Agotados');await delay(400);assert.equal(await evaluate("document.querySelectorAll('.product-card').length"),80);const actualEmpty=(await state()).productos.filter(p=>p.activo&&p.stock===0).length;assert.ok(actualEmpty>80);await go('/vender');await waitFor("document.querySelectorAll('.sale-product').length===30");await button('Otros');await delay(150);assert.equal(await evaluate("document.querySelectorAll('.sale-product').length"),0);record('AT-06',{activeEmptyProducts:actualEmpty,inventoryDisplays:80,salesOthersDisplays:0,availableOtherCategoryProduct:'AUDIT-ZZ'});
    await go('/inventario');await button('+ Nuevo');await waitFor("!!document.querySelector('.product-form')");await evaluate("(()=>{const i=document.getElementById([...document.querySelectorAll('.sheet label')].find(l=>l.textContent==='Nombre').htmlFor);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'AUDIT unsaved draft');i.dispatchEvent(new Event('input',{bubbles:true}))})()");await evaluate("document.querySelector('.sheet-x').click()");await waitFor("!document.querySelector('.sheet')");await button('+ Nuevo');await waitFor("!!document.querySelector('.product-form')");const draft=await evaluate("document.getElementById([...document.querySelectorAll('.sheet label')].find(l=>l.textContent==='Nombre').htmlFor).value");assert.equal(draft,'');record('AT-09',{typed:'AUDIT unsaved draft',confirmationShown:false,valueAfterReopening:draft});await evaluate("document.querySelector('.sheet-x').click()");
    await go('/clientes');await waitFor("!!document.querySelector('.entity-list')");await peerEval("import('/src/lib/supabase.js').then(({supabase})=>supabase.auth.signOut())");await delay(600);assert.equal(await evaluate("!!document.querySelector('.nav') && location.pathname==='/clientes'"),true);await send('Page.reload');await waitFor("location.pathname==='/login' && !!document.querySelector('.login-form')");record('AT-11',{otherTabSignedOut:true,mainTabRemainsInside:true,reloadRedirectsToLogin:true});
    await writeFile(join(artifacts,'evidence.json'),JSON.stringify({findings:evidence,scope:'isolated local demo profiles; no production data'},null,2));
  }finally{peer.close();await send('Target.closeTarget',{targetId:peerTarget.id}).catch(()=>{})}
  assert.deepEqual(externalRequests,[]);assert.deepEqual(browserErrors,[]);await writeFile(join(artifacts,'results.json'),JSON.stringify({status:'PASS',cases:results.length,results,externalRequests,browserErrors,meaning:'AT-01 and AT-03 must be fixed; remaining entries must still reproduce as requested'},null,2));console.log(JSON.stringify({status:'PASS',cases:results.length,artifacts}));await send('Browser.close').catch(()=>{});

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
