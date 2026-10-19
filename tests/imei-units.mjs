import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createDemoClient } from '../src/lib/demo/client.js'
import { DEMO_PASSWORD } from '../src/lib/demo/seed.js'
import { isValidImei, normalizeSerial, parseSerialList, validateUnitAttributes, validateProductAttributes, suggestSerialType } from '../src/lib/imei.js'

const IMEI = ['356938035643809', '490154203237518', '353918053470106', '359881030314355']
const store = () => { const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) } }
async function demo(email = 'admin@angietech.demo') {
  const client = createDemoClient({ storage: store(), now: () => new Date('2026-10-18T15:00:00Z'), location: { protocol: 'http:', hostname: 'localhost' } })
  assert.equal((await client.auth.signInWithPassword({ email, password: DEMO_PASSWORD })).error, null)
  return client
}
const ok = r => { assert.equal(r.error, null, r.error?.message); return r.data }

test('IMEI: 15 dígitos con dígito verificador, normaliza espacios/guiones y detecta repetidos', () => {
  for (const v of IMEI) assert.ok(isValidImei(v), v)
  for (const v of ['356938035643808', '35693803564380', '3569380356438090', 'ABCDEFGHIJKLMNO', '']) assert.equal(isValidImei(v), false, v)
  assert.equal(normalizeSerial(' 35-693803-564380 9 ', 'imei'), '356938035643809')
  assert.throws(() => normalizeSerial('356938035643808', 'imei'), /verificador/)
  assert.equal(normalizeSerial('  SN-ABC 123 ', 'serie'), 'SN-ABC 123', 'serial de accesorio no se fuerza a IMEI')
  assert.equal(normalizeSerial('C02XL0GHJGH5', null), 'C02XL0GHJGH5')
  assert.deepEqual(parseSerialList('356938035643809\n490154203237518, ', 'imei'), ['356938035643809', '490154203237518'])
  assert.throws(() => parseSerialList('356938035643809\n35 6938035643809', 'imei'), /repetido/)
  assert.deepEqual(validateUnitAttributes({ color: ' Titanio ', capacidad: '256 GB', imei2: '49-0154203237518', nota: '' }), { color: 'Titanio', capacidad: '256 GB', imei2: '490154203237518' })
  assert.throws(() => validateUnitAttributes({ imei2: '356938035643809' }, '356938035643809'), /igual/)
  assert.throws(() => validateUnitAttributes({ precio: '1' }), /no permitido/)
  assert.deepEqual(validateProductAttributes([{ etiqueta: 'Capacidad', valor: '256 GB' }, { etiqueta: 'Vacío', valor: '' }]), [{ etiqueta: 'Capacidad', valor: '256 GB' }])
  assert.throws(() => validateProductAttributes([{ etiqueta: '', valor: 'x' }]))
  assert.equal(suggestSerialType('Smartphones'), 'imei'); assert.equal(suggestSerialType('Accesorios'), 'serie')
})

test('demo: celular con IMEI desde registro hasta venta y devolución; accesorio sin IMEI intacto', async () => {
  const admin = await demo()
  const phone = ok(await admin.from('productos').insert({ codigo: 'MOTO-G85', nombre: 'Motorola G85 256GB', categoria_id: 1, precio_venta: 1200000, precio_compra: 900000, stock_min: 1, garantia_meses: 12, maneja_serial: true, tipo_serial: 'imei', atributos: [{ etiqueta: 'Capacidad', valor: '256 GB' }] }).select('*').single())
  assert.equal(phone.maneja_serial, true); assert.equal(phone.tipo_serial, 'imei'); assert.equal(phone.stock, 0)
  const buy = items => admin.rpc('registrar_compra', { p_proveedor_id: 1, p_numero_documento: 'IMEI-' + Math.random(), p_forma_pago: 'contado', p_metodo_pago: 'efectivo', p_items: [{ producto_id: phone.id, cantidad: items.length, costo_unitario: 900000 }], p_seriales: items.map(serial => ({ producto_id: phone.id, serial })) })
  assert.match((await buy(['356938035643808'])).error.message, /verificador/, 'IMEI inválido rechazado')
  assert.match((await buy([IMEI[0], ' 35 6938035643809'])).error.message, /duplicate/, 'repetido dentro de la compra')
  ok(await buy([IMEI[0], '49 0154 2032 3751 8']))
  assert.match((await buy([IMEI[0]])).error.message, /duplicate/, 'IMEI ya existente en inventario')
  let units = ok(await admin.from('unidades_serializadas').select('*').eq('producto_id', phone.id))
  assert.deepEqual(units.map(u => u.serial).sort(), [IMEI[0], IMEI[1]].sort(), 'guardados normalizados')
  assert.equal(ok(await admin.from('productos').select('*').eq('id', phone.id).single()).stock, 2)
  const unit = units.find(u => u.serial === IMEI[0])
  ok(await admin.rpc('unidad_actualizar_atributos', { p_unidad_id: unit.id, p_atributos: { color: 'Azul', capacidad: '256 GB', imei2: IMEI[2] } }))
  assert.match((await admin.rpc('unidad_actualizar_atributos', { p_unidad_id: units.find(u => u.serial === IMEI[1]).id, p_atributos: { imei2: IMEI[2] } })).error.message, /IMEI 2/)
  assert.match((await buy([IMEI[2]])).error.message, /duplicate/, 'el IMEI 2 también cuenta como registrado')
  assert.match((await admin.from('productos').update({ maneja_serial: false }).eq('id', phone.id)).error.message, /unidades registradas/)
  // Venta de la unidad exacta: factura conserva el vínculo IMEI ↔ producto ↔ venta.
  const invoice = ok(await admin.rpc('emitir_factura', { p_items: [{ producto_id: phone.id, cantidad: 1, unidad_id: unit.id }], p_metodo_pago: 'efectivo', p_request_id: 'imei-sale-1' }))
  const line = ok(await admin.from('factura_items').select('*').eq('factura_id', invoice))[0]
  assert.equal(line.unidad_id, unit.id)
  const sold = ok(await admin.from('unidades_serializadas').select('*').eq('id', unit.id).single())
  assert.equal(sold.estado, 'vendida'); assert.equal(sold.factura_item_id, line.id); assert.equal(sold.atributos.color, 'Azul')
  assert.ok((await admin.rpc('emitir_factura', { p_items: [{ producto_id: phone.id, cantidad: 1, unidad_id: unit.id }], p_metodo_pago: 'efectivo', p_request_id: 'imei-sale-2' })).error, 'no se vende dos veces')
  ok(await admin.rpc('registrar_devolucion', { p_factura_id: invoice, p_items: [{ factura_item_id: line.id, cantidad: 1 }], p_motivo: 'Cambio', p_reintegra_stock: true }))
  const back = ok(await admin.from('unidades_serializadas').select('*').eq('id', unit.id).single())
  assert.equal(back.estado, 'disponible'); assert.equal(back.serial, IMEI[0])
  assert.equal(ok(await admin.from('factura_items').select('*').eq('id', line.id).single()).unidad_id, unit.id, 'la factura conserva el IMEI histórico')
  // Accesorio: sin IMEI, cantidad libre; los datos adicionales no rompen filtros ni ventas.
  const cable = ok(await admin.from('productos').insert({ codigo: 'CABLE-X', nombre: 'Cable X', categoria_id: 6, precio_venta: 20000, precio_compra: 8000, stock_min: 1, garantia_meses: 0, atributos: [{ etiqueta: 'Longitud', valor: '2 m' }] }).select('*').single())
  ok(await admin.rpc('registrar_compra', { p_proveedor_id: 1, p_numero_documento: 'ACC-1', p_forma_pago: 'contado', p_metodo_pago: 'efectivo', p_items: [{ producto_id: cable.id, cantidad: 5, costo_unitario: 8000 }], p_seriales: [] }))
  ok(await admin.rpc('emitir_factura', { p_items: [{ producto_id: cable.id, cantidad: 2 }], p_metodo_pago: 'efectivo', p_request_id: 'acc-sale-1' }))
  assert.equal(ok(await admin.from('productos_venta').select('*').ilike('nombre', '%Cable X%'))[0].stock, 3)
  assert.ok((await admin.from('productos').insert({ codigo: 'BAD-ATTR', nombre: 'Malo', categoria_id: 6, precio_venta: 1, atributos: [{ etiqueta: '', valor: 'x' }] })).error)
})

test('demo: solo inventario autorizado edita datos de la unidad', async () => {
  const seller = await demo('ana@angietech.demo')
  const unit = ok(await seller.from('unidades_serializadas').select('*').eq('estado', 'disponible'))[0]
  assert.match((await seller.rpc('unidad_actualizar_atributos', { p_unidad_id: unit.id, p_atributos: { color: 'Rojo' } })).error.message, /permiso/)
})

// ---------- SQL 18 en PGlite ----------
const ADMIN = '00000000-0000-0000-0000-000000000001', SELLER = '00000000-0000-0000-0000-000000000002', OTHER = '00000000-0000-0000-0000-000000000003'
async function fixture() {
  const db = new PGlite()
  await db.exec(`create role anon;create role authenticated;create schema auth;grant usage on schema auth to authenticated;grant usage on schema public to authenticated;
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('app.uid',true),'')::uuid$$;
  create table perfiles(id uuid primary key,rol text,negocio_id int);
  insert into perfiles values('${ADMIN}','admin',1),('${SELLER}','vendedor',1),('${OTHER}','admin',2);
  create function mi_negocio() returns int language sql stable security definer as $$select negocio_id from perfiles where id=auth.uid()$$;
  create function tiene_permiso(p text) returns boolean language sql stable security definer as $$select exists(select 1 from perfiles where id=auth.uid() and rol='admin')$$;
  create table actividad(id bigserial primary key,accion text);
  create function registrar_actividad(a text,e text,i text,d jsonb) returns void language sql security definer as $$insert into actividad(accion) values(a)$$;
  create table productos(id bigint primary key,negocio_id int default 1,nombre text,maneja_serial boolean default false,stock int default 0);
  create table unidades_serializadas(id bigint generated always as identity primary key,negocio_id int default 1,producto_id bigint references productos,serial text not null,estado text default 'disponible',factura_item_id bigint);
  create unique index on unidades_serializadas(negocio_id,serial);
  insert into productos values(1,1,'iPhone',true,0),(2,1,'Laptop',true,0),(3,1,'Cable',false,4),(4,2,'Otro negocio',true,0);
  insert into unidades_serializadas(producto_id,serial) values(1,'LEGADO-SIN-LUHN');`)
  await db.exec(readFileSync('supabase/18_imei_unidades.sql', 'utf8'))
  await db.exec("update productos set tipo_serial='imei' where id in (1,4); update productos set tipo_serial='serie' where id=2")
  return db
}
const as = async (db, id) => { await db.exec('reset role'); await db.query("select set_config('app.uid',$1,false)", [id]); await db.exec('set role authenticated') }

test('SQL 18: trigger valida IMEI también para compras, IMEI 2 único y datos de unidad con permiso', async () => {
  const db = await fixture()
  try {
    const insert = (p, s, neg = 1) => db.query('insert into unidades_serializadas(producto_id,serial,negocio_id) values($1,$2,$3) returning serial', [p, s, neg]).then(r => r.rows[0].serial)
    assert.equal(await insert(1, ' 35-693803 5643809 '), IMEI[0])
    await assert.rejects(insert(1, '356938035643808'), /no es válido/)
    await assert.rejects(insert(1, '35693803564380'), /no es válido/)
    await assert.rejects(insert(1, IMEI[0]), /duplicate|unique/)
    assert.equal(await insert(4, IMEI[0], 2), IMEI[0], 'otro negocio puede tener el mismo IMEI')
    assert.equal(await insert(2, 'C02XL0GHJGH5'), 'C02XL0GHJGH5', 'número de serie libre')
    // Las filas anteriores no se revalidan al editar sus datos.
    const legacy = (await db.query("select id from unidades_serializadas where serial='LEGADO-SIN-LUHN'")).rows[0].id
    const unit = (await db.query("select id from unidades_serializadas where serial=$1 and negocio_id=1", [IMEI[0]])).rows[0].id
    await as(db, ADMIN)
    const updated = (await db.query('select unidad_actualizar_atributos($1,$2) v', [legacy, { color: 'Negro', capacidad: '128 GB' }])).rows[0].v
    assert.equal(updated.atributos.color, 'Negro')
    await db.query('select unidad_actualizar_atributos($1,$2)', [unit, { imei2: '49 0154203237518' }])
    await db.exec('reset role')
    assert.equal((await db.query('select atributos->>\'imei2\' i from unidades_serializadas where id=$1', [unit])).rows[0].i, IMEI[1])
    await assert.rejects(insert(1, IMEI[1]), /IMEI 2 de otra unidad/)
    await as(db, ADMIN)
    await assert.rejects(db.query('select unidad_actualizar_atributos($1,$2)', [legacy, { imei2: IMEI[1] }]), /ya está registrado/)
    await assert.rejects(db.query('select unidad_actualizar_atributos($1,$2)', [legacy, { imei2: '356938035643808' }]), /no válidos/)
    await assert.rejects(db.query('select unidad_actualizar_atributos($1,$2)', [legacy, { precio: '1' }]), /no válidos/)
    await as(db, SELLER)
    await assert.rejects(db.query('select unidad_actualizar_atributos($1,$2)', [legacy, { color: 'Rojo' }]), /permiso/)
    await as(db, OTHER)
    await assert.rejects(db.query('select unidad_actualizar_atributos($1,$2)', [legacy, { color: 'Rojo' }]), /no existe/)
    await db.exec('reset role')
    // Atributos de producto y bloqueo del control por unidad con unidades existentes.
    await db.query("update productos set atributos=$1 where id=3", [JSON.stringify([{ etiqueta: 'Longitud', valor: '2 m' }])])
    await assert.rejects(db.query("update productos set atributos=$1 where id=3", [JSON.stringify([{ etiqueta: '', valor: 'x' }])]), /productos_atributos_check/)
    await assert.rejects(db.query("update productos set tipo_serial='otro' where id=2"), /productos_tipo_serial_check/)
    await db.query("update productos set tipo_serial='imei' where id=3")
    assert.equal((await db.query('select tipo_serial from productos where id=3')).rows[0].tipo_serial, null, 'sin control por unidad no guarda tipo')
    await assert.rejects(db.query('update productos set maneja_serial=false where id=1'), /unidades registradas/)
    await assert.rejects(db.query('update productos set maneja_serial=true where id=3'), /unidades registradas/, 'accesorio con stock no se convierte')
    await db.query("insert into productos(id,nombre) values(5,'Nuevo')"); await db.query("update productos set maneja_serial=true,tipo_serial='imei' where id=5")
    assert.equal((await db.query('select tipo_serial from productos where id=5')).rows[0].tipo_serial, 'imei')
  } finally { await db.close() }
})
