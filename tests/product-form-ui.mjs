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
const artifacts = join(root, 'artifacts', process.env.UI_ARTIFACTS || 'product-form')
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
  await go('/');assert.deepEqual(await evaluate("[...document.querySelectorAll('.quick-actions button')].map(b=>b.textContent.trim())"),['Nueva venta','Inventario','Facturas']);await go('/clientes');await waitFor("!!document.querySelector('.entity-list')");check('Home has three useful shortcuts; customer module remains available')
  await go('/inventario');await button('+ Nuevo');await waitFor("!!document.querySelector('.product-form')")
  await button('+100 mil');assert.equal(await value('Precio venta'),'100.000');assert.equal(await value('Precio compra'),'0');check('No active input: quick amount targets sale price and formats COP')
  await field('Precio venta','0');await focus('Precio venta');assert.equal(await value('Precio venta'),'');await send('Input.insertText',{text:'3200000'});assert.equal(await value('Precio venta'),'3.200.000');await blur();assert.equal(await value('Precio venta'),'3.200.000');check('Native typing replaces zero and immediately formats 3.200.000 without US commas')
  await focus('Precio compra');assert.equal(await value('Precio compra'),'');await button('+10 mil');assert.equal(await value('Precio compra'),'10.000');await button('+100 mil');await button('+1 millón');assert.equal(await value('Precio compra'),'1.110.000');assert.equal(await value('Precio venta'),'3.200.000');check('All amount chips sum against purchase price without changing sale')
  await focus('Precio venta');await blur();await button('+100 mil');assert.equal(await value('Precio venta'),'3.300.000');check('Last-used sale input remains chip target after blur')
  await focus('Precio compra');await field('Precio compra','');assert.equal(await value('Precio compra'),'');await blur();assert.equal(await value('Precio compra'),'0');check('Price can stay empty while editing and restores zero on blur')
  await focus('Stock inicial');assert.equal(await value('Stock inicial'),'');await send('Input.insertText',{text:'5'});assert.equal(await value('Stock inicial'),'5');await blur();await field('Stock mínimo','0');await focus('Stock mínimo');assert.equal(await value('Stock mínimo'),'');await send('Input.insertText',{text:'2'});await blur();assert.equal(await value('Stock mínimo'),'2');check('Stock fields replace zero with first typed digit')
  await field('Precio compra','0');await focus('Precio compra');
  for(const [digit,expected] of [['2','2'],['5','25'],['0','250'],['0','2.500'],['0','25.000'],['0','250.000'],['0','2.500.000']]){await send('Input.insertText',{text:digit});assert.equal(await value('Precio compra'),expected)}
  await blur();await focus('Precio compra');assert.equal(await value('Precio compra'),'2.500.000');check('Every keystroke groups COP live, zero replaced, nonzero preserved on focus')
  for(const pasted of ['$ 2.500.000','2500000','2,500,000']){await evaluate(inputExpression('Precio compra')+'.select()');await send('Input.insertText',{text:pasted});assert.equal(await value('Precio compra'),'2.500.000')};check('Currency, bare digits and US grouping paste normalize to Colombian grouping')
  await field('Precio compra','1000000');await focus('Precio compra');await evaluate(inputExpression('Precio compra')+'.setSelectionRange(2,2)');await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});assert.equal(await value('Precio compra'),'0');check('Backspace through a grouping separator deletes the adjacent digit')
  await field('Precio compra','1234567');await focus('Precio compra');await evaluate('(()=>{const i='+inputExpression('Precio compra')+';Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(i,"1234.567");i.setSelectionRange(1,1);i.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"deleteContentBackward"}))})()');assert.equal(await value('Precio compra'),'234.567');assert.ok(await evaluate(inputExpression('Precio compra')+'.type==="text" && '+inputExpression('Precio compra')+'.inputMode==="numeric"'));check('iOS-style input event without keydown deletes across a separator; text input requests numeric keyboard');
  await field('Precio compra','1080000');await focus('Precio compra');await evaluate(inputExpression('Precio compra')+'.setSelectionRange(3,4)');await send('Input.insertText',{text:'9'});assert.equal(await value('Precio compra'),'1.090.000');assert.equal(await evaluate(inputExpression('Precio compra')+'.selectionStart'),4);check('Middle selection replacement preserves digit-relative caret')
  await field('Precio compra','2.500.000');await field('Precio venta','3.200.000');await field('Nombre','Producto formulario premium');await field('Código único (SKU)','FORM-PREMIUM');await field('Categoría','1')
  await field('Precio venta','-1');assert.equal(await value('Precio venta'),'1');await field('Stock mínimo','-1');await button('Guardar');assert.ok(await evaluate("!!document.querySelector('input[aria-invalid=true]')"));assert.equal(await value('Nombre'),'Producto formulario premium');await field('Stock mínimo','2');await field('Precio venta','3.200.000');check('Price paste removes non-digits; negative stock validation preserves form values')
  const source=JSON.parse(readFileSync(join(root,'src/assets/products/sources.json'),'utf8'))['SGS24-256'].filename,doc=await send('DOM.getDocument'),node=await send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'input[aria-label="Seleccionar foto del producto"]'});await send('DOM.setFileInputFiles',{nodeId:node.nodeId,files:[join(root,'src/assets/products',source)]});await waitFor("!!document.querySelector('.photo-editor-preview>img') && !document.querySelector('.product-save').disabled");await screenshot('photo-ready')
  await field('Precio compra','0');await focus('Precio compra');for(const digit of '1080000')await send('Input.insertText',{text:digit});assert.equal(await value('Precio compra'),'1.080.000');await field('Precio venta','0');await focus('Precio venta');for(const digit of '3200000')await send('Input.insertText',{text:digit});assert.equal(await value('Precio venta'),'3.200.000');await button('Guardar');await waitFor("!document.querySelector('.sheet')");const product=await evaluate("JSON.parse(localStorage.getItem('angie-tech:demo:v1')).tables.productos.find(p=>p.codigo==='FORM-PREMIUM')");assert.equal(product.precio_compra,1080000);assert.equal(product.precio_venta,3200000);assert.equal(product.stock,5);assert.equal(product.stock_min,2);assert.ok(product.image_ref);check('Formatted prices save clean numeric COP and preserve initial stock/image reference')
  await go('/inventario?q=FORM-PREMIUM');await waitFor("document.querySelector('.product-thumbnail img')?.naturalWidth>0");await send('Page.reload');await waitFor("document.querySelector('.product-thumbnail img')?.src.startsWith('blob:') && document.querySelector('.product-thumbnail img')?.naturalWidth>0");check('Saved product and IndexedDB photo survive reload after form redesign')
  await tap('.product-card');await waitFor("document.querySelector('.sheet')?.textContent.includes('$1.080.000') && document.querySelector('.sheet')?.textContent.includes('$3.200.000')");await button('Editar');await focus('Precio venta');assert.equal(await value('Precio venta'),'3.200.000');await evaluate(inputExpression('Precio venta')+'.select()');for(const digit of '3500000')await send('Input.insertText',{text:digit});assert.equal(await value('Precio venta'),'3.500.000');await button('Guardar');await waitFor("!document.querySelector('.sheet')");await send('Page.reload');await waitFor("!!document.querySelector('.product-card')");await tap('.product-card');await waitFor("document.querySelector('.sheet')?.textContent.includes('$3.500.000')");check('Required 1080000/3200000 create, reopen, edit 3500000, save and reload flow');await close();
  await go('/inventario');await button('+ Nuevo');await field('Nombre','Producto chips COP');await field('Código único (SKU)','FORM-CHIPS');await focus('Precio venta');await button('+10 mil');assert.equal(await value('Precio venta'),'10.000');await button('+100 mil');assert.equal(await value('Precio venta'),'110.000');await button('+1 millón');assert.equal(await value('Precio venta'),'1.110.000');await button('Guardar');await waitFor("!document.querySelector('.sheet')");assert.equal(await evaluate("JSON.parse(localStorage.getItem('angie-tech:demo:v1')).tables.productos.find(p=>p.codigo==='FORM-CHIPS').precio_venta"),1110000);check('Sale chips 0 → 10.000 → 110.000 → 1.110.000 save numeric 1110000');
  for(const theme of ['dark','light'])for(const[width,height]of [[320,700],[360,800],[390,844],[430,932]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await evaluate('import("/src/lib/theme.js").then(m=>m.setTheme('+JSON.stringify(theme)+'))');await go('/inventario');await button('+ Nuevo');await waitFor("!!document.querySelector('.product-form')");await evaluate('document.fonts.ready.then(()=>true)');await geometry(width+'-product-'+theme,width,height);await screenshot(width+'-product-top-'+theme)
    assert.ok(await evaluate("[...document.querySelectorAll('.product-amount-chip')].every(b=>b.getBoundingClientRect().height>=44)"));assert.ok(await evaluate("document.querySelector('.product-save').getBoundingClientRect().bottom<=visualViewport.height+1"));check(width+' '+theme+' readable price chips and visible sticky Save')
    await focus('Precio venta');await send('Input.insertText',{text:'3200000'});await blur();await screenshot(width+'-product-prices-'+theme)
    await focus('Descripción / notas');await send('Emulation.setDeviceMetricsOverride',{width,height:450,deviceScaleFactor:1,mobile:true});await delay(250);assert.ok(await evaluate("(()=>{const b=document.querySelector('.product-save').getBoundingClientRect(),i=document.activeElement.getBoundingClientRect();return b.bottom<=visualViewport.height+1 && i.bottom<=b.top && i.top>=0})()"),'Focused notes and Save must remain visible with keyboard-sized viewport');await screenshot(width+'-keyboard-'+theme);check(width+' '+theme+' viewport shrinks without hiding active field or Save')
    await close();await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true})
  }
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await go('/inventario');await button('+ Nuevo');await focus('Precio venta');await evaluate('Object.defineProperty(visualViewport,"height",{configurable:true,value:430});Object.defineProperty(visualViewport,"offsetTop",{configurable:true,value:24});visualViewport.dispatchEvent(new Event("resize"))');await delay(200);assert.ok(await evaluate('(()=>{const f=document.activeElement.getBoundingClientRect(),b=document.querySelector(".sheet-body").getBoundingClientRect(),save=document.querySelector(".product-save").getBoundingClientRect();return !!document.querySelector(".keyboard-open") && f.top>=b.top && f.bottom<=b.bottom && save.bottom<=454 && save.top>=b.bottom})()'));await screenshot('390-visual-viewport-keyboard');await evaluate('delete visualViewport.height;delete visualViewport.offsetTop;visualViewport.dispatchEvent(new Event("resize"))');await delay(200);assert.equal(await evaluate('!!document.querySelector(".keyboard-open")'),false);assert.ok(await evaluate('document.querySelector(".product-save").getBoundingClientRect().bottom<=844'));check('Safari visualViewport resize/offset simulation keeps focused price and footer separated, restores full layout');await close();
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
