import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// No npm dependencies, production accounts, real camera, or remote requests.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const artifacts = join(root, 'artifacts', 'ui-review')
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5173'
assert.equal(new URL(base).hostname, '127.0.0.1', 'Use a local server for these tests')
const browserPath = process.env.UI_BROWSER_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome',
].find(existsSync)
assert.ok(browserPath, 'Chrome/Edge is required. You can set UI_BROWSER_PATH.')
const fixture = readFileSync(join(root, 'tests', 'fixtures', 'supabase.js'), 'utf8')
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
        } else if (url.pathname === '/src/lib/supabase.js') {
          await send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/javascript' }], body: Buffer.from(fixture).toString('base64') })
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
      assert.equal(measurements.themeButtons, 1)
      assert.ok(measurements.nav.minimumTarget >= 44)
    }
    results.push({ name, width, height, status: 'PASS' })
  }
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Log.enable')
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] })
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__UI_TEST_ROLE__ = sessionStorage.getItem('ui-test-role') || 'login'; delete window.BarcodeDetector;" })
  await send('Page.navigate', { url: base + '/login' })
  await waitFor("!!document.querySelector('.login-form')")
  const routes = [
    ['/login', 'login', '.login-form'], ['/', 'admin', '.stat-card'],
    ['/inventario', 'admin', '.product-card'], ['/vender', 'admin', '.sale-product'],
    ['/facturas', 'admin', '.invoice-card'], ['/mas', 'admin', '.menu-row'],
  ]
  for (const [width, height] of [[320,568],[360,740],[390,844],[430,932]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true, screenWidth: width, screenHeight: height })
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
    for (const [path, role, selector] of routes) {
      await navigate(path, role)
      await waitFor(`!!document.querySelector(${JSON.stringify(selector)})`)
      await delay(700)
      const name = `${width}-${path === '/' ? 'inicio' : path.slice(1)}`
      await geometry(name, width, height, role !== 'login')
      await screenshot(name)
    }
    await navigate('/vender')
    await waitFor("!!document.querySelector('.sale-product')")
    for (let i = 0; i < 4; i++) await tap('.sale-product')
    assert.equal(await evaluate("document.querySelector('.cart-count').textContent"), '3', 'Cart must respect stock limit')
    const cart = await evaluate("(() => { const r=document.querySelector('.cart-bar-button').getBoundingClientRect(); return {top:r.top,bottom:r.bottom,navTop:document.querySelector('.nav').getBoundingClientRect().top}; })()")
    assert.ok(cart.top >= 0 && cart.bottom <= cart.navTop, 'Cart bar must stay visible above the nav')
    const toast = await evaluate("document.querySelector('.toast').getBoundingClientRect().bottom")
    assert.ok(toast <= cart.top, 'Status messages must not cover the checkout action')
    await geometry(`${width}-carrito-barra`, width, height)
    await screenshot(`${width}-carrito-barra`)
    await tap('.cart-bar-button')
    await waitFor("!!document.querySelector('[role=dialog]')")
    await geometry(`${width}-carrito-modal`, width, height)
    await screenshot(`${width}-carrito-modal`)
    await tap('[aria-label="Reducir cantidad"]')
    await tap('[aria-label="Aumentar cantidad"]')
    assert.equal(await evaluate("document.querySelector('.stepper span').textContent"), '3')
    await tap('[aria-label^="Quitar "]')
    // Removing a product now requires the requested confirmation; the stock is unaffected.
    await waitFor("document.querySelectorAll('[role=dialog]').length === 2")
    assert.equal(await evaluate("document.querySelector('.cart-count').textContent"), '3')
    await tap('.sheet:last-child .sheet-foot .btn.bad')
    await waitFor("document.querySelectorAll('[role=dialog]').length === 1")
    assert.equal(await evaluate("document.querySelector('.sheet-foot button').disabled"), true, 'Empty cart cannot be charged')
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })
    await waitFor("!document.querySelector('[role=dialog]')")
  }
  // Detail sheets, manual scanner and real-active visual state using a synthetic local stream.
  await send('Emulation.setDeviceMetricsOverride', { width:320,height:568,deviceScaleFactor:1,mobile:true })
  await navigate('/inventario'); await waitFor("!!document.querySelector('.product-card')")
  await tap('.product-card'); await geometry('320-producto-modal',320,568); await screenshot('320-producto-modal')
  await tap('.sheet-x'); await tap('.header-controls .btn'); await geometry('320-producto-formulario',320,568); await screenshot('320-producto-formulario')
  await tap('.sheet-x'); await tap('[aria-label="Escanear"]')
  await waitFor("!!document.querySelector('#scanner-code')")
  assert.equal(await evaluate("document.querySelectorAll('.scanner-line').length"), 0, 'No scan animation without an active camera')
  await geometry('320-escaner-manual',320,568); await screenshot('320-escaner-manual'); await tap('.sheet-x')
  await evaluate("window.BarcodeDetector=class {async detect(){return []}}; navigator.mediaDevices.getUserMedia=async()=>{const c=document.createElement('canvas');c.width=320;c.height=240;c.getContext('2d').fillRect(0,0,320,240);return c.captureStream(1)}")
  await tap('[aria-label="Escanear"]'); await waitFor("!!document.querySelector('.scanner-line')")
  await geometry('320-escaner-activo-simulado',320,568); await screenshot('320-escaner-activo-simulado'); await tap('.sheet-x')
  await navigate('/facturas'); await waitFor("!!document.querySelector('.invoice-card')")
  assert.equal(await evaluate("document.querySelectorAll('.invoice-card .badge.good').length"),1)
  assert.equal(await evaluate("document.querySelectorAll('.invoice-card .badge.bad').length"),1)
  assert.equal(await evaluate("document.querySelectorAll('.invoice-card .badge.warn').length"),1)
  await tap('.invoice-card'); await waitFor("!!document.querySelector('.sheet .card')"); await geometry('320-factura-modal',320,568); await screenshot('320-factura-modal'); await tap('.sheet-x')
  for (const path of ['/clientes','/empleados','/proveedores','/finanzas','/garantias']) {
    await navigate(path); await delay(700); await geometry(`320-${path.slice(1)}`,320,568)
  }
  await navigate('/', 'seller'); await waitFor("!!document.querySelector('.stat-card')")
  await geometry('320-inicio-vendedor',320,568); await screenshot('320-inicio-vendedor')
  assert.equal(await evaluate("[...document.querySelectorAll('.nav button')].map(b=>b.textContent).join('|')"),'Mis ventas|Vender|Productos|Clientes|Más','Preserve role-specific navigation')
  await navigate('/login','login')
  await evaluate("const email=document.querySelector('#login-email'),password=document.querySelector('#login-password');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(email,'prueba@example.test');email.dispatchEvent(new Event('input',{bubbles:true}));set.call(password,'prueba-local');password.dispatchEvent(new Event('input',{bubbles:true}));")
  await tap('.login-form .btn.full'); await waitFor("!!document.querySelector('[role=alert]')")
  assert.ok(await evaluate("document.querySelector('[role=alert]').textContent.includes('Correo o contraseña incorrectos.')"))
  await geometry('320-login-error',320,568,false)
  await navigate('/'); await waitFor("!!document.querySelector('.tech-hero')")
  assert.equal(await evaluate("document.querySelectorAll('.hero-photo').length"),1)
  assert.ok(await evaluate("document.querySelector('.hero-photo').naturalWidth > 0"),'The hero uses a loaded photograph')
  assert.equal(await evaluate("document.querySelectorAll('.stat-card').length"),4,'Home stays compact with four metrics')
  assert.ok(await evaluate("parseFloat(getComputedStyle(document.querySelector('.hero-photo')).animationDuration)>=10"))
  await evaluate("document.querySelector('.view').scrollTop=document.querySelector('.view').scrollHeight")
  await waitFor("document.querySelector('.tech-hero').dataset.paused === 'true'")
  await send('Emulation.setEmulatedMedia', { features:[{name:'prefers-reduced-motion',value:'reduce'}] })
  for (const [path,role,selector] of routes) {
    await navigate(path,role); await waitFor(`!!document.querySelector(${JSON.stringify(selector)})`)
    await delay(100)
    assert.equal(await evaluate("document.getAnimations().filter(a=>a.playState==='running').length"),0,`Reduced motion: ${path}`)
  }
  results.push({name:'prefers-reduced-motion: six screens',status:'PASS'})
  await send('Emulation.setEmulatedMedia', { features:[{name:'prefers-reduced-motion',value:'no-preference'}] })
  await navigate('/'); await waitFor("!!document.querySelector('.stat-card')")
  await tap('[aria-label="Cambiar tema"]'); assert.equal(await evaluate("document.documentElement.dataset.theme"),'light')
  await geometry('320-tema-claro',320,568); await tap('[aria-label="Cambiar tema"]')
  await send('Emulation.setDeviceMetricsOverride', {width:768,height:1024,deviceScaleFactor:1,mobile:true})
  await navigate('/'); await waitFor("!!document.querySelector('.stat-card')"); await delay(700); await geometry('768-tablet',768,1024); await screenshot('768-tablet')
  assert.deepEqual(externalRequests, [], 'No requests should leave the local test server')
  assert.deepEqual(browserErrors, [], 'No browser runtime or resource errors')
  const report = { status:'PASS', cases:results.length, results, externalRequests, browserErrors, fixturesOnly:true, testedOn:'Chromium with touch emulation; physical device testing remains necessary' }
  await writeFile(join(artifacts,'results.json'),JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify({status:'PASS',cases:results.length,externalRequests:externalRequests.length,browserErrors:browserErrors.length,artifacts},null,2))
  await send('Browser.close').catch(()=>{})
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
