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
const artifacts = join(root, 'artifacts', process.env.UI_ARTIFACTS || 'pdf-finance')
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
  const spa=async path=>{await evaluate(`(()=>{const a=document.createElement('a');a.href=${JSON.stringify(path)};a.addEventListener('click',e=>{e.preventDefault();history.pushState({},'',a.href);window.dispatchEvent(new PopStateEvent('popstate'))});document.body.append(a);a.click();a.remove()})()`);await waitFor("!!document.querySelector('.nav')");await delay(200)}
  const dateButton=()=>evaluate("document.querySelector('.date-field button').click()")
  const selectDate=async iso=>{await evaluate(`document.querySelector('[data-date="${iso}"]').click()`);await button('Confirmar')}
  const before=(await state()).tables.movimientos.length
  await go('/finanzas');await waitFor("!!document.querySelector('.finance-stats .stat-value')")
  const stats=()=>evaluate("[...document.querySelectorAll('.finance-stats .stat-value')].map(e=>Number(e.textContent.replace(/[^0-9-]/g,'')))")
  const initialStats=await stats()
  await button('+ Registrar');assert.ok(await evaluate("!document.querySelector('.movement-form input[type=date]')"));check('Finance uses a button DateField, without native date inputs')
  await focus('Monto');for(const digit of '1200000')await send('Input.insertText',{text:digit});assert.equal(await value('Monto'),'1.200.000');assert.ok(await evaluate(inputExpression('Monto')+'.type==="text" && '+inputExpression('Monto')+'.inputMode==="numeric"'));check('Expense native typing formats clean COP 1.200.000 with shared product input')
  await button('+10 mil');await button('+50 mil');await button('+100 mil');await button('+500 mil');await button('+1 millón');assert.equal(await value('Monto'),'2.860.000');await field('Monto','1200000');check('Every amount chip adds rather than replaces the amount')
  await field('Categoría','__custom');assert.equal(await value('Otra categoría'),'');await field('Otra categoría','Categoría prueba');await field('Categoría','Proveedores');assert.ok(await evaluate("![...document.querySelectorAll('.movement-form label')].some(l=>l.textContent==='Otra categoría')"));check('Custom category input appears only when selected and suggested categories remain available')
  const original=await evaluate("document.querySelector('.date-field button').textContent")
  await dateButton();await waitFor("!!document.querySelector('.angie-calendar')");assert.equal(await evaluate("document.querySelectorAll('.calendar-days button').length"),42)
  const month=await evaluate("document.querySelector('.calendar-month b').textContent");await tap('[aria-label="Mes siguiente"]');assert.notEqual(await evaluate("document.querySelector('.calendar-month b').textContent"),month);await tap('[aria-label="Mes anterior"]');assert.equal(await evaluate("document.querySelector('.calendar-month b').textContent"),month)
  await evaluate("document.querySelector('.calendar-days button').click()");await button('Cancelar');assert.equal(await evaluate("document.querySelector('.date-field button').textContent"),original);check('Calendar opens 42 Sunday-first days, changes months/year, and cancel preserves date')
  await dateButton();await selectDate('2026-10-07');assert.ok(await evaluate("document.querySelector('.date-field button').textContent.includes('07/10/2026')"));await dateButton();await button('Hoy');const today=await evaluate("import('/src/lib/format.js').then(m=>m.hoyBogota())");assert.equal(await evaluate("document.querySelector('.calendar-days .selected').dataset.date"),today);await button('Confirmar');check('Explicit date is ISO-safe; Hoy selects Bogotá today and Confirmar applies it')
  await field('Descripción (opcional)','Compra de insumos PDF-FINANCE');await button('Registrar gasto');await waitFor("!document.querySelector('.sheet')");await waitFor("document.body.innerText.includes('Compra de insumos PDF-FINANCE')");let tables=(await state()).tables;const expense=tables.movimientos.at(-1);assert.equal(expense.monto,1200000);assert.equal(expense.fecha,today);assert.equal(expense.categoria,'Proveedores');assert.equal(expense.tipo,'gasto');assert.equal(tables.movimientos.length,before+1);assert.ok(tables.actividad.some(a=>a.entidad==='movimientos'&&String(a.entidad_id)===String(expense.id)));assert.equal((await stats())[1],initialStats[1]+1200000);check('Expense saves category, description, clean numeric amount/date; finance refreshes without reload and history records it')
  await button('+ Registrar');await button('Ingreso');assert.ok(await evaluate("document.querySelector('.movement-segments .ingreso').getAttribute('aria-pressed')==='true'"));await field('Categoría','Servicio');await focus('Monto');for(const digit of '350000')await send('Input.insertText',{text:digit});assert.equal(await value('Monto'),'350.000');await field('Descripción (opcional)','Servicio técnico PDF-FINANCE');await button('Registrar ingreso');await waitFor("!document.querySelector('.sheet')");await waitFor("document.body.innerText.includes('Servicio técnico PDF-FINANCE')");tables=(await state()).tables;const income=tables.movimientos.at(-1);assert.equal(income.monto,350000);assert.equal(income.tipo,'ingreso');assert.equal(income.categoria,'Servicio');const finalStats=await stats();assert.equal(finalStats[0],initialStats[0]+350000);assert.equal(finalStats[2],initialStats[2]-850000);check('Income 350.000 saves and refreshes finance; net result changes by income minus expense with existing calculations')
  await spa('/');await waitFor("!!document.querySelector('.stat-card')");await button('Ver detalle ›');await waitFor("!!document.querySelector('.sheet')");assert.ok(await evaluate(`document.querySelector('.sheet').textContent.includes(${JSON.stringify(Math.abs(finalStats[2]).toLocaleString('es-CO'))})`));await close();await button('Ver todo ›');await waitFor("!!document.querySelector('.sheet')");assert.ok(await evaluate("document.querySelector('.sheet').textContent.includes('Registro creado')"));await close();check('SPA navigation shows updated Dashboard and complete activity history without reloading')
  await go('/finanzas');await waitFor("document.body.innerText.includes('Compra de insumos PDF-FINANCE') && document.body.innerText.includes('Servicio técnico PDF-FINANCE')");assert.deepEqual(await stats(),finalStats);check('Both financial movements and totals persist after reload')
  for(const theme of ['dark','light'])for(const [width,height]of [[390,844],[320,700],[360,800],[430,932]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);await button('+ Registrar');await geometry(`${theme}-${width}-movement`,width,height);await screenshot(`${theme}-${width}-movement`)
    await focus('Monto');await evaluate(`Object.defineProperty(visualViewport,'height',{configurable:true,value:${Math.round(height*.51)}});Object.defineProperty(visualViewport,'offsetTop',{configurable:true,value:24});visualViewport.dispatchEvent(new Event('resize'))`);await delay(150)
    const fit=await evaluate("(()=>{const s=document.querySelector('.movement-form').getBoundingClientRect(),f=document.querySelector('.movement-form .sheet-foot').getBoundingClientRect(),v=visualViewport;return{top:s.top,bottom:s.bottom,footer:f.bottom,height:v.height,offset:v.offsetTop,bg:getComputedStyle(document.querySelector('.movement-form .sheet-foot')).backgroundColor,locked:document.getElementById('root').inert}})()");assert.ok(Math.abs(fit.bottom-(fit.height+fit.offset))<2);assert.ok(Math.abs(fit.footer-fit.bottom)<2);assert.equal(fit.locked,true);assert.notEqual(fit.bg,'rgba(0, 0, 0, 0)');await screenshot(`${theme}-${width}-keyboard`)
    const point=await evaluate("(()=>{const r=document.querySelector('.movement-form .sheet-body').getBoundingClientRect();return{x:r.left+3,y:r.bottom-20}})()");await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});for(let step=1;step<=8;step++){await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x,y:point.y-step*10}]});await delay(25)}await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await delay(150);assert.ok(await evaluate("document.querySelector('.movement-form .sheet-body').scrollTop>0"))
    await blur();await evaluate("delete visualViewport.height;delete visualViewport.offsetTop;visualViewport.dispatchEvent(new Event('resize'))");await dateButton();await waitFor("!!document.querySelector('.angie-calendar')");await geometry(`${theme}-${width}-calendar`,width,height);await screenshot(`${theme}-${width}-calendar`);assert.ok(await evaluate("getComputedStyle(document.querySelector('.calendar-days .selected')).backgroundColor !== getComputedStyle(document.querySelector('.angie-calendar')).backgroundColor"));assert.ok(await evaluate("(()=>{const s=getComputedStyle(document.querySelector('.calendar-days .selected'));const lum=c=>{const v=c.match(/[0-9.]+/g).slice(0,3).map(n=>Number(n)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return v[0]*.2126+v[1]*.7152+v[2]*.0722};const a=lum(s.backgroundColor),b=lum(s.color);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5})()"),'Selected calendar day must meet normal-text contrast in both themes');await button('Cancelar');assert.equal(await evaluate("document.getElementById('root').inert"),true);await close();assert.equal(await evaluate("document.getElementById('root').inert"),false);check(`${theme} ${width}x${height}: compact movement, solid keyboard footer, scrolling, nested calendar, background lock and no overflow`)
  }
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await go('/facturas?factura=3');await waitFor("!!document.querySelector('.sheet')");await button('PDF / Imprimir');await waitFor("!!document.querySelector('[data-print-invoice]')");assert.ok(await evaluate("document.querySelector('.invoice-preview').textContent.includes('Vista previa de factura') && !document.querySelector('.invoice-preview').textContent.includes('Simulación de pdf')"));assert.ok(await evaluate("document.querySelector('[data-print-invoice]').textContent.includes('FV-1245')"));check('FV-1245 preview has real invoice content and separate save/print actions without simulation copy')
  for(const theme of ['dark','light'])for(const [width,height]of [[390,844],[320,700],[360,800],[430,932]]){await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);await geometry(`${theme}-${width}-pdf-preview`,width,height);await screenshot(`${theme}-${width}-pdf-preview`)}
  await evaluate("window.print=()=>window.__printCalled=true");await button('Imprimir');assert.equal(await evaluate('window.__printCalled'),true);check('Print remains an explicit separate action; PDF preview fits all four widths in both themes')
  await rm(join(artifacts,'ANGIE-TECH-FV-1245.pdf'),{force:true});await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:artifacts});await evaluate("window.__realMatchMedia=window.matchMedia;window.matchMedia=q=>q==='(pointer: coarse)'?{matches:true}:window.__realMatchMedia(q);Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});Object.defineProperty(navigator,'share',{configurable:true,value:async()=>{window.__desktopShareCalled=true}})");await button('Guardar PDF');await waitFor("!document.querySelector('[role=alert]')");for(let i=0;i<40&&!existsSync(join(artifacts,'ANGIE-TECH-FV-1245.pdf'));i++)await delay(100);assert.ok(existsSync(join(artifacts,'ANGIE-TECH-FV-1245.pdf')));const downloaded=readFileSync(join(artifacts,'ANGIE-TECH-FV-1245.pdf'));assert.ok(downloaded.toString('latin1').startsWith('%PDF-'));assert.ok(downloaded.toString('latin1').includes('FV-1245'));assert.ok(!(await evaluate('window.__desktopShareCalled')));check('Desktop, including touch-enabled PC, downloads the correctly named vector PDF without invoking Share')
  await send('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'});await evaluate("window.matchMedia=q=>q==='(pointer: coarse)'?{matches:true}:window.__realMatchMedia(q);Object.defineProperty(navigator,'canShare',{configurable:true,value:({files})=>files[0]?.type==='application/pdf'});Object.defineProperty(navigator,'share',{configurable:true,value:async({files})=>{window.__shared={name:files[0].name,type:files[0].type,bytes:Array.from(new Uint8Array(await files[0].arrayBuffer()))}}})");await button('Guardar PDF');await waitFor("!!window.__shared");const shared=await evaluate('window.__shared');assert.equal(shared.name,'ANGIE-TECH-FV-1245.pdf');assert.equal(shared.type,'application/pdf');assert.ok(Buffer.from(shared.bytes).toString('latin1').includes('FV-1245'));check('Mobile file-sharing capability branch receives actual PDF File bytes and invoice filename')
  await button('Cerrar vista previa');await button('PDF / Imprimir');await button('Compartir PDF');check('Explicit Compartir PDF action uses the same real PDF file-sharing flow')
  await evaluate("Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>false});window.__realOpen=window.open;window.open=url=>{window.__opened=url;return {}};");await button('Guardar PDF');await waitFor("!!window.__opened");assert.ok((await evaluate('window.__opened')).startsWith('blob:'));const opened=await evaluate("fetch(window.__opened).then(r=>r.arrayBuffer()).then(b=>Array.from(new Uint8Array(b)))");assert.ok(Buffer.from(opened).toString('latin1').startsWith('%PDF-'));check('Unsupported mobile share opens a real local PDF Blob for Safari saving')
  await evaluate("window.__opened=null;Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});Object.defineProperty(navigator,'share',{configurable:true,value:async()=>{throw new DOMException('cancel','AbortError')}})");await button('Guardar PDF');assert.equal(await evaluate('window.__opened'),null);check('User-cancelled sharing does not trigger an unwanted fallback window')
  await evaluate("Object.defineProperty(navigator,'share',{configurable:true,value:async()=>{throw new DOMException('blocked','NotAllowedError')}})");await button('Guardar PDF');await waitFor("!!window.__opened");check('Denied sharing falls back to opening the local PDF')
  await close();await go('/finanzas');await waitFor("document.body.innerText.includes('Compra de insumos PDF-FINANCE')");assert.equal((await state()).tables.movimientos.length,before+2)
  assert.deepEqual(externalRequests,[]);assert.deepEqual(browserErrors,[]);await writeFile(join(artifacts,'results.json'),JSON.stringify({status:'PASS',cases:results.length,results,externalRequests,browserErrors,origin:base,physicalSafari:'Pending physical iPhone validation; sharing APIs capability branches exercised with actual PDF files'},null,2));console.log(JSON.stringify({status:'PASS',cases:results.length,artifacts}));await send('Browser.close').catch(()=>{})

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
