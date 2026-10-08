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
const artifacts = join(root, 'artifacts', process.env.UI_ARTIFACTS || 'product-modal-keyboard')
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

  await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1})
  const scrollTouch=async(x,y,distance)=>{await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let step=1;step<=8;step++){await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+distance*step/8}]});await delay(25)}await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})}
  const snapshot=()=>evaluate('(()=>{const overlay=document.querySelector(".keyboard-aware-overlay"),sheet=document.querySelector(".product-form"),body=sheet.querySelector(".sheet-body"),foot=sheet.querySelector(".sheet-foot"),frame=sheet.parentElement;const r=e=>{const b=e.getBoundingClientRect();return {top:b.top,bottom:b.bottom,left:b.left,right:b.right,height:b.height}};return {overlay:r(overlay),frame:r(frame),sheet:r(sheet),body:r(body),foot:r(foot),input:r(document.activeElement),save:r(sheet.querySelector(".product-save")),colors:[sheet,body,foot].map(e=>getComputedStyle(e).backgroundColor),backdrop:getComputedStyle(overlay).backgroundColor,z:Number(getComputedStyle(overlay).zIndex),navZ:Number(getComputedStyle(document.querySelector(".nav")).zIndex),footInside:foot.closest(".sheet")===sheet,backgroundTop:document.querySelector(".view").scrollTop,pageTop:scrollY,inert:document.getElementById("root").inert,backgroundOverflow:getComputedStyle(document.querySelector(".view")).overflowY,bodyPosition:getComputedStyle(document.body).position,bodyScroll:body.scrollTop,footerHit:sheet.contains(document.elementFromPoint(r(foot).left+8,r(foot).top+2)),lowerBackdrop:document.elementFromPoint(1,innerHeight-1)===overlay,extension:{color:getComputedStyle(frame,"::after").backgroundColor,top:getComputedStyle(frame,"::after").top,height:getComputedStyle(frame,"::after").height,content:getComputedStyle(frame,"::after").content},sheetPaddingBottom:getComputedStyle(sheet).paddingBottom,overlayOverflow:getComputedStyle(overlay).overflow}})()')
  for(const theme of ['dark','light'])for(const[width,height]of [[320,700],[360,800],[390,844],[430,932]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await evaluate('import("/src/lib/theme.js").then(m=>m.setTheme('+JSON.stringify(theme)+'))');await go('/inventario');await waitFor("document.querySelectorAll('.product-card').length===18");
    const background=await evaluate('(()=>{const v=document.querySelector(".view");v.scrollTop=180;return {scroll:v.scrollTop,overflow:v.style.overflow,position:document.body.style.position,bodyTop:document.body.style.top}})()');
    await button('+ Nuevo');await waitFor("!!document.querySelector('.product-form')");await focus('Precio compra');await send('Input.insertText',{text:'1000000'});assert.equal(await value('Precio compra'),'1.000.000');
    const available=Math.floor(height*.51),offset=24;
    await evaluate('Object.defineProperty(visualViewport,"height",{configurable:true,value:'+available+'});Object.defineProperty(visualViewport,"offsetTop",{configurable:true,value:'+offset+'});visualViewport.dispatchEvent(new Event("resize"))');await delay(180);
    const s=await snapshot();assert.equal(s.overlay.top,0);assert.equal(s.overlay.bottom,height);assert.equal(s.overlay.left,0);assert.equal(s.overlay.right,width);assert.ok(s.backdrop.includes('0.72'));assert.ok(s.z>s.navZ);assert.equal(s.lowerBackdrop,true);check(width+' '+theme+' backdrop covers header, inventory and bottom nav beyond reduced visual viewport');
    assert.equal(s.frame.top,offset);assert.equal(s.frame.height,available);assert.equal(s.sheet.bottom,available+offset);assert.ok(s.sheet.top>=offset);assert.ok(s.input.top>=s.body.top);assert.ok(s.input.bottom<=s.body.bottom);assert.ok(s.save.bottom<=s.sheet.bottom);assert.ok(s.save.top>=s.body.bottom);check(width+' '+theme+' active purchase price visible, header and footer fit available keyboard viewport');
    assert.equal(s.sheet.height,available);assert.equal(s.sheet.top,offset);assert.equal(s.foot.bottom,s.sheet.bottom);assert.equal(s.sheetPaddingBottom,'0px');assert.equal(s.extension.color,s.colors[0]);assert.equal(parseFloat(s.extension.top),available);assert.ok(parseFloat(s.extension.height)>=height-offset-available);assert.equal(s.extension.content,'""');assert.equal(s.overlayOverflow,'hidden');check(width+' '+theme+' sheet fills the available height and solid surface continues below Save without exposing inventory');
    assert.equal(s.footInside,true);assert.equal(s.footerHit,true);assert.deepEqual(s.colors,[s.colors[0],s.colors[0],s.colors[0]]);assert.ok(!s.colors[0].includes('rgba')&&!s.colors[0].includes('transparent'));assert.ok(Math.abs(s.body.bottom-s.foot.top)<=1);check(width+' '+theme+' sheet, body and attached footer form one opaque surface without gaps');
    assert.equal(s.inert,true);assert.equal(s.bodyPosition,'fixed');assert.equal(s.backgroundOverflow,'hidden');assert.equal(s.backgroundTop,background.scroll);assert.equal(s.pageTop,0);
    const headTop=await evaluate('document.querySelector(".product-form>h3").getBoundingClientRect().top');
    await scrollTouch(Math.round(s.body.left+3),Math.round((s.body.top+s.body.bottom)/2),-80);await delay(150);
    const after=await snapshot();assert.ok(after.bodyScroll>s.bodyScroll,'Gesture must scroll the form body: '+JSON.stringify({before:s.bodyScroll,after:after.bodyScroll,body:s.body,input:s.input}));assert.equal(after.backgroundTop,background.scroll);assert.equal(after.pageTop,0);assert.equal(after.foot.top,s.foot.top);assert.equal(await evaluate('document.querySelector(".product-form>h3").getBoundingClientRect().top'),headTop);check(width+' '+theme+' touch scroll moves only form body, keeping background, header and footer stable');
    // At a scroll boundary, overscroll must not reach the inventory.
    await evaluate('document.querySelector(".product-form .sheet-body").scrollTop=0');await scrollTouch(Math.round(s.body.left+3),Math.round((s.body.top+s.body.bottom)/2),80);await delay(100);assert.equal((await snapshot()).backgroundTop,background.scroll);
    await blur();await focus('Precio compra');await delay(150);const focused=await snapshot();assert.ok(focused.input.top>=focused.body.top && focused.input.bottom<=focused.body.bottom);assert.equal(await value('Precio compra'),'1.000.000');await screenshot(width+'-keyboard-'+theme);const visible=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,clip:{x:0,y:0,width,height:available+offset,scale:1}});await writeFile(join(artifacts,width+'-keyboard-visible-'+theme+'.png'),Buffer.from(visible.data,'base64'));
    if(width===390 && theme==='dark'){
      await evaluate('window.__testInnerHeightDescriptor=Object.getOwnPropertyDescriptor(window,"innerHeight");Object.defineProperty(window,"innerHeight",{configurable:true,value:'+available+'});visualViewport.dispatchEvent(new Event("resize"))');await delay(100);const resized=await snapshot();assert.equal(await evaluate('!!document.querySelector(".keyboard-open")'),false);assert.equal(resized.extension.color,resized.colors[0]);assert.equal(parseFloat(resized.extension.top),available);assert.equal(resized.overlay.bottom,height);await evaluate('Object.defineProperty(window,"innerHeight",window.__testInnerHeightDescriptor);delete window.__testInnerHeightDescriptor;visualViewport.dispatchEvent(new Event("resize"))');await delay(100);check('390 Safari simultaneous innerHeight/visualViewport resize keeps lower surface opaque even without keyboard class');
    }
    await evaluate('delete visualViewport.height;delete visualViewport.offsetTop;visualViewport.dispatchEvent(new Event("resize"))');await delay(150);assert.equal(await evaluate('!!document.querySelector(".keyboard-open")'),false);await geometry(width+'-restored-'+theme,width,height);assert.ok(await evaluate('document.querySelector(".product-save").getBoundingClientRect().bottom<=innerHeight'));await screenshot(width+'-restored-'+theme);
    // Opening and closing a nested scanner must not unlock the parent background.
    await button('Escanear');await waitFor('document.querySelectorAll(".sheet").length===2');await close();await waitFor('document.querySelectorAll(".sheet").length===1');assert.equal(await evaluate('document.getElementById("root").inert'),true);assert.equal(await evaluate('getComputedStyle(document.querySelector(".view")).overflowY'),'hidden');await close();await waitFor('!document.querySelector(".sheet")');assert.equal(await evaluate('document.getElementById("root").inert'),false);assert.equal(await evaluate('document.querySelector(".view").scrollTop'),background.scroll);assert.equal(await evaluate('document.querySelector(".view").style.overflow'),background.overflow);assert.equal(await evaluate('document.body.style.position'),background.position);assert.equal(await evaluate('document.body.style.top'),background.bodyTop);check(width+' '+theme+' keyboard dismissal and nested modal closure restore size and original background scroll');
  }
  await go('/inventario');await button('+ Nuevo');await send('Emulation.setEmulatedMedia',{media:'print'});assert.equal(await evaluate('getComputedStyle(document.body).position'),'static');assert.equal(await evaluate('getComputedStyle(document.querySelector(".overlay")).position'),'static');await send('Emulation.setEmulatedMedia',{media:'screen',features:[{name:'prefers-reduced-motion',value:'reduce'}]});await close();check('Print styles release fixed body positioning while a modal is open');
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
