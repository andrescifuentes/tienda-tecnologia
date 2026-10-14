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
const artifacts = join(root, 'artifacts', process.env.UI_ARTIFACTS || 'audit-fixes')
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
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 180000)
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
  await send('Page.navigate',{url:base+'/login'});await waitFor("!!document.querySelector('.login-form')");await evaluate("import('/src/lib/demo/seed.js').then(({createDemoSeed,DEMO_KEY})=>{const legacy=createDemoSeed();legacy.tables.clientes[0].direccion='FIX-LEGACY-KEEP';localStorage.setItem(DEMO_KEY,JSON.stringify(legacy))})");await evaluate("document.querySelector('.login-form .btn').click()");await waitFor("!!document.querySelector('.stat-card')")
  const check=name=>results.push({name,status:'PASS'})
  const button=async text=>{await evaluate('(()=>{const scope=[...document.querySelectorAll(".sheet")].at(-1)||document;const b=[...scope.querySelectorAll("button")].find(b=>b.textContent.trim()==='+JSON.stringify(text)+');if(!b)throw Error("Missing button");b.click()})()');await delay(100)}
  const inputExpression=label=>'document.getElementById([...document.querySelectorAll("label")].find(l=>l.textContent.trim()==='+JSON.stringify(label)+').htmlFor)'
  const field=async(label,value)=>{await evaluate('(()=>{const i='+inputExpression(label)+';Object.getOwnPropertyDescriptor(i.tagName==="SELECT"?HTMLSelectElement.prototype:i.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,"value").set.call(i,'+JSON.stringify(String(value))+');i.dispatchEvent(new Event(i.tagName==="SELECT"?"change":"input",{bubbles:true}))})()');await delay(50)}
  const focus=async label=>{await evaluate(inputExpression(label)+'.focus()');await delay(80)}
  const value=label=>evaluate(inputExpression(label)+'.value')
  const blur=()=>evaluate('document.activeElement.blur()')
  const go=async path=>{await send('Page.navigate',{url:base+path});await waitFor("!!document.querySelector('.nav') && document.readyState==='complete'");await delay(150)}
  const close=()=>evaluate("[...document.querySelectorAll('.sheet')].at(-1).querySelector('.sheet-x').click()")
  const peerTarget=await (await fetch(`http://${debugUrl.host}/json/new?about:blank`,{method:'PUT'})).json(),peer=new WebSocket(peerTarget.webSocketDebuggerUrl)
  await new Promise((resolve,reject)=>{peer.addEventListener('open',resolve,{once:true});peer.addEventListener('error',reject,{once:true})})
  let peerSeq=0;const peerPending=new Map()
  const peerSend=(method,params={})=>new Promise((resolve,reject)=>{const id=++peerSeq,timer=setTimeout(()=>reject(Error('Peer CDP timeout '+method)),180000);peerPending.set(id,{resolve,reject,timer});peer.send(JSON.stringify({id,method,params}))})
  peer.addEventListener('message',async({data})=>{const event=JSON.parse(data);if(event.id){const p=peerPending.get(event.id);if(p){clearTimeout(p.timer);peerPending.delete(event.id);event.error?p.reject(Error(JSON.stringify(event.error))):p.resolve(event.result)}}else if(event.method==='Fetch.requestPaused'){const{requestId,request}=event.params;const url=new URL(request.url);if(url.origin!==new URL(base).origin&&url.protocol!=='data:'){externalRequests.push(request.url);await peerSend('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'})}else await peerSend('Fetch.continueRequest',{requestId})}})
  const peerEval=async expression=>{const r=await peerSend('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value}
  const state=()=>evaluate("JSON.parse(localStorage.getItem('angie-tech:demo:v1'))")
  // Both CDP targets use the actual shared localStorage and IndexedDB, without
  // mocking locks or reducing the overlapping workloads.
  assert.equal((await state()).tables.clientes[0].direccion,'FIX-LEGACY-KEEP');check('AT-AUD-03: legacy localStorage data survives first transactional import');
  const evidence={concurrency:[],sync:[]}
  try {
    await peerSend('Page.enable');await peerSend('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});await peerSend('Page.navigate',{url:base+'/finanzas'})
    for(let i=0;i<100&&!(await peerEval("!!document.querySelector('.finance-period')"));i++)await delay(100)
    for(const count of [20,50]) {
      const write=side=>`import('/src/lib/supabase.js').then(async({supabase})=>{let success=0;for(let i=0;i<${count};i++){const r=await supabase.from('movimientos').insert({tipo:'ingreso',categoria:'Servicio',descripcion:'FIX-${count}-${side}-'+i,monto:1,fecha:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota'}).format(new Date())});if(r.error)throw Error(r.error.message);success++}return success})`
      console.log('START concurrency '+count+'+'+count);const watch=setInterval(()=>evaluate("JSON.parse(localStorage.getItem('angie-tech:demo:v1')).tables.movimientos.length").then(n=>console.log('Persisted rows: '+n)).catch(()=>{}),5000);let successes;try{successes=await Promise.all([evaluate(write('A')),peerEval(write('B'))])}finally{clearInterval(watch)}console.log('FINISH concurrency '+count+'+'+count)
      const snapshot=await state(),rows=snapshot.tables.movimientos.filter(m=>m.descripcion?.startsWith(`FIX-${count}-`))
      assert.equal(successes.reduce((a,b)=>a+b,0),count*2);assert.equal(rows.length,count*2)
      assert.equal(new Set(rows.map(r=>r.id)).size,count*2);assert.equal(new Set(rows.map(r=>r.descripcion)).size,count*2)
      for(const records of Object.values(snapshot.tables))assert.equal(new Set(records.map(r=>r.id)).size,records.length)
      evidence.concurrency.push({perTab:count,confirmed:count*2,persisted:rows.length,uniqueIds:count*2})
      check(`AT-AUD-03: ${count}+${count} simultaneous writes persist exactly once with unique IDs`)
    }
    await go('/');await waitFor("!!document.querySelector('.home-metrics')")
    const income=()=>evaluate("Number(document.querySelector('[aria-label=\"Ingresos del mes\"] .stat-value').textContent.replace(/\\D/g,''))")
    const before=await income()
    const peerRpc=async(name,args)=>peerEval(`import('/src/lib/supabase.js').then(async({supabase})=>{const r=await supabase.rpc(${JSON.stringify(name)},${JSON.stringify(args)});if(r.error)throw Error(r.error.message);return r.data})`)
    const peerMovement=async(tipo,description,monto)=>peerEval(`import('/src/lib/supabase.js').then(async({supabase})=>{const r=await supabase.from('movimientos').insert({tipo:${JSON.stringify(tipo)},categoria:'Servicio',descripcion:${JSON.stringify(description)},monto:${monto},fecha:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota'}).format(new Date())});if(r.error)throw Error(r.error.message)})`)
    await peerMovement('ingreso','FIX-SYNC-INCOME',12345)
    await waitFor(`Number(document.querySelector('[aria-label="Ingresos del mes"] .stat-value').textContent.replace(/\\D/g,''))===${before+12345}`)
    assert.equal(await income(),before+12345);check('AT-AUD-01: other-tab income updates Dashboard by exactly 12.345 without reload')
    let snapshot=await state();const product=snapshot.tables.productos.find(p=>!p.maneja_serial&&p.stock>=3&&p.garantia_meses)
    const stock=product.stock,invoiceCount=snapshot.tables.facturas.length
    const sale={p_items:[{producto_id:product.id,cantidad:1}],p_metodo_pago:'efectivo',p_cliente_id:1,p_vendedor_id:'demo-ana',p_request_id:'FIX-SALE-IDEMPOTENT'}
    const mainRpc=(name,args)=>evaluate(`import('/src/lib/supabase.js').then(async({supabase})=>{const r=await supabase.rpc(${JSON.stringify(name)},${JSON.stringify(args)});if(r.error)throw Error(r.error.message);return r.data})`)
    const ids=await Promise.all([mainRpc('emitir_factura',sale),peerRpc('emitir_factura',sale)])
    assert.equal(ids[0],ids[1]);snapshot=await state();assert.equal(snapshot.tables.facturas.length,invoiceCount+1)
    const invoice=snapshot.tables.facturas.find(f=>f.id===ids[0]);assert.equal(invoice.comision,Math.round(invoice.total*.03))
    assert.equal(snapshot.tables.productos.find(p=>p.id===product.id).stock,stock-1)
    assert.equal(snapshot.tables.movimientos.filter(m=>m.factura_id===invoice.id&&m.origen==='venta').length,1)
    assert.equal(snapshot.tables.garantias.filter(g=>snapshot.tables.factura_items.some(i=>i.factura_id===invoice.id&&i.id===g.factura_item_id)).length,1)
    assert.equal(snapshot.tables.actividad.filter(a=>a.entidad==='factura'&&a.entidad_id===String(invoice.id)).length,1)
    await waitFor(`Number(document.querySelector('[aria-label="Ingresos del mes"] .stat-value').textContent.replace(/\\D/g,''))===${before+12345+invoice.total}`)
    check('AT-AUD-03/01: simultaneous duplicate sale creates one invoice, stock movement, ledger, commission, warranty and history; Dashboard refreshes')
    const purchase={p_proveedor_id:1,p_items:[{producto_id:product.id,cantidad:2,costo_unitario:product.precio_compra}],p_forma_pago:'contado',p_metodo_pago:'efectivo',p_request_id:'FIX-PURCHASE-IDEMPOTENT'}
    const purchases=await Promise.all([mainRpc('registrar_compra',purchase),peerRpc('registrar_compra',purchase)])
    assert.equal(purchases[0],purchases[1]);snapshot=await state();assert.equal(snapshot.tables.productos.find(p=>p.id===product.id).stock,stock+1)
    assert.equal(snapshot.tables.movimientos.filter(m=>m.compra_id===purchases[0]).length,1)
    await button('Ver todo ›');await waitFor("document.querySelector('.sheet')?.textContent.includes('Ingreso de mercancía')");await close()
    check('AT-AUD-03/01: simultaneous duplicate purchase commits once and open activity updates')
    await peerMovement('gasto','FIX-SYNC-EXPENSE',54321);await button('Ver detalle ›')
    const expected=(await peerEval("import('/src/lib/supabase.js').then(async({supabase})=>(await supabase.rpc('resumen_dashboard')).data[0].gastos_mes)"))
    await waitFor(`document.querySelector('.sheet')?.textContent.includes(${JSON.stringify(Number(expected).toLocaleString('es-CO'))})`);await close()
    await go('/inventario');await waitFor("!!document.querySelector('.product-card')")
    await peerRpc('ajustar_stock_fisico_demo',{id:product.id,stock:0,motivo:'FIX-SYNC-STOCK'})
    await waitFor(`[...document.querySelectorAll('.product-card')].some(r=>r.textContent.includes(${JSON.stringify(product.nombre)})&&r.textContent.includes('Stock: 0'))`)
    check('AT-AUD-01: inventory refreshes stock after other-tab adjustment without reload')
    await go('/finanzas');await waitFor("!!document.querySelector('.finance-movement')")
    await peerMovement('ingreso','FIX-SYNC-FINANCE',22);await waitFor("document.body.innerText.includes('FIX-SYNC-FINANCE')")
    check('AT-AUD-01: open Finance refreshes other-tab movement without reload')
    await go('/');await waitFor("!!document.querySelector('.home-metrics')")
    await tap('[aria-label="Ver notificaciones locales"]');await waitFor("!!document.querySelector('.sheet')")
    const other=(await state()).tables.productos.find(p=>p.stock>p.stock_min&&!p.maneja_serial&&p.id!==product.id)
    await peerRpc('ajustar_stock_fisico_demo',{id:other.id,stock:0,motivo:'FIX-SYNC-NOTIFICATIONS'})
    await waitFor(`document.querySelector('.sheet')?.textContent.includes(${JSON.stringify(other.nombre)})`);await close()
    check('AT-AUD-01: open notifications refresh after other-tab stock adjustment')
    await peerRpc('actualizar_perfil_demo',{nombre:'FIX-SYNC-PROFILE',telefono:'3001234567'})
    await waitFor("document.querySelector('.activity-list')?.textContent.includes('Perfil actualizado')")
    check('AT-AUD-01/04: genuine new action becomes visible in recent activity without reload')
    const beforeFailure=(await state()).tables.movimientos.length
    const quota=await peerEval(`import('/src/lib/supabase.js').then(async({supabase})=>{const original=Storage.prototype.setItem;let thrown=false;Storage.prototype.setItem=function(key,value){if(key==='angie-tech:demo:v1'&&!thrown){thrown=true;throw new DOMException('Quota exceeded','QuotaExceededError')}return original.call(this,key,value)};try{const result=await supabase.from('movimientos').insert({tipo:'ingreso',categoria:'Servicio',monto:1,fecha:'2026-10-08',descripcion:'FIX-QUOTA'});return {rejected:!!result.error,count:(await supabase.from('movimientos').select('*')).data.length}}finally{Storage.prototype.setItem=original}})`)
    assert.equal(quota.rejected,true);assert.equal(quota.count,beforeFailure);assert.equal((await state()).tables.movimientos.length,beforeFailure)
    check('AT-AUD-03: failed compatibility-store write aborts authoritative transaction without partial data')
    // Same scarce product, different request IDs: one sale must fail rather than
    // oversell. Existing invoice/ledger/history counts must stay coherent.
    await peerRpc('ajustar_stock_fisico_demo',{id:product.id,stock:1,motivo:'FIX-SCARCE-STOCK'})
    const scarceResults=await Promise.all([evaluate(`import('/src/lib/supabase.js').then(({supabase})=>supabase.rpc('emitir_factura',${JSON.stringify({...sale,p_request_id:'FIX-SCARCE-A'})}))`),peerEval(`import('/src/lib/supabase.js').then(({supabase})=>supabase.rpc('emitir_factura',${JSON.stringify({...sale,p_request_id:'FIX-SCARCE-B'})}))`)])
    assert.equal(scarceResults.filter(r=>!r.error).length,1);assert.equal(scarceResults.filter(r=>r.error).length,1)
    assert.equal((await state()).tables.productos.find(p=>p.id===product.id).stock,0)
    check('AT-AUD-03: different concurrent sales cannot oversell the final stock unit')
    await go('/inventario');await button('+ Nuevo');await field('Nombre','FIX-MONEY-UI');await field('Código único (SKU)','FIX-MONEY-UI');await field('Categoría','1');await field('Precio compra','18000')
    for(const unsafe of ['9007199254740992','9007199254740993']){
      await field('Precio venta',unsafe);assert.equal((await value('Precio venta')).replaceAll('.',''),unsafe)
      await button('Guardar');assert.ok(await evaluate("document.querySelector('.product-form [role=alert]')?.textContent.includes('El valor ingresado es demasiado grande.')"))
      assert.ok(!(await state()).tables.productos.some(p=>p.codigo==='FIX-MONEY-UI'))
    }
    await field('Precio venta','9007199254740991');await button('Guardar');await waitFor("!document.querySelector('.product-form')")
    assert.equal((await state()).tables.productos.find(p=>p.codigo==='FIX-MONEY-UI').precio_venta,9007199254740991)
    check('AT-AUD-02: product COP input rejects both unsafe values and saves exact maximum through the actual form')
    await go('/finanzas');await button('+ Registrar');await field('Categoría','Transporte')
    for(const unsafe of ['9007199254740992','9007199254740993']){
      await field('Monto',unsafe);await button('Registrar gasto');assert.ok(await evaluate("document.querySelector('.movement-form [role=alert]')?.textContent.includes('El valor ingresado es demasiado grande.')"))
    }
    await close();check('AT-AUD-02: movement COP input rejects unsafe values through the actual form')
    await send('Page.reload');await waitFor("!!document.querySelector('.finance-period')")
    const reloaded=await state();for(const count of [20,50])assert.equal(reloaded.tables.movimientos.filter(m=>m.descripcion?.startsWith(`FIX-${count}-`)).length,count*2)
    check('AT-AUD-03: all concurrent writes survive a real reload')
    evidence.sync.push({incomeBefore:before,incomeAfter:before+12345,sale:invoice.id,purchase:purchases[0],inventoryStock:0})
    await writeFile(join(artifacts,'evidence.json'),JSON.stringify(evidence,null,2))
  } finally {peer.close();await send('Target.closeTarget',{targetId:peerTarget.id}).catch(()=>{})}
  assert.equal(browserErrors.length,0);assert.equal(externalRequests.length,0)
  await writeFile(join(artifacts,'results.json'),JSON.stringify({status:'PASS',cases:results.length,results,externalRequests,browserErrors},null,2))
  console.log(JSON.stringify({status:'PASS',cases:results.length,artifacts,origin:base}))

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
