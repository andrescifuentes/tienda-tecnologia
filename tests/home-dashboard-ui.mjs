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
const artifacts = join(root, 'artifacts', process.env.UI_ARTIFACTS || 'home-dashboard')
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
  const field=async(label,value)=>{await evaluate('(()=>{const i='+inputExpression(label)+';Object.getOwnPropertyDescriptor(i.tagName==="SELECT"?HTMLSelectElement.prototype:HTMLInputElement.prototype,"value").set.call(i,'+JSON.stringify(String(value))+');i.dispatchEvent(new Event(i.tagName==="SELECT"?"change":"input",{bubbles:true}))})()');await delay(50)}
  const focus=async label=>{await evaluate(inputExpression(label)+'.focus()');await delay(80)}
  const value=label=>evaluate(inputExpression(label)+'.value')
  const blur=()=>evaluate('document.activeElement.blur()')
  const go=async path=>{await send('Page.navigate',{url:base+path});await waitFor("!!document.querySelector('.nav') && document.readyState==='complete'");await delay(150)}
  const close=()=>evaluate("[...document.querySelectorAll('.sheet')].at(-1).querySelector('.sheet-x').click()")

  const state=()=>evaluate("JSON.parse(localStorage.getItem('angie-tech:demo:v1'))")
  const home=async()=>{await go('/');await waitFor("!!document.querySelector('.home-metrics button')")}
  const rpc=(name,args)=>evaluate('import("/src/lib/supabase.js").then(async m=>{const r=await m.supabase.rpc('+JSON.stringify(name)+','+JSON.stringify(args)+');if(r.error)throw Error(r.error.message);return r.data})')
  await home();const seed=(await state()).tables,product=seed.productos.find(p=>p.activo),invoice=seed.facturas.find(f=>f.estado==='emitida')
  for(const [label,path]of [['Nueva venta','/vender'],['Inventario','/inventario'],['Facturas','/facturas']]){await home();await button(label);await waitFor('location.pathname==='+JSON.stringify(path));check('Quick access '+label+' opens '+path)}
  await home();assert.deepEqual(await evaluate("[...document.querySelectorAll('.quick-actions button')].map(b=>b.textContent.trim())"),['Nueva venta','Inventario','Facturas']);assert.equal(await evaluate("[...document.querySelectorAll('.quick-actions button,.nav button,.nav a')].some(b=>b.textContent.includes('Clientes'))"),false);check('No Clientes promotion; exactly three columns and five bottom destinations')
  const search=async text=>{await home();await evaluate('(()=>{const i=document.querySelector(".search-bar input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(i,'+JSON.stringify(text)+');i.dispatchEvent(new Event("input",{bubbles:true}))})()');await waitFor("!!document.querySelector('.search-results button')");await tap('.search-results button');await waitFor("!!document.querySelector('.sheet')")}
  for(const text of [product.nombre,product.codigo]){await search(text);assert.ok((await evaluate("document.querySelector('.sheet').textContent")).includes(product.nombre));check('Search '+text+' opens product detail')}
  await search(invoice.prefijo+'-'+String(invoice.numero).padStart(4,'0'));assert.ok(await evaluate("location.search.includes('factura=')"));check('Full invoice number search opens invoice detail')
  await home();await tap('[aria-label="Escanear"]');await waitFor("!!document.getElementById('scanner-code')");await field('…o digita el código',product.codigo);await button('OK');await waitFor("location.search.includes('producto=') && !!document.querySelector('.sheet')");check('Scanner manual fallback resolves SKU and opens product')
  await home();await tap('.hero-arrow');await waitFor("location.pathname==='/vender'");check('Hero arrow opens Nueva venta')
  for(const [label,day]of [['Ventas de hoy',true],['Ventas del mes',false]]){await home();await tap('[aria-label="'+label+'"]');await waitFor("!!document.querySelector('.sheet')");const expected=await evaluate('(()=>{const t=JSON.parse(localStorage.getItem("angie-tech:demo:v1")).tables;const today=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Bogota"}).format(new Date());return t.facturas.filter(f=>f.estado==="emitida" && '+(day?'new Intl.DateTimeFormat("en-CA",{timeZone:"America/Bogota"}).format(new Date(f.fecha))===today':'new Intl.DateTimeFormat("en-CA",{timeZone:"America/Bogota"}).format(new Date(f.fecha)).startsWith(today.slice(0,7))')+').length})()');assert.equal(await evaluate("document.querySelectorAll('.sheet button.menu-row').length"),expected);if(expected){await tap('.sheet button.menu-row');await waitFor("location.search.includes('factura=') && !!document.querySelector('.sheet')")};check(label+' opens correct period and invoice detail')}
  await home();await tap('[aria-label="Ingresos del mes"]');await waitFor("location.pathname==='/finanzas'");check('Income metric opens Finanzas')
  await home();await tap('[aria-label="Stock bajo"]');await waitFor("location.pathname==='/inventario' && document.querySelector('.chip.on')?.textContent==='Stock bajo'");await waitFor("!document.querySelector('.loading-state')");const low=(await state()).tables.productos.filter(p=>p.activo&&p.stock<=p.stock_min);assert.equal(await evaluate("document.querySelectorAll('.product-card').length"),low.length);check('Low stock metric opens inventory with real low-stock filter')
  await home();await button('Ver detalle ›');await waitFor("!!document.querySelector('.sheet')");const text=await evaluate("document.querySelector('.sheet').textContent");for(const label of ['Ventas de hoy','Ventas del mes','Ingresos del mes','Gastos del mes','Utilidad del mes','Stock bajo','Agotados'])assert.ok(text.includes(label));const cards=await evaluate("[...document.querySelectorAll('.sheet .stat-card')].map(e=>[e.querySelector('.stat-heading p').textContent,e.querySelector('.stat-value').textContent])");assert.equal(cards.find(([k])=>k==='Agotados')[1],String(seed.productos.filter(p=>p.activo&&p.stock===0).length));check('Expanded summary shows all seven real business metrics')
  await home();await tap('[aria-label="Ver notificaciones locales"]');await waitFor("!!document.querySelector('.sheet')");check('Notification bell opens local notifications');await close();await tap('[aria-label="Mi perfil"]');await waitFor("!!document.querySelector('.sheet')");check('Avatar opens profile')
  const warranty=(await state()).tables.garantias[0];assert.ok(warranty);await rpc('actualizar_garantia_demo',{id:warranty.id,estado:'resuelta',nota:'Verificación del enlace de actividad'})
  // Produce genuine activity through existing demo operations, including more than 50 rows.
  for(let i=0;i<55;i++)await rpc('actualizar_perfil_demo',{nombre:'Administrador Demo',telefono:'3001234567'})
  await home();assert.equal(await evaluate("document.querySelectorAll('.activity-list .row').length"),3);assert.equal(await evaluate("document.querySelectorAll('.activity-list button,.activity-list .text-brand').length"),0);check('Recent activity capped at three; non-navigable profile events have no fake arrow')
  await button('Ver todo ›');await waitFor("!!document.querySelector('.sheet')");assert.equal(await evaluate("document.querySelectorAll('.sheet .menu-row').length"),(await state()).tables.actividad.length);assert.ok((await state()).tables.actividad.length>50);check('Ver todo contains complete history beyond 50 records')
  for(const[kind,path]of [['producto','/inventario'],['factura','/facturas'],['compra','/proveedores'],['garantia','/garantias']]){await home();await button('Ver todo ›');const a=(await state()).tables.actividad.find(a=>a.entidad===kind);assert.ok(a,'Missing real activity '+kind);await evaluate('[...document.querySelectorAll(".sheet button.menu-row")].find(b=>b.querySelector("b")?.textContent==='+JSON.stringify(a.accion)+').click()');await waitFor('location.pathname==='+JSON.stringify(path)+' && !!document.querySelector(".sheet")');if(kind==='compra')await waitFor("[...document.querySelectorAll('.sheet')].at(-1)?.textContent.includes('Detalle de compra') && document.querySelectorAll('.sheet').length===2");check('Real '+kind+' activity opens corresponding record detail')}
  for(const theme of ['dark','light'])for(const[width,height]of [[320,700],[360,800],[390,844],[430,932]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await evaluate('import("/src/lib/theme.js").then(m=>m.setTheme('+JSON.stringify(theme)+'))');await home();await evaluate('document.fonts.ready.then(()=>true)');await geometry(width+'-home-'+theme,width,height);
    const sizes=await evaluate("(()=>{const h=document.querySelector('.tech-hero').getBoundingClientRect(),m=document.querySelector('.home-metrics').getBoundingClientRect();return {hero:h.height,summary:m.top,metrics:[...document.querySelectorAll('.home-metrics .stat-card')].map(e=>e.getBoundingClientRect().height),columns:getComputedStyle(document.querySelector('.quick-actions')).gridTemplateColumns.split(' ').length}})()");assert.ok(sizes.hero>=170&&sizes.hero<=205);assert.ok(sizes.metrics.every(h=>h>=105&&h<=120));assert.equal(sizes.columns,3);if(width===390)assert.ok(sizes.summary<height-80);await screenshot(width+'-home-'+theme);check(width+' '+theme+' compact hero, 110px metrics, visible summary, no overflow')
  }
  assert.deepEqual(externalRequests,[]);assert.deepEqual(browserErrors,[]);await writeFile(join(artifacts,'results.json'),JSON.stringify({status:'PASS',cases:results.length,results,externalRequests,browserErrors,origin:base,testedOn:'Chromium touch emulation; real iPhone Safari remains a physical check'},null,2));console.log(JSON.stringify({status:'PASS',cases:results.length,artifacts}));await send('Browser.close').catch(()=>{})
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
