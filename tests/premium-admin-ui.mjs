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
const artifacts = join(root, 'artifacts', process.env.UI_ARTIFACTS || 'premium-admin')
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
  const fieldSearch=async text=>{await evaluate('(()=>{const i=document.querySelector(".search-bar input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(i,'+JSON.stringify(text)+');i.dispatchEvent(new Event("input",{bubbles:true}))})()');await delay(300)}
  const state=()=>evaluate("JSON.parse(localStorage.getItem('angie-tech:demo:v1'))")
  const saved=()=>waitFor("!document.querySelector('.sheet')")
  const pages=[['/mas','hub'],['/configuracion','settings'],['/facturas','invoices'],['/garantias','warranties'],['/proveedores','suppliers'],['/empleados','employees']]
  const keyboard=async name=>{
    await evaluate("Object.defineProperty(visualViewport,'height',{configurable:true,value:450});Object.defineProperty(visualViewport,'offsetTop',{configurable:true,value:25});visualViewport.dispatchEvent(new Event('resize'))")
    await delay(160)
    const v=await evaluate("(()=>{const s=[...document.querySelectorAll('.sheet')].at(-1),r=s.getBoundingClientRect(),f=s.querySelector('.sheet-foot'),fr=f.getBoundingClientRect();return {scroll:window.scrollY,overlay:s.closest('.overlay').getBoundingClientRect().top,frame:s.parentElement.getBoundingClientRect().top,vv:visualViewport.offsetTop,css:s.closest('.overlay').style.cssText,top:r.top,bottom:r.bottom,foot:fr.bottom,solid:getComputedStyle(f).backgroundColor,body:getComputedStyle(s).backgroundColor,covered:!!document.elementFromPoint(innerWidth/2,474)?.closest('.sheet'),inert:document.getElementById('root').inert}})()")
    assert.ok(Math.abs(v.top-25)<=1,name+JSON.stringify(v));assert.ok(Math.abs(v.bottom-475)<=1);assert.ok(Math.abs(v.foot-475)<=1);assert.equal(v.solid,v.body);assert.notEqual(v.solid,'rgba(0, 0, 0, 0)');assert.ok(v.covered);assert.ok(v.inert)
    await screenshot(name+'-keyboard');check(name+': solid sheet and footer fill visualViewport to the keyboard')
    await evaluate("delete visualViewport.height;delete visualViewport.offsetTop;visualViewport.dispatchEvent(new Event('resize'))");await delay(100)
  }
  for(const theme of ['dark','light'])for(const [width,height]of [[320,700],[360,800],[390,844],[430,932]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await evaluate(`import('/src/lib/theme.js').then(m=>m.setTheme(${JSON.stringify(theme)}))`)
    for(const [path,name] of pages){
      await go(path);await waitFor("!document.querySelector('.loading-state')");await evaluate('document.fonts.ready.then(()=>true)');await geometry(`${theme}-${width}-${name}`,width,height);await screenshot(`${theme}-${width}-${name}`)
      if(name==='settings')assert.equal(await evaluate("document.querySelectorAll('.page-content input').length"),0)
      if(name==='invoices'){const h=await evaluate("[...document.querySelectorAll('.invoice-card')].map(c=>c.getBoundingClientRect().height)");assert.ok(h.every(n=>n<105),JSON.stringify(h))}
      if(name==='warranties'){
        assert.ok(await evaluate("[...document.querySelectorAll('.chip')].every(c=>c.scrollWidth<=c.clientWidth+1&&getComputedStyle(c).whiteSpace==='nowrap')"))
        await evaluate("document.querySelector('.chips').scrollLeft=10000");await delay(120);assert.ok(await evaluate("document.querySelector('.chips').scrollLeft>0"));await button('Todas');await waitFor("!!document.querySelector('.warranty-card')");await geometry(`${theme}-${width}-warranty-all`,width,height)
      }
    }
    await button('+ Vendedor');await waitFor("!!document.querySelector('.employee-create-sheet')");await geometry(`${theme}-${width}-new-seller`,width,height);await screenshot(`${theme}-${width}-new-seller`)
    assert.equal(await evaluate("document.querySelectorAll('[role=switch]').length"),10)
    await tap('.admin-permissions summary');assert.ok(await evaluate("[...document.querySelectorAll('.premium-switch')].every(s=>s.getBoundingClientRect().height>=44)"));await tap('.admin-permissions summary')
    if(width===390){await focus('Contraseña inicial');await keyboard(theme+'-new-seller')}
    await close();await tap('.employee-card');await waitFor("!!document.querySelector('.employee-edit-sheet') && !!document.querySelector('[role=switch]')");await geometry(`${theme}-${width}-edit-seller`,width,height);await screenshot(`${theme}-${width}-edit-seller`)
    if(width===390){await focus('Nombre empleado');await keyboard(theme+'-edit-seller')}
    await close();await go('/configuracion');await tap('[data-setting="nombre"]');await geometry(`${theme}-${width}-settings-editor`,width,height);await screenshot(`${theme}-${width}-settings-editor`)
    if(width===390){await focus('Nombre del negocio');await keyboard(theme+'-settings-editor')}
    await close();await go('/proveedores');await button('+ Nuevo');await geometry(`${theme}-${width}-supplier-form`,width,height);await close()
  }
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
  for(const path of ['/empleados','/proveedores','/finanzas','/garantias','/clientes','/facturas','/configuracion']){await go('/mas');await evaluate(`[...document.querySelectorAll('.menu-list button')].find(b=>b.textContent.includes(${JSON.stringify({'/empleados':'Empleados','/proveedores':'Proveedores','/finanzas':'Finanzas','/garantias':'Garantías','/clientes':'Clientes','/facturas':'Facturas','/configuracion':'Configuración'}[path])})).click()`);await waitFor(`location.pathname===${JSON.stringify(path)}`)}
  await go('/mas');await tap('[aria-label="Mi perfil"]');await waitFor("!!document.querySelector('.sheet')");await close();check('Administrative hub preserves every route and opens the existing profile')
  await go('/configuracion');const original=(await state()).tables.tienda[0].nombre;await tap('[data-setting="nombre"]');await field('Nombre del negocio','Discarded');await close();assert.equal((await state()).tables.tienda[0].nombre,original)
  const fields=[['nombre','Nombre del negocio','ANGIE TECH premium'],['nit','NIT del negocio','900000999-1'],['telefono','Teléfono del negocio','3001234567'],['direccion','Dirección del negocio','Bogotá · prueba visual'],['factura_pie','Pie de factura','Gracias por comprar en Angie Tech']]
  for(const [key,label,text] of fields){await tap(`[data-setting="${key}"]`);await field(label,text);await button('Guardar negocio');await saved();assert.equal((await state()).tables.tienda[0][key],text)}
  await button('Claro');await send('Page.reload');await waitFor("!!document.querySelector('.theme-segments')");assert.equal(await evaluate('document.documentElement.dataset.theme'),'light');assert.equal((await state()).tables.tienda[0].nombre,'ANGIE TECH premium');await button('Oscuro');check('Settings sheets save every existing business field, discard safely and persist theme after reload')
  await go('/facturas');await fieldSearch('FV-1245');await waitFor("document.querySelectorAll('.invoice-card').length===1");await tap('.invoice-card');await waitFor("!!document.querySelector('.invoice-detail-sheet')");await close();await fieldSearch('');await button('Anuladas');await waitFor("!!document.querySelector('.invoice-card') && [...document.querySelectorAll('.invoice-card')].every(c=>c.textContent.includes('Anulada'))");assert.ok(await evaluate("[...document.querySelectorAll('.invoice-card')].every(c=>c.textContent.includes('Anulada'))"));await button('Emitidas');await waitFor("!!document.querySelector('.invoice-card') && !document.querySelector('.invoice-card').textContent.includes('Anulada')");assert.ok(await evaluate("[...document.querySelectorAll('.invoice-card')].every(c=>c.textContent.includes('Emitida'))"));check('Invoice full-number search, statuses and detail navigation remain functional')
  await go('/garantias');for(const label of ['Por vencer','En revisión','Resueltas','Rechazadas','Vencidas','Todas']){await button(label);await waitFor("!document.querySelector('.loading-state')");assert.equal(await evaluate(`[...document.querySelectorAll('.chip')].find(c=>c.textContent===${JSON.stringify(label)}).getAttribute('aria-pressed')`),'true')};await tap('.warranty-card');await waitFor("!!document.querySelector('.warranty-detail-sheet')");await close();check('All warranty filters remain reachable and individual cards open detail')
  await go('/proveedores');await button('Ver detalle ›');await waitFor("!!document.querySelector('.sheet')");assert.ok(await evaluate("document.querySelector('.sheet').textContent.includes('$')"));await close();await tap('.supplier-card');await waitFor("!!document.querySelector('.supplier-detail-sheet')");await close();await button('+ Nuevo');await field('Nombre / razón social','Proveedor premium UI');await field('Contacto','Laura prueba');await button('Guardar');await saved();assert.ok((await state()).tables.proveedores.some(p=>p.nombre==='Proveedor premium UI'));check('Supplier balances, detail and create retain real stored data')
  await go('/empleados');await button('+ Vendedor');await field('Nombre completo','Vendedor premium UI');await field('Documento empleado','998877');await field('Teléfono','3005554444');await field('Correo (con él inicia sesión)','premium-ui@angietech.demo');await field('Comisión % (opcional)','3')
  await button('Generar contraseña');const password=await value('Contraseña inicial');assert.ok(password.length>=16);assert.equal(await evaluate(inputExpression('Contraseña inicial')+'.type'),'password');await button('Mostrar contraseña');assert.equal(await evaluate(inputExpression('Contraseña inicial')+'.type'),'text');await button('Ocultar contraseña');assert.equal(await evaluate(inputExpression('Contraseña inicial')+'.type'),'password')
  await tap('.admin-permissions summary');await tap('[role="switch"][aria-label="Ver costos"]');await button('Crear usuario');await saved();let tables=(await state()).tables;let employee=tables.perfiles.find(p=>p.correo==='premium-ui@angietech.demo');assert.ok(employee);assert.equal(employee.comision_pct,3);assert.ok(employee.password_hash);assert.ok(!Object.values(employee).includes(password));assert.ok(!JSON.stringify(await state()).includes(password));assert.ok(tables.perfil_permisos.some(p=>p.perfil_id===employee.id&&p.permiso==='ver_costos'));check('Create seller preserves identity, hashed password, commission and switch permissions; plaintext is not stored')
  await evaluate("[...document.querySelectorAll('.employee-card')].find(c=>c.textContent.includes('Vendedor premium UI')).click()");await waitFor("!!document.querySelector('[role=switch]')");await field('Nombre empleado','Vendedor premium editado');await field('Comisión % (vacío = sin comisión)','4');await tap('.admin-permissions summary');await tap('[role="switch"][aria-label="Ver costos"]');await tap('[role="switch"][aria-label="Registrar compras"]');await button('Guardar cambios');await saved();tables=(await state()).tables;employee=tables.perfiles.find(p=>p.id===employee.id);assert.equal(employee.nombre,'Vendedor premium editado');assert.equal(employee.comision_pct,4);assert.ok(!tables.perfil_permisos.some(p=>p.perfil_id===employee.id&&p.permiso==='ver_costos'));assert.ok(tables.perfil_permisos.some(p=>p.perfil_id===employee.id&&p.permiso==='registrar_compras'))
  for(const [action,active]of [['Desactivar empleado',false],['Activar empleado',true]]){await evaluate("[...document.querySelectorAll('.employee-card')].find(c=>c.textContent.includes('Vendedor premium editado')).click()");await button(action);await button('Confirmar estado');await saved();assert.equal((await state()).tables.perfiles.find(p=>p.id===employee.id).activo,active)}
  await send('Page.reload');await waitFor("!!document.querySelector('.employee-card')");assert.equal((await state()).tables.perfiles.find(p=>p.id===employee.id).comision_pct,4);check('Edit seller, permissions, commission and deactivate/reactivate persist through reload')
  assert.deepEqual(externalRequests,[]);assert.deepEqual(browserErrors,[])
  await writeFile(join(artifacts,'results.json'),JSON.stringify({status:'PASS',cases:results.length,results,externalRequests,browserErrors,physicalIPhone:'Pending'},null,2));console.log(JSON.stringify({status:'PASS',cases:results.length,artifacts}));await send('Browser.close').catch(()=>{})

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
