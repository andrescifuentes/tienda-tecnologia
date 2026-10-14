import assert from 'node:assert/strict'
import { esEntornoDemoPermitido } from '../src/lib/demo/environment.js'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// No npm dependencies, production accounts, real camera, or remote requests.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const artifacts = join(root, 'artifacts', process.env.UI_ARTIFACTS || 'invoice-email')
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
        if (url.pathname === '/src/lib/invoiceEmail.js') {
          const original=await (await fetch(request.url)).text();
          const instrumented=original.replace('navigate = globalThis.window?.location?.assign.bind(globalThis.window.location)', 'navigate = url => { (window.__mailUrls ||= []).push(url); if(window.__mailMode === "throws")throw Error("OS diagnostic not configured"); }');
          assert.notEqual(instrumented,original,'Mail handoff fixture must intercept actual navigation without launching OS apps');
          await send('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/javascript'}],body:Buffer.from(instrumented).toString('base64')});
        } else if (process.env.POST_SALE_REAL_FIXTURE === '1' && url.pathname === '/src/lib/supabase.js') {
          const fixture = "import {createDemoClient} from '/src/lib/demo/client.js'; export const isDemoMode=false; export const supabaseConfigurationError=''; export const supabase=createDemoClient(); supabase.storage={from:()=>({upload:async()=>{window.__uploadCalls=(window.__uploadCalls||0)+1;if(window.__UPLOAD_MODE__==='hang')return new Promise(()=>{});return{error:window.__UPLOAD_MODE__==='success'?null:{message:'Bucket not found'}}},getPublicUrl:()=>({data:{publicUrl:'https://example.test/invoice.pdf'}})})}; export async function conAutorizacionAdmin(){window.__adminAuthCalls=(window.__adminAuthCalls||0)+1;throw Error('No administrator authentication in this local fixture')}";
          await send('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/javascript'}],body:Buffer.from(fixture).toString('base64')});
        } else if (url.origin !== new URL(base).origin && url.protocol !== 'data:') {
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





  await send('Page.enable');await send('Runtime.enable');await send('Log.enable');await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});await send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  const downloads=join(artifacts,'downloads');await mkdir(downloads,{recursive:true});await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
  const check=name=>{results.push({name,status:'PASS'});console.log('PASS '+name)};
  const api=expression=>evaluate("import(performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/lib/supabase.js')?.name||'/src/lib/supabase.js').then(async({supabase})=>{"+expression+"})");
  const field=async(selector,value)=>{await evaluate('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,'+JSON.stringify(value)+');e.dispatchEvent(new Event("input",{bubbles:true}))})()');await delay(60)};
  const clickText=async text=>{await evaluate('(()=>{const b=[...document.querySelectorAll(".sheet button")].find(b=>b.textContent.trim()==='+JSON.stringify(text)+');if(!b)throw Error("Missing button "+'+JSON.stringify(text)+');b.click()})()');await delay(100)};
  const free=async()=>{await waitFor("!document.querySelector('[data-app-dialog]')");assert.equal(await evaluate("document.getElementById('root').inert"),false);assert.equal(await evaluate("document.activeElement.matches('input,textarea,select')"),false)};
  const noPopup=async()=>{assert.equal(await evaluate('window.__popupCalls?.length||0'),0);assert.equal((await send('Target.getTargets')).targetInfos.filter(t=>t.type==='page').length,targetCount)};
  await send('Page.navigate',{url:base+'/login'});await waitFor("!!document.querySelector('#login-email')");await field('#login-email','ana@angietech.demo');await field('#login-password','AngieDemo123!');await tap('.login-submit');await waitFor("!!document.querySelector('.seller-home')");
  const product=await api("return (await supabase.from('productos_venta').select('*')).data.find(p=>!p.maneja_serial&&p.stock>=12)");
  const sale=async(customerName)=>{
    await send('Page.navigate',{url:base+'/vender?q='+encodeURIComponent(product.codigo)});await waitFor("!!document.querySelector('.pos-tile .pos-add')");await tap('.pos-tile .pos-add');await tap('.pos-bar');await tap('.pos-who2 button');await waitFor("!!document.querySelector('.client-picker-sheet .row')");
    if(customerName)await evaluate("[...document.querySelectorAll('.client-picker-sheet .row')].find(e=>e.textContent.includes("+JSON.stringify(customerName)+")).click()");else await tap('.client-picker-sheet .row');
    await waitFor("!document.querySelector('.client-picker-sheet')");await tap('.pos-pay2');await waitFor("!!document.querySelector('.seller-sale-complete')");
    await evaluate("window.__popupCalls=[];window.__mailUrls=[];window.__mailMode='configured';window.open=(...args)=>{window.__popupCalls.push(args);return null};Object.defineProperty(navigator,'share',{configurable:true,value:undefined});Object.defineProperty(navigator,'canShare',{configurable:true,value:undefined});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copiedText=text;if(window.__copyMode==='deny')throw Error('Permission diagnostic');if(window.__copyMode==='hang')return new Promise(()=>{})}}});window.__copyMode='ok'");
  };
  await sale();const targetCount=(await send('Target.getTargets')).targetInfos.filter(t=>t.type==='page').length;
  const sold=await api("return (await supabase.from('facturas').select('*').eq('vendedor_id','demo-ana').order('id',{ascending:false}).limit(1)).data[0]");
  const before=await api('return supabase.demo.snapshot().tables');
  await tap('.email-more-options');await waitFor("!!document.querySelector('.invoice-email-preview')");await noPopup();assert.equal(await evaluate('window.__mailUrls.length'),0);check('Email action first opens an internal preview without navigation or new tabs');
  assert.equal(await evaluate("document.querySelector('.email-preview-recipient input').value"),sold.clientes.correo);assert.equal(await evaluate("document.querySelector('.email-preview-subject p').textContent"),'Factura '+sold.prefijo+'-'+String(sold.numero).padStart(4,'0')+' - Angie Tech');assert.ok(await evaluate("document.querySelector('.email-preview-attachment').textContent.includes('El PDF debe adjuntarse manualmente desde tu aplicación de correo.')"));assert.ok(await evaluate("document.querySelector('.email-preview-message').textContent.includes('Gracias por tu compra')"));check('Actual customer email, invoice subject, professional message and attachment instruction');
  assert.equal(await evaluate("!!document.querySelector('.email-share')"),false);check('Browser without Web Share retains copy and real PDF actions');
  await tap('.email-open');await noPopup();assert.equal(await evaluate('window.__mailUrls.length'),1);assert.ok((await evaluate('window.__mailUrls[0]')).startsWith('mailto:'));assert.ok(await evaluate("!!document.querySelector('.seller-sale-complete')&&!document.querySelector('.email-open').disabled"));check('Configured protocol handoff requests mailto in current page without popup');
  await evaluate("window.__mailMode='no-handler'");await tap('.email-open');await noPopup();assert.ok(await evaluate("document.querySelector('.email-direct-status').textContent.includes('Adjunta el PDF')"));check('Silent missing-handler/cancelled OS handoff leaves all fallback actions usable');
  await evaluate("window.__mailMode='throws'");await tap('.email-open');await noPopup();assert.equal(await evaluate("document.body.innerText.includes('OS diagnostic')"),false);assert.ok(await evaluate("document.querySelector('.invoice-email-preview [role=alert]').textContent.includes('No se pudo abrir')"));check('Rejected protocol handoff shows useful fallback without technical details');
  for(const [button,selector] of [['Copiar correo','.email-preview-recipient input'],['Copiar asunto','.email-preview-subject p'],['Copiar mensaje','.email-preview-message pre']]){await clickText(button);const expected=await evaluate("document.querySelector("+JSON.stringify(selector)+")."+(selector.endsWith('input')?'value':'textContent'));assert.equal(await evaluate('window.__copiedText'),expected);check(button+' copies the exact real value');}
  await evaluate("window.__copyMode='deny';document.execCommand=command=>{window.__selectedCopy=document.activeElement.value;return command==='copy'}");await clickText('Copiar mensaje');await waitFor("document.querySelector('.email-preview-info')?.textContent.includes('Mensaje copiado')");assert.equal(await evaluate('window.__selectedCopy'),await evaluate("document.querySelector('.email-preview-message pre').textContent"));assert.equal(await evaluate("document.querySelectorAll('textarea[aria-hidden=true]').length"),0);assert.equal(await evaluate("document.activeElement.matches('input,textarea,select')"),false);check('Denied clipboard falls back inside active dialog with cleanup and no residual input focus');
  await evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});document.execCommand=()=>false");await clickText('Copiar asunto');await waitFor("!!document.querySelector('.email-manual-copy')");assert.equal(await evaluate('getSelection().toString()'),await evaluate("document.querySelector('.email-preview-subject p').textContent"));check('HTTP/no clipboard/no legacy copying offers visibly selectable manual text');
  await evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>new Promise(()=>{})}})");await clickText('Copiar correo');assert.equal(await evaluate("document.querySelector('.email-preview-cancel').disabled"),false);await waitFor("!!document.querySelector('.email-manual-copy')&&!document.querySelector('.email-copy-actions button').disabled");check('Hung clipboard times out without blocking cancel, PDF or new sale');
  await tap('.email-download');await waitFor("document.querySelector('.email-preview-info')?.textContent.includes('PDF está listo')");let downloaded;for(let i=0;i<60&&!downloaded;i++){downloaded=readdirSync(downloads).find(f=>f.endsWith('.pdf'));if(!downloaded)await delay(150)}assert.ok(downloaded);const pdf=readFileSync(join(downloads,downloaded));assert.ok(pdf.toString('latin1').startsWith('%PDF-'));assert.ok(pdf.toString('latin1').includes(sold.prefijo+'-'+String(sold.numero).padStart(4,'0')));check('Download generates the unchanged real invoice PDF');
  await evaluate("Object.defineProperty(navigator,'canShare',{configurable:true,value:data=>data.files[0]?.type==='application/pdf'});Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.__shared={name:data.files[0].name,type:data.files[0].type,title:data.title,text:data.text,target:window.__shareTarget,activation:navigator.userActivation.isActive,header:new TextDecoder().decode((await data.files[0].arrayBuffer()).slice(0,5))};if(window.__shareMode==='cancel')throw new DOMException('Cancel','AbortError');if(window.__shareMode==='error')throw Error('Native diagnostic');if(window.__shareMode==='deferred')return new Promise(resolve=>{window.__finishShare=resolve});if(window.__shareMode==='hang')return new Promise(()=>{})}});window.__shareMode='ok'");await tap('.email-preview-cancel');await tap('.email-more-options');await waitFor("!!document.querySelector('.email-share')");
  await send('Network.setUserAgentOverride',{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',platform:'iPhone'});
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  const priority=await evaluate("(()=>{const p=document.querySelector('.email-preview-actions'),buttons=[...p.querySelectorAll('button')],share=p.querySelector('.email-share'),mail=p.querySelector('.email-open'),download=p.querySelector('.email-download');return{order:buttons.slice(0,4).map(e=>e.className),mailLabel:mail.textContent,shareBeforeMail:!!(share.compareDocumentPosition(mail)&Node.DOCUMENT_POSITION_FOLLOWING),downloadBeforeCopy:!!(download.compareDocumentPosition(p.querySelector('.email-copy-actions'))&Node.DOCUMENT_POSITION_FOLLOWING),primary:!share.classList.contains('sec'),secondary:mail.classList.contains('sec')}})()");
  assert.equal(priority.primary,true);assert.equal(priority.secondary,true);assert.equal(priority.shareBeforeMail,true);assert.equal(priority.downloadBeforeCopy,true);assert.equal(priority.mailLabel,'Aplicación del sistema');check('iPhone prioritizes Share, secondary Mail, PDF download and then copy data');
  const nativeTap=async()=>{const position=await evaluate("(()=>{const b=document.querySelector('.email-share');b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()");await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...position});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...position});await delay(150)};
  await nativeTap();await waitFor("!!window.__shared");const shared=await evaluate('window.__shared');assert.equal(shared.type,'application/pdf');assert.equal(shared.header,'%PDF-');assert.equal(shared.activation,true);assert.equal(shared.title,await evaluate("document.querySelector('.email-preview-subject p').textContent"));assert.ok(shared.text.includes(sold.prefijo+'-'+String(sold.numero).padStart(4,'0')));assert.ok(shared.text.length<120);assert.equal(await evaluate("document.body.innerText.includes('Correo enviado')"),false);check('Supported Web Share receives a real PDF from a user gesture without claiming email delivery');
  await evaluate("window.__shareMode='cancel'");await nativeTap();await waitFor("document.querySelector('.email-preview-info')?.textContent.includes('Compartir cancelado')");assert.equal(await evaluate("document.querySelector('.email-share').disabled"),false);check('Native sharing cancellation returns to usable email preview');
  await evaluate("window.__shareMode='error'");await nativeTap();await waitFor("document.querySelector('.email-preview-info')?.textContent.includes('Descarga el PDF')");assert.equal(await evaluate("document.body.innerText.includes('Native diagnostic')"),false);check('Native sharing error keeps download/copy alternatives');
  const leaveApp=()=>evaluate("window.dispatchEvent(new Event('blur'));Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'))");
  const returnApp=()=>evaluate("document.querySelector('#invoice-email-recipient').focus();Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));delete document.visibilityState");
  const invoiceNumber=await evaluate("document.querySelector('.seller-sale-complete .fd-num').textContent");
  for(const app of ['Gmail','Outlook','Mail','WhatsApp']){
    await evaluate("window.__shareTarget="+JSON.stringify(app)+";window.__shareMode='deferred';window.__finishShare=null");const mailCalls=await evaluate('window.__mailUrls.length');
    await nativeTap();await waitFor("typeof window.__finishShare==='function'");await leaveApp();await evaluate('window.__finishShare()');await delay(60);await returnApp();await delay(80);
    assert.equal(await evaluate("document.querySelector('.seller-sale-complete .fd-num').textContent"),invoiceNumber);assert.equal(await evaluate("document.querySelector('.email-share').disabled"),false);assert.equal(await evaluate("document.activeElement.matches('input,textarea,select')"),false);assert.equal(await evaluate("!!document.querySelector('.fd-auth,[type=password]')"),false);assert.equal(await evaluate('window.__mailUrls.length'),mailCalls);assert.equal(await evaluate('window.__shared.target'),app);check('Simulated '+app+' native target returns without losing invoice, keyboard or admin prompt');
  }
  await evaluate("window.__shareMode='deferred';window.__finishShare=null");await nativeTap();await waitFor("typeof window.__finishShare==='function'");await evaluate('window.__lateShare=window.__finishShare');await leaveApp();await returnApp();await waitFor("!document.querySelector('.email-share').disabled");check('Return releases pending native share while invoice stays available');
  await evaluate("window.__shareMode='cancel'");await nativeTap();await waitFor("document.querySelector('.email-preview-info')?.textContent.includes('Compartir cancelado')");await evaluate('window.__lateShare()');await delay(100);assert.ok(await evaluate("document.querySelector('.email-preview-info').textContent.includes('Compartir cancelado')"));check('Late native response cannot overwrite a newer share result');
  await evaluate("window.__mailMode='no-account'");await tap('.email-open');assert.ok(await evaluate("document.querySelector('.email-direct-status').textContent.includes('Adjunta el PDF')"));await leaveApp();await returnApp();assert.equal(await evaluate("document.querySelector('.seller-sale-complete .fd-num').textContent"),invoiceNumber);assert.ok(await evaluate("!!document.querySelector('.invoice-email-preview')&&!document.querySelector('.email-share').disabled"));check('Simulated Mail account setup returns to the same invoice and independent share action');
  await evaluate("Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>false})");await tap('.email-preview-cancel');await tap('.email-more-options');await waitFor("!!document.querySelector('.invoice-email-preview')");assert.equal(await evaluate("!!document.querySelector('.email-share')"),false);assert.ok(await evaluate("!!document.querySelector('.email-download')&&document.querySelectorAll('.email-copy-actions button').length===3"));assert.equal(await evaluate("document.querySelector('.email-preview-cancel').disabled"),false);check('PDF canShare false leaves every manual fallback and Cancel available');
  await evaluate("Object.defineProperty(navigator,'canShare',{configurable:true,value:d=>d.files[0]?.type==='application/pdf'})");await tap('.email-preview-cancel');await tap('.email-more-options');await waitFor("!!document.querySelector('.email-share')");
  const after=await api('return supabase.demo.snapshot().tables');for(const table of ['facturas','factura_items','movimientos','productos','factura_envios'])assert.deepEqual(after[table],before[table]);check('Preparing, copying, opening and sharing email do not mutate sales or record a fake send');
  for(const theme of ['dark','light'])for(const[width,height]of [[320,700],[360,800],[390,844],[430,932],[844,390],[932,430],[1280,800]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<1000});await evaluate('import("/src/lib/theme.js").then(m=>m.setTheme('+JSON.stringify(theme)+'))');await evaluate("document.querySelector('.email-preview-head').scrollIntoView({block:'start'})");await delay(100);
    const g=await evaluate("(()=>{const sheet=document.querySelector('.seller-sale-complete'),r=sheet.getBoundingClientRect(),body=sheet.querySelector('.sheet-body'),footer=sheet.querySelector('.sheet-foot'),p=document.querySelector('.invoice-email-preview');return{top:r.top,bottom:r.bottom,dialogs:document.querySelectorAll('[data-app-dialog]').length,bodyOverflow:getComputedStyle(body).overflowY,footerBackground:getComputedStyle(footer).backgroundColor,overflow:[...p.querySelectorAll('*')].filter(e=>e.tagName!=='INPUT'&&!e.closest('svg')&&e.getBoundingClientRect().width&&e.scrollWidth>e.clientWidth+2).map(e=>e.className),scrolls:[...p.querySelectorAll('*')].filter(e=>['auto','scroll'].includes(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight+2).map(e=>e.className),targets:[...p.querySelectorAll('button')].map(e=>e.getBoundingClientRect().height),inputFont:parseFloat(getComputedStyle(p.querySelector('input')).fontSize)}})()");assert.ok(g.top>=0&&g.bottom<=height+1);assert.equal(g.dialogs,1);assert.equal(g.bodyOverflow,'auto');assert.notEqual(g.footerBackground,'rgba(0, 0, 0, 0)');assert.deepEqual(g.overflow,[]);assert.deepEqual(g.scrolls,[]);assert.ok(g.targets.every(h=>h>=44));assert.ok(g.inputFont>=16);const primary=await evaluate("(()=>{const p=document.querySelector('.email-share').getBoundingClientRect(),b=document.querySelector('.seller-sale-complete .sheet-body').getBoundingClientRect();return{top:p.top,bottom:p.bottom,bodyTop:b.top,bodyBottom:b.bottom}})()");assert.ok(primary.top>=primary.bodyTop-1&&primary.bottom<=primary.bodyBottom+1,'Primary share is fully visible above footer');await screenshot('email-'+theme+'-'+width);check('Premium email single scroll/layout/touch targets '+theme+' '+width);
  }
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await evaluate("Object.defineProperty(visualViewport,'height',{configurable:true,value:450});Object.defineProperty(visualViewport,'offsetTop',{configurable:true,value:12});visualViewport.dispatchEvent(new Event('resize'))");await delay(200);const frame=await evaluate("(()=>{const r=document.querySelector('.seller-sale-complete').getBoundingClientRect();return{top:r.top,bottom:r.bottom}})()");assert.equal(frame.top,12);assert.equal(frame.bottom,462);await evaluate("document.querySelector('#invoice-email-recipient').focus()");await clickText('Copiar mensaje');assert.equal(await evaluate("document.activeElement.matches('input,textarea,select')"),false);await screenshot('email-390-keyboard');await evaluate("delete visualViewport.height;delete visualViewport.offsetTop;visualViewport.dispatchEvent(new Event('resize'))");check('Email honors keyboard visualViewport and dismisses input focus before actions');
  await tap('.email-preview-cancel');assert.equal(await evaluate("!!document.querySelector('.invoice-email-preview')"),false);assert.ok(await evaluate("!!document.querySelector('.seller-sale-complete')"));check('Cancel returns to sale success without losing invoice');
  await clickText('Abrir factura');await waitFor("!!document.querySelector('.invoice-detail-sheet')");await tap('.email-more-options');await waitFor("!!document.querySelector('.invoice-email-preview')");assert.equal(await evaluate("!!document.querySelector('.fd-auth,[type=password]')"),false);await tap('.email-preview-cancel');await tap('.invoice-detail-sheet .sheet-x');await waitFor("!!document.querySelector('.seller-sale-complete')");check('Existing invoice detail shares the email experience and returns without authorization');
  await tap('.email-more-options');await waitFor("!!document.querySelector('.email-share')");await evaluate("window.__shareMode='hang'");await nativeTap();assert.equal(await evaluate("document.querySelector('.email-preview-cancel').disabled"),false);await clickText('Nueva venta');await free();check('New sale remains available while native sharing is pending');
  const missing=await api("const r=await supabase.from('clientes').insert({nombre:'Cliente sin correo UX',tipo_documento:'CC',documento:'MAIL-NO-EMAIL',telefono:'3001234567',correo:null}).select('*').single();if(r.error)throw Error(r.error.message);return r.data");await sale(missing.nombre);await tap('.email-more-options');await waitFor("!!document.querySelector('.invoice-email-preview')");assert.equal(await evaluate("document.querySelector('#invoice-email-recipient').value"),'');assert.equal(await evaluate("document.querySelector('.email-copy-actions button').disabled"),true);assert.equal(await evaluate("document.querySelector('.email-download').disabled"),false);await noPopup();check('Actual customer without email can still copy subject/message and download PDF');
  await tap('.email-open');assert.ok(await evaluate("document.querySelector('.invoice-email-preview [role=alert]').textContent.includes('correo registrado')"));assert.equal(await evaluate('window.__mailUrls.length'),0);await field('#invoice-email-recipient','mal correo');await tap('.email-open');assert.ok(await evaluate("document.querySelector('.invoice-email-preview [role=alert]').textContent.includes('Revisa el correo')"));check('Missing/invalid recipient blocks only mailto, not exits or fallbacks');
  await field('#invoice-email-recipient','nuevo+correo@example.test');await tap('.email-open');assert.equal(await evaluate('window.__mailUrls.length'),1);const persisted=await api('return (await supabase.from("clientes").select("*").eq("id",'+missing.id+').single()).data');assert.equal(persisted.correo,null);check('Optional delivery address can be corrected without changing stored customer or invoice');
  await evaluate("Object.defineProperty(navigator,'canShare',{configurable:true,value:d=>d.files[0]?.type==='application/pdf'});Object.defineProperty(navigator,'share',{configurable:true,value:async d=>{window.__missingEmailFile={name:d.files[0].name,type:d.files[0].type,text:d.text}}})");await tap('.email-preview-cancel');await tap('.email-more-options');await waitFor("!!document.querySelector('.email-share')");await field('#invoice-email-recipient','');await nativeTap();await waitFor('!!window.__missingEmailFile');assert.equal(await evaluate('window.__missingEmailFile.type'),'application/pdf');assert.equal(await evaluate("!!document.querySelector('.invoice-email-preview [role=alert]')"),false);check('Native PDF sharing works without an email address and never forces Mail');
  await tap('.email-preview-cancel');await clickText('Nueva venta');await free();await send('Page.navigate',{url:base+'/'});await waitFor("!!document.querySelector('.seller-home')");assert.equal(await evaluate("!!document.querySelector('[data-app-dialog]')"),false);check('Return/navigation/new sale leave no blocking dialogs or orphan windows');
  assert.deepEqual(externalRequests,[]);assert.deepEqual(browserErrors,[]);await writeFile(join(artifacts,'results.json'),JSON.stringify({status:'PASS',cases:results.length,results,externalRequests,browserErrors,remoteCalls:0,physicalWindowsMailPending:true,physicalSafariPending:true},null,2));console.log(JSON.stringify({status:'PASS',cases:results.length,artifacts}));await send('Browser.close').catch(()=>{});
} catch(error){await writeFile(join(artifacts,'results.json'),JSON.stringify({status:'FAIL',error:error.stack,results,externalRequests,browserErrors},null,2));console.error(error.stack);process.exitCode=1}
finally{socket?.close();browser.kill();await delay(300);if(!profile.startsWith(join(tmpdir(),'angie-tech-ui-')))throw Error('Unexpected profile');await rm(profile,{recursive:true,force:true,maxRetries:20,retryDelay:250}).catch(error=>{console.error('Profile cleanup failed',error.message);process.exitCode=1})}
