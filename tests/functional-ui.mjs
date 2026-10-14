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
const artifacts = join(root, 'artifacts', process.env.UI_ARTIFACTS || 'functional-ui')
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
  await send('Page.enable');await send('Runtime.enable');await send('Log.enable');await send('DOM.enable')
  await send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]})
  await send('Page.addScriptToEvaluateOnNewDocument',{source:'delete window.BarcodeDetector;'})
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
  await send('Page.navigate',{url:base+'/login'});await waitFor("!!document.querySelector('.login-form')")
  const state=()=>evaluate("JSON.parse(localStorage.getItem('angie-tech:demo:v1'))")
  const check=(name)=>results.push({name,status:'PASS'})
  const button=async text=>{await evaluate('(()=>{const scope=[...document.querySelectorAll(".sheet")].at(-1)||document;const b=[...scope.querySelectorAll("button")].find(b=>b.textContent.trim()==='+JSON.stringify(text)+');if(!b)throw Error("Missing button: '+text+'");b.click()})()');await delay(180)}
  const field=async(label,value)=>{await evaluate('(()=>{const l=[...document.querySelectorAll("label")].find(l=>l.textContent.trim()==='+JSON.stringify(label)+');if(!l)throw Error("Missing field '+label+'");const e=document.getElementById(l.htmlFor);const p=e.tagName==="SELECT"?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,"value").set.call(e,'+JSON.stringify(String(value))+');e.dispatchEvent(new Event(e.tagName==="SELECT"?"change":"input",{bubbles:true}))})()');await delay(100)}
  const go=async path=>{await send('Page.navigate',{url:base+path});await waitFor("!!document.querySelector('.nav') && document.readyState==='complete'");await delay(350)}
  const close=async()=>{await evaluate("[...document.querySelectorAll('.sheet')].at(-1).querySelector('.sheet-x').click()");await delay(100)}
  const saved=()=>waitFor("!document.querySelector('[role=dialog]')")
  const row=async text=>{await waitFor('[...document.querySelectorAll(".sheet:last-child .row,.entity-list .row")].some(r=>r.textContent.includes('+JSON.stringify(text)+'))');await evaluate('[...document.querySelectorAll(".sheet:last-child .row,.entity-list .row")].find(r=>r.textContent.includes('+JSON.stringify(text)+')).click()');await waitFor("!!document.querySelector('.sheet')")}
  const double=async selector=>evaluate('(()=>{const b=document.querySelector('+JSON.stringify(selector)+');b.click();b.click()})()')
  const imageFingerprint=key=>evaluate('import("/src/lib/demo/images.js").then(async m=>{const b=await m.loadImage('+JSON.stringify(key)+');if(!b)return null;const a=new Uint8Array(await b.arrayBuffer());return {size:b.size,type:b.type,bytes:[...a].reduce((n,v,i)=>(n+v*(i+1))%1000000007,0)}})')
  const upload=async filename=>{const doc=await send('DOM.getDocument');const input=await send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'input[aria-label="Seleccionar foto del producto"]'});assert.ok(input.nodeId);await send('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[join(root,'src','assets','products',filename)]});await waitFor("!!document.querySelector('.photo-editor-preview>img') && !document.querySelector('.sheet-foot button').disabled")}
  const productVisible=async()=>{await waitFor("!!document.querySelector('.product-card')");await waitFor("document.querySelector('.product-thumbnail img')?.src.startsWith('blob:') && document.querySelector('.product-thumbnail img')?.naturalWidth>0")}
  await button('Entrar');await waitFor("!!document.querySelector('.stat-card')")
  const source=JSON.parse(readFileSync(join(root,'src/assets/products/sources.json'),'utf8'))['SGS24-256'].filename
  const initial=await state()
  assert.equal(initial.tables.productos.length,18)
  check('Fresh isolated profile starts from local seed; no production accounts')

  await go('/proveedores');await button('+ Nuevo');await field('Nombre / razón social','Proveedor UI completo');await field('Contacto','Contacto local');await field('Correo','proveedor@example.test');await field('Notas','Entrega de diez unidades');await double('.sheet-foot button');await saved()
  let t=(await state()).tables, provider=t.proveedores.find(p=>p.nombre==='Proveedor UI completo');assert.ok(provider);assert.equal(t.proveedores.filter(p=>p.nombre===provider.nombre).length,1)
  await row(provider.nombre);await button('Editar');await field('Notas','Proveedor editado');await button('Guardar');await saved()
  assert.equal((await state()).tables.proveedores.find(p=>p.id===provider.id).notas,'Proveedor editado')
  await row(provider.nombre);await button('Desactivar proveedor');await button('Cancelar');assert.equal((await state()).tables.proveedores.find(p=>p.id===provider.id).activo,true)
  await button('Desactivar proveedor');await button('Desactivar');await saved();assert.equal((await state()).tables.proveedores.find(p=>p.id===provider.id).activo,false)
  await row(provider.nombre);await button('Activar proveedor');await button('Activar');await saved()
  check('Supplier create/edit/deactivate/reactivate, cancellation and duplicate-submit prevention')

  await go('/clientes');await button('+ Nuevo');await button('Guardar');assert.ok(await evaluate("!!document.querySelector('[role=alert]')"));await field('Nombre','Cliente UI completo');await field('Teléfono (WhatsApp)','3001234567');await field('Correo','cliente@example.test');await field('Notas','Sin documento obligatorio');await button('Guardar');await saved()
  let customer=(await state()).tables.clientes.find(c=>c.nombre==='Cliente UI completo');assert.ok(customer);assert.equal(customer.documento,null)
  await row(customer.nombre);await button('Editar');await field('Notas','Cliente editado');await button('Guardar');await saved()
  await row(customer.nombre);await button('Desactivar cliente');await button('Desactivar');await saved();await row(customer.nombre);await button('Activar cliente');await button('Activar');await saved()
  check('Customer CRUD with optional document, valid contact, notes and confirmations')

  await go('/empleados');await button('+ Vendedor');await field('Nombre completo','Vendedora UI completa');await field('Documento empleado','1234');await field('Correo (con él inicia sesión)','functional@angietech.demo');await field('Contraseña inicial','AngieDemo123!');await field('Comisión % (opcional)','3');await button('Crear usuario');await saved()
  let employee=(await state()).tables.perfiles.find(p=>p.correo==='functional@angietech.demo');assert.ok(employee)
  await row(employee.nombre);await field('Teléfono','3005555555');await button('Guardar cambios');await saved()
  await row(employee.nombre);await button('Desactivar empleado');await button('Confirmar estado');await saved();assert.equal((await state()).tables.perfiles.find(p=>p.id===employee.id).activo,false)
  await row(employee.nombre);await button('Activar empleado');await button('Confirmar estado');await saved()
  check('Employee credentials, optional document, editing and active-state confirmations')

  await go('/inventario');await button('+ Nuevo');await field('Código único (SKU)','TEST-S26');await field('Nombre','Samsung Galaxy S26');await field('Categoría','1');await field('Marca','Samsung');await field('Precio compra','2500000');await field('Precio venta','3200000');await field('Stock inicial','5');await field('Stock mínimo','2');await field('Descripción / notas','Equipo creado desde el formulario')
  await upload(source);await screenshot('product-photo-preview');await double('.sheet-foot button');await saved()
  let product=(await state()).tables.productos.find(p=>p.codigo==='TEST-S26');assert.equal(product.stock,5);assert.ok(product.image_ref);assert.equal((await state()).tables.productos.filter(p=>p.codigo==='TEST-S26').length,1)
  let fingerprint=await imageFingerprint(product.image_ref);assert.ok(fingerprint.size>0)
  assert.ok(!(await evaluate("localStorage.getItem('angie-tech:demo:v1')")).includes('data:image'))
  await go('/inventario?q=TEST-S26');await productVisible();await screenshot('product-created')
  await send('Page.reload');await waitFor("!!document.querySelector('.nav')");await productVisible();assert.deepEqual(await imageFingerprint(product.image_ref),fingerprint)
  check('Exact TEST-S26 creation, stock 5 and resized binary photo in real IndexedDB; reload retains photo')
  await tap('.product-card');await button('Editar');await field('Stock mínimo','-1');await button('Guardar');assert.ok(await evaluate("!!document.querySelector('input[aria-invalid=true]')"));assert.equal((await state()).tables.productos.find(p=>p.id===product.id).precio_venta,3200000);await field('Stock mínimo','2');await field('Precio venta','3200000');await field('Descripción / notas','Notas editadas sin perder la foto');await button('Guardar');await saved()
  await waitFor("!!document.querySelector('.product-card')");await tap('.product-card');await button('Editar');await button('Eliminar foto');await button('Guardar');await saved();await waitFor("!!document.querySelector('.photo-pending')");assert.equal(await imageFingerprint(product.image_ref),null)
  await tap('.product-card');await button('Editar');await upload(source);await button('Guardar');await saved();product=(await state()).tables.productos.find(p=>p.codigo==='TEST-S26');fingerprint=await imageFingerprint(product.image_ref);await productVisible()
  check('Product edit, field-level negative-stock validation, remove photo, honest placeholder and replacement photo')

  await go('/inventario');await button('+ Nuevo');await field('Código único (SKU)','BUY-10');await field('Nombre','Producto compra diez');await field('Categoría','6');await field('Precio compra','50000');await field('Precio venta','80000');await field('Stock mínimo','2');await button('Guardar');await saved()
  let buyProduct=(await state()).tables.productos.find(p=>p.codigo==='BUY-10');assert.equal(buyProduct.stock,0);assert.equal(buyProduct.image_ref,undefined)
  await button('Ingreso');await field('Proveedor',provider.id);await field('N.º factura del proveedor','UI-10');await field('Notas compra','Compra de diez unidades');await button('+ Agregar producto');await waitFor("document.querySelectorAll('.sheet').length===2");await waitFor("[...document.querySelectorAll('.sheet:last-child .row')].some(r=>r.textContent.includes('Producto compra diez'))");await evaluate("[...document.querySelectorAll('.sheet:last-child .row')].find(r=>r.textContent.includes('Producto compra diez')).click()");await field('Cantidad','10');await field('Costo unitario','50000');await double('.sheet-foot button');await saved()
  t=(await state()).tables;let purchase=t.compras.find(c=>c.numero_documento==='UI-10');assert.equal(t.productos.find(p=>p.id===buyProduct.id).stock,10);assert.equal(purchase.total,500000);assert.equal(purchase.proveedor_id,provider.id);assert.ok(t.movimientos.some(m=>m.compra_id===purchase.id&&m.monto===500000));assert.ok(t.actividad.some(a=>a.entidad==='compra'&&String(a.entidad_id)===String(purchase.id)))
  await go('/proveedores');await row(provider.nombre);assert.ok(await evaluate("document.querySelector('.sheet').textContent.includes('UI-10')"));await close()
  check('Create supplier/product, buy 10, stock 10, line cost, supplier history, financial ledger and activity')
  await go('/proveedores?compra='+purchase.id);await waitFor("document.querySelectorAll('.sheet').length===2 && [...document.querySelectorAll('.sheet')].at(-1).textContent.includes('Producto compra diez')");assert.ok(await evaluate("[...document.querySelectorAll('.sheet')].at(-1).textContent.includes('Compra de diez unidades')"));assert.equal(await evaluate("[...document.querySelectorAll('.sheet')].at(-1).querySelector('h3').textContent"),'Detalle de compra');await close();assert.equal(await evaluate("document.querySelectorAll('.sheet').length"),1);await button('Ver compra');await waitFor("document.querySelectorAll('.sheet').length===2 && [...document.querySelectorAll('.sheet')].at(-1).textContent.includes('Producto compra diez')");await close();await close()
  check('Purchase deep link and supplier detail open real line quantities, costs, payment and notes')

  await go('/vender');await button('Smartphones');assert.ok(await evaluate("[...document.querySelectorAll('.sale-product')].every(p=>p.textContent.includes('Samsung')||p.textContent.includes('iPhone')||p.textContent.includes('Xiaomi'))"));await button('Todos')
  for(let i=0;i<2;i++)await tap('[aria-label="Agregar Samsung Galaxy S26"]')
  for(let i=0;i<2;i++)await tap('[aria-label="Agregar Producto compra diez"]')
  await go('/clientes');await go('/vender');assert.equal(await evaluate("document.querySelector('.cart-count').textContent"),'4');await tap('.cart-bar-button')
  await button('Expandir carrito');assert.ok(await evaluate("document.querySelector('.sheet').classList.contains('sheet-expanded')"));await button('Contraer carrito')
  await tap('[aria-label="Quitar Producto compra diez"]');assert.equal((await evaluate("document.querySelector('.cart-count').textContent")),'4');await button('Cancelar')
  await button('Vaciar carrito');await button('Quitar');assert.equal(await evaluate("document.querySelector('.sheet-foot button').disabled"),true);await close()
  for(let i=0;i<2;i++)await tap('[aria-label="Agregar Samsung Galaxy S26"]')
  for(let i=0;i<2;i++)await tap('[aria-label="Agregar Producto compra diez"]')
  await tap('.cart-bar-button');await tap('[aria-label="Reducir cantidad"]');await tap('[aria-label="Aumentar cantidad"]')
  await button('Consumidor final · tocar para elegir');await button('+ Nuevo cliente');await field('Nombre','Cliente rápido local');await button('Guardar');await waitFor("document.querySelectorAll('.sheet').length===1");assert.ok((await state()).tables.clientes.some(c=>c.nombre==='Cliente rápido local'))
  const pick=await evaluate("[...document.querySelectorAll('.sheet button')].find(b=>b.textContent.includes('Cliente rápido local')).textContent");await button(pick);await waitFor("document.querySelectorAll('.sheet').length===2");await row(customer.nombre)
  // The picker uses plain rows rather than the entity list.
  check('Cart persists navigation, expands, changes quantities, confirms removal/clear and creates a quick customer')

  await field('Vendedor',employee.id);await button('Transferencia');await field('Notas (opcional)','Venta completa con foto')
  const beforeInvoices=(await state()).tables.facturas.length
  await double('.sheet-foot button');await waitFor("document.querySelector('.sheet')?.textContent.includes('Venta registrada')")
  t=(await state()).tables;const invoice=t.facturas.at(-1),item=t.factura_items.find(i=>i.factura_id===invoice.id&&i.producto_id===product.id)
  assert.equal(t.facturas.length,beforeInvoices+1);assert.equal(invoice.total,6560000);assert.equal(invoice.vendedor_id,employee.id);assert.equal(invoice.cliente_id,customer.id);assert.equal(invoice.comision,196800);assert.equal(t.productos.find(p=>p.id===product.id).stock,3);assert.equal(t.productos.find(p=>p.id===buyProduct.id).stock,8);assert.ok(t.movimientos.some(m=>m.factura_id===invoice.id&&m.origen==='venta'));assert.ok(t.actividad.some(a=>a.entidad==='factura'&&String(a.entidad_id)===String(invoice.id)));assert.deepEqual(JSON.parse(await evaluate("sessionStorage.getItem('angie:cart:demo-admin')")).carrito,[])
  check('Double confirmation makes exactly one sale/invoice; stock, assigned employee, commission, ledger, activity and cleared cart reconcile')
  await button('PDF / Imprimir');await waitFor("!!document.querySelector('[data-print-invoice]')");assert.ok(await evaluate("document.querySelector('[data-print-invoice]').textContent.includes('Samsung Galaxy S26')"));await send('Emulation.setEmulatedMedia',{media:'print'});await evaluate('document.fonts.ready.then(()=>true)');await delay(250);assert.equal(await evaluate("getComputedStyle(document.querySelector('#root')).display"),'none');assert.ok(await evaluate("document.querySelector('[data-print-invoice]').getBoundingClientRect().height>200"));assert.equal(await evaluate("getComputedStyle(document.querySelector('.sheet'),'::before').display"),'none');assert.ok(await evaluate("!document.querySelector('.toast') || getComputedStyle(document.querySelector('.toast')).display==='none'"));await screenshot('invoice-print');const pdf=await send('Page.printToPDF',{printBackground:true});const pdfBytes=Buffer.from(pdf.data,'base64');assert.equal(pdfBytes.subarray(0,5).toString(),'%PDF-');assert.ok(pdfBytes.toString('latin1').includes('/Font'),'Printed invoice must contain text fonts, not an empty PDF');assert.ok(pdfBytes.length>10000,'Printed invoice must contain rendered content');await writeFile(join(artifacts,'invoice-local.pdf'),pdfBytes);await send('Emulation.setEmulatedMedia',{media:'screen',features:[{name:'prefers-reduced-motion',value:'reduce'}]});await button('Cerrar vista previa')
  await field('Teléfono para WhatsApp','');await button('WhatsApp');assert.ok(await evaluate("document.querySelector('[role=alert]').textContent.includes('teléfono')"));await field('Teléfono para WhatsApp',customer.telefono);await button('WhatsApp');await waitFor("!!document.querySelector('.invoice-preview')");await evaluate("window.open=(...args)=>{window.__outboundPreview=args;return null}");await button('Abrir WhatsApp');const outgoing=await evaluate('window.__outboundPreview');assert.ok(outgoing[0].startsWith('https://wa.me/573001234567?text='));assert.ok(decodeURIComponent(outgoing[0]).includes(String(invoice.numero)));await button('Cerrar vista previa');await button('Correo');await waitFor("!!document.querySelector('.invoice-preview a')");const mail=await evaluate("document.querySelector('.invoice-preview a').getAttribute('href')");assert.ok(mail.startsWith('mailto:cliente%40example.test?subject='));assert.ok(decodeURIComponent(mail).includes('ANGIE TECH'));await button('Cerrar vista previa')
  check('Real local printable PDF artifact, WhatsApp phone validation and opt-in encoded message, email recipient/subject/body; no sends')
  assert.ok((await state()).tables.factura_envios.filter(e=>e.factura_id===invoice.id).every(e=>e.simulado===true&&e.estado==='previsualizado'))

  await button('Crear garantía');await waitFor("document.querySelectorAll('.sheet').length===2 && document.querySelector('.sheet:last-child select').options.length>1");await field('Producto y factura',item.id)
  const today=await evaluate("import('/src/lib/format.js').then(m=>m.hoyBogota())"),expiry=new Date(today+'T12:00:00Z');expiry.setUTCDate(expiry.getUTCDate()+10)
  await field('Inicio de cobertura',today);await field('Vencimiento de cobertura (opcional)',expiry.toISOString().slice(0,10));await field('Motivo garantia','Cobertura comercial');await field('Descripcion garantia','Producto entregado');await button('Guardar garantía');await waitFor("document.querySelectorAll('.sheet').length===1")
  let warranty=(await state()).tables.garantias.find(g=>g.factura_item_id===item.id);assert.ok(warranty);assert.equal(warranty.cliente_id,customer.id);await close()
  await go('/');await tap('[aria-label="Ver notificaciones locales"]');await waitFor("document.querySelector('.sheet').textContent.includes('Garantía por vencer')");assert.ok(await evaluate("document.querySelector('.sheet').textContent.includes('Samsung Galaxy S26')"));await screenshot('notifications');await close()
  check('Warranty from invoice records customer/product/purchase/date and produces a local expiring-coverage notification')
  await go('/garantias?garantia='+warranty.id);await waitFor("!!document.querySelector('.sheet')");await field('Nota de seguimiento','Seguimiento local');await button('Guardar estado y nota');await saved()
  await go('/garantias?garantia='+warranty.id);await waitFor("!!document.querySelector('.sheet')");await field('Descripción del problema','Revisión de pantalla');await button('Registrar reclamo');await saved()
  await go('/garantias?garantia='+warranty.id);await waitFor("!!document.querySelector('.sheet')");await button('En revisión');await saved()
  await go('/garantias?garantia='+warranty.id);await waitFor("!!document.querySelector('.sheet')");await button('Finalizar');await saved();assert.equal((await state()).tables.garantias.find(g=>g.id===warranty.id).estado,'resuelta');assert.ok((await state()).tables.garantia_eventos.filter(e=>e.garantia_id===warranty.id).length>=5)
  check('Warranty note, claim, review, resolution and history are persisted through actual forms')

  await go('/clientes');await row(customer.nombre);assert.ok(await evaluate("document.querySelector('.sheet').textContent.includes('FV-"+invoice.numero+"')"));assert.ok(await evaluate("document.querySelector('.sheet').textContent.includes('GAR-"+warranty.id+"')"));await close()
  await go('/empleados');await row(employee.nombre);assert.ok(await evaluate("document.querySelector('.sheet').textContent.includes('FV-"+invoice.numero+"')"));await field('Comisión % (vacío = sin comisión)','4');await button('Guardar cambios');await saved();assert.equal((await state()).tables.facturas.find(f=>f.id===invoice.id).comision,196800)
  await go('/');const expected=await evaluate("import('/src/lib/supabase.js').then(async m=>(await m.supabase.rpc('resumen_dashboard')).data[0])");assert.equal(await evaluate("document.querySelector('.stat-value').textContent.replace(/\\D/g,'')"),String(Math.round(expected.ventas_hoy)))
  check('Customer invoice/warranty history, employee sales and historical commission snapshot, live Dashboard summary')

  async function refundInvoice(id,restock){await go('/facturas?factura='+id);await waitFor("!!document.querySelector('.sheet')");await button('Devolución');await evaluate("(()=>{const r=[...document.querySelectorAll('.sheet .row')].find(r=>r.textContent.includes('Samsung Galaxy S26')&&r.querySelector('input[type=number]'));const i=r.querySelector('input[type=number]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'1');i.dispatchEvent(new Event('input',{bubbles:true}))})()");if(!restock)await evaluate("document.querySelector('.sheet input[type=checkbox]').click()");await field('Motivo',restock?'Devolución revendible':'Daño no revendible');await button('Registrar devolución');await waitFor("document.querySelectorAll('.sheet').length===2");await button('Confirmar devolución');await waitFor("document.querySelectorAll('.sheet').length===1 && !document.querySelector('.sheet input[type=number]')")}
  await refundInvoice(invoice.id,true);t=(await state()).tables;assert.equal(t.productos.find(p=>p.id===product.id).stock,4);assert.equal(t.devoluciones.filter(d=>d.factura_id===invoice.id).reduce((n,d)=>n+d.total_devuelto,0),3200000)
  await button('Anular');await field('Motivo de la anulación','Cancelar saldo de la venta');await button('Confirmar anulación');await waitFor("document.querySelector('.sheet').textContent.includes('Motivo de anulación')")
  t=(await state()).tables;assert.equal(t.facturas.find(f=>f.id===invoice.id).estado,'anulada');assert.equal(t.productos.find(p=>p.id===product.id).stock,5);assert.equal(t.productos.find(p=>p.id===buyProduct.id).stock,10);assert.equal(t.movimientos.filter(m=>m.factura_id===invoice.id&&m.tipo==='gasto').reduce((n,m)=>n+m.monto,0),invoice.total);assert.equal(await evaluate("[...document.querySelectorAll('.sheet button')].some(b=>b.textContent.trim()==='Anular')"),false);await close()
  check('Resellable refund and cancellation restore remaining units once, reverse exactly the original income and keep invoice history')
  const fullNumber=invoice.prefijo+'-'+String(invoice.numero).padStart(4,'0')
  await go('/facturas?q='+encodeURIComponent(fullNumber));await waitFor("document.querySelectorAll('.invoice-card').length===1");await button('Anuladas');await waitFor("document.querySelector('.invoice-card').textContent.includes('Anulada')");await button('Emitidas');await waitFor("document.querySelectorAll('.invoice-card').length===0");await go('/');await evaluate('(()=>{const input=document.querySelector(".search-bar input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,'+JSON.stringify(fullNumber)+');input.dispatchEvent(new Event("input",{bubbles:true}))})()');await waitFor("!!document.querySelector('.search-results button')");await tap('.search-results button');await waitFor("location.pathname==='/facturas' && !!document.querySelector('.sheet')");assert.equal(await evaluate("Number(new URLSearchParams(location.search).get('factura'))"),invoice.id);assert.ok((await evaluate("document.querySelector('.sheet').textContent")).includes(fullNumber))
  check('Full prefixed invoice number search, cancelled/emitted filters and global search navigate to matching historical invoice')

  await go('/vender');await tap('[aria-label="Agregar Samsung Galaxy S26"]');await tap('.cart-bar-button');await field('Vendedor',employee.id);await double('.sheet-foot button');await waitFor("document.querySelector('.sheet').textContent.includes('Venta registrada')");const damaged=(await state()).tables.facturas.at(-1);assert.ok(damaged.numero>invoice.numero);assert.equal(damaged.comision,128000);await close()
  await refundInvoice(damaged.id,false);t=(await state()).tables;assert.equal(t.productos.find(p=>p.id===product.id).stock,4);assert.ok(t.movimientos_inventario.some(m=>m.referencia_tipo==='devolucion'&&m.tipo==='devolucion_danada'&&m.cantidad===0));await close()
  check('Next invoice number never reused; new commission rate applies only to future sale; damaged return records without restocking')
  await go('/inventario?q=TEST-S26');await productVisible();await tap('.product-card');await button('Movimientos');assert.ok(await evaluate("document.querySelector('.sheet').textContent.includes('devolucion danada')"));await button('‹ Volver');await button('Ajustar stock');await field('Tipo de movimiento','fisico');await field('Stock fisico','3');await field('Motivo (obligatorio)','Daño / pérdida / corrección');await button('Guardar');await saved();assert.equal((await state()).tables.productos.find(p=>p.id===product.id).stock,3)
  check('Product movement history and physical stock 4→3 adjustment with required reason')

  await go('/inventario?q=TEST-S26');await tap('.product-card');await button('Desactivar producto');await button('Desactivar');await saved();await go('/vender');await evaluate("(()=>{const i=document.querySelector('.search-bar input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'TEST-S26');i.dispatchEvent(new Event('input',{bubbles:true}))})()");await waitFor("document.querySelectorAll('.sale-product').length===0");await go('/inventario?q=TEST-S26');await button('Inactivos');await waitFor("!!document.querySelector('.product-card')");await tap('.product-card');await button('Activar producto');await button('Activar');await saved()
  check('Soft-deactivated product is hidden from new sales, visible in inactive filter and restorable without losing photo/history')
  await go('/');await tap('[aria-label="Ver notificaciones locales"]');await tap('.notification-row');await waitFor("location.pathname!=='/'");assert.equal((await state()).tables.notificaciones_leidas.length,1)
  await go('/');await tap('[aria-label="Mi perfil"]');await field('Nombre del usuario','Valentina funcional');await field('Teléfono','3002222222');await button('Guardar perfil');await saved();assert.equal((await state()).tables.perfiles.find(p=>p.id==='demo-admin').nombre,'Valentina funcional')
  await go('/configuracion');await tap('[data-setting="nombre"]');await field('Nombre del negocio','ANGIE TECH local');await button('Guardar negocio');await waitFor("!document.querySelector('.settings-edit-sheet')");await tap('[data-setting="factura_pie"]');await field('Pie de factura','Gracias por tu compra local');await button('Guardar negocio');await waitFor("document.querySelector('.toast')?.textContent.includes('Datos del negocio guardados')");await waitFor("!document.querySelector('.settings-edit-sheet')");await evaluate("document.querySelector('[aria-label=\"Cambiar tema\"]').click()");const theme=await evaluate('document.documentElement.dataset.theme');await send('Page.reload');await waitFor("!!document.querySelector('.nav')");assert.equal(await evaluate('document.documentElement.dataset.theme'),theme);assert.equal((await state()).tables.tienda[0].nombre,'ANGIE TECH local')
  check('Notification badge/read state and navigation, editable current profile/business and persistent theme')

  for(const[width,height]of [[320,700],[360,800],[390,844],[430,932]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true})
    await go('/inventario');await button('+ Nuevo');await geometry(width+'-photo-form',width,height);await screenshot(width+'-photo-form');await close()
    await go('/');await tap('[aria-label="Ver notificaciones locales"]');await geometry(width+'-notifications',width,height);await screenshot(width+'-notifications');await close()
    await go('/');await tap('[aria-label="Mi perfil"]');await geometry(width+'-profile',width,height);await screenshot(width+'-profile');await close()
    await go('/facturas?factura='+damaged.id);await waitFor("!!document.querySelector('.sheet')");await button('PDF / Imprimir');await geometry(width+'-print-preview',width,height);await screenshot(width+'-print-preview');await close()
    await go('/inventario?q=TEST-S26');await productVisible();await tap('[aria-label="Escanear"]');await waitFor("!!document.querySelector('#scanner-code')");await evaluate("(()=>{const i=document.querySelector('#scanner-code');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'TEST-S26');i.dispatchEvent(new Event('input',{bubbles:true}))})()");await button('Buscar producto');await waitFor("!document.querySelector('.sheet')");await productVisible()
  }
  check('Manual scanner still resolves SKU at all four mobile widths without blocking the workflow')
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await go('/inventario?q=TEST-S26');await productVisible();assert.deepEqual(await imageFingerprint(product.image_ref),fingerprint)
  const persisted=(await state()).tables;await send('Page.reload');await waitFor("!!document.querySelector('.nav')");await productVisible();assert.deepEqual((await state()).tables,persisted);assert.deepEqual(await imageFingerprint(product.image_ref),fingerprint)
  check('Complete product/photo/customer/purchase/sale/warranty/refund/history chain survives browser refresh')

  // A second real tab shares persistent localStorage and IndexedDB, not component memory.
  const newTarget=await send('Target.createTarget',{url:'about:blank'}),targetInfo=(await(await fetch('http://'+debugUrl.host+'/json/list')).json()).find(t=>t.id===newTarget.targetId)
  const tab=new WebSocket(targetInfo.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{tab.addEventListener('open',resolve,{once:true});tab.addEventListener('error',reject,{once:true})})
  let tabSeq=0;const tabPending=new Map()
  tab.addEventListener('message',({data})=>{const message=JSON.parse(data);const promise=tabPending.get(message.id);if(promise){tabPending.delete(message.id);clearTimeout(promise.timer);message.error?promise.reject(Error(JSON.stringify(message.error))):promise.resolve(message.result)}})
  const tabSend=(method,params={})=>new Promise((resolve,reject)=>{const id=++tabSeq,timer=setTimeout(()=>reject(Error('Second tab timed out')),15000);tabPending.set(id,{resolve,reject,timer});tab.send(JSON.stringify({id,method,params}))})
  try{await tabSend('Page.enable');await tabSend('Runtime.enable');await tabSend('Page.navigate',{url:base+'/inventario?q=TEST-S26'});let found=false;for(let i=0;i<80;i++){const r=await tabSend('Runtime.evaluate',{expression:"!!document.querySelector('.product-thumbnail img')?.naturalWidth",returnByValue:true});if(r.result.value){found=true;break}await delay(150)}assert.ok(found,'Reopened tab must load persisted uploaded photo');const data=await tabSend('Runtime.evaluate',{expression:"JSON.parse(localStorage.getItem('angie-tech:demo:v1')).tables.productos.find(p=>p.codigo==='TEST-S26').stock",returnByValue:true});assert.equal(data.result.value,3)}finally{tab.close();await send('Target.closeTarget',{targetId:newTarget.targetId})}
  check('New real browser tab restores product, stock and IndexedDB photo after component memory is gone')

  await go('/configuracion');await button('Restablecer datos demo');await button('Cancelar');assert.ok((await state()).tables.productos.some(p=>p.codigo==='TEST-S26'));await button('Restablecer datos demo');await button('Restablecer y cerrar sesión');await waitFor("!!document.querySelector('.login-form')");await waitFor('localStorage.getItem("angie-tech:demo:v1") && JSON.parse(localStorage.getItem("angie-tech:demo:v1")).tables.productos.length===18');await waitFor('import("/src/lib/demo/images.js").then(async m=>!await m.loadImage('+JSON.stringify(product.image_ref)+'))')
  assert.equal((await state()).tables.clientes.length,10);assert.equal((await state()).tables.facturas.length,16);assert.equal((await state()).session,null);assert.equal(await evaluate('document.documentElement.dataset.theme'),theme);assert.equal(await evaluate("Object.keys(sessionStorage).filter(k=>k.startsWith('angie:cart:')).length"),0)
  await button('Entrar');await waitFor("!!document.querySelector('.stat-card')");await go('/inventario');await waitFor("document.querySelectorAll('.product-card').length===18");assert.equal(await evaluate("document.querySelectorAll('.product-thumbnail img').length"),18)
  check('Reset confirmation/cancel, seed restored, uploaded photo removed, draft cleared, logged out, theme retained and demo photos restored')
  assert.deepEqual(externalRequests,[]);assert.deepEqual(browserErrors,[])
  await writeFile(join(artifacts,'results.json'),JSON.stringify({status:'PASS',cases:results.length,results,externalRequests,browserErrors,origin:base},null,2));console.log(JSON.stringify({status:'PASS',cases:results.length,artifacts,origin:base}));await send('Browser.close').catch(()=>{})

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
