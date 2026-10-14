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
const artifacts = join(root, 'artifacts', process.env.UI_ARTIFACTS || 'three-improvements')
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
  const go=async path=>{await send('Page.navigate',{url:base+path});await waitFor("!!document.querySelector('.nav') && document.readyState==='complete'");await delay(400)};
  const close=async()=>{await evaluate("[...document.querySelectorAll('.sheet')].at(-1).querySelector('.sheet-x').click()");await waitFor("!document.querySelector('.sheet')")};
  const button=async text=>{await evaluate('(()=>{const s=[...document.querySelectorAll(".sheet")].at(-1)||document;const b=[...s.querySelectorAll("button")].find(b=>(b.getAttribute("aria-label")||b.textContent.trim())==='+JSON.stringify(text)+');if(!b)throw Error("Missing button");b.click()})()');await delay(150)};
  const field=async(label,value)=>{await evaluate('(()=>{const l=[...document.querySelectorAll("label")].find(l=>l.textContent.trim()==='+JSON.stringify(label)+');const e=document.getElementById(l.htmlFor);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,'+JSON.stringify(value)+');e.dispatchEvent(new Event("input",{bubbles:true}))})()');await delay(100)};
  const click=async selector=>{await evaluate('document.querySelector('+JSON.stringify(selector)+').click()');await delay(120)};
  const api=expression=>evaluate("import('/src/lib/supabase.js').then(async({supabase})=>{"+expression+"})");
  const state=()=>evaluate("JSON.parse(localStorage.getItem('angie-tech:demo:v1'))");
  const money=n=>'$'+Math.round(Number(n)).toLocaleString('es-CO');
  await send('Page.navigate',{url:base+'/login'});await waitFor("!!document.querySelector('.login-form')");await click('.login-form .btn');await waitFor("!!document.querySelector('.home-metrics')");
  const original=(await state()).tables.perfiles.find(p=>p.id==='demo-admin');
  await click('[aria-label="Mi perfil"]');await waitFor("!!document.querySelector('.profile-sheet')");await field('Nombre del usuario','Perfil iPhone validado');await field('Teléfono','3001234567');await button('Guardar perfil');await waitFor("!document.querySelector('.sheet')");await click('[aria-label="Mi perfil"]');await waitFor("!!document.querySelector('.profile-sheet')");assert.equal(await evaluate("document.querySelector('.profile-sheet input').value"),'Perfil iPhone validado');assert.equal(await evaluate("document.querySelector('.profile-sheet input[type=tel]').value"),'3001234567');check('Profile name and phone save and reopen');
  await button('Claro');assert.equal(await evaluate('document.documentElement.dataset.theme'),'light');assert.equal(await evaluate("document.querySelector('.profile-theme button:last-child').getAttribute('aria-pressed')"),'true');await close();await click('[aria-label="Mi perfil"]');await waitFor("!!document.querySelector('.profile-sheet')");assert.equal(await evaluate("document.querySelector('.profile-theme button:last-child').getAttribute('aria-pressed')"),'true');await button('Oscuro');check('Segmented theme changes immediately and persists on reopen');await close();
  const layout=async(name,width,height)=>{
    await delay(100);await evaluate('document.fonts.ready.then(()=>true)');
    const m=await evaluate("(()=>{const s=document.querySelector('.sheet'),b=s.querySelector('.sheet-body'),f=s.querySelector('.sheet-foot'),r=s.getBoundingClientRect(),br=b.getBoundingClientRect(),fr=f.getBoundingClientRect(),x=s.querySelector('.sheet-x').getBoundingClientRect();return{top:r.top,bottom:r.bottom,bodyBottom:br.bottom,footerTop:fr.top,footerBottom:fr.bottom,close:[x.width,x.height],overflow:[...s.querySelectorAll('*')].filter(e=>{const t=e.getBoundingClientRect();return t.width&&(t.left<r.left-1||t.right>r.right+1||e.scrollWidth>e.clientWidth+2)&&!e.closest('svg')}).map(e=>e.className),otherScroll:[...s.querySelectorAll('*')].filter(e=>e!==b&&['auto','scroll'].includes(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight+1).map(e=>e.className),rootInert:document.getElementById('root').inert,scroll:getComputedStyle(b).overflowY}})()");assert.deepEqual(m.overflow,[],name);assert.deepEqual(m.otherScroll,[]);assert.ok(m.top>=0&&m.bottom<=height+1&&m.bodyBottom<=m.footerTop+1&&m.footerBottom<=m.bottom);assert.ok(m.close.every(n=>n>=44)&&m.rootInert&&m.scroll==='auto');check(name);if(width===390)await screenshot(name.replaceAll(' ','-'));await evaluate("document.querySelector('.sheet-body').scrollTop=100000");await delay(80);
  };
  const financeCheck=async type=>{await waitFor("!!document.querySelector('.finance-detail-hero') || !!document.querySelector('.finance-detail-sheet [role=alert]')");const data=await evaluate("({total:document.querySelector('.finance-detail-total strong').textContent,hero:document.querySelector('.finance-detail-hero strong')?.textContent,amounts:[...document.querySelectorAll('.finance-detail-row')].map(e=>Number(e.dataset.amount)),alert:document.querySelector('.finance-detail-sheet [role=alert]')?.textContent,card:document.querySelector('.finance-stats button[aria-label=\""+(type==='ingreso'?'Ingresos':'Gastos')+"\"] .stat-value').textContent})");assert.ok(!data.alert,data.alert);assert.equal(data.total,data.card);assert.equal(data.hero,data.card);assert.equal(money(data.amounts.reduce((n,v)=>n+v,0)),data.card)};
  for(const theme of ['dark','light'])for(const[width,height]of [[320,700],[360,800],[390,844],[430,932],[844,390]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await evaluate('import("/src/lib/theme.js").then(m=>m.setTheme('+JSON.stringify(theme)+'))');await go('/');await click('[aria-label="Mi perfil"]');await waitFor("!!document.querySelector('.profile-sheet')");await layout(theme+' '+width+' profile',width,height);assert.deepEqual(await evaluate("(()=>{const r=document.querySelector('.profile-sheet .profile-avatar').getBoundingClientRect();return[r.width,r.height]})()"),width<=360?[64,64]:[76,76]);await close();
    await go('/vender');await waitFor("!!document.querySelector('[aria-label=\"Agregar Cable USB-C trenzado 2 metros\"]')");await click('[aria-label="Agregar Cable USB-C trenzado 2 metros"]');await geometry(theme+' '+width+' inline cart',width,height);const controls=await evaluate("[...document.querySelectorAll('.sale-inline-control button')].map(e=>{const r=e.getBoundingClientRect();return[r.width,r.height]})");assert.ok(controls.every(r=>r.every(n=>n>=44)));assert.equal(await evaluate("document.querySelectorAll('button button').length"),0);await screenshot(theme+'-'+width+'-inline-cart');await evaluate("Object.keys(sessionStorage).filter(k=>k.startsWith('angie:cart:')).forEach(k=>sessionStorage.removeItem(k))");
    await go('/finanzas');await waitFor("!document.querySelector('.loading-state')");for(const type of ['ingreso','gasto']){await click('[aria-label="'+(type==='ingreso'?'Ingresos':'Gastos')+'"]');await financeCheck(type);await layout(theme+' '+width+' '+type,width,height);await close()}
  }
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await go('/');await click('[aria-label="Mi perfil"]');await waitFor("!!document.querySelector('.profile-sheet')");await evaluate("document.querySelector('.profile-sheet input[type=tel]').focus();Object.defineProperty(visualViewport,'height',{configurable:true,value:450});Object.defineProperty(visualViewport,'offsetTop',{configurable:true,value:30});visualViewport.dispatchEvent(new Event('resize'))");await delay(150);const k=await evaluate("(()=>{const s=document.querySelector('.profile-sheet'),r=s.getBoundingClientRect(),f=s.querySelector('.sheet-foot').getBoundingClientRect();return[r.top,r.bottom,f.bottom,getComputedStyle(s.querySelector('.sheet-foot')).backgroundColor]})()");assert.deepEqual(k.slice(0,3),[30,480,480]);assert.notEqual(k[3],'rgba(0, 0, 0, 0)');await screenshot('profile-keyboard');await evaluate("document.activeElement.blur();delete visualViewport.height;delete visualViewport.offsetTop;visualViewport.dispatchEvent(new Event('resize'))");await close();check('Profile keyboard has continuous surface and solid protected footer');
  await go('/vender');await waitFor("!!document.querySelector('[aria-label=\"Agregar Cable USB-C trenzado 2 metros\"]')");const cable='Cable USB-C trenzado 2 metros',other='Case MagSafe iPhone 15 Pro';const add=async name=>click('[aria-label="Aumentar '+name+'"]'),minus=async name=>click('[aria-label="Disminuir '+name+'"]');const count=name=>evaluate('Number(document.querySelector('+JSON.stringify('[aria-label="Unidades de '+name+'"]')+')?.textContent||0)');
  await add(cable);assert.equal(await count(cable),1);await add(cable);assert.equal(await count(cable),2);await minus(cable);assert.equal(await count(cable),1);check('Inline add, increase and decrease');await add(other);assert.equal(await evaluate("document.querySelector('.cart-count').textContent"),'2');const draft=(await evaluate("JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage).find(k=>k.startsWith('angie:cart:'))))"));const expected=draft.carrito.reduce((n,i)=>n+i.cantidad*i.producto.precio_venta,0);assert.equal(await evaluate("document.querySelector('.cart-bar-button strong').textContent"),money(expected));check('Multiple products synchronize subtotal and cart badge');await minus(cable);assert.equal(await count(cable),0);assert.equal(await evaluate("document.querySelector('.cart-count').textContent"),'1');await minus(other);assert.equal(await evaluate("!!document.querySelector('.cart-bar-button')"),false);check('Last unit removes line, badge and empty cart footer');
  const product=(await state()).tables.productos.find(p=>p.nombre===cable);await evaluate('(()=>{const b=document.querySelector('+JSON.stringify('[aria-label="Aumentar '+cable+'"]')+');for(let i=0;i<'+(product.stock+10)+';i++)b.click()})()');await delay(180);assert.equal(await count(cable),product.stock);assert.equal(await evaluate('document.querySelector('+JSON.stringify('[aria-label="Aumentar '+cable+'"]')+').disabled'),true);assert.equal(await evaluate('document.querySelector('+JSON.stringify('[aria-label="Agregar '+cable+'"]')+').closest(".sale-product").querySelector(".badge").textContent'),'0 disp.');check('Rapid taps stay bounded by stock; available badge updates');await evaluate('(()=>{const b=document.querySelector('+JSON.stringify('[aria-label="Disminuir '+cable+'"]')+');for(let i=0;i<'+(product.stock+10)+';i++)b.click()})()');await delay(180);assert.equal(await count(cable),0);check('Rapid decrement cannot produce negative quantities');
  const serial='Xiaomi Redmi Note 13 Pro';await add(serial);await waitFor("!!document.querySelector('.serial-option')");const serial1=await evaluate("document.querySelector('.serial-option b').textContent");await click('.serial-option');await waitFor("!document.querySelector('.sheet')");await add(serial);await waitFor("!!document.querySelector('.serial-option')");assert.equal(await evaluate('document.querySelector(".serial-list").textContent.includes('+JSON.stringify(serial1)+')'),false);const serial2=await evaluate("document.querySelector('.serial-option b').textContent");await click('.serial-option');await waitFor("!document.querySelector('.sheet')");assert.equal(await count(serial),2);await minus(serial);assert.equal(await count(serial),1);await add(serial);await waitFor("!!document.querySelector('.serial-option')");assert.ok(await evaluate('document.querySelector(".serial-list").textContent.includes('+JSON.stringify(serial2)+')'));await close();await click('.cart-bar-button');assert.ok(await evaluate('document.querySelector(".checkout-sheet").textContent.includes('+JSON.stringify(serial1)+')'));await close();check('Serialized addition selects unique units; minus releases last selected unit and preserves checkout');
  const before=await state();await go('/finanzas');await waitFor("!document.querySelector('.loading-state')");await click('[aria-label="Ingresos"]');await financeCheck('ingreso');await click('[aria-label="Mes anterior del detalle"]');await financeCheck('ingreso');check('Month navigation refreshes income detail and parent card together');for(let i=0;i<3;i++)await click('[aria-label="Mes anterior del detalle"]');await financeCheck('ingreso');assert.equal(await evaluate("document.querySelectorAll('.finance-detail-row').length"),0);assert.ok(await evaluate("document.querySelector('.finance-detail-sheet .empty-state').textContent.includes('Sin ingresos')"));check('Empty period shows zero and real empty state');await close();await go('/finanzas');await waitFor("!document.querySelector('.loading-state')");await click('[aria-label="Gastos"]');await financeCheck('gasto');await click('[aria-label="Mes anterior del detalle"]');await financeCheck('gasto');check('Expense period navigation reconciles actual rows');await close();assert.deepEqual((await state()).tables,before.tables);check('Finance browsing leaves business data unchanged');
  await go('/');await click('[aria-label="Mi perfil"]');await waitFor("!!document.querySelector('.profile-sheet')");await field('Nombre del usuario',original.nombre);await field('Teléfono',original.telefono||'');await button('Guardar perfil');await waitFor("!document.querySelector('.sheet')");await click('[aria-label="Mi perfil"]');await waitFor("!!document.querySelector('.profile-sheet')");await button('Cerrar sesión');await waitFor("!!document.querySelector('.login-form')");assert.equal(await evaluate("document.querySelectorAll('.sheet').length"),0);check('Logout closes profile and returns to login');
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
