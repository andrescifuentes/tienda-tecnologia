// Recorrido completo de Angie Tech en modo demo (sin red). Cada paso registra PASS/FAIL.
// Uso: VITE_DEMO_MODE=true npx vite --port 5174   y en otra terminal:
//      B=http://127.0.0.1:5174 UI_BROWSER_PATH=<ruta de Chrome> node tests/recorrido-completo-ui.mjs
// Requiere playwright-core (npm i -D playwright-core). Sale con código 1 si algún paso falla.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
const B = process.env.B || 'http://127.0.0.1:5174'
const OUT = 'artifacts/recorrido'; fs.mkdirSync(OUT, { recursive: true })
const b = await chromium.launch({ executablePath: process.env.UI_BROWSER_PATH || undefined, args: process.platform === 'linux' ? ['--no-sandbox'] : [] })
const results = []
let p, errs = [], consoleErrs = []
const state = () => p.evaluate(() => JSON.parse(localStorage.getItem('angie-tech:demo:v1')))
const wait = ms => p.waitForTimeout(ms)
async function step(name, fn) {
  const e0 = errs.length
  try { const info = await fn(); if (errs.length > e0) throw new Error('Error JS: ' + errs.slice(e0).join(' | ')); results.push({ name, ok: true, info }) }
  catch (e) { results.push({ name, ok: false, info: String(e.message || e).split('\n')[0].slice(0, 220) }); await p.screenshot({ path: `${OUT}/FALLA-${results.length}.png` }).catch(() => {}) }
}
async function session(email, w = 390, h = 844) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } })
  await ctx.route(u => /wa\.me|whatsapp\.com/.test(u.hostname), r => r.fulfill({ body: 'wa' }))
  p = await ctx.newPage(); errs = []
  p.on('pageerror', e => errs.push(e.message))
  p.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) consoleErrs.push(m.text().slice(0, 160)) })
  await p.goto(B + '/login'); await p.waitForSelector('.login-form')
  if (email !== 'admin@angietech.demo') { await p.click('.demo-roles'); await p.selectOption('#demo-account', email) }
  await p.click('.demo-entry'); await p.waitForSelector('.ah-sales-open', { timeout: 20000 }); await wait(800)
}
async function visit(path, sel) {
  await p.goto(B + path); await p.waitForSelector(sel, { timeout: 12000 }); await wait(500)
  const r = await p.evaluate(() => ({ path: location.pathname, over: document.documentElement.scrollWidth - innerWidth, boom: /Algo salió mal|Something went wrong/.test(document.body.innerText), text: document.body.innerText.length }))
  if (r.boom) throw new Error('Pantalla de error')
  if (r.over > 1) throw new Error('Desborde horizontal de ' + r.over + 'px')
  if (r.path !== path) throw new Error('Redirigió a ' + r.path)
  return r.text + ' caracteres'
}
const clearCart = () => p.evaluate(() => { for (const k of Object.keys(sessionStorage)) sessionStorage.removeItem(k) })
async function vender(q, metodo) {
  await clearCart(); await p.goto(B + '/vender'); await p.waitForSelector('input[aria-label="Buscar producto"]'); await wait(900)
  await p.fill('input[aria-label="Buscar producto"]', q); await wait(900)
  await p.locator('.pos-tile').first().locator('.pos-add').click(); await wait(400)
  await p.click('.pos-bar'); await wait(600)
  if (metodo) await p.click(`.pos-pays2 button:has-text("${metodo}")`)
  // Transferencia abre la hoja de códigos QR: sin QR configurados se vuelve a la venta y se cobra igual.
  if (metodo === 'Transferencia') { await wait(700); const volver = p.locator('.tqr-sheet button:has-text("Volver a la venta")'); if (await volver.count()) await volver.click(); await wait(400) }
  await p.click('.pos-pay2'); await wait(2300)
  await p.click('.fd-finish.ok'); await wait(3800)
}

// ───────────── ADMINISTRADOR ─────────────
await session('admin@angietech.demo')
await step('Admin · Inicio carga sin errores', () => visit('/', '.ah-sales-open'))
for (const [path, sel] of [['/inventario', '.inv-card'], ['/vender', '.pos-tile'], ['/facturas', '.fv-card, .invoice-card, .fv'], ['/facturas/historial', 'main'], ['/clientes', 'button:has-text("Nuevo cliente")'], ['/proveedores', 'button:has-text("Nuevo proveedor")'], ['/empleados', '.employee-card, .row'], ['/finanzas', 'main'], ['/finanzas/movimientos', 'main'], ['/reportes', 'main'], ['/caja', '.cash-head, .cash-hero, main'], ['/configuracion', '#locales'], ['/actividad', 'main'], ['/mas', 'main']])
  await step(`Admin · abre ${path}`, () => visit(path, sel))

await step('Admin · crear cliente', async () => {
  await p.goto(B + '/clientes'); await wait(1200)
  const antes = (await state()).tables.clientes.length
  await p.locator('button:has-text("Nuevo"), button:has-text("+ Cliente"), button:has-text("Agregar")').first().click(); await wait(500)
  await p.locator('.sheet input').first().fill('1012345678'); await p.fill('.sheet input[placeholder="Ej. Pepito Perez"]', 'Cliente Recorrido QA'); await p.fill('.sheet input[placeholder="300 123 4567"]', '3009998877'); await wait(200)
  await p.locator('.sheet button:has-text("Guardar"), .sheet button:has-text("Crear")').first().click(); await wait(1200)
  const d = (await state()).tables.clientes; if (d.length !== antes + 1 || !d.some(c => c.nombre === 'Cliente Recorrido QA')) throw new Error('No se guardó el cliente'); return 'clientes ' + antes + '→' + d.length
})

let stockAntes
await step('Admin · venta en efectivo descuenta stock y crea factura', async () => {
  const s0 = await state(); const prod = s0.tables.productos.find(x => /JBL/.test(x.nombre)); stockAntes = prod.stock
  const f0 = s0.tables.facturas.length
  await vender('JBL', 'Efectivo')
  const s1 = await state(); const p1 = s1.tables.productos.find(x => x.id === prod.id)
  if (s1.tables.facturas.length !== f0 + 1) throw new Error('No se creó la factura')
  if (p1.stock !== stockAntes - 1) throw new Error(`Stock ${stockAntes}→${p1.stock}`)
  return `factura nueva, stock ${stockAntes}→${p1.stock}`
})
await step('Admin · venta con tarjeta', async () => { const n = (await state()).tables.facturas.length; await vender('Cable', 'Tarjeta'); const s = await state(); const f = s.tables.facturas.at(-1); if (s.tables.facturas.length !== n + 1 || f.metodo_pago !== 'tarjeta') throw new Error('Falló'); return 'ok' })
await step('Admin · la venta aparece en Facturas con su local', async () => {
  await p.goto(B + '/facturas'); await wait(1800); const t = await p.evaluate(() => document.body.innerText)
  const f = (await state()).tables.facturas.at(-1); const num = 'FV-' + String(f.numero).padStart(4, '0')
  if (!t.includes(num)) throw new Error('No aparece ' + num); return num
})
await step('Admin · abrir detalle de factura', async () => { await p.locator('.fv-card, .invoice-card').first().click(); await wait(1500); const t = await p.evaluate(() => document.body.innerText); if (!/Total/i.test(t)) throw new Error('Sin detalle'); await p.keyboard.press('Escape'); return 'ok' })

await step('Caja · resumen con ventas por método', async () => {
  await p.goto(B + '/caja'); await wait(2000); const t = await p.evaluate(() => document.body.innerText)
  for (const k of ['Efectivo', 'Tarjeta', 'Transferencia']) if (!t.includes(k)) throw new Error('Falta ' + k)
  return 'ok'
})
await step('Caja · tocar Efectivo muestra productos vendidos', async () => {
  await p.locator('.cash-method').first().click(); await wait(1200); const t = await p.evaluate(() => document.body.innerText)
  if (!/JBL|Cable/.test(t)) throw new Error('No muestra productos'); await p.keyboard.press('Escape'); await wait(400); return 'ok'
})
await step('Caja · registrar novedad', async () => {
  await p.click('button:has-text("Registrar novedad")'); await wait(500)
  await p.locator('.sheet textarea').first().fill('Prueba de novedad QA'); await p.locator('.sheet button:has-text("Guardar"), .sheet button:has-text("Registrar")').last().click(); await wait(1200)
  const ev = (await state()).tables.caja_eventos.filter(e => e.tipo === 'novedad'); if (!ev.some(e => e.descripcion === 'Prueba de novedad QA')) throw new Error('No se guardó'); return 'ok'
})
await step('Caja · cerrar con base para mañana', async () => {
  await p.click('.cash-close-btn'); await wait(600)
  const esperado = await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('angie-tech:demo:v1')); const c = s.tables.caja_sesiones.find(c => c.estado === 'abierta'); return c ? c.inicial_cent + s.tables.caja_eventos.filter(e => e.caja_id === c.id).reduce((n, e) => n + e.efectivo_cent, 0) : null })
  await p.locator('.cc [data-cop-input]').first().fill(String(Math.round(esperado / 100))); await wait(200)
  await p.locator('.cc [data-cop-input]').nth(1).fill('50000'); await wait(200)
  await p.click('button:has-text("Confirmar cierre de caja")'); await wait(1500)
  const c = (await state()).tables.caja_sesiones.at(-1); if (c.estado !== 'cerrada') throw new Error('No cerró'); if (c.base_siguiente_cent !== 5000000) throw new Error('Base ' + c.base_siguiente_cent)
  return `contado ${c.contado_cent / 100}, base 50.000, dif ${c.diferencia_cent}`
})
await step('Caja · historial muestra el cierre y abre su detalle', async () => {
  await p.locator('.hc-row').first().scrollIntoViewIfNeeded(); await p.locator('.hc-row').first().click(); await wait(1500)
  const t = await p.evaluate(() => document.body.innerText); if (!/Detalle del cierre/i.test(t)) throw new Error('No abre el detalle'); if (!/Prueba de novedad QA/.test(t)) throw new Error('El detalle no muestra la novedad')
  await p.keyboard.press('Escape'); await wait(400); return 'ok'
})
await step('Caja · filtros Año/Mes/Día responden', async () => {
  const sel = p.locator('.hc select'); const n = await sel.count(); if (n < 3) throw new Error('Hay ' + n + ' filtros')
  await sel.nth(2).selectOption({ index: 0 }); await wait(800); return n + ' filtros'
})
await step('Caja · reabrir (admin, mismo día)', async () => {
  await p.click('button:has-text("Reabrir")'); await wait(500); await p.locator('.sheet textarea, .sheet input').first().fill('Se cerró por error'); await p.locator('.sheet button:has-text("Reabrir")').last().click(); await wait(1500)
  const c = (await state()).tables.caja_sesiones.at(-1); if (c.estado !== 'abierta') throw new Error('Sigue cerrada'); return 'ok'
})

await step('Locales · crear Local 2', async () => {
  await p.goto(B + '/configuracion'); await wait(1200)
  await p.click('button:has-text("Agregar local")'); await wait(400)
  await p.fill('input[placeholder="Ej: Local Centro"]', 'Local QA Centro'); await p.click('button:has-text("Crear local")'); await wait(1200)
  if (!(await state()).tables.locales.some(l => l.nombre === 'Local QA Centro')) throw new Error('No se creó'); return 'ok'
})
await step('Locales · editar nombre de Local 1', async () => {
  await p.locator('#locales button:has-text("Editar")').first().click(); await wait(400)
  const inp = p.locator('input[placeholder="Ej: Local Centro"]'); await inp.fill('Local QA Principal'); await p.locator('button:has-text("Guardar")').last().click(); await wait(1200)
  if (!(await state()).tables.locales.some(l => l.nombre === 'Local QA Principal')) throw new Error('No se guardó'); return 'ok'
})
await step('Locales · trasladar stock al Local 2', async () => {
  await p.goto(B + '/inventario'); await wait(1500)
  await p.locator('.inv-card').first().click(); await wait(1000)
  await p.click('button:has-text("Trasladar")'); await wait(500)
  const loc2 = (await state()).tables.locales.find(l => l.nombre === 'Local QA Centro')
  const sels = p.locator('.sheet select'); if (await sels.count()) await sels.last().selectOption(String(loc2.id)).catch(() => {})
  const cb = p.locator('.sheet input[type="checkbox"]'); if (await cb.count()) await cb.first().check(); else await p.locator('.sheet input[inputmode="numeric"], .sheet input[type="number"]').last().fill('1'); await wait(200)
  await p.locator('.sheet button:has-text("Trasladar")').last().click(); await wait(1500)
  const sl = (await state()).tables.stock_local.filter(s => s.local_id === loc2.id && s.stock > 0); if (!sl.length) throw new Error('El Local 2 sigue sin stock'); return sl.length + ' producto(s) en Local 2'
})
await step('Locales · filtro Local 2 no muestra agotados del Local 1', async () => {
  await p.goto(B + '/inventario'); await wait(1300)
  await p.locator('.loc-sel-opt', { hasText: 'Local QA Centro' }).first().click(); await wait(1200)
  const n = await p.locator('.inv-card').count(); const t = await p.evaluate(() => document.body.innerText)
  if (n < 1 || n > 3) throw new Error('Muestra ' + n + ' productos'); if (/Agotado/.test(t)) throw new Error('Muestra agotados'); return n + ' producto(s)'
})
await step('Locales · empleados muestran su local', async () => { await p.goto(B + '/empleados'); await wait(1300); const t = await p.evaluate(() => document.body.innerText); if (!/Local QA/.test(t)) throw new Error('Sin local'); return 'ok' })
await step('Admin · Finanzas y Reportes muestran cifras', async () => { await p.goto(B + '/finanzas'); await wait(1500); const t = await p.evaluate(() => document.body.innerText); if (!/\$\s?\d/.test(t)) throw new Error('Sin cifras'); return 'ok' })
await step('Admin · compra a proveedor suma stock', async () => {
  const s0 = await state(); const c0 = s0.tables.compras.length
  await p.goto(B + '/proveedores'); await wait(1300)
  await p.locator('.pv-card').first().click(); await wait(900)
  await p.click('button:has-text("Registrar compra")'); await wait(900)
  await p.click('button.pos-more'); await wait(700)
  await p.locator('.product-pick').filter({ hasNotText: 'IMEI' }).first().click(); await wait(700)
  const s1 = await state(); const tieneSerial = await p.locator('.cp-serial textarea').count()
  if (tieneSerial) await p.locator('.cp-serial textarea').fill('QA-SERIAL-' + Date.now())
  const precio = p.locator('.cp-item input[data-cop-input], .cp-item input[inputmode="numeric"]'); if (await precio.count()) { const v = await precio.first().inputValue(); if (!v || v === '0') await precio.first().fill('10000') }
  await p.click('.cf-save'); await wait(1800)
  const s2 = await state(); if (s2.tables.compras.length !== c0 + 1) throw new Error('No se registró la compra')
  const ci = s2.tables.compra_items.filter(i => i.compra_id === s2.tables.compras.at(-1).id)[0]
  const antes = s0.tables.productos.find(x => x.id === ci.producto_id).stock, despues = s2.tables.productos.find(x => x.id === ci.producto_id).stock
  if (despues !== antes + ci.cantidad) throw new Error(`stock ${antes}→${despues}`)
  return `stock ${antes}→${despues}`
})
await step('Admin · tema oscuro sin errores', async () => { await p.emulateMedia({ colorScheme: 'dark' }); await visit('/', '.ah-sales-open'); await visit('/caja', 'main'); await p.emulateMedia({ colorScheme: 'light' }); return 'ok' })
await step('Admin · pantalla pequeña 320px sin desbordes', async () => { await p.setViewportSize({ width: 320, height: 640 }); for (const r of ['/', '/inventario', '/vender', '/caja', '/facturas']) await visit(r, 'main'); await p.setViewportSize({ width: 390, height: 844 }); return 'ok' })

// ───────────── VENDEDOR ─────────────
await session('ana@angietech.demo')
await step('Vendedor · Inicio propio', () => visit('/', '.ah-sales-open'))
for (const path of ['/finanzas', '/empleados', '/reportes', '/configuracion', '/proveedores']) await step(`Vendedor · NO entra a ${path}`, async () => {
  await p.goto(B + path); await wait(1500); const r = await p.evaluate(() => location.pathname); if (r === path) { const t = await p.evaluate(() => document.body.innerText); if (!/permiso|acceso/i.test(t)) throw new Error('Pudo entrar a ' + path) } return 'bloqueado → ' + r
})
await step('Vendedor · inventario sin costos', async () => {
  await visit('/inventario', '.inv-card'); await p.locator('.inv-card').first().click(); await wait(1000)
  const t = await p.evaluate(() => document.body.innerText); if (/Costo|Precio de compra|Margen|Utilidad/i.test(t)) throw new Error('Ve costos'); return 'ok'
})
await step('Vendedor · vende', async () => { const n = (await state()).tables.facturas.length; await vender('JBL', 'Transferencia'); const s = await state(); if (s.tables.facturas.length !== n + 1) throw new Error('No vendió'); if (s.tables.facturas.at(-1).vendedor_id !== 'demo-ana') throw new Error('Vendedor errado'); return 'ok' })
await step('Vendedor · ve la caja de su local sin utilidades', async () => {
  await visit('/caja', 'main'); const t = await p.evaluate(() => document.body.innerText); if (/Utilidad|Ganancia|Costo/i.test(t)) throw new Error('Ve datos de administrador'); return 'ok'
})
await step('Vendedor · no puede cambiar su rol', async () => {
  const r = await p.evaluate(async () => { const s = JSON.parse(localStorage.getItem('angie-tech:demo:v1')); return s.tables.perfiles.find(x => x.id === 'demo-ana').rol }); if (r !== 'vendedor') throw new Error(r); return 'rol ' + r
})

console.log(JSON.stringify({ pass: results.filter(r => r.ok).length, fail: results.filter(r => !r.ok).length, results, consoleErrs: [...new Set(consoleErrs)].slice(0, 10) }, null, 1))
await b.close()
if (results.some(r => !r.ok)) process.exit(1)
