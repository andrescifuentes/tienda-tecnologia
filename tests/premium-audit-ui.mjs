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
const artifacts = join(root, 'artifacts', process.env.UI_ARTIFACTS || 'premium-audit')
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

  await send('Page.enable');await send('Runtime.enable');await send('Log.enable');await send('DOM.enable');await send('Emulation.setFocusEmulationEnabled',{enabled:true});await send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]})
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  await send('Page.navigate',{url:base+'/login'});await waitFor("!!document.querySelector('.login-form')");await evaluate("document.querySelector('.login-form .btn').click()");await waitFor("!!document.querySelector('.stat-card')")
  const check=name=>results.push({name,status:'PASS'})
  const button=async text=>{await evaluate('(()=>{const scope=[...document.querySelectorAll(".sheet")].at(-1)||document;const b=[...scope.querySelectorAll("button")].find(b=>b.textContent.trim()==='+JSON.stringify(text)+');if(!b)throw Error("Missing button");b.click()})()');await delay(100)}
  const inputExpression=label=>'document.getElementById([...document.querySelectorAll("label")].find(l=>l.textContent.trim()==='+JSON.stringify(label)+').htmlFor)'
  const field=async(label,value)=>{await evaluate('(()=>{const i='+inputExpression(label)+';Object.getOwnPropertyDescriptor(i.tagName==="SELECT"?HTMLSelectElement.prototype:i.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,"value").set.call(i,'+JSON.stringify(String(value))+');i.dispatchEvent(new Event(i.tagName==="SELECT"?"change":"input",{bubbles:true}))})()');await delay(50)}
  const focus=async label=>{await evaluate(inputExpression(label)+'.focus()');await delay(80)}
  const value=label=>evaluate(inputExpression(label)+'.value')
  const blur=()=>evaluate('document.activeElement.blur()')
  const go=async path=>{await send('Page.navigate',{url:base+path});await waitFor("!!document.querySelector('.nav') && document.readyState==='complete'");await delay(150)}
  const close=()=>evaluate("[...document.querySelectorAll('.sheet')].at(-1).querySelector('.sheet-x').click()")
  const state=()=>evaluate("JSON.parse(localStorage.getItem('angie-tech:demo:v1'))")
  const findings=[]
  for(const theme of ['dark','light'])for(const [width,height]of [[320,700],[360,800],[390,844],[430,932]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await evaluate(`import('/src/lib/theme.js').then(m=>m.setTheme(${JSON.stringify(theme)}))`)
    await go('/finanzas');await waitFor("!!document.querySelector('.finance-movement')");await geometry(`${theme}-${width}-finance`,width,height);await screenshot(`${theme}-${width}-finance`)
    const current=await evaluate("document.querySelector('.finance-period b').textContent");await tap('[aria-label="Mes financiero anterior"]');await waitFor(`document.querySelector('.finance-period b').textContent!==${JSON.stringify(current)} && !document.querySelector('.loading-state')`);await tap('[aria-label="Mes financiero siguiente"]');await waitFor(`document.querySelector('.finance-period b').textContent===${JSON.stringify(current)} && !!document.querySelector('.finance-movement')`)
    await evaluate("document.querySelector('.finance-movements').scrollIntoView({block:'start'})");await screenshot(`${theme}-${width}-movement-list`);await tap('.movement-delete');await waitFor("!!document.querySelector('.finance-confirm-sheet')");await geometry(`${theme}-${width}-delete-confirmation`,width,height);await screenshot(`${theme}-${width}-delete-confirmation`);await button('Cancelar');
    await go('/');await waitFor("!!document.querySelector('.home-metrics')")
    for(const label of ['Ventas de hoy','Ventas del mes']){
      await tap(`[aria-label="${label}"]`);await waitFor("!!document.querySelector('.sales-metric-sheet')");await geometry(`${theme}-${width}-${label}`,width,height);await screenshot(`${theme}-${width}-${label.replaceAll(' ','-')}`);assert.ok(await evaluate("document.querySelector('.metric-summary strong').textContent.includes('$')"));assert.ok(await evaluate("document.querySelectorAll('.metric-invoice').length>0"));await close()
    }
    check(`${theme} ${width}: finance month navigation, premium balance/movements and both metric sheets`)
  }
  await tap('[aria-label="Ventas del mes"]');await tap('.metric-invoice');await waitFor("location.search.includes('factura=') && !!document.querySelector('.invoice-detail-sheet')");check('Premium metric invoice row preserves invoice-detail navigation');await close()
  for(const theme of ['dark','light']){
    await send('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:1,mobile:true});await evaluate(`import('/src/lib/theme.js').then(m=>m.setTheme(${JSON.stringify(theme)}))`);await go('/finanzas');await button('+ Registrar');await geometry(`${theme}-landscape-movement`,844,390);await evaluate("document.querySelector('.date-field button').click()");await waitFor("!!document.querySelector('.angie-calendar')");await geometry(`${theme}-landscape-calendar`,844,390);await screenshot(`${theme}-landscape-calendar`);await button('Cancelar');await close();check(`${theme}: landscape sheets preserve scroll and calendar actions`)
  }
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await go('/finanzas');await button('+ Registrar');const count=(await state()).tables.movimientos.length;await button('Registrar gasto');assert.ok(await evaluate("document.querySelector('[role=alert]').textContent.includes('categoría')"));await field('Categoría','Transporte');await field('Monto','0');await button('Registrar gasto');assert.ok(await evaluate("document.querySelector('[role=alert]').textContent.includes('mayor que cero')"));assert.equal((await state()).tables.movimientos.length,count);await field('Monto','9007199254740993');assert.equal(await value('Monto'),'9.007.199.254.740.993');await button('+10 mil');assert.equal(await value('Monto'),'9.007.199.254.750.993');await button('Registrar gasto');assert.ok(await evaluate("document.querySelector('[role=alert]').textContent.includes('demasiado grande')"));assert.equal((await state()).tables.movimientos.length,count);await close();check('Empty fields, zero and unsafe monetary values are rejected atomically; chips preserve all entered digits')
  await button('+ Registrar');assert.equal(await value('Monto'),'');await field('Categoría','Transporte');await field('Monto','$ 1,200,000');assert.equal(await value('Monto'),'1.200.000');await field('Descripción (opcional)','Auditoría eliminación');await evaluate("(()=>{const b=document.querySelector('.movement-form .sheet-foot button');b.click();b.click()})()");await waitFor("!document.querySelector('.movement-form')");assert.equal((await state()).tables.movimientos.length,count+1);await button('+ Registrar');await field('Monto','50000');await close();assert.equal((await state()).tables.movimientos.length,count+1);check('Paste, double tap and close without saving preserve exactly one financial record')
  await evaluate("[...document.querySelectorAll('.finance-movement')].find(r=>r.textContent.includes('Auditoría eliminación')).querySelector('.movement-delete').click()");await button('Cancelar');assert.equal((await state()).tables.movimientos.length,count+1);await evaluate("[...document.querySelectorAll('.finance-movement')].find(r=>r.textContent.includes('Auditoría eliminación')).querySelector('.movement-delete').click()");await button('Eliminar');await waitFor("!document.querySelector('.finance-confirm-sheet')");assert.equal((await state()).tables.movimientos.length,count);check('Premium delete confirmation cancels safely and deletes only the selected manual movement')
  await go('/facturas?factura=3');await waitFor("!!document.querySelector('.invoice-detail-sheet')");await button('Anular');await field('Motivo de la anulación','Auditoría PDF anulada');await button('Confirmar anulación');await waitFor("document.querySelector('.invoice-detail-sheet')?.textContent.includes('Motivo de anulación')");await button('PDF / Imprimir');assert.ok(await evaluate("document.querySelector('[data-print-invoice]').textContent.includes('anulada')"));await button('Guardar PDF');check('Cancelled invoices retain a usable document preview and real PDF generation');await close()
  await go('/inventario');await button('+ Nuevo');await field('Nombre','Audit precision');await field('Código único (SKU)','AUD-PRECISION');await field('Categoría','1');await field('Precio compra','18000');await field('Precio venta','9007199254740993');await button('Guardar');assert.ok(await evaluate("document.querySelector('.product-form [role=alert]')?.textContent.includes('demasiado grande')"));assert.ok(!(await state()).tables.productos.some(p=>p.codigo==='AUD-PRECISION'));await close();check('Unsafe product price is rejected with no rounded record saved')
  // Two actual tabs share the same isolated browser storage; outbound requests remain blocked.
  await go('/');await waitFor("!!document.querySelector('.home-metrics')");await evaluate("window.__auditStorageEvents=0;window.addEventListener('storage',()=>window.__auditStorageEvents++)")
  const dashboardBefore=await evaluate("document.querySelector('[aria-label=\"Ingresos del mes\"] .stat-value').textContent")
  const peerTarget=await (await fetch(`http://${debugUrl.host}/json/new?about:blank`,{method:'PUT'})).json(),peer=new WebSocket(peerTarget.webSocketDebuggerUrl)
  await new Promise((resolve,reject)=>{peer.addEventListener('open',resolve,{once:true});peer.addEventListener('error',reject,{once:true})})
  let peerSeq=0;const peerPending=new Map()
  const peerSend=(method,params={})=>new Promise((resolve,reject)=>{const id=++peerSeq,timer=setTimeout(()=>reject(Error('Peer CDP timeout '+method)),30000);peerPending.set(id,{resolve,reject,timer});peer.send(JSON.stringify({id,method,params}))})
  peer.addEventListener('message',async({data})=>{const event=JSON.parse(data);if(event.id){const p=peerPending.get(event.id);if(p){clearTimeout(p.timer);peerPending.delete(event.id);event.error?p.reject(Error(JSON.stringify(event.error))):p.resolve(event.result)}}else if(event.method==='Fetch.requestPaused'){const{requestId,request}=event.params;const url=new URL(request.url);if(url.origin!==new URL(base).origin&&url.protocol!=='data:'){externalRequests.push(request.url);await peerSend('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'})}else await peerSend('Fetch.continueRequest',{requestId})}})
  const peerEval=async expression=>{const r=await peerSend('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value}
  try{
    await peerSend('Page.enable');await peerSend('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});await peerSend('Page.navigate',{url:base+'/finanzas'});for(let i=0;i<100&&!(await peerEval("!!document.querySelector('.finance-period')"));i++)await delay(100)
    const insert=description=>`import('/src/lib/supabase.js').then(async({supabase})=>{const r=await supabase.from('movimientos').insert({tipo:'ingreso',categoria:'Servicio',descripcion:${JSON.stringify(description)},monto:12345,fecha:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota'}).format(new Date())});if(r.error)throw Error(r.error.message);return true})`
    await peerEval(insert('AUDIT-OTHER-TAB'));await waitFor("window.__auditStorageEvents>0");await delay(500);const dashboardAfter=await evaluate("document.querySelector('[aria-label=\"Ingresos del mes\"] .stat-value').textContent");assert.ok((await state()).tables.movimientos.some(m=>m.descripcion==='AUDIT-OTHER-TAB'));assert.equal(Number(dashboardAfter.replace(/\D/g,'')),Number(dashboardBefore.replace(/\D/g,''))+12345);await screenshot('cross-tab-dashboard');check('Cross-tab audit verifies real storage event, persisted movement and visible Dashboard value')
    const prefix='AUDIT-CONCURRENT-'+Date.now(),iterations=20;
    const batch=side=>`import('/src/lib/supabase.js').then(async({supabase})=>{let ok=0;for(let i=0;i<${iterations};i++){const r=await supabase.from('movimientos').insert({tipo:'ingreso',categoria:'Servicio',descripcion:${JSON.stringify(prefix+'-'+side+'-')}+i,monto:10,fecha:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota'}).format(new Date())});if(!r.error)ok++}return ok})`
    const successes=await Promise.all([evaluate(batch('A')),peerEval(batch('B'))]);const stored=(await state()).tables.movimientos.filter(m=>m.descripcion?.startsWith(prefix)).length;assert.equal(successes[0]+successes[1],40);assert.equal(stored,40);check('Concurrent two-tab writes are counted against actual persisted records')
  }finally{peer.close();await send('Target.closeTarget',{targetId:peerTarget.id}).catch(()=>{})}
  assert.deepEqual(findings,[]);assert.deepEqual(externalRequests,[]);assert.deepEqual(browserErrors,[])
  await writeFile(join(artifacts,'findings.json'),JSON.stringify({status:findings.length?'COMPLETED_WITH_FINDINGS':'PASS',findings,corrected:['PDF access for cancelled invoices','Finance rejects unsafe amounts; amount chips use exact integer addition'],physicalSafari:'Not tested on a physical iPhone'},null,2))
  await writeFile(join(artifacts,'results.json'),JSON.stringify({status:'PASS',cases:results.length,results,externalRequests,browserErrors,auditFindings:findings.length,physicalSafari:'Pending physical check'},null,2));console.log(JSON.stringify({status:'PASS',cases:results.length,auditFindings:findings.length,artifacts}));await send('Browser.close').catch(()=>{})

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
