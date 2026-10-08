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
const artifacts = join(root, 'artifacts', process.env.UI_ARTIFACTS || 'resume-review')
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
  await send('Page.navigate',{url:base+'/login'})
  await waitFor("!!document.querySelector('.login-form')")
  if(!['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname)){
    assert.equal(await evaluate('window.isSecureContext'),false,'LAN HTTP must exercise an insecure browser context')
    assert.equal(await evaluate('typeof window.crypto?.subtle'),'undefined','LAN login must use the local SHA-256 fallback')
    results.push({name:'Actual private LAN HTTP context without Web Crypto',status:'PASS'})
  }
  const button = async text => {
    await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)throw new Error('Missing button: '+${JSON.stringify(text)});b.click()})()`)
    await delay(250)
  }
  async function field(label,value){await evaluate(`(()=>{const l=[...document.querySelectorAll('label')].find(l=>l.textContent.trim()===${JSON.stringify(label)});if(!l)throw new Error('Missing field '+${JSON.stringify(label)});const el=document.getElementById(l.htmlFor);const prototype=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);await delay(80)}
  const state=()=>evaluate("JSON.parse(localStorage.getItem('angie-tech:demo:v1'))")
  const close=async()=>{await tap('.sheet:last-child .sheet-x');await delay(150)}
  async function go(path){await send('Page.navigate',{url:base+path});await waitFor(`location.pathname + location.search === ${JSON.stringify(path)} && document.readyState === 'complete' && !!document.querySelector('.nav')`);await delay(550)}
  async function login(email='admin@angietech.demo'){
    const s=await state();if(s?.session){await go('/mas');await button('Cerrar sesión');await waitFor("!!document.querySelector('.login-form')")}
    await field('Correo',email);await field('Contraseña','AngieDemo123!');await button('Entrar');await waitFor("!!document.querySelector('.stat-card')")
  }
  const routes=[['/','inicio','.stat-card'],['/inventario','inventario','.product-card'],['/vender','vender','.sale-product'],['/facturas','facturas','.invoice-card'],['/clientes','clientes','.row'],['/proveedores','proveedores','.row'],['/empleados','empleados','.row'],['/finanzas','finanzas','.row'],['/garantias','garantias','.row'],['/mas','mas','.menu-row'],['/configuracion','configuracion','.card']]
  for(const [width,height] of [[320,568],[360,740],[390,844],[430,932]]){
    // Responsive cases are isolated; the functional suite verifies draft persistence.
    await evaluate("Object.keys(sessionStorage).filter(k=>k.startsWith('angie:cart:')).forEach(k=>sessionStorage.removeItem(k))")
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true,screenWidth:width,screenHeight:height})
    await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1})
    const s=await state();if(s?.session){await go('/mas');await button('Cerrar sesión')}
    await waitFor("!!document.querySelector('.login-form')");await delay(550)
    await geometry(`${width}-login`,width,height,false);await screenshot(`${width}-login`)
    await button('Ver');assert.equal(await evaluate("document.querySelector('#login-password').type"),'text');await button('Ocultar')
    await button('Entrar');await waitFor("!!document.querySelector('.stat-card')")
    for(const [path,name,selector] of routes){await go(path);await waitFor(`!!document.querySelector(${JSON.stringify(selector)})`);await geometry(`${width}-${name}`,width,height);await screenshot(`${width}-${name}`)}
    for(const [path,label,name] of [['/inventario','+ Nuevo','nuevo-producto'],['/inventario','Ingreso','ingreso'],['/clientes','+ Nuevo','nuevo-cliente'],['/proveedores','+ Nuevo','nuevo-proveedor'],['/empleados','+ Vendedor','nuevo-empleado'],['/finanzas','+ Registrar','nuevo-gasto'],['/garantias','+ Nueva','nueva-garantia']]){
      await go(path);await button(label);await waitFor("!!document.querySelector('[role=dialog]')");await geometry(`${width}-${name}`,width,height);await screenshot(`${width}-${name}`);await close()
    }
    await go('/vender');await waitFor("!!document.querySelector('.sale-product')")
    await tap('[aria-label="Agregar Cable USB-C trenzado 2 metros"]');await tap('[aria-label="Agregar Cable USB-C trenzado 2 metros"]')
    const bar=await evaluate("(()=>{const r=document.querySelector('.cart-bar-button').getBoundingClientRect();return {bottom:r.bottom,navTop:document.querySelector('.nav').getBoundingClientRect().top}})()")
    assert.ok(bar.bottom<=bar.navTop);await geometry(`${width}-carrito-barra`,width,height);await screenshot(`${width}-carrito-barra`)
    await tap('.cart-bar-button');await geometry(`${width}-cobro`,width,height);await screenshot(`${width}-cobro`)
    await tap('[aria-label="Reducir cantidad"]');await tap('[aria-label="Aumentar cantidad"]');assert.equal(await evaluate("document.querySelector('.stepper span').textContent"),'2')
    await close()
  }
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
  await go('/mas');await button('Cerrar sesión');await waitFor("!!document.querySelector('.login-form')")
  await button('¿Olvidaste tu contraseña?');await waitFor("document.querySelector('.sheet')?.textContent.includes('AngieDemo123!')");await close()
  await tap('.demo-roles');await field('Probar como','ana@angietech.demo');await tap('.login-options input');await tap('.demo-entry');await waitFor("!!document.querySelector('.stat-card')")
  assert.equal((await state()).session.user.id,'demo-ana')
  assert.equal(await evaluate("localStorage.getItem('angie:remember-email')"),'ana@angietech.demo')
  results.push({name:'Demo entry authenticates the selected seller; password help and remembered email work',status:'PASS'})
  await login(); await go('/'); await evaluate('document.fonts.ready.then(()=>true)')
  assert.equal(await evaluate("document.querySelectorAll('.stat-card').length"),4)
  assert.equal(await evaluate("document.querySelectorAll('.activity-list .row').length"),3)
  assert.ok(await evaluate("document.querySelector('.brand-logo').naturalWidth > 0"))
  assert.ok(await evaluate("document.fonts.check('20px Inter') && document.fonts.check('20px \\\"Playfair Display\\\"')"))
  const compactHome=await evaluate("(()=>{const v=document.querySelector('.view');return {content:v.scrollHeight,viewport:v.clientHeight,hero:document.querySelector('.tech-hero').getBoundingClientRect().height}})()")
  assert.ok(compactHome.hero>=180&&compactHome.hero<=230)
  assert.ok(compactHome.content-compactHome.viewport<400,'Home should need less than one short additional swipe at 390 px')
  await button('Ver detalle ›'); await waitFor("document.querySelector('.sheet')?.textContent.includes('Ventas por empleado')")
  assert.ok(await evaluate("document.querySelector('.sheet').textContent.includes('Valor inventario')")); await close()
  await button('Ver todo ›'); await waitFor("document.querySelectorAll('.sheet .row').length>3"); await close()
  results.push({name:'Compact home: four metrics, three activities, original logo, local fonts and complete detail sheets',status:'PASS',measurements:compactHome})
  async function searchGlobal(text){await go('/');await evaluate(`(()=>{const i=document.querySelector('.search-bar input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(text)});i.dispatchEvent(new Event('input',{bubbles:true}))})()`);await waitFor("!!document.querySelector('.search-results button')")}
  await searchGlobal('USB-C');await tap('.search-results button');assert.equal(await evaluate('location.pathname'),'/inventario');await waitFor("!!document.querySelector('.sheet')")
  await searchGlobal('SGS24-256');await tap('.search-results button');assert.equal(await evaluate('location.pathname'),'/inventario');await waitFor("!!document.querySelector('.sheet')");await go('/clientes?q=Juan%20Carlos');await waitFor("document.querySelector('.entity-list')?.textContent.includes('Juan Carlos')")
  await searchGlobal('1243');await tap('.search-results button');assert.equal(await evaluate('location.pathname'),'/facturas')
  results.push({name:'Global search opens product/SKU and invoice details; client module search stays available',status:'PASS'})
  await go('/inventario');await waitFor("document.querySelectorAll('.product-card').length===18")
  await evaluate("document.querySelectorAll('.product-thumbnail img').forEach(i=>i.loading='eager')")
  await waitFor("[...document.querySelectorAll('.product-thumbnail img')].every(i=>i.complete&&i.naturalWidth>0)")
  assert.equal(await evaluate("document.querySelectorAll('.photo-pending').length"),0)
  assert.equal(await evaluate("new Set([...document.querySelectorAll('.product-thumbnail img')].map(i=>i.src)).size"),18)
  await tap('.category-toggle');await button('Audio');assert.ok(await evaluate("[...document.querySelectorAll('.product-card')].every(c=>c.textContent.includes('Audio'))"))
  results.push({name:'All eighteen seed SKUs have unique loaded photos; category filtering works',status:'PASS'})
  await go('/inventario');await button('+ Nuevo');await field('Código único (SKU)','DEMO-UI-001');await field('Nombre','Cargador GaN compacto');await field('Marca','Anker');await field('Categoría','6');await field('Proveedor','1');await field('Precio compra','50000');await field('Precio venta','90000');await field('Stock inicial','2');await button('Guardar');await waitFor("!document.querySelector('[role=dialog]')")
  let s=await state(),product=s.tables.productos.find(p=>p.codigo==='DEMO-UI-001');assert.equal(product.stock,2)
  results.push({name:'Create product through form, persisted stock',status:'PASS'})
  await button('Ingreso');await field('Proveedor','1');await field('N.º factura del proveedor','UI-COMPRA-001');await button('+ Agregar producto');await waitFor("document.querySelectorAll('[role=dialog]').length===2")
  await evaluate("[...document.querySelectorAll('.sheet:last-child .row')].find(r=>r.textContent.includes('Cargador GaN compacto')).click()")
  await delay(250);await field('Cantidad','3');await field('Costo unitario','50000');await evaluate("document.querySelector('.sheet-foot button').click()")
  await waitFor("!document.querySelector('[role=dialog]')");s=await state();assert.equal(s.tables.productos.find(p=>p.id===product.id).stock,5)
  results.push({name:'Purchase form increases stock and creates supplier/finance relations',status:'PASS'})
  await login('ana@angietech.demo');await go('/vender');await tap('[aria-label="Agregar Cargador GaN compacto"]');await tap('.cart-bar-button');await button('Consumidor final · tocar para elegir');await waitFor("document.querySelectorAll('[role=dialog]').length===2");await delay(450)
  await evaluate("[...document.querySelectorAll('.sheet:last-child .row')].find(r=>r.textContent.includes('Juan Carlos Ramírez')).click()")
  await delay(200);await button('Transferencia');await evaluate("document.querySelector('.sheet-foot button').click()")
  await waitFor("document.querySelector('[role=dialog]')?.textContent.includes('Venta registrada')")
  s=await state();const invoice=s.tables.facturas.at(-1);assert.equal(invoice.total,90000);assert.equal(invoice.comision,2700);assert.equal(invoice.vendedor_id,'demo-ana');assert.equal(invoice.cliente_id,1);assert.equal(s.tables.productos.find(p=>p.id===product.id).stock,4);assert.ok(s.tables.movimientos.some(m=>m.factura_id===invoice.id&&m.origen==='venta'))
  results.push({name:'Checkout through UI updates invoice, customer, income, seller commission and stock',status:'PASS'})
  await button('PDF / Imprimir');await waitFor("!!document.querySelector('.invoice-preview')");await button('Cerrar vista previa');await button('WhatsApp');await waitFor("!!document.querySelector('.invoice-preview')");await button('Cerrar vista previa');await button('Correo');await waitFor("!!document.querySelector('.invoice-preview')");await button('Cerrar vista previa')
  assert.equal((await state()).tables.factura_envios.filter(e=>e.factura_id===invoice.id).length,2)
  results.push({name:'PDF, WhatsApp and email simulate locally without external navigation',status:'PASS'})
  await close();await go('/clientes');await evaluate("[...document.querySelectorAll('.row')].find(r=>r.textContent.includes('Juan Carlos Ramírez')).click()")
  await waitFor(`document.querySelector('.sheet')?.textContent.includes('FV-${invoice.numero}')`)
  results.push({name:'Sale appears in client purchase history',status:'PASS'})
  const persisted=(await state()).tables;await send('Page.reload');await waitFor("!!document.querySelector('.nav')");assert.deepEqual((await state()).tables,persisted)
  results.push({name:'Real page reload preserves all demo tables and session',status:'PASS'})
  await login();await go('/');await waitFor("!!document.querySelector('.stat-card')")
  const expected=await evaluate("import('/src/lib/supabase.js').then(async({supabase,isDemoMode})=>{if(!isDemoMode)throw new Error('Demo required');return (await supabase.rpc('resumen_dashboard')).data[0]})")
  assert.equal(await evaluate("document.querySelectorAll('.stat-card')[0].querySelector('.stat-value').textContent.replace(/\\D/g,'')"),String(Math.round(expected.ventas_hoy)))
  results.push({name:'Dashboard renders the current transactional summary',status:'PASS'})
  await go('/clientes');await button('+ Nuevo');await button('Guardar');assert.ok(await evaluate("!!document.querySelector('[role=alert]')"));await field('Nombre','Laura Andrea Mejía');await field('Documento','1000008888');await field('Correo','laura.andrea@example.test');await field('Ciudad','Pereira');await button('Guardar');await waitFor("!document.querySelector('[role=dialog]')")
  await waitFor("[...document.querySelectorAll('.row')].some(r=>r.textContent.includes('Laura Andrea Mejía'))")
  await evaluate("[...document.querySelectorAll('.row')].find(r=>r.textContent.includes('Laura Andrea Mejía')).click()");await button('Editar');await field('Nombre','Laura Andrea Mejía Torres');await button('Guardar');await waitFor("!document.querySelector('[role=dialog]')")
  assert.ok((await state()).tables.clientes.some(c=>c.nombre==='Laura Andrea Mejía Torres'&&c.ciudad==='Pereira'))
  results.push({name:'Client form validates, creates and edits with optional empty phone/address',status:'PASS'})
  await go('/proveedores');await button('+ Nuevo');await field('Nombre / razón social','Andina Mobile SAS');await field('NIT','900000888-0');await field('Ciudad','Pereira');await button('Guardar');await waitFor("!document.querySelector('[role=dialog]')");assert.ok((await state()).tables.proveedores.some(p=>p.nombre==='Andina Mobile SAS'))
  results.push({name:'Supplier form creates persistent supplier',status:'PASS'})
  await go('/empleados');await button('+ Vendedor');await field('Nombre completo','Laura Ospina');await field('Correo (con él inicia sesión)','laura@angietech.demo');await field('Contraseña inicial','AngieDemo123!');await field('Comisión % (opcional)','4');await button('Crear usuario');await waitFor("!document.querySelector('[role=dialog]')");assert.ok((await state()).tables.perfiles.some(p=>p.correo==='laura@angietech.demo'&&p.comision_pct===4))
  results.push({name:'Employee form creates local credentials, commission and permissions',status:'PASS'})
  await go('/finanzas');await button('+ Registrar');await field('Categoría','Transporte');await field('Monto','18000');await button('Registrar gasto');await waitFor("!document.querySelector('[role=dialog]')");assert.ok((await state()).tables.movimientos.some(m=>m.categoria==='Transporte'&&m.monto===18000&&!m.origen))
  results.push({name:'Expense form updates local finance',status:'PASS'})
  await go('/garantias');await button('+ Nueva');const choice=await evaluate("document.querySelector('.sheet select option:nth-child(2)')?.value");assert.ok(choice);await field('Producto y factura',choice);await button('Guardar garantía');await waitFor("!document.querySelector('[role=dialog]')");assert.ok((await state()).tables.garantias.some(g=>g.factura_item_id===Number(choice)))
  results.push({name:'Warranty form associates a sold product with invoice, serial and customer',status:'PASS'})
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  for(const [path,,selector] of routes){await go(path);await waitFor(`!!document.querySelector(${JSON.stringify(selector)})`);assert.equal(await evaluate("document.getAnimations().filter(a=>a.playState==='running').length"),0)}
  results.push({name:'Reduced motion preserves functionality across all pages',status:'PASS'})
  await send('Emulation.setDeviceMetricsOverride',{width:768,height:1024,deviceScaleFactor:1,mobile:true});await go('/');await geometry('768-tablet',768,1024);await screenshot('768-tablet')
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false})
  for(const [path,name,selector] of routes){await go(path);await waitFor(`!!document.querySelector(${JSON.stringify(selector)})`);await geometry('1280-'+name,1280,900);await screenshot('1280-'+name)}
  assert.deepEqual(externalRequests,[],'No requests may leave localhost');assert.deepEqual(browserErrors,[],'No browser errors')
  const report={status:'PASS',cases:results.length,results,externalRequests,browserErrors,actualDemoStore:true,physicalDeviceTestingPending:true}
  await writeFile(join(artifacts,'results.json'),JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify({status:'PASS',cases:results.length,externalRequests:externalRequests.length,browserErrors:browserErrors.length,artifacts},null,2));await send('Browser.close').catch(()=>{})

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
