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
const artifacts = join(root, 'artifacts', process.env.UI_ARTIFACTS || 'employee-creation')
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
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable')
  await send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]})
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
  const check=name=>results.push({name,status:'PASS'})
  const button=async text=>{
    const clicked=await evaluate("(()=>{const el=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==="+JSON.stringify(text)+");if(!el)return false;el.click();return true})()")
    assert.equal(clicked,true,'Button '+text)
    await delay(80)
  }
  const field=async(label,value)=>evaluate("(()=>{const l=[...document.querySelectorAll('.sheet label')].find(l=>l.textContent==="+JSON.stringify(label)+");if(!l)throw Error('Missing field');const e=document.getElementById(l.htmlFor);Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,"+JSON.stringify(String(value))+");e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()")
  const state=()=>evaluate("import('/src/lib/supabase.js').then(({supabase})=>supabase.demo.snapshot())")
  const open=async()=>{await button('+ Vendedor');await waitFor("!!document.querySelector('.employee-create-sheet')")}
  const fill=async(email='new-seller@angietech.demo',name='Vendedora prueba bug',document='EMP-BUG-001')=>{
    await field('Nombre completo',name);await field('Correo (con \u00e9l inicia sesi\u00f3n)',email)
    await field('Contrase\u00f1a inicial','SellerPass123!');await field('Documento empleado',document)
    await field('Comisi\u00f3n % (opcional)','3')
  }
  const settleError=async()=>waitFor("!!document.querySelector('.employee-create-sheet [role=alert]')&&!document.querySelector('.employee-create-sheet .sheet-foot button').disabled")
  const restore=()=>evaluate("import('/src/lib/supabase.js').then(({supabase})=>{supabase.functions.invoke=window.__originalInvoke})")
  const go=async path=>{await send('Page.navigate',{url:base+path});await waitFor("!!document.querySelector('.nav')&&document.readyState==='complete'")}
  const employeeRow=async name=>evaluate("[...document.querySelectorAll('.employee-card')].find(b=>b.textContent.includes("+JSON.stringify(name)+")).click()")
  await send('Page.navigate',{url:base+'/login'});await waitFor("!!document.querySelector('.demo-entry')")
  await evaluate("document.querySelector('.demo-entry').click()");await waitFor("!!document.querySelector('.nav')")
  check('Admin demo login uses existing AuthContext')
  await go('/empleados');await waitFor("document.querySelectorAll('.employee-card').length===5")
  const initial=(await state()).tables.perfiles.length
  await open();await button('Crear usuario')
  assert.ok(await evaluate("!!document.querySelector('.sheet input[aria-invalid=true]')"))
  check('Missing required identity prevents submission')
  await fill()
  await evaluate("import('/src/lib/supabase.js').then(({supabase})=>{window.__originalInvoke=supabase.functions.invoke;window.__invokeCalls=0;supabase.functions.invoke=async(...a)=>{window.__invokeCalls++;await new Promise(r=>setTimeout(r,700));return window.__originalInvoke(...a)}})")
  await evaluate("const b=document.querySelector('.sheet-foot button');b.click();b.click()")
  await waitFor("document.querySelector('.sheet-foot button').disabled")
  assert.equal(await evaluate("document.querySelector('.sheet-foot button').textContent"),'Creando\u2026')
  await evaluate("document.querySelector('.sheet-x').click();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))")
  assert.ok(await evaluate("!!document.querySelector('.employee-create-sheet')"))
  check('One loading message, disabled button, double submit locked and close guarded while pending')
  await waitFor("!document.querySelector('.sheet')&&[...document.querySelectorAll('.employee-card')].some(e=>e.textContent.includes('Vendedora prueba bug'))")
  assert.equal(await evaluate("window.__invokeCalls"),1)
  assert.equal((await state()).tables.perfiles.length,initial+1)
  const seller=(await state()).tables.perfiles.find(p=>p.correo==='new-seller@angietech.demo')
  assert.equal(seller.rol,'vendedor');assert.equal(seller.activo,true)
  assert.deepEqual((await state()).tables.perfil_permisos.filter(p=>p.perfil_id===seller.id).map(p=>p.permiso).sort(),['crear_clientes','vender','ver_inventario'])
  await restore()
  check('Verified success closes modal and lists exactly one seller immediately with expected permissions')
  await open()
  assert.equal(await evaluate("document.querySelector('.sheet input[type=email]').value"),'')
  assert.equal(await evaluate("document.querySelector('.sheet input[type=password]').value"),'')
  check('Reopened creation form is empty')
  await fill('new-seller@angietech.demo','Duplicate email','EMP-BUG-002')
  await button('Crear usuario');await settleError()
  assert.ok(await evaluate("document.querySelector('.sheet [role=alert]').textContent.includes('correo ya')"))
  assert.equal((await state()).tables.perfiles.length,initial+1)
  check('Duplicate email returns useful error, releases loading and preserves existing seller')
  await fill('second-seller@angietech.demo','Second seller','EMP-BUG-001')
  await button('Crear usuario');await settleError()
  assert.ok(await evaluate("document.querySelector('.sheet [role=alert]').textContent.includes('documento')"))
  assert.equal((await state()).tables.perfiles.length,initial+1)
  check('Duplicate demo document rejects atomically')
  await fill('retry-seller@angietech.demo','Retry seller','EMP-BUG-003')
  await evaluate("import('/src/lib/supabase.js').then(({supabase})=>{supabase.functions.invoke=async()=>{throw new TypeError('Failed to fetch')}})")
  await button('Crear usuario');await settleError()
  assert.ok(await evaluate("document.querySelector('.sheet [role=alert]').textContent.includes('conexi')"))
  assert.equal(await evaluate("document.querySelector('.sheet input[type=email]').value"),'retry-seller@angietech.demo')
  check('Network rejection ends loading and preserves form for retry')
  await evaluate("import('/src/lib/supabase.js').then(({supabase})=>{supabase.functions.invoke=async()=>({data:null,error:{name:'FunctionsFetchError',message:'Failed to send a request to the Edge Function',context:new TypeError('Failed to fetch')}})})")
  await button('Crear usuario');await settleError()
  assert.ok(await evaluate("document.querySelector('.sheet [role=alert]').textContent.includes('FUNCTION_REQUEST_FAILED')&&document.querySelector('.sheet [role=alert]').textContent.includes('CORS')"))
  check('SDK transport/CORS failure shows its real safe code instead of generic backend rejection')
  await evaluate("import('/src/lib/supabase.js').then(({supabase})=>{supabase.functions.invoke=async()=>({data:null,error:{context:new Response(JSON.stringify({code:'NOT_FOUND',message:'Requested function was not found'}),{status:404})}})})")
  await button('Crear usuario');await settleError()
  assert.ok(await evaluate("document.querySelector('.sheet [role=alert]').textContent.includes('FUNCTION_NOT_FOUND')&&document.querySelector('.sheet [role=alert]').textContent.includes('desplegada')"))
  check('Missing remote function displays deployment diagnosis and releases loading')

  await restore()
  await evaluate("import('/src/lib/supabase.js').then(({supabase})=>{window.__originalFrom=supabase.from;supabase.from=(...args)=>{const q=window.__originalFrom(...args);if(args[0]==='perfiles'){q.order=()=>({then:(resolve,reject)=>Promise.resolve({data:null,error:{code:'42501'}}).then(resolve,reject)})}return q}})")
  await button('Crear usuario');await waitFor("!document.querySelector('.sheet')")
  assert.ok((await state()).tables.perfiles.some(p=>p.correo==='retry-seller@angietech.demo'))
  check('Retry succeeds and refresh has no duplicate')
  await waitFor("!!document.querySelector('.admin-employees [role=alert]')")
  assert.ok(await evaluate("[...document.querySelectorAll('.employee-card')].some(e=>e.textContent.includes('Retry seller'))"))
  assert.equal(await evaluate("!!document.querySelector('.admin-employees .skel-list')"),false)
  check('Failed list refresh keeps verified new seller visible and ends loader')
  await evaluate("import('/src/lib/supabase.js').then(({supabase})=>{supabase.from=window.__originalFrom})")
  await button('Actualizar lista');await waitFor("!document.querySelector('.admin-employees [role=alert]')")
  check('List refresh retry recovers without duplicate seller')
  await open();await fill('timeout-seller@angietech.demo','Timeout seller','EMP-BUG-004')
  await evaluate("import('/src/lib/supabase.js').then(({supabase})=>{supabase.functions.invoke=()=>new Promise(()=>{})})")
  await button('Crear usuario')
  await settleErrorWithLongTimeout()
  async function settleErrorWithLongTimeout(){await waitFor("!!document.querySelector('.employee-create-sheet [role=alert]')&&!document.querySelector('.employee-create-sheet .sheet-foot button').disabled",42000)}
  assert.ok(await evaluate("document.querySelector('.sheet [role=alert]').textContent.includes('tard')"))
  await restore();await evaluate("document.querySelector('.sheet-x').click()")
  check('Full 35-second production deadline releases hung invoke and allows closing without false success')
  await send('Page.reload');await waitFor("[...document.querySelectorAll('.employee-card')].some(e=>e.textContent.includes('Vendedora prueba bug'))")
  assert.equal((await state()).tables.perfiles.filter(p=>p.id===seller.id).length,1)
  check('Created seller persists after reload')
  await employeeRow(seller.nombre);await waitFor("!!document.querySelector('.employee-edit-sheet')")
  await field('Tel\u00e9fono','3009876543');await button('Guardar cambios');await waitFor("!document.querySelector('.sheet')")
  assert.equal((await state()).tables.perfiles.find(p=>p.id===seller.id).telefono,'3009876543')
  check('Seller editing still persists')
  await employeeRow(seller.nombre);await waitFor("!!document.querySelector('.employee-edit-sheet')")
  await button('Desactivar empleado');await button('Confirmar estado');await waitFor("!document.querySelector('.sheet')")
  assert.equal((await state()).tables.perfiles.find(p=>p.id===seller.id).activo,false)
  let denied=await evaluate("import('/src/lib/supabase.js').then(({supabase})=>supabase.auth.signInWithPassword({email:'new-seller@angietech.demo',password:'SellerPass123!'}))")
  assert.ok(denied.error)
  check('Deactivation persists and prevents seller login')
  await employeeRow(seller.nombre);await waitFor("!!document.querySelector('.employee-edit-sheet')")
  await button('Activar empleado');await button('Confirmar estado');await waitFor("!document.querySelector('.sheet')")
  await evaluate("import('/src/lib/supabase.js').then(({supabase})=>supabase.auth.signOut())")
  await waitFor("!!document.querySelector('.login-form')")
  await evaluate("(()=>{for(const[id,value]of[['login-email','new-seller@angietech.demo'],['login-password','SellerPass123!']]){const el=document.getElementById(id);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))}})()")
  await evaluate("document.querySelector('.login-submit').click()");await waitFor("!!document.querySelector('.nav')")
  const active=(await state()).session.user.id;assert.equal(active,seller.id)
  await go('/empleados');await waitFor("location.pathname!=='/empleados'&&!!document.querySelector('.nav')")
  assert.equal(await evaluate("!!document.querySelector('.admin-employees')"),false)
  check('New seller logs in through real login form and cannot access administrator page')
  await go('/inventario');await waitFor("!!document.querySelector('.inv-card')")
  await evaluate("document.querySelector('.inv-card').click()");await waitFor("!!document.querySelector('.inv-detail')")
  assert.equal(await evaluate("document.querySelector('.inv-detail').innerText.includes('Precio de compra')"),false)
  await evaluate("document.querySelector('.inv-detail [aria-label=Volver]').click()")
  await go('/clientes');await waitFor("!!document.querySelector('.cl-card')")
  await go('/vender');await waitFor("!!document.querySelector('.pos-tile')")
  await go('/facturas');await waitFor("!!document.querySelector('.fv-summary')")
  check('Seller inventory hides costs; clients, sales and invoices remain accessible')
  // Restore the seed only in this isolated browser profile, never in the user's session.
  await evaluate("import('/src/lib/supabase.js').then(async({supabase})=>{await supabase.auth.signInWithPassword({email:'admin@angietech.demo',password:'AngieDemo123!'});await supabase.demo.reset()})")
  assert.equal((await state()).tables.perfiles.length,5)
  check('Test users removed by isolated demo reset')
  assert.deepEqual(externalRequests,[]);assert.deepEqual(browserErrors,[])
  await writeFile(join(artifacts,'results.json'),JSON.stringify({status:'PASS',cases:results.length,results,externalRequests,browserErrors},null,2))
  console.log(JSON.stringify({status:'PASS',cases:results.length,artifacts}))
  await send('Browser.close').catch(()=>{})
} catch (error) {
  await writeFile(join(artifacts,'results.json'),JSON.stringify({status:'FAIL',error:error.stack,results,externalRequests,browserErrors},null,2))
  console.error(error.stack);process.exitCode=1
} finally {
  socket?.close();browser.kill()
  if (!profile.startsWith(join(tmpdir(),'angie-tech-ui-'))) throw new Error('Unexpected test profile path')
  await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(error=>{console.error('Test profile cleanup failed',error.message);process.exitCode=1})
}
