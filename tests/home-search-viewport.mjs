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
    const clip = name.includes('keyboard') ? await evaluate('({x:0,y:visualViewport.offsetTop,width:innerWidth,height:visualViewport.height,scale:1})') : undefined;
    const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, ...(clip?{clip}:{}) })
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


  await send('Page.enable');await send('Page.bringToFront');await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});await send('Runtime.enable');await send('Log.enable');await send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await send('Page.navigate',{url:base+'/login'});await waitFor("!!document.querySelector('.login-form')");await evaluate("document.querySelector('.login-form .btn').click()");await waitFor("!!document.querySelector('.stat-card')");
  for(const theme of ['dark','light'])for(const [width,height] of [[320,700],[360,800],[390,844],[430,932]])for(const path of ['/','/inventario','/vender','/facturas','/proveedores','/clientes','/empleados']){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await evaluate('import("/src/lib/theme.js").then(m=>m.setTheme('+JSON.stringify(theme)+'))');
    await send('Page.navigate',{url:base+path});await waitFor("!!document.querySelector('.search-bar input') && document.readyState==='complete'");await delay(100);
    await evaluate("document.querySelector('.view').scrollTop=300;document.querySelector('.search-bar input').focus({preventScroll:true})");await delay(80);
    await waitFor("document.querySelector('.device').classList.contains('search-mode')",3000);
    if(path==='/'){
      const hidden=await evaluate("['.tech-hero','.quick-actions','.home-metrics','.nav','.app-footer'].map(sel=>{const e=document.querySelector(sel);return !e||e.getClientRects().length===0})");assert.ok(hidden.every(Boolean),'Focus removes Home decoration, metrics and navigation');
    }
    // Model both Safari (stable layout height) and browsers resizing innerHeight too.
    await evaluate("window.__originalInnerHeight=Object.getOwnPropertyDescriptor(window,'innerHeight')");
    const visible=height-330;
    await evaluate('Object.defineProperty(visualViewport,"height",{configurable:true,value:'+visible+'});Object.defineProperty(visualViewport,"offsetTop",{configurable:true,value:37});Object.defineProperty(window,"innerHeight",{configurable:true,value:'+visible+'});visualViewport.dispatchEvent(new Event("resize"))');await delay(100);
    const measure=()=>evaluate("(()=>{const d=document.querySelector('.device'),r=d.getBoundingClientRect(),i=d.querySelector('.search-bar input'),f=i.getBoundingClientRect(),v=d.querySelector('.view').getBoundingClientRect();return {top:r.top,bottom:r.bottom,fieldTop:f.top,fieldBottom:f.bottom,viewTop:v.top,viewBottom:v.bottom,font:parseFloat(getComputedStyle(i).fontSize),nav:getComputedStyle(d.querySelector('.nav')).display,keyboard:d.classList.contains('search-keyboard'),docWidth:document.documentElement.scrollWidth,rootScroll:scrollY,bodyOverflow:getComputedStyle(document.body).overflowY,viewOverflow:getComputedStyle(d.querySelector('.view')).overflowY}})()");
    let m=await measure();assert.ok(m.keyboard&&m.nav==='none',JSON.stringify(m));assert.ok(Math.abs(m.top-37)<1&&Math.abs(m.bottom-(visible+37))<1,JSON.stringify(m));assert.ok(m.fieldTop>=m.viewTop+7&&m.fieldBottom<=m.viewBottom-7,JSON.stringify(m));assert.ok(m.font>=16&&m.docWidth<=width&&m.rootScroll===0&&m.bodyOverflow==='hidden'&&m.viewOverflow==='auto',JSON.stringify(m));
    await evaluate("Object.defineProperty(visualViewport,'offsetTop',{configurable:true,value:61});visualViewport.dispatchEvent(new Event('scroll'))");await delay(80);assert.ok(Math.abs((await measure()).top-61)<1);
    // Blurring precedes keyboard-close resize on Safari: keep the frame/nav stable.
    await evaluate("document.activeElement.blur()");await delay(100);assert.equal((await measure()).keyboard,true);
    await evaluate("Object.defineProperty(window,'innerHeight',window.__originalInnerHeight);delete window.__originalInnerHeight;delete visualViewport.height;delete visualViewport.offsetTop;visualViewport.dispatchEvent(new Event('resize'))");await delay(100);m=await measure();assert.equal(m.keyboard,false);assert.notEqual(m.nav,'none');assert.ok(Math.abs(m.top)<1&&Math.abs(m.bottom-height)<1,JSON.stringify(m));
    results.push({name:theme+' '+width+' '+path+' focus/pan/blur/restore',status:'PASS'});
    if(path==='/'){await screenshot(width+'-'+theme+'-home');await evaluate("document.querySelector('.search-bar input').focus();Object.defineProperty(visualViewport,'height',{configurable:true,value:450});visualViewport.dispatchEvent(new Event('resize'))");await delay(100);assert.equal((await measure()).keyboard,true);await screenshot(width+'-'+theme+'-keyboard');await evaluate("document.activeElement.blur();delete visualViewport.height;visualViewport.dispatchEvent(new Event('resize'))");await delay(80)}
  }
  await send('Page.navigate',{url:base+'/'});await waitFor("!!document.querySelector('.search-bar input')");await evaluate("document.querySelector('.search-bar input').focus();Object.defineProperty(visualViewport,'height',{configurable:true,value:450});visualViewport.dispatchEvent(new Event('resize'))");await delay(100);
  // SPA navigation unmounts the focused search before Safari's closing resize.
  await evaluate("document.querySelector('.quick-actions button').click()");await waitFor("location.pathname==='/vender' && !!document.querySelector('.search-bar input')");await delay(100);assert.equal(await evaluate("getComputedStyle(document.querySelector('.nav')).display"),'none');
  await evaluate("delete visualViewport.height;visualViewport.dispatchEvent(new Event('resize'))");await delay(100);assert.notEqual(await evaluate("getComputedStyle(document.querySelector('.nav')).display"),'none');results.push({name:'SPA navigation retains keyboard frame until closing resize',status:'PASS'});
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  for(const term of ['AirPods','Cable USB-C trenzado 2 metros','USBC2M','FV-1245']){
    await send('Page.navigate',{url:base+'/'});await waitFor("!!document.querySelector('.search-bar input')");await evaluate('(()=>{const i=document.querySelector(".search-bar input");i.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(i,'+JSON.stringify(term)+');i.dispatchEvent(new Event("input",{bubbles:true}));Object.defineProperty(visualViewport,"height",{configurable:true,value:450});Object.defineProperty(visualViewport,"offsetTop",{configurable:true,value:30});visualViewport.dispatchEvent(new Event("resize"))})()');await waitFor("!!document.querySelector('.search-results button')");assert.equal(await evaluate("getComputedStyle(document.querySelector('.nav')).display"),'none');
    const position=await evaluate("(()=>{const s=document.querySelector('.search-bar').getBoundingClientRect(),r=document.querySelector('.search-results').getBoundingClientRect();return{gap:r.top-s.bottom,hidden:document.querySelector('.tech-hero').getClientRects().length===0}})()");assert.ok(position.hidden&&position.gap>=0&&position.gap<=20,JSON.stringify(position));
    await screenshot('390-keyboard-results-'+term.replace(/[^a-zA-Z0-9]/g,'-'));
    await evaluate("document.querySelector('.search-results button').click()");await waitFor("!!document.querySelector('.sheet')");assert.ok(await evaluate("location.search.includes('producto=')||location.search.includes('factura=')"));await evaluate("delete visualViewport.height;delete visualViewport.offsetTop;visualViewport.dispatchEvent(new Event('resize'))");await delay(100);results.push({name:'Keyboard search '+term+' opens correct detail',status:'PASS'});
  }
  await send('Page.navigate',{url:base+'/'});await waitFor("!!document.querySelector('.search-bar input')");await evaluate("document.querySelector('.search-bar input').focus();Object.defineProperty(visualViewport,'height',{configurable:true,value:450});Object.defineProperty(visualViewport,'offsetTop',{configurable:true,value:30});visualViewport.dispatchEvent(new Event('resize'))");await delay(100);await evaluate("document.querySelector('[aria-label=\"Cambiar tema\"]').click();document.querySelector('[aria-label=\"Escanear\"]').click()");await waitFor("!!document.querySelector('.scanner-sheet')");await delay(100);const scanner=await evaluate("(()=>{const s=document.querySelector('.scanner-sheet').getBoundingClientRect();return{top:s.top,bottom:s.bottom,inert:document.getElementById('root').inert}})()");assert.equal(scanner.top,30);assert.equal(scanner.bottom,480);assert.ok(scanner.inert);await evaluate("document.querySelector('.scanner-sheet .sheet-x').click();delete visualViewport.height;delete visualViewport.offsetTop;visualViewport.dispatchEvent(new Event('resize'))");await delay(100);assert.notEqual(await evaluate("getComputedStyle(document.querySelector('.nav')).display"),'none');results.push({name:'Theme and scanner remain usable from open search keyboard',status:'PASS'});
  await send('Page.navigate',{url:base+'/'});await waitFor("!!document.querySelector('.search-bar input')");
  await evaluate("document.querySelector('.search-bar input').focus();Object.defineProperty(visualViewport,'height',{configurable:true,value:450});visualViewport.dispatchEvent(new Event('resize'))");await delay(100);
  await evaluate("delete visualViewport.height;visualViewport.dispatchEvent(new Event('resize'))");await delay(100);assert.equal(await evaluate("document.querySelector('.device').classList.contains('search-mode')"),false,'Native keyboard dismissal restores Home even while input keeps focus');
  await evaluate("Object.defineProperty(visualViewport,'height',{configurable:true,value:450});visualViewport.dispatchEvent(new Event('resize'))");await delay(100);assert.equal(await evaluate("document.querySelector('.device').classList.contains('search-mode')"),true,'Reopening keyboard restores Search Mode');
  await evaluate("document.activeElement.blur();delete visualViewport.height;visualViewport.dispatchEvent(new Event('resize'))");await delay(100);
  for(const [width,height] of [[844,390],[390,844]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await evaluate("window.dispatchEvent(new Event('orientationchange'))");await delay(100);await geometry('Rotate '+width,width,height);
  }
  await evaluate("document.querySelector('.search-bar input').focus();Object.defineProperty(visualViewport,'height',{configurable:true,value:450});visualViewport.dispatchEvent(new Event('resize'))");await delay(100);
  await send('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:1,mobile:true});await evaluate("Object.defineProperty(visualViewport,'height',{configurable:true,value:200});window.dispatchEvent(new Event('orientationchange'));visualViewport.dispatchEvent(new Event('resize'))");await delay(100);
  assert.equal(await evaluate("Math.round(document.querySelector('.device').getBoundingClientRect().height)"),200,'Rotation with focus uses visible viewport');
  await evaluate("document.activeElement.blur();delete visualViewport.height;visualViewport.dispatchEvent(new Event('resize'))");await delay(100);assert.notEqual(await evaluate("getComputedStyle(document.querySelector('.nav')).display"),'none');
  results.push({name:'Native dismissal, reopening and portrait/landscape restore',status:'PASS'});
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  for(const closeFirst of [true,false]){
    await send('Page.navigate',{url:base+'/'});await waitFor("!!document.querySelector('.search-bar input')");await evaluate("document.querySelector('.search-bar input').focus();Object.defineProperty(visualViewport,'height',{configurable:true,value:450});visualViewport.dispatchEvent(new Event('resize'))");await delay(100);
    await evaluate("document.querySelector('[aria-label=\"Escanear\"]').click()");await waitFor("!!document.querySelector('.scanner-sheet')");
    if(closeFirst)await evaluate("document.querySelector('.scanner-sheet .sheet-x').click()");
    await evaluate("delete visualViewport.height;visualViewport.dispatchEvent(new Event('resize'))");await delay(150);
    if(!closeFirst)await evaluate("document.querySelector('.scanner-sheet .sheet-x').click()");
    await waitFor("!document.querySelector('.scanner-sheet') && getComputedStyle(document.querySelector('.nav')).display!=='none'");
    assert.equal(await evaluate("document.querySelector('.device').classList.contains('search-mode')"),false);assert.equal(await evaluate("!!document.querySelector('[data-dialog-restoring-focus]')"),false);
    results.push({name:'Scanner close/viewport race: '+(closeFirst?'dialog first':'resize first'),status:'PASS'});
  }
  assert.deepEqual(externalRequests,[]);assert.deepEqual(browserErrors,[]);await writeFile(join(artifacts,'results.json'),JSON.stringify({status:'PASS',cases:results.length,results,externalRequests,browserErrors,testedOn:'Chromium touch emulation with Safari viewport event sequences; physical Safari still required'},null,2));console.log(JSON.stringify({status:'PASS',cases:results.length,artifacts}));await send('Browser.close').catch(()=>{});
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
