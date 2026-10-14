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
const artifacts = join(root, 'artifacts', process.env.UI_ARTIFACTS || 'finance-detail-large')
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
  await send('Page.enable');await send('Page.bringToFront');await send('Runtime.enable');await send('Log.enable');await send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  const check=name=>results.push({name,status:'PASS'});
  const api=body=>evaluate("import('/src/lib/supabase.js').then(async({supabase})=>{"+body+"})");
  const click=async selector=>{await evaluate('document.querySelector('+JSON.stringify(selector)+').click()');await delay(150)};
  const go=async path=>{await send('Page.navigate',{url:base+path});await waitFor("!!document.querySelector('.nav') && document.readyState==='complete'");await delay(300)};
  const close=async()=>{await click('.sheet .sheet-x');await waitFor("!document.querySelector('.sheet')")};
  await send('Page.navigate',{url:base+'/login'});await waitFor("!!document.querySelector('.login-form')");await click('.login-form .btn');await waitFor("!!document.querySelector('.home-metrics')");
  await api("const fecha=new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'});for(const tipo of ['ingreso','gasto']){const r=await supabase.from('movimientos').insert({tipo,categoria:'Prueba de cifras grandes',descripcion:'Importe de validacion local',monto:89999999999999,fecha});if(r.error)throw Error(r.error.message)}");
  for(const theme of ['dark','light'])for(const[width,height]of [[320,700],[360,800],[390,844],[430,932],[844,390]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await evaluate('import("/src/lib/theme.js").then(m=>m.setTheme('+JSON.stringify(theme)+'))');await go('/finanzas');await waitFor("!document.querySelector('.loading-state')");await geometry(theme+' '+width+' finance large cards',width,height);
    for(const label of ['Ingresos','Gastos']){
      await click('[aria-label="'+label+'"]');await waitFor("!!document.querySelector('.finance-detail-hero')");const m=await evaluate("(()=>{const s=document.querySelector('.finance-detail-sheet'),r=s.getBoundingClientRect(),b=s.querySelector('.sheet-body'),f=s.querySelector('.sheet-foot').getBoundingClientRect();return{sum:[...s.querySelectorAll('.finance-detail-row')].reduce((n,e)=>n+Number(e.dataset.amount),0),total:s.querySelector('.finance-detail-total strong').textContent,scrollHeight:b.scrollHeight,clientHeight:b.clientHeight,footer:f.bottom,sheet:r.bottom,overflow:[...s.querySelectorAll('*')].filter(e=>{const t=e.getBoundingClientRect();return t.width&&(t.left<r.left-1||t.right>r.right+1||e.scrollWidth>e.clientWidth+2)&&!e.closest('svg')}).map(e=>e.className)}})()");assert.deepEqual(m.overflow,[]);assert.equal(m.total,'$'+m.sum.toLocaleString('es-CO'));assert.ok(m.footer<=height&&m.footer<=m.sheet);if(width===390){assert.ok(m.scrollHeight>m.clientHeight);await screenshot(theme+'-'+label+'-large')};await evaluate("document.querySelector('.sheet-body').scrollTop=100000");await delay(80);assert.ok(await evaluate("document.querySelector('.sheet-body').scrollTop>0"));check(theme+' '+width+' '+label+' large totals, reconciliation, scroll and footer');await close();
    }
  }
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await go('/finanzas');await waitFor("!document.querySelector('.loading-state')");await click('[aria-label="Ingresos"]');await waitFor("!!document.querySelector('.finance-detail-hero')");
  const periodTotal=await evaluate("document.querySelector('.finance-detail-total strong').textContent");
  const search=async value=>{await evaluate('(()=>{const e=document.querySelector(".finance-detail-sheet .search-bar input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,'+JSON.stringify(value)+');e.dispatchEvent(new Event("input",{bubbles:true}))})()');await delay(150)};
  await search('importe de validacion local');assert.equal(await evaluate("document.querySelectorAll('.finance-detail-row').length"),1);assert.equal(await evaluate("Number(document.querySelector('.finance-detail-row').dataset.amount)"),89999999999999);assert.equal(await evaluate("document.querySelector('.finance-detail-total strong').textContent"),periodTotal);check('Shared search filters actual concepts and shows a separate subtotal without changing period total');
  await search('NONEXISTENT-FINANCE-ROW');assert.equal(await evaluate("document.querySelectorAll('.finance-detail-row').length"),0);assert.ok(await evaluate("document.querySelector('.finance-detail-sheet .empty-state').textContent.includes('Sin coincidencias')"));check('Search without matches shows a clear empty state');
  await search('FV-');assert.ok(await evaluate("[...document.querySelectorAll('.finance-detail-row')].every(e=>e.textContent.includes('FV-'))"));check('Search accepts invoice references');
  await evaluate("document.querySelector('.finance-detail-sheet .search-bar input').focus();Object.defineProperty(visualViewport,'height',{configurable:true,value:450});Object.defineProperty(visualViewport,'offsetTop',{configurable:true,value:30});visualViewport.dispatchEvent(new Event('resize'))");await delay(150);assert.deepEqual(await evaluate("(()=>{const s=document.querySelector('.finance-detail-sheet'),r=s.getBoundingClientRect(),f=s.querySelector('.sheet-foot').getBoundingClientRect();return[r.top,r.bottom,f.bottom]})()"),[30,480,480]);await screenshot('finance-search-keyboard');await evaluate("document.activeElement.blur();delete visualViewport.height;delete visualViewport.offsetTop;visualViewport.dispatchEvent(new Event('resize'))");check('Finance search keyboard preserves continuous sheet and total footer');
  await click('[aria-label="Mes anterior del detalle"]');await waitFor("!!document.querySelector('.finance-detail-hero')");assert.equal(await evaluate("document.querySelector('.finance-detail-sheet .search-bar input')?.value||''"),'');check('Changing the period resets the previous search');await close();
  await go('/vender');await waitFor("!!document.querySelector('[aria-label=\"Agregar Cable USB-C trenzado 2 metros\"]')");await tap('[aria-label="Agregar Cable USB-C trenzado 2 metros"]');await tap('[aria-label="Aumentar Cable USB-C trenzado 2 metros"]');await evaluate("document.querySelector('[aria-label=\"Disminuir Cable USB-C trenzado 2 metros\"]').scrollIntoView({block:'center'})");await delay(2500);await screenshot('390-selected-product');await send('Page.reload');await waitFor("!!document.querySelector('[aria-label=\"Unidades de Cable USB-C trenzado 2 metros\"]')");assert.equal(await evaluate("document.querySelector('[aria-label=\"Unidades de Cable USB-C trenzado 2 metros\"]').textContent"),'2');check('Touch controls work and inline quantity persists after reload through the existing user cart draft');
  await api("const r=await supabase.rpc('guardar_empleado_demo',{id:'demo-ana',datos:{},permisos:['vender','ver_inventario','ver_finanzas']});if(r.error)throw Error(r.error.message);await supabase.auth.signInWithPassword({email:'ana@angietech.demo',password:'AngieDemo123!'})");await go('/finanzas');await waitFor("!document.querySelector('.loading-state')");assert.equal(await evaluate("document.querySelectorAll('.finance-stats .stat-card').length"),2);await click('[aria-label="Ingresos"]');await waitFor("!!document.querySelector('.finance-detail-hero')");assert.equal(await evaluate("!!document.querySelector('.finance-detail-sheet [role=alert]')"),false);assert.equal(await evaluate("[...document.querySelectorAll('.finance-detail-row')].reduce((n,e)=>n+Number(e.dataset.amount),0)"),await evaluate("Number(document.querySelector('.finance-stats button[aria-label=\"Ingresos\"] .stat-value').textContent.replace(/[^0-9]/g,''))"));check('Seller finance detail reconciles only permitted sales without exposing costs');await close();
  assert.deepEqual(externalRequests,[]);assert.deepEqual(browserErrors,[]);await writeFile(join(artifacts,'results.json'),JSON.stringify({status:'PASS',cases:results.length,results,externalRequests,browserErrors,physicalSafariPending:true},null,2));console.log(JSON.stringify({status:'PASS',cases:results.length,artifacts}));await send('Browser.close').catch(()=>{});
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
