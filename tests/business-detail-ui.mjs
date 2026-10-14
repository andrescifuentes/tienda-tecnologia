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
const artifacts = join(root, 'artifacts', process.env.UI_ARTIFACTS || 'business-detail')
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
  await send('Page.navigate',{url:base+'/login'});await waitFor("!!document.querySelector('.login-form')");await evaluate("document.querySelector('.login-form .btn').click()");await waitFor("!!document.querySelector('.home-metrics')");
  const persisted=await evaluate("localStorage.getItem('angie-tech:demo:v1')");
  const open=async()=>{await evaluate("document.querySelector('.home-section button').click()");await waitFor("!!document.querySelector('.business-detail-sheet')");await evaluate('document.fonts.ready.then(()=>true)');await delay(150)};
  const close=async()=>{await evaluate("document.querySelector('.business-detail-sheet .sheet-x').click()");await waitFor("!document.querySelector('.sheet')")};
  const money=n=>'$'+Number(n).toLocaleString('es-CO',{maximumFractionDigits:0});
  const summary=await evaluate("import('/src/lib/supabase.js').then(async({supabase})=>(await supabase.rpc('resumen_dashboard')).data[0])");
  for(const theme of ['dark','light'])for(const[width,height]of [[320,700],[360,800],[390,844],[430,932]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await evaluate('import("/src/lib/theme.js").then(m=>m.setTheme('+JSON.stringify(theme)+'))');await open();
    const m=await evaluate("(()=>{const s=document.querySelector('.business-detail-sheet'),b=s.querySelector('.sheet-body'),f=s.querySelector('.sheet-foot'),r=s.getBoundingClientRect(),br=b.getBoundingClientRect(),fr=f.getBoundingClientRect(),x=s.querySelector('.sheet-x').getBoundingClientRect();const overflow=[...s.querySelectorAll('*')].filter(e=>{const t=e.getBoundingClientRect();return t.width&&(t.left<r.left-1||t.right>r.right+1||e.scrollWidth>e.clientWidth+2)&&!e.closest('svg')}).map(e=>e.className);return{top:r.top,bottom:r.bottom,bodyTop:br.top,bodyBottom:br.bottom,footerTop:fr.top,footerBottom:fr.bottom,close:[x.width,x.height],overflow,rootInert:document.getElementById('root').inert,scroll:getComputedStyle(b).overflowY,otherScroll:[...s.querySelectorAll('*')].filter(e=>e!==b&&['auto','scroll'].includes(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight+1).map(e=>e.className),cards:[...s.querySelectorAll('.stat-card')].map(e=>[e.querySelector('.stat-heading p').textContent,e.querySelector('.stat-value').textContent]),headline:s.querySelector('.headline').getBoundingClientRect().width,secondary:s.querySelector('.income').getBoundingClientRect().width,headingFont:parseFloat(getComputedStyle(s.querySelector(':scope>h3')).fontSize)}})()");
    assert.deepEqual(m.overflow,[],theme+' '+width+' overflow');assert.ok(m.top>=0&&m.bottom<=height+1&&m.bodyBottom<=m.footerTop+1&&m.footerBottom<=m.bottom);assert.ok(m.close.every(n=>n>=44)&&m.rootInert&&m.scroll==='auto');assert.deepEqual(m.otherScroll,[]);assert.equal(m.cards.length,9);assert.ok(m.headingFont>=24);assert.ok(m.headline>m.secondary*1.8);
    const cards=Object.fromEntries(m.cards);for(const[label,key]of [['Ventas de hoy','ventas_hoy'],['Ventas del mes','ventas_mes'],['Ingresos del mes','ingresos_mes'],['Gastos del mes','gastos_mes'],['Utilidad del mes','utilidad_mes'],['Valor inventario','valor_inventario']])assert.equal(cards[label],money(summary[key]),label);assert.equal(cards['Stock bajo'],String(summary.productos_stock_bajo));assert.equal(cards['Facturas del d\u00eda'],String(summary.facturas_hoy));
    await screenshot(width+'-'+theme+'-executive');await evaluate("document.querySelector('.business-detail-sheet .sheet-body').scrollTop=100000");await delay(100);await screenshot(width+'-'+theme+'-records');check(theme+' '+width+' layout, hierarchy, unchanged metrics, one scroll, fixed footer');await close();
  }
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await open();
  await evaluate("Object.defineProperty(visualViewport,'height',{configurable:true,value:450});Object.defineProperty(visualViewport,'offsetTop',{configurable:true,value:30});visualViewport.dispatchEvent(new Event('resize'))");await delay(150);
  const keyboard=await evaluate("(()=>{const s=document.querySelector('.business-detail-sheet'),r=s.getBoundingClientRect(),b=s.querySelector('.sheet-body').getBoundingClientRect(),f=s.querySelector('.sheet-foot').getBoundingClientRect();return{top:r.top,bottom:r.bottom,bodyBottom:b.bottom,footerTop:f.top,footerBottom:f.bottom,background:getComputedStyle(s.querySelector('.sheet-foot')).backgroundColor,inert:document.getElementById('root').inert}})()");assert.equal(keyboard.top,30);assert.equal(keyboard.bottom,480);assert.ok(keyboard.bodyBottom<=keyboard.footerTop+1&&keyboard.footerBottom<=480&&keyboard.background!=='rgba(0, 0, 0, 0)'&&keyboard.inert);check('Reduced Safari viewport keeps continuous sheet and protected footer');await screenshot('390-keyboard');await evaluate("delete visualViewport.height;delete visualViewport.offsetTop;visualViewport.dispatchEvent(new Event('resize'))");await delay(150);await close();assert.equal(await evaluate("document.getElementById('root').inert"),false);assert.equal(await evaluate("localStorage.getItem('angie-tech:demo:v1')"),persisted);check('Opening, scrolling, resizing and closing do not change persisted business data');
  await open();
  const team=await evaluate("Promise.all([import('/src/lib/supabase.js'),import('/src/lib/format.js')]).then(async([{supabase},{rangoMes}])=>{const m=rangoMes();return(await supabase.rpc('ventas_por_empleado',{p_desde:m.ini,p_hasta:m.fin})).data})");
  const rows=await evaluate("[...document.querySelectorAll('.executive-person')].map(e=>({name:e.querySelector('.executive-person-top b').textContent,total:e.querySelector('.executive-person-total strong').textContent,commission:e.querySelector('.executive-commission b').textContent}))");assert.equal(rows.length,team.length);for(const e of team){const row=rows.find(r=>r.name===e.nombre);assert.equal(row.total,money(e.total_vendido));assert.equal(row.commission,money(e.comision))}check('Team totals and commissions match the existing dashboard API');
  await close();await evaluate("import('/src/lib/supabase.js').then(async({supabase})=>{const r=await supabase.rpc('guardar_empleado_demo',{id:'demo-ana',datos:{},permisos:['vender','ver_inventario','ver_finanzas']});if(r.error)throw Error(r.error.message);await supabase.auth.signInWithPassword({email:'ana@angietech.demo',password:'AngieDemo123!'})})");await send('Page.reload');await waitFor("!!document.querySelector('.home-metrics')");await open();assert.equal(await evaluate("document.querySelectorAll('.business-detail .stat-card').length"),7);assert.equal(await evaluate("!!document.querySelector('.business-detail .profit,.business-detail .negative,.business-detail .inventory-value')"),false);assert.equal(await evaluate("document.querySelectorAll('.executive-bar').length"),2);check('Existing cost permissions remain respected by metrics and visualization');await close();
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
