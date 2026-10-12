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
const artifacts = join(root, 'artifacts', process.env.UI_ARTIFACTS || 'seller-home')
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
        // ModuleBanner deliberately ellipsizes its title; keep bounds checks and strict seller amount checks.
        const bannerEllipsis = el.matches('.mb-title') && getComputedStyle(el).textOverflow === 'ellipsis';
        if (r.width && (r.left < -1 || r.right > innerWidth + 1 || (!bannerEllipsis && el.scrollWidth > el.clientWidth + 2))) failures.push({element:el.className || el.tagName,left:r.left,right:r.right,scroll:el.scrollWidth,client:el.clientWidth});
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



  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]})
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
  const check = name => { results.push({name,status:'PASS'}); console.log('PASS '+name) }
  const go = async path => { await send('Page.navigate',{url:base+path}); await waitFor("!!document.querySelector('.nav') && document.readyState==='complete'"); await delay(150) }
  const input = async (selector,value) => {
    await evaluate('(()=>{const i=document.querySelector('+JSON.stringify(selector)+');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(i,'+JSON.stringify(value)+');i.dispatchEvent(new Event("input",{bubbles:true}))})()')
  }
  const login = async email => {
    await send('Page.navigate',{url:base+'/login'}); await waitFor("!!document.getElementById('login-email')")
    await input('#login-email',email); await input('#login-password','AngieDemo123!'); await tap('.login-form .btn')
    await waitFor("!!document.querySelector('.nav') && location.pathname==='/'")
  }
  const logout = async () => { await evaluate("import('/src/lib/supabase.js').then(m=>m.supabase.auth.signOut())"); await waitFor("location.pathname==='/login'") }
  const home = async () => { await go('/'); await waitFor("!!document.querySelector('.seller-total')"); }
  const period = async key => { await evaluate('(()=>{const s=document.querySelector(".seller-period select");Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(s,'+JSON.stringify(key)+');s.dispatchEvent(new Event("change",{bubbles:true}))})()'); await waitFor("!!document.querySelector('.seller-total')"); }
  await login('admin@angietech.demo'); await waitFor("!!document.querySelector('.ah-sales')")
  await evaluate('document.fonts.ready.then(()=>true)'); await delay(100) // Measure the final font, not the fallback during loading.
  assert.equal(await evaluate("!!document.querySelector('.seller-home')"),false)
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.nav button')].map(b=>b.textContent.trim())"),['Inicio','Inventario','Facturas','Vender','Más'])
  await geometry('admin-unchanged',390,844); await screenshot('admin-unchanged'); check('Admin home and navigation retained')
  await evaluate("import('/src/lib/supabase.js').then(async m=>{for(const permiso of ['ver_finanzas','ver_costos','editar_inventario','registrar_compras']){const r=await m.supabase.from('perfil_permisos').insert({perfil_id:'demo-ana',permiso});if(r.error)throw Error(r.error.message)}})")
  await logout(); await login('ana@angietech.demo'); await waitFor("!!document.querySelector('.seller-total')")
  assert.equal(await evaluate("document.querySelector('.seller-heading h1').textContent"),'Vendedor')
  assert.equal(await evaluate("document.querySelector('.seller-heading p').textContent"),'Ana López')
  assert.equal(await evaluate("!!document.querySelector('.ah-sales,.ah-duo,.ah-stock,.home-hero-photo')"),false)
  check('Seller UI login succeeds; extra permissions do not expose admin home')
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.nav button')].map(b=>b.textContent.trim())"),['Inicio','Inventario','Vender','Facturas','Clientes'])
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.seller-quick button')].map(b=>b.textContent.trim())"),['Nueva venta','Productos','Facturas'])
  check('Exactly three shortcuts and five seller destinations')
  for (const key of ['hoy','semana','mes']) {
    await period(key)
    const expected = await evaluate('Promise.all([import("/src/lib/supabase.js"),import("/src/lib/sellerHome.js"),import("/src/lib/format.js")]).then(async ([m,s,f])=>{const r=s.periodoVendedor('+JSON.stringify(key)+');const d=await m.supabase.rpc("ventas_por_empleado",{p_desde:r.desde,p_hasta:r.hasta});const own=d.data.find(x=>x.vendedor_id==="demo-ana");return{total:f.money(own?.total_vendido||0),count:Number(own?.facturas)||0}})')
    assert.equal(await evaluate("document.querySelector('.seller-total').textContent"),expected.total)
    assert.equal(await evaluate("Number(document.querySelector('.seller-count b').textContent)"),expected.count)
    check('Own net sales and count: '+key)
  }
  const ownIds = await evaluate("import('/src/lib/supabase.js').then(async m=>(await m.supabase.from('facturas').select('id').eq('vendedor_id','demo-ana').order('fecha',{ascending:false}).limit(3)).data.map(f=>f.id))")
  assert.equal(await evaluate("document.querySelectorAll('.seller-invoice').length"),ownIds.length)
  assert.ok(await evaluate("[...document.querySelectorAll('.seller-invoice')].every(e=>e.querySelector('.seller-invoice-main b').textContent && e.querySelector('.seller-invoice-main>span').textContent && e.querySelector('small').textContent && e.querySelector('strong').textContent && e.querySelector('.seller-status').textContent)"))
  await tap('.seller-invoice'); await waitFor("!!document.querySelector('.fd-num')")
  const first = await evaluate("import('/src/lib/supabase.js').then(async m=>(await m.supabase.from('facturas').select('*').eq('id',"+ownIds[0]+").single()).data)")
  assert.equal(await evaluate("document.querySelector('.fd-num').textContent"),first.prefijo+'-'+String(first.numero).padStart(4,'0'))
  assert.ok(await evaluate("!!document.querySelector('.fd-act.pdf') && !!document.querySelector('.fd-act.wa') && !!document.querySelector('.fd-act.mail')"))
  await tap('.sheet-x'); await waitFor("!document.querySelector('.sheet')"); check('Latest own invoice opens existing detail with PDF/WhatsApp/email')
  await tap('.seller-section-heading button'); await waitFor("location.pathname==='/facturas' && !!document.querySelector('.fv-card')")
  const expectedNumbers = await evaluate("Promise.all([import('/src/lib/supabase.js'),import('/src/lib/format.js')]).then(async ([m,f])=>(await m.supabase.from('facturas').select('*').eq('vendedor_id','demo-ana')).data.map(f.numFactura))")
  assert.ok((await evaluate("[...document.querySelectorAll('.fv-num')].map(e=>e.textContent)")).every(n=>expectedNumbers.includes(n)))
  check('Ver todas opens own Facturas')
  await tap('.fv-history-btn'); await waitFor("location.pathname==='/facturas/historial' && !!document.querySelector('.fv-card')")
  assert.ok((await evaluate("[...document.querySelectorAll('.fv-num')].map(e=>e.textContent)")).every(n=>expectedNumbers.includes(n)))
  check('History remains scoped to the seller')
  for (const [label,path] of [['Nueva venta','/vender'],['Productos','/inventario'],['Facturas','/facturas']]) {
    await home(); await evaluate('(()=>{const b=[...document.querySelectorAll(".seller-quick button")].find(b=>b.textContent.trim()==='+JSON.stringify(label)+');b.click()})()'); await waitFor('location.pathname==='+JSON.stringify(path)); check('Quick access '+label)
  }
  await go('/inventario'); await waitFor("!!document.querySelector('.inv-card')")
  assert.equal(await evaluate("document.body.innerText.includes('Precio de compra') || !!document.querySelector('.inv-add')"),false)
  const product = await evaluate("import('/src/lib/supabase.js').then(async m=>(await m.supabase.from('productos_venta').select('*')).data.find(p=>p.maneja_serial && p.stock>0))")
  await go('/inventario?producto='+product.id); await waitFor("!!document.querySelector('.inv-detail')")
  assert.equal(await evaluate("/Precio de compra|Utilidad|Margen|Editar|Ingreso de mercancía/.test(document.querySelector('.inv-detail').innerText)"),false)
  assert.ok(await evaluate("document.querySelector('.inv-detail').innerText.includes('Stock')")); check('Inventory hides costs/admin actions even with extra permissions; product and serial detail retained')
  await home(); await send('Page.reload'); await waitFor("!!document.querySelector('.seller-total')"); assert.equal(await evaluate("document.querySelector('.seller-heading p').textContent"),'Ana López'); check('Seller session and own view survive reload')
  for (const theme of ['dark','light']) for (const [width,height] of [[320,700],[360,800],[390,844],[430,932],[844,390]]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true})
    await evaluate('import("/src/lib/theme.js").then(m=>m.setTheme('+JSON.stringify(theme)+'))'); await home(); await evaluate('document.fonts.ready.then(()=>true)')
    await geometry(theme+'-'+width+'-seller',width,height)
    const layout = await evaluate("(()=>{const q=[...document.querySelectorAll('.seller-quick button')].map(e=>e.getBoundingClientRect());const nodes=[...document.querySelectorAll('.seller-sales,.seller-total,.seller-invoice,.seller-invoice-side,.seller-invoice-main,.seller-section-heading,.seller-heading,.seller-quick')];return{heights:q.map(r=>r.height),overflow:nodes.filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.className),viewOverflow:getComputedStyle(document.querySelector('.view')).overflowY,targets:[...document.querySelectorAll('.seller-quick button,.seller-period,.seller-section-heading button,.seller-controls button')].map(e=>e.getBoundingClientRect().height)}})()")
    assert.deepEqual(layout.overflow,[]); assert.ok(layout.heights.every(h=>h>=44&&h===layout.heights[0])); assert.ok(layout.targets.every(h=>h>=44)); assert.equal(layout.viewOverflow,'auto')
    await screenshot(theme+'-'+width+'-seller'); check('Responsive/touch/one scroll '+theme+' '+width+'x'+height)
    for(const amount of ['$123.456.789','$999.999.999.999']) {
      await evaluate('(()=>{const e=document.querySelector(".seller-total");e.textContent='+JSON.stringify(amount)+';e.classList.toggle("compact",e.textContent.length>14);document.querySelectorAll(".seller-invoice-side strong").forEach(e=>e.textContent='+JSON.stringify(amount)+')})()')
      assert.ok(await evaluate("[...document.querySelectorAll('.seller-total,.seller-invoice,.seller-invoice-side strong')].every(e=>e.scrollWidth<=e.clientWidth+1)")); check('Large COP amount fits '+theme+' '+width+' '+amount)
    }
  }
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true}); await home(); await tap('[aria-label="Mi perfil"]'); await waitFor("!!document.querySelector('.profile-sheet')"); check('Personal profile and sign-out remain accessible')
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:430,deviceScaleFactor:1,mobile:true}); await delay(250)
  assert.ok(await evaluate("(()=>{const r=document.querySelector('.profile-sheet').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1})()")); check('Existing modal remains within reduced visible viewport')
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true}); await tap('.sheet-x'); await logout(); await login('carlos@angietech.demo'); await waitFor("!!document.querySelector('.seller-total')")
  assert.equal(await evaluate("document.querySelector('.seller-heading p').textContent"),'Carlos Ruiz')
  const carlos = await evaluate("Promise.all([import('/src/lib/supabase.js'),import('/src/lib/format.js')]).then(async ([m,f])=>(await m.supabase.from('facturas').select('*').eq('vendedor_id','demo-carlos')).data.map(f.numFactura))")
  const numbers = await evaluate("[...document.querySelectorAll('.seller-invoice-main b')].map(e=>e.textContent)")
  assert.ok(numbers.every(n=>carlos.includes(n))); assert.ok(numbers.every(n=>!expectedNumbers.includes(n))); check('Switching seller never displays previous seller invoices')
  await go('/facturas?factura='+ownIds[0]); await waitFor("!!document.querySelector('.sheet [role=alert]')")
  assert.equal(await evaluate("!!document.querySelector('.fd-num')"),false); check('Another seller invoice ID is denied by the data query')
  assert.deepEqual(externalRequests,[]); assert.deepEqual(browserErrors,[])
  await writeFile(join(artifacts,'results.json'),JSON.stringify({status:'PASS',cases:results.length,results},null,2))
  console.log(JSON.stringify({status:'PASS',cases:results.length,artifacts})); await send('Browser.close').catch(()=>{})
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
