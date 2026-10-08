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
const artifacts = join(root, 'artifacts', process.env.UI_ARTIFACTS || 'premium-iphone')
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

  await send('Page.enable');await send('Runtime.enable');await send('Log.enable');await send('DOM.enable');await send('Emulation.setFocusEmulationEnabled',{enabled:true});await send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  const check=name=>results.push({name,status:'PASS'})
  const go=async path=>{await send('Page.navigate',{url:base+path});await waitFor(`location.pathname+location.search===${JSON.stringify(path)} && document.readyState==='complete'`);await waitFor("!!document.querySelector('.nav')");await delay(300)}
  const button=async text=>{await evaluate(`(()=>{const scope=[...document.querySelectorAll('.sheet')].at(-1)||document;const b=[...scope.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Missing button '+${JSON.stringify(text)});b.click()})()`);await delay(150)}
  const field=async(label,value)=>{await evaluate(`(()=>{const l=[...document.querySelectorAll('label')].find(l=>l.textContent.trim()===${JSON.stringify(label)});if(!l)throw Error('Missing field');const i=document.getElementById(l.htmlFor);Object.getOwnPropertyDescriptor(i.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(String(value))});i.dispatchEvent(new Event(i.tagName==='SELECT'?'change':'input',{bubbles:true}))})()`);await delay(100)}
  const close=async()=>{await evaluate("[...document.querySelectorAll('.sheet')].at(-1).querySelector('.sheet-x').click()");await delay(100)}
  const theme=async value=>{await evaluate(`import('/src/lib/theme.js').then(m=>m.setTheme(${JSON.stringify(value)}))`)}
  const vv=()=>evaluate("Object.defineProperty(visualViewport,'height',{configurable:true,value:450});Object.defineProperty(visualViewport,'offsetTop',{configurable:true,value:25});visualViewport.dispatchEvent(new Event('resize'))")
  const restore=async()=>{await evaluate("document.activeElement.blur();delete visualViewport.height;delete visualViewport.offsetTop;visualViewport.dispatchEvent(new Event('resize'))");await delay(100)}
  const keyboard=async(name,selector)=>{await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);await vv();await delay(150);const m=await evaluate("(()=>{const s=[...document.querySelectorAll('.sheet')].at(-1),r=s.getBoundingClientRect(),f=s.querySelector('.sheet-foot').getBoundingClientRect();return{top:r.top,bottom:r.bottom,footer:f.bottom,bg:getComputedStyle(s.querySelector('.sheet-foot')).backgroundColor,surface:getComputedStyle(s).backgroundColor,inert:document.getElementById('root').inert,covered:!!document.elementFromPoint(innerWidth/2,474)?.closest('.sheet')}})()");assert.ok(Math.abs(m.top-25)<1,JSON.stringify(m));assert.ok(Math.abs(m.bottom-475)<1);assert.ok(Math.abs(m.footer-475)<1);assert.equal(m.bg,m.surface);assert.notEqual(m.bg,'rgba(0, 0, 0, 0)');assert.ok(m.inert&&m.covered);await screenshot(name+'-keyboard');check(name+' keyboard: solid viewport, footer and background lock');await restore()}
  const dimensions=[[320,700],[360,800],[390,844],[430,932]]
  await send('Page.navigate',{url:base+'/login'});await waitFor("!!document.querySelector('.login-form')")
  for(const t of ['dark','light'])for(const[w,h]of dimensions){await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:true});await theme(t);await geometry(`${t}-${w}-login`,w,h,false);await screenshot(`${t}-${w}-login`);assert.ok(await evaluate("[...document.querySelectorAll('.login-input input')].every(i=>parseFloat(getComputedStyle(i).fontSize)>=16)"));if(w===390)assert.ok(await evaluate("document.querySelector('.demo-access').getBoundingClientRect().bottom<=844"))}
  await button('Entrar');await waitFor("!!document.querySelector('.stat-card')")
  for(const t of ['dark','light'])for(const[w,h]of dimensions){
    await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:true});await theme(t)
    for(const[path,label]of [['/','home'],['/mas','more'],['/inventario','inventory'],['/facturas','invoices'],['/vender','sell'],['/finanzas','finance']]){await go(path);await waitFor("!document.querySelector('.loading-state')");await geometry(`${t}-${w}-${label}`,w,h);await screenshot(`${t}-${w}-${label}`)}
    assert.equal(await evaluate("document.querySelectorAll('.balance-candle').length"),4);const totals=await evaluate("[...document.querySelectorAll('.balance-key .chart-row b')].map(e=>e.textContent)");const tiles=await evaluate("[...document.querySelectorAll('.finance-stats .stat-value')].map(e=>e.textContent)");assert.equal(totals[3],tiles[2])
    await go('/facturas');await waitFor("!!document.querySelector('.invoice-card')");
    for(const amount of ['$999.900','$4.799.900','$10.000.000','$123.456.789']){await evaluate(`[...document.querySelectorAll('.invoice-amount')].forEach(e=>e.textContent=${JSON.stringify(amount)})`);assert.ok(await evaluate("[...document.querySelectorAll('.invoice-card')].every(c=>{const l=c.querySelector('.invoice-main').getBoundingClientRect(),r=c.querySelector('.invoice-side').getBoundingClientRect(),ch=c.querySelector('.invoice-chevron').getBoundingClientRect();return l.right<=r.left+1&&ch.right<=r.right+1&&Math.abs(ch.right-r.right)<1&&r.right<=c.getBoundingClientRect().right&&c.scrollWidth<=c.clientWidth+1})"))};check(`${t}-${w} invoice amounts align with the right-edge chevron`)
    await tap('.invoice-card');await waitFor("!!document.querySelector('.invoice-party')");await geometry(`${t}-${w}-invoice-detail`,w,h);await screenshot(`${t}-${w}-invoice-detail`);const boxes=await evaluate("[...document.querySelectorAll('.communication-actions button')].map(e=>{const r=e.getBoundingClientRect();return{w:r.width,h:r.height}})");assert.equal(boxes.length,3);assert.ok(boxes.every(b=>Math.abs(b.w-boxes[0].w)<1&&b.h===boxes[0].h));assert.ok(await evaluate("!document.querySelector('.aftersale-actions .btn.bad') && !!document.querySelector('.destructive-zone button')"));await close()
    await go('/inventario?q=GLASS15');await waitFor("!!document.querySelector('.product-card')");await tap('.product-card');await geometry(`${t}-${w}-product-detail`,w,h);await screenshot(`${t}-${w}-product-detail`);assert.ok(await evaluate("!!document.querySelector('.product-detail-hero img') && !!document.querySelector('.destructive-zone')"));await button('Ajustar stock');if(w===390)await keyboard(t+'-product-adjust','.product-detail-sheet input');await close()
    await go('/inventario');await button('Ingreso');await geometry(`${t}-${w}-purchase-empty`,w,h);await screenshot(`${t}-${w}-purchase-empty`);if(w===390)await keyboard(t+'-purchase','.purchase-sheet input');await close()
    await go('/proveedores');await button('+ Nuevo');await geometry(`${t}-${w}-supplier`,w,h);await screenshot(`${t}-${w}-supplier`);assert.equal(await evaluate("document.querySelectorAll('.supplier-form .admin-form-section').length"),4);if(w===390)await keyboard(t+'-supplier','.supplier-form input');await close()
    await go('/vender');await waitFor("!!document.querySelector('[aria-label=\"Agregar Cable USB-C trenzado 2 metros\"]')");await tap('[aria-label="Agregar Cable USB-C trenzado 2 metros"]');await tap('.cart-bar-button');await geometry(`${t}-${w}-checkout`,w,h);await screenshot(`${t}-${w}-checkout`);if(w===390)await keyboard(t+'-checkout','.checkout-sheet input');await close();await evaluate("Object.keys(sessionStorage).filter(k=>k.startsWith('angie:cart:')).forEach(k=>sessionStorage.removeItem(k))")
    await go('/vender');await waitFor("!!document.querySelector('.sale-product')");await evaluate("[...document.querySelectorAll('.sale-product')].find(b=>b.textContent.includes('Xiaomi Redmi Note 13 Pro')).click()");await waitFor("!!document.querySelector('.serial-option')");await geometry(`${t}-${w}-serials`,w,h);await screenshot(`${t}-${w}-serials`);assert.ok(await evaluate("[...document.querySelectorAll('.serial-option')].every(b=>b.tagName==='BUTTON'&&b.textContent.includes('Disponible'))"));await close()
    await go('/');await tap('[aria-label="Ver notificaciones locales"]');await waitFor("!!document.querySelector('.notification-row')");await geometry(`${t}-${w}-notifications`,w,h);await screenshot(`${t}-${w}-notifications`);assert.ok(await evaluate("[...document.querySelectorAll('.notification-row')].every(b=>!!b.querySelector('.notice-icon svg'))"));await close()
    await go('/inventario');await tap('[aria-label="Escanear"]');await waitFor("!!document.querySelector('.scanner-fallback')");await geometry(`${t}-${w}-scanner`,w,h);await screenshot(`${t}-${w}-scanner`);assert.equal(await evaluate("document.querySelector('.scanner-sheet .sheet-foot button').disabled"),true);if(w===390)await keyboard(t+'-scanner','#scanner-code');await close()
  }
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
  for(const t of ['dark','light'])for(const path of ['/inventario','/vender','/facturas','/clientes','/proveedores','/empleados']){await go(path);await theme(t);await waitFor("!!document.querySelector('.search-bar input')");await evaluate("document.querySelector('.search-bar input').focus()");await vv();await delay(120);const m=await evaluate("(()=>{const d=document.querySelector('.device').getBoundingClientRect();return{top:d.top,bottom:d.bottom,font:parseFloat(getComputedStyle(document.querySelector('.search-bar input')).fontSize),nav:getComputedStyle(document.querySelector('.nav')).display,width:document.documentElement.scrollWidth}})()");assert.ok(m.font>=16);assert.equal(m.nav,'none');assert.ok(Math.abs(m.top-25)<1&&Math.abs(m.bottom-475)<1,JSON.stringify(m));assert.ok(m.width<=390);await screenshot(t+'-'+path.slice(1)+'-search-keyboard');await restore();assert.notEqual(await evaluate("getComputedStyle(document.querySelector('.nav')).display"),'none');check(t+' '+path+' search keyboard does not zoom, clip or overlap navigation')}
  await go('/inventario');await button('Ingreso');await field('Forma de pago','credito');await evaluate("document.getElementById([...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='Vence el').htmlFor).click()");await waitFor("!!document.querySelector('.angie-calendar')");assert.ok(await evaluate("[...document.querySelectorAll('.calendar-days [data-date]')].filter(b=>b.dataset.date<new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'})).every(b=>b.disabled)"));await button('Confirmar');await waitFor("!document.querySelector('.angie-calendar')");await close();check('Purchase calendar keeps the existing credit minimum date and applies selected date')
  await go('/');await tap('[aria-label="Ver notificaciones locales"]');await waitFor("!!document.querySelector('.notification-row.is-new')");await tap('.notification-row.is-new');await waitFor("!document.querySelector('.notifications-sheet')");await go('/');await tap('[aria-label="Ver notificaciones locales"]');await waitFor("!!document.querySelector('.notification-row.is-read')");await close();check('Notification navigation persists the read badge')
  await go('/vender');await tap('[aria-label="Escanear"]');await waitFor("!!document.querySelector('.scanner-fallback')");await field('…o digita el código','USBC2M');await button('Buscar producto');await waitFor("!!document.querySelector('.cart-bar-button') && !document.querySelector('.scanner-sheet')");check('Manual scanner resolves an existing product and adds it to cart')
  await evaluate("window.__cameraStopped=false;window.__decode=false;window.BarcodeDetector=class{static async getSupportedFormats(){return['code_128']} async detect(){return window.__decode?[{rawValue:'MAGSAFE15'}]:[]}};navigator.mediaDevices.getUserMedia=async constraints=>{window.__cameraConstraints=constraints;const c=document.createElement('canvas');c.width=320;c.height=240;c.getContext('2d').fillRect(0,0,320,240);const s=c.captureStream(1);for(const t of s.getTracks()){const stop=t.stop.bind(t);t.stop=()=>{window.__cameraStopped=true;stop()}}return s}")
  await tap('[aria-label="Escanear"]');await waitFor("!!document.querySelector('.scanner-line')");assert.equal(await evaluate("window.__cameraConstraints.video.facingMode"),'environment');await evaluate("window.__decode=true");await waitFor("!document.querySelector('.scanner-sheet') && window.__cameraStopped");await tap('.cart-bar-button');assert.ok(await evaluate("document.querySelector('.checkout-sheet').textContent.includes('Case MagSafe iPhone 15 Pro')"));await close();check('Compatible camera requests environment video, detects code, selects product and releases tracks (synthetic stream)')
  await evaluate("navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Denied','NotAllowedError')}");await tap('[aria-label="Escanear"]');await waitFor("!!document.querySelector('.scanner-fallback')");assert.equal(await evaluate("document.querySelectorAll('.scanner-line').length"),0);await close();check('Denied camera permission offers manual fallback without an active-camera animation')
  assert.deepEqual(externalRequests,[]);assert.deepEqual(browserErrors,[])
  await writeFile(join(artifacts,'results.json'),JSON.stringify({status:'PASS',cases:results.length,results,externalRequests,browserErrors,physicalIPhone:'Pending; Chrome viewport and synthetic camera only'},null,2));console.log(JSON.stringify({status:'PASS',cases:results.length,artifacts}));await send('Browser.close').catch(()=>{})

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
