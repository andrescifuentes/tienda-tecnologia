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
const artifacts = join(root, 'artifacts', process.env.UI_ARTIFACTS || 'login-cinematic')
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
  await send('Page.enable');await send('Page.bringToFront');await send('Runtime.enable');await send('Log.enable');await send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});await send('Emulation.setFocusEmulationEnabled',{enabled:true});
  const check=name=>results.push({name,status:'PASS'});
  const open=async()=>{await send('Page.navigate',{url:base+'/login'});await waitFor("!!document.querySelector('.login-form')");await evaluate('document.fonts.ready.then(()=>true)');await delay(2400)};
  const click=async selector=>{await evaluate('document.querySelector('+JSON.stringify(selector)+').click()');await delay(120)};
  const field=async(selector,value)=>{await evaluate('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,'+JSON.stringify(value)+');e.dispatchEvent(new Event("input",{bubbles:true}))})()');await delay(120)};
  await open();
  const persisted=await evaluate("localStorage.getItem('angie-tech:demo:v1')");
  for(const theme of ['dark','light'])for(const[width,height]of [[320,700],[360,800],[390,844],[430,932],[844,390]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await evaluate('import("/src/lib/theme.js").then(m=>m.setTheme('+JSON.stringify(theme)+'))');await open();await geometry(theme+' '+width+' cinematic layout',width,height,false);
    const m=await evaluate("(()=>{const screen=document.querySelector('.login-screen'),hero=document.querySelector('.login-hero').getBoundingClientRect(),form=document.querySelector('.login-form').getBoundingClientRect(),brand=document.querySelector('.login-brand'),photo=document.querySelector('.login-photo'),submit=document.querySelector('.login-submit').getBoundingClientRect(),demo=document.querySelector('.demo-entry').getBoundingClientRect(),headline=document.querySelector('#login-headline');return{hero:{top:hero.top,bottom:hero.bottom,width:hero.width},form:{top:form.top,bottom:form.bottom,left:form.left},brandInScene:!!brand.closest('.login-hero'),border:getComputedStyle(document.querySelector('.login-hero')).borderRadius,photoLoaded:photo.complete&&photo.naturalWidth>0,font:getComputedStyle(headline).fontFamily,inputFonts:[...document.querySelectorAll('.login-input input')].map(e=>parseFloat(getComputedStyle(e).fontSize)),submitBottom:submit.bottom,demoBottom:demo.bottom,bodyScroll:getComputedStyle(screen).overflowY,otherScroll:[...document.querySelectorAll('.login-layout *')].filter(e=>['auto','scroll'].includes(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight+2).map(e=>e.className),targets:[...document.querySelectorAll('.login-form button,.login-theme,.login-options label')].map(e=>e.getBoundingClientRect().height),headingCount:document.querySelectorAll('h1').length}})()");
    assert.ok(m.brandInScene&&m.photoLoaded&&m.font.includes('Playfair'));assert.ok(m.inputFonts.every(n=>n>=16));assert.ok(m.targets.every(n=>n>=44));assert.deepEqual(m.otherScroll,[]);assert.equal(m.headingCount,1);assert.equal(m.bodyScroll,'auto');
    if(width<700){assert.ok(m.form.top<m.hero.bottom-20);assert.equal(m.hero.width,width);assert.equal(m.border,'0px');assert.ok(m.submitBottom<=height,'CTA must fit first viewport '+width);assert.ok(m.demoBottom<=height,'Demo must fit first viewport '+width)}else{assert.ok(m.form.left>width/3,'Landscape uses an overlapping side panel')}
    await screenshot(theme+'-'+width+'-cinematic');check(theme+' '+width+' structural overlap, scene branding, typography, first viewport and targets');
    if(width===390){
      for(const selector of ['#login-email','#login-password']){
        await evaluate('document.querySelector('+JSON.stringify(selector)+').focus();Object.defineProperty(visualViewport,"height",{configurable:true,value:450});Object.defineProperty(visualViewport,"offsetTop",{configurable:true,value:30});visualViewport.dispatchEvent(new Event("resize"))');await delay(180);
        const k=await evaluate('(()=>{const screen=document.querySelector(".login-screen"),r=screen.getBoundingClientRect(),f=document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect(),cta=document.querySelector(".login-submit").getBoundingClientRect();return{top:r.top,bottom:r.bottom,fieldTop:f.top,fieldBottom:f.bottom,ctaBottom:cta.bottom,heroHeight:document.querySelector(".login-hero").getBoundingClientRect().height,scroll:screen.scrollHeight,client:screen.clientHeight,rootScroll:document.documentElement.scrollHeight,windowHeight:innerHeight,keyboard:screen.classList.contains("login-keyboard")}})()');assert.ok(k.keyboard);assert.equal(k.top,30);assert.equal(k.bottom,480);assert.ok(k.fieldTop>=30&&k.fieldBottom<=480);assert.ok(k.ctaBottom<=480,'Keyboard CTA visible '+JSON.stringify(k));assert.equal(k.heroHeight,82);assert.ok(k.rootScroll<=k.windowHeight);await screenshot(theme+'-'+selector.slice(1)+'-keyboard');check(theme+' '+selector+' keyboard stays visible with accessible CTA and a single scroll');
        await evaluate('document.activeElement.blur();delete visualViewport.height;delete visualViewport.offsetTop;visualViewport.dispatchEvent(new Event("resize"));document.querySelector(".login-screen").scrollTop=0');await delay(120);assert.equal(await evaluate("document.querySelector('.login-screen').classList.contains('login-keyboard')"),false);
      }
    }
  }
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await open();await tap('[aria-label="Mostrar contraseña"]');assert.equal(await evaluate("document.querySelector('#login-password').type"),'text');assert.equal(await evaluate("document.querySelector('[aria-label=\"Ocultar contraseña\"]').getAttribute('aria-pressed')"),'true');await tap('[aria-label="Ocultar contraseña"]');assert.equal(await evaluate("document.querySelector('#login-password').type"),'password');check('Touch password visibility preserves value and announces state');
  await tap('[aria-label="Cambiar tema"]');const nextTheme=await evaluate('document.documentElement.dataset.theme');assert.ok(['light','dark'].includes(nextTheme));assert.equal(await evaluate("localStorage.getItem('theme')"),nextTheme);check('Theme toggle uses existing persisted preference');
  await click('[aria-label="Cambiar perfil demo"]');assert.equal(await evaluate("document.querySelector('[aria-label=\"Cambiar perfil demo\"]').getAttribute('aria-expanded')"),'true');assert.equal(await evaluate("document.querySelector('#demo-account').options.length"),5);await click('[aria-label="Cambiar perfil demo"]');assert.equal(await evaluate("!!document.querySelector('#demo-account')"),false);check('Existing demo account selector expands and collapses');
  await evaluate("[...document.querySelectorAll('.login-options button')][0].click()");await waitFor("!!document.querySelector('.sheet')");assert.ok(await evaluate("document.querySelector('.sheet').textContent.includes('Recordarme')"));await click('.sheet-x');await waitFor("!document.querySelector('.sheet')");assert.equal(await evaluate("document.getElementById('root').inert"),false);check('Existing recovery modal and focus restoration work');
  assert.equal(await evaluate("localStorage.getItem('angie-tech:demo:v1')"),persisted);check('Visual interactions do not mutate demo business data');
  await field('#login-email','invalid@example.test');await field('#login-password','invalid-password');
  const press=await evaluate("(()=>{const e=document.querySelector('.login-submit');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()");await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[press]});await delay(140);assert.ok(await evaluate("(()=>{const t=getComputedStyle(document.querySelector('.login-submit')).transform;return t!=='none'&&new DOMMatrixReadOnly(t).a<1})()"));await send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});check('CTA retains tactile scale feedback after entrance animation completes');
  await tap('.login-submit');await waitFor("!!document.querySelector('.login-form [role=alert]')");assert.equal(await evaluate('location.pathname'),'/login');await geometry('Login auth error keeps layout',390,844,false);check('Existing invalid login reports error without navigation');
  await field('#login-email','admin@angietech.demo');await field('#login-password','AngieDemo123!');await click('.login-options input[type=checkbox]');assert.equal(await evaluate("document.querySelector('.login-options input').checked"),true);await tap('.login-submit');await waitFor("!!document.querySelector('.home-metrics')");assert.equal(await evaluate("localStorage.getItem('angie:remember-email')"),'admin@angietech.demo');check('Entrar authenticates and Recordarme persists only email');
  await evaluate("import('/src/lib/supabase.js').then(({supabase})=>supabase.auth.signOut())");await waitFor("!!document.querySelector('.login-form')");assert.equal(await evaluate("document.querySelector('.login-options input').checked"),true);await click('.login-options input[type=checkbox]');await tap('.demo-entry');await waitFor("!!document.querySelector('.home-metrics')");assert.equal(await evaluate("localStorage.getItem('angie:remember-email')"),null);check('Explorar demo keeps existing local login and clears email when Remember is off');
  await evaluate("import('/src/lib/supabase.js').then(({supabase})=>supabase.auth.signOut())");await waitFor("!!document.querySelector('.login-form')");
  for(const reduced of ['no-preference','reduce']){await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:reduced}]});await send('Page.reload');await waitFor("!!document.querySelector('.login-form')");const animations=await evaluate("document.getAnimations().map(a=>({name:a.animationName,duration:a.effect.getTiming().duration,iterations:a.effect.getTiming().iterations}))");if(reduced==='reduce')assert.equal(animations.length,0);else{assert.ok(animations.length>=7);assert.ok(animations.every(a=>a.iterations===1))}await delay(2400);assert.equal(await evaluate("document.getAnimations().filter(a=>a.playState==='running').length"),0);check(reduced+' entrance sequence respects motion preference and stops after playing')}
  assert.equal(await evaluate("[...document.querySelectorAll('.login-form input')].every(e=>!!document.querySelector('label[for=\"'+e.id+'\"]')||e.type==='checkbox')"),true);check('Inputs keep explicit accessible labels and native types');
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
