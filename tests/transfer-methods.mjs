import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createDemoClient } from '../src/lib/demo/client.js'
import { DEMO_PASSWORD } from '../src/lib/demo/seed.js'
import { validateTransferMethod, validateImageDataUrl, loadTransferMethods, registerInvoiceTransferMethod, transferSchemaMissing, TRANSFER_LIMITS } from '../src/lib/transferMethods.js'

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII='
const jpg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='
const medio = { nombre: 'Nequi', titular: 'Angie Tech SAS', numero_cuenta: '3001234567', detalle: 'Cuenta de ahorros', qr_data_url: png, logo_data_url: jpg }
const store = () => { const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) } }
async function session(email, storage = store()) {
  const client = createDemoClient({ storage, now: () => new Date('2026-10-18T15:00:00Z'), location: { protocol: 'http:', hostname: 'localhost' } })
  assert.equal((await client.auth.signInWithPassword({ email, password: DEMO_PASSWORD })).error, null)
  return client
}
const ok = result => { assert.equal(result.error, null, result.error?.message); return result.data }

test('valida nombre, imágenes PNG/JPG reales y límites de tamaño', () => {
  const value = validateTransferMethod({ ...medio, nombre: '  Nequi  ' })
  assert.equal(value.nombre, 'Nequi'); assert.equal(value.activo, true); assert.equal(value.orden, 0)
  assert.equal(validateTransferMethod({ nombre: 'Banco', qr_data_url: png }).logo_data_url, null)
  for (const patch of [{ nombre: '' }, { qr_data_url: '' }, { qr_data_url: 'https://example.test/qr.png' }, { qr_data_url: 'data:image/svg+xml;base64,PHN2Zz4=' }, { qr_data_url: 'data:image/png;base64,/9j/AAAA' }, { logo_data_url: 'data:image/gif;base64,R0lGODlh' }, { nombre: 'Ne\nqui' }, { nombre: 'x'.repeat(61) }, { orden: -1 }])
    assert.throws(() => validateTransferMethod({ ...medio, ...patch }), undefined, JSON.stringify(patch).slice(0, 40))
  const base64Length = 4 * Math.ceil((TRANSFER_LIMITS.qrBytes + 10) / 3), big = 'data:image/png;base64,iVBORw0KGgo' + 'A'.repeat(base64Length - 11)
  assert.throws(() => validateImageDataUrl(big, { maxBytes: TRANSFER_LIMITS.qrBytes, label: 'QR' }), /tamaño/)
  assert.ok(transferSchemaMissing({ code: 'PGRST205' })); assert.equal(transferSchemaMissing({ code: '42501' }), false)
})

test('demo: administrador configura, vendedor solo consulta activos y no edita', async () => {
  const storage = store(), admin = await session('admin@angietech.demo', storage)
  ok(await admin.from('medios_transferencia').insert(medio))
  ok(await admin.from('medios_transferencia').insert({ nombre: 'Daviplata', qr_data_url: png, orden: 5 }))
  assert.ok((await admin.from('medios_transferencia').insert({ ...medio, nombre: 'nequi' })).error, 'nombre duplicado')
  assert.ok((await admin.from('medios_transferencia').insert({ nombre: 'Sin QR' })).error, 'QR obligatorio')
  const all = await loadTransferMethods(admin, { soloActivos: false })
  assert.deepEqual(all.map(m => m.nombre), ['Nequi', 'Daviplata'])
  const davi = all.find(m => m.nombre === 'Daviplata')
  ok(await admin.from('medios_transferencia').update({ activo: false }).eq('id', davi.id))
  ok(await admin.from('medios_transferencia').update({ qr_data_url: jpg }).eq('id', all[0].id))
  assert.equal((await loadTransferMethods(admin, { soloActivos: false })).find(m => m.nombre === 'Nequi').qr_data_url, jpg)
  const seller = await session('ana@angietech.demo', storage)
  const visible = await loadTransferMethods(seller)
  assert.deepEqual(visible.map(m => m.nombre), ['Nequi'])
  assert.equal(visible[0].qr_data_url, jpg)
  assert.ok((await seller.from('medios_transferencia').insert({ ...medio, nombre: 'Falso' })).error)
  assert.ok((await seller.from('medios_transferencia').update({ qr_data_url: png }).eq('id', visible[0].id)).error)
  assert.ok((await seller.from('medios_transferencia').delete().eq('id', visible[0].id)).error)
  assert.equal((await seller.from('medios_transferencia').select('*').eq('id', davi.id)).data.length, 0, 'inactivo oculto al vendedor')
})

test('demo: transferencia con QR registra el medio sin duplicar venta, caja ni Finanzas', async () => {
  const storage = store(), admin = await session('admin@angietech.demo', storage)
  ok(await admin.from('medios_transferencia').insert(medio)); ok(await admin.from('medios_transferencia').insert({ nombre: 'Bancolombia', qr_data_url: png }))
  const methods = await loadTransferMethods(admin), nequi = methods.find(m => m.nombre === 'Nequi'), banco = methods.find(m => m.nombre === 'Bancolombia')
  assert.deepEqual(methods.map(m => m.nombre), ['Bancolombia', 'Nequi'], 'mismo orden: alfabético')
  const seller = await session('ana@angietech.demo', storage), before = seller.demo.snapshot().tables
  const invoice = ok(await seller.rpc('emitir_factura', { p_items: [{ producto_id: 14, cantidad: 1 }], p_metodo_pago: 'transferencia', p_request_id: 'sale-request-qr-1' }))
  assert.equal(ok(await seller.rpc('emitir_factura', { p_items: [{ producto_id: 14, cantidad: 1 }], p_metodo_pago: 'transferencia', p_request_id: 'sale-request-qr-1' })), invoice, 'reintento idempotente')
  const middle = seller.demo.snapshot().tables
  assert.deepEqual(await registerInvoiceTransferMethod(seller, invoice, nequi.id), { id: nequi.id, nombre: 'Nequi' })
  assert.deepEqual(await registerInvoiceTransferMethod(seller, invoice, nequi.id), { id: nequi.id, nombre: 'Nequi' }, 'repetir es idempotente')
  await assert.rejects(registerInvoiceTransferMethod(seller, invoice, banco.id), /otro medio/)
  const after = seller.demo.snapshot().tables
  assert.equal(after.facturas.length, before.facturas.length + 1)
  for (const table of ['facturas', 'movimientos', 'caja_eventos', 'factura_items', 'movimientos_inventario']) assert.equal(after[table].length, middle[table].length, table)
  const row = after.facturas.find(f => f.id === invoice)
  assert.equal(row.total, middle.facturas.find(f => f.id === invoice).total); assert.equal(row.medio_transferencia.nombre, 'Nequi')
  const cash = ok(await seller.rpc('emitir_factura', { p_items: [{ producto_id: 14, cantidad: 1 }], p_metodo_pago: 'efectivo', p_request_id: 'sale-request-qr-2' }))
  await assert.rejects(registerInvoiceTransferMethod(seller, cash, nequi.id), /no se cobró por transferencia/)
  const other = await session('carlos@angietech.demo', storage)
  await assert.rejects(registerInvoiceTransferMethod(other, invoice, nequi.id), /permiso/)
  // Renombrar o desactivar no altera la referencia histórica; borrar un medio usado se impide.
  ok(await admin.auth.signInWithPassword({ email: 'admin@angietech.demo', password: DEMO_PASSWORD }))
  ok(await admin.from('medios_transferencia').update({ nombre: 'Nequi Negocio', activo: false }).eq('id', nequi.id))
  assert.equal(admin.demo.snapshot().tables.facturas.find(f => f.id === invoice).medio_transferencia.nombre, 'Nequi')
  assert.match((await admin.from('medios_transferencia').delete().eq('id', nequi.id)).error.message, /usó en ventas/)
  ok(await admin.from('medios_transferencia').delete().eq('id', banco.id))
})

// ---------- SQL 16 en PGlite ----------
const A = '00000000-0000-0000-0000-00000000000a', S = '00000000-0000-0000-0000-00000000000b', S2 = '00000000-0000-0000-0000-00000000000c', B = '00000000-0000-0000-0000-00000000000d'
async function sql() {
  const db = new PGlite()
  await db.exec(`create role anon;create role authenticated;create schema auth;grant usage on schema auth to authenticated;grant usage on schema public to authenticated;
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('app.uid',true),'')::uuid$$;
  create table tienda(id int primary key,nombre text);insert into tienda values(1,'Angie'),(2,'Otro');
  create table perfiles(id uuid primary key,nombre text,rol text,activo boolean default true,negocio_id int references tienda(id));
  insert into perfiles values('${A}','Admin','admin',true,1),('${S}','Ana','vendedor',true,1),('${S2}','Sin permiso','vendedor',true,1),('${B}','Admin B','admin',true,2);
  create function mi_negocio() returns int language sql stable security definer as $$select negocio_id from perfiles where id=auth.uid() and activo$$;
  create function es_activo() returns boolean language sql stable security definer as $$select exists(select 1 from perfiles where id=auth.uid() and activo)$$;
  create function es_admin() returns boolean language sql stable security definer as $$select exists(select 1 from perfiles where id=auth.uid() and activo and rol='admin')$$;
  create function tiene_permiso(p text) returns boolean language sql stable security definer as $$select es_admin() or (es_activo() and p='vender' and auth.uid()<>'${S2}')$$;
  create table actividad(id bigserial primary key,accion text,detalle jsonb);
  create function registrar_actividad(a text,e text,i text,d jsonb) returns void language sql security definer as $$insert into actividad(accion,detalle) values(a,d)$$;
  create table facturas(id bigint primary key,negocio_id int,vendedor_id uuid,metodo_pago text,estado text default 'emitida',total numeric);
  insert into facturas values(1,1,'${S}','transferencia','emitida',100),(2,1,'${S}','efectivo','emitida',100),(3,1,'${A}','transferencia','emitida',100);`)
  await db.exec(readFileSync('supabase/16_medios_transferencia.sql', 'utf8'))
  return db
}
const as = async (db, id) => { await db.exec('reset role'); await db.query("select set_config('app.uid',$1,false)", [id]); await db.exec('set role authenticated') }

test('SQL 16 compila; RLS: admin gestiona, vendedor ve activos, otro negocio aislado', async () => {
  const db = await sql()
  try {
    await as(db, A)
    await db.query('insert into medios_transferencia(nombre,qr_data_url,logo_data_url,negocio_id) values($1,$2,$3,2)', ['Nequi', png, jpg])
    const rows = (await db.query('select * from medios_transferencia')).rows
    assert.equal(rows.length, 1); assert.equal(rows[0].negocio_id, 1, 'el negocio lo fija el servidor'); assert.equal(rows[0].actualizado_por, A)
    await db.query("insert into medios_transferencia(nombre,qr_data_url,activo) values('Daviplata',$1,false)", [png])
    await assert.rejects(db.query("insert into medios_transferencia(nombre,qr_data_url) values('NEQUI',$1)", [png]), /duplicate|unique/)
    await assert.rejects(db.query("insert into medios_transferencia(nombre,qr_data_url) values('SVG','data:image/svg+xml;base64,PHN2Zz4=')"), /medios_transferencia_validos/)
    await assert.rejects(db.query("insert into medios_transferencia(nombre,qr_data_url) values('Falso','data:image/png;base64,/9j/AAAA')"), /medios_transferencia_validos/)
    await assert.rejects(db.query("insert into medios_transferencia(nombre) values('Sin QR')"), /null/)
    await as(db, S)
    assert.deepEqual((await db.query('select nombre from medios_transferencia')).rows.map(r => r.nombre), ['Nequi'])
    await assert.rejects(db.query("insert into medios_transferencia(nombre,qr_data_url) values('Falso',$1)", [png]), /row-level security/)
    assert.equal((await db.query("update medios_transferencia set qr_data_url=$1 returning id", [jpg])).rows.length, 0)
    assert.equal((await db.query('delete from medios_transferencia returning id')).rows.length, 0)
    await as(db, S2)
    assert.equal((await db.query('select * from medios_transferencia')).rows.length, 0, 'sin permiso vender')
    await as(db, B)
    assert.equal((await db.query('select * from medios_transferencia')).rows.length, 0, 'otro negocio')
    assert.equal((await db.query("update medios_transferencia set nombre='X' returning id")).rows.length, 0)
  } finally { await db.close() }
})

test('SQL 16: registrar medio solo en transferencias propias, una vez, y borrado restringido', async () => {
  const db = await sql()
  try {
    await as(db, A)
    const nequi = (await db.query("insert into medios_transferencia(nombre,qr_data_url) values('Nequi',$1) returning id", [png])).rows[0].id
    const banco = (await db.query("insert into medios_transferencia(nombre,qr_data_url) values('Banco',$1) returning id", [png])).rows[0].id
    const reg = (f, m) => db.query('select factura_registrar_medio_transferencia($1,$2) as v', [f, m]).then(r => r.rows[0].v)
    await as(db, S)
    assert.deepEqual(await reg(1, nequi), { id: Number(nequi), nombre: 'Nequi' })
    assert.deepEqual(await reg(1, nequi), { id: Number(nequi), nombre: 'Nequi' })
    await assert.rejects(reg(1, banco), /otro medio/)
    await assert.rejects(reg(2, nequi), /no se cobró por transferencia/)
    await assert.rejects(reg(3, nequi), /permiso/, 'factura de otro vendedor')
    await as(db, S2); await assert.rejects(reg(1, nequi), /permiso/)
    await as(db, B); await assert.rejects(reg(1, nequi), /permiso/)
    await as(db, A)
    await db.query("update medios_transferencia set nombre='Nequi Nuevo', activo=false where id=$1", [nequi])
    await db.exec('reset role')
    assert.equal((await db.query('select medio_transferencia->>\'nombre\' as n, total from facturas where id=1')).rows[0].n, 'Nequi')
    await as(db, A)
    await assert.rejects(db.query('delete from medios_transferencia where id=$1', [nequi]), /foreign key/)
    assert.equal((await db.query('delete from medios_transferencia where id=$1 returning id', [banco])).rows.length, 1)
    await assert.rejects(reg(3, nequi), /desactivado/)
    await db.exec('reset role')
    assert.equal((await db.query("select count(*)::int n from actividad where accion='factura.medio_transferencia'")).rows[0].n, 1)
    assert.equal((await db.query('select count(*)::int n from facturas')).rows[0].n, 3, 'no crea ventas')
  } finally { await db.close() }
})
