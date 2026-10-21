import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createDemoClient } from '../src/lib/demo/client.js'
import { DEMO_PASSWORD } from '../src/lib/demo/seed.js'
import { dailyCashSummary, dailyReportCsv, bogotaDate } from '../src/lib/cashDaily.js'

const NOW = new Date('2026-10-18T20:00:00Z'), DAY = '2026-10-18'
const store = () => { const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) } }
async function demo(email = 'admin@angietech.demo', storage = store()) {
  const client = createDemoClient({ storage, now: () => NOW, location: { protocol: 'http:', hostname: 'localhost' } })
  assert.equal((await client.auth.signInWithPassword({ email, password: DEMO_PASSWORD })).error, null)
  return client
}
const login = (client, email) => client.auth.signInWithPassword({ email, password: DEMO_PASSWORD })
const ok = r => { assert.equal(r.error, null, r.error?.message); return r.data }
const sale = (client, metodo, precio, id) => client.rpc('emitir_factura', { p_items: [{ producto_id: 14, cantidad: 1, precio_unitario: precio }], p_metodo_pago: metodo, p_request_id: 'daily-sale-' + id }).then(ok)

test('fórmula: efectivo 250.000 + transferencias 350.000 + tarjeta 400.000 = 1.000.000 sin sumar al efectivo', () => {
  const f = (id, metodo, total, extra = {}) => ({ id, metodo_pago: metodo, total, estado: 'emitida', fecha: '2026-10-18T15:00:00Z', vendedor_id: 'a', ...extra })
  const r = dailyCashSummary({ fecha: DAY, facturas: [f(1, 'efectivo', 250000), f(2, 'transferencia', 200000, { medio_transferencia: { nombre: 'Nequi' } }), f(3, 'transferencia', 150000), f(4, 'tarjeta', 400000), f(5, 'efectivo', 99, { fecha: '2026-10-18T04:30:00Z' })],
    sesiones: [{ id: 1, responsable_id: 'a', apertura_en: '2026-10-18T13:00:00Z', estado: 'cerrada', inicial_cent: 5000000 }] })
  assert.equal(r.ventas.cantidad, 4, '04:30Z es el 17 a las 23:30 en Bogotá: no cuenta')
  assert.deepEqual(r.ventas.por_metodo, { efectivo: 25000000, transferencia: 35000000, tarjeta: 40000000 })
  assert.equal(r.ventas.bruto_cent, 100000000)
  assert.equal(r.efectivo.esperado_cent, 5000000 + 25000000, 'solo efectivo inicial + ventas en efectivo')
  assert.deepEqual(r.ventas.transferencias_por_medio, [{ nombre: 'Nequi', cent: 20000000 }, { nombre: 'Sin medio registrado', cent: 15000000 }])
  assert.equal(bogotaDate('2026-10-19T04:59:59Z'), '2026-10-18'); assert.equal(bogotaDate('2026-10-19T05:00:00Z'), '2026-10-19')
}, )

test('demo: cierre diario con totales por método, ajustes, caja y sin tocar facturas', async () => {
  const admin = await demo()
  const caja = ok(await admin.rpc('caja_abrir', { p_inicial_cent: 10000000, p_request_id: 'daily-open-1' }))
  await sale(admin, 'efectivo', 250000, 1); await sale(admin, 'transferencia', 350000, 2); const card = await sale(admin, 'tarjeta', 400000, 3)
  let state = ok(await admin.rpc('caja_dia_estado', { p_fecha: DAY, p_responsable: 'demo-admin' }))
  assert.equal(state.resumen.ventas.bruto_cent, 100000000); assert.equal(state.resumen.ventas.cantidad, 3)
  assert.deepEqual(state.resumen.ventas.por_metodo, { efectivo: 25000000, transferencia: 35000000, tarjeta: 40000000 })
  assert.equal(state.resumen.efectivo.esperado_cent, 35000000)
  assert.deepEqual(state.resumen.pendientes.cajas_abiertas.map(c => c.id), [caja])
  // Devolución parcial de la venta con tarjeta: ajuste comercial, no toca el efectivo.
  const line = admin.demo.snapshot().tables.factura_items.find(i => i.factura_id === card)
  ok(await admin.rpc('registrar_devolucion', { p_factura_id: card, p_items: [{ factura_item_id: line.id, cantidad: 1 }], p_motivo: 'Cliente desistió', p_reintegra_stock: true }))
  const cash = admin.demo.snapshot().tables.facturas.find(f => f.request_id === 'daily-sale-1').id
  ok(await admin.rpc('anular_factura', { p_factura_id: cash, p_motivo: 'Error de digitación' }))
  state = ok(await admin.rpc('caja_dia_estado', { p_fecha: DAY, p_responsable: 'demo-admin' }))
  const r = state.resumen
  assert.equal(r.devoluciones.cantidad, 1); assert.equal(r.devoluciones.por_metodo.tarjeta, 40000000)
  assert.equal(r.anulaciones.cantidad, 1); assert.equal(r.anulaciones.por_metodo.efectivo, 25000000)
  assert.equal(r.neto_cent, 35000000); assert.equal(r.ventas.anuladas, 1)
  assert.equal(r.efectivo.esperado_cent, 35000000, 'el reembolso no confirmado no se resta del efectivo')
  assert.equal(r.pendientes.reembolsos_sin_confirmar, 2)
  // No se puede cerrar el día con un turno abierto.
  await assert.rejects(admin.rpc('caja_cerrar_dia', { p_fecha: DAY, p_responsable: 'demo-admin', p_request_id: 'daily-close-1', p_huella: r.huella, p_contado_cent: 35000000 }).then(ok), /turnos de caja abiertos/)
  const shift = ok(await admin.rpc('caja_estado'))
  const adj = shift.pending_adjustments.find(a => a.tipo === 'anulacion')
  ok(await admin.rpc('caja_movimiento', { p_caja_id: caja, p_request_id: 'daily-refund-1', p_tipo: 'reembolso', p_monto_cent: 25000000, p_metodo: 'efectivo', p_descripcion: 'Devuelto al cliente', p_referencia: 'Recibo 1', p_ajuste_id: adj.id }))
  const shift2 = ok(await admin.rpc('caja_estado'))
  ok(await admin.rpc('caja_cerrar', { p_caja_id: caja, p_request_id: 'daily-shift-close', p_revision: shift2.session.revision, p_contado_cent: shift2.summary.efectivo_esperado_cent, p_observaciones: '' }))
  state = ok(await admin.rpc('caja_dia_estado', { p_fecha: DAY, p_responsable: 'demo-admin' }))
  assert.equal(state.resumen.efectivo.esperado_cent, 10000000, 'inicial + 250.000 − reembolso confirmado 250.000')
  assert.equal(state.resumen.pendientes.reembolsos_sin_confirmar, 1); assert.equal(state.resumen.pendientes.cajas_abiertas.length, 0)
  const before = admin.demo.snapshot().tables
  // Huella vieja, diferencia sin explicación y fecha futura se rechazan.
  await assert.rejects(admin.rpc('caja_cerrar_dia', { p_fecha: DAY, p_responsable: 'demo-admin', p_request_id: 'daily-close-2', p_huella: r.huella, p_contado_cent: 10000000 }).then(ok), /movimientos nuevos/)
  await assert.rejects(admin.rpc('caja_cerrar_dia', { p_fecha: DAY, p_responsable: 'demo-admin', p_request_id: 'daily-close-2', p_huella: state.resumen.huella, p_contado_cent: 9000000 }).then(ok), /sobrante o faltante/)
  await assert.rejects(admin.rpc('caja_dia_estado', { p_fecha: '2026-10-19' }).then(ok), /hasta hoy/)
  const id = ok(await admin.rpc('caja_cerrar_dia', { p_fecha: DAY, p_responsable: 'demo-admin', p_request_id: 'daily-close-2', p_huella: state.resumen.huella, p_contado_cent: 9990000, p_observaciones: 'Faltan 100 pesos' }))
  assert.equal(ok(await admin.rpc('caja_cerrar_dia', { p_fecha: DAY, p_responsable: 'demo-admin', p_request_id: 'daily-close-2', p_huella: state.resumen.huella, p_contado_cent: 9990000, p_observaciones: 'Faltan 100 pesos' })), id, 'reintento idempotente')
  await assert.rejects(admin.rpc('caja_cerrar_dia', { p_fecha: DAY, p_responsable: 'demo-admin', p_request_id: 'daily-close-3', p_huella: state.resumen.huella, p_contado_cent: 10000000 }).then(ok), /ya tiene un cierre/)
  const after = admin.demo.snapshot().tables
  for (const table of ['facturas', 'factura_items', 'devoluciones', 'movimientos', 'movimientos_inventario', 'caja_eventos']) assert.deepEqual(after[table], before[table], table)
  const closed = ok(await admin.rpc('caja_dia_estado', { p_fecha: DAY, p_responsable: 'demo-admin' }))
  assert.equal(closed.cierre.diferencia_cent, -10000); assert.equal(closed.cierre.cerrado_nombre, 'Valentina Gómez')
  // El consolidado del negocio es un alcance distinto e incluye ventas de otros vendedores.
  const all = ok(await admin.rpc('caja_dia_estado', { p_fecha: DAY }))
  assert.equal(all.cierre, null); assert.ok(all.resumen.ventas.cantidad >= 3)
  assert.equal(ok(await admin.rpc('caja_cierres_dia')).cierres[0].id, id)
  const csv = dailyReportCsv(closed.cierre.resumen, closed.cierre, closed.facturas)
  assert.ok(csv.startsWith('﻿')); assert.ok(csv.includes('Total vendido')); assert.ok(csv.includes('Centavos COP enteros'))
  // Una venta posterior cambia el estado vivo pero no el cierre confirmado.
  await sale(admin, 'efectivo', 1000, 9)
  const later = ok(await admin.rpc('caja_dia_estado', { p_fecha: DAY, p_responsable: 'demo-admin' }))
  assert.notEqual(later.resumen.huella, later.cierre.huella); assert.equal(later.cierre.resumen.ventas.cantidad, 3)
})

test('demo: permiso individual de cierre para vendedores (frontend y backend)', async () => {
  const storage = store(), client = await demo('ana@angietech.demo', storage)
  const shift = ok(await client.rpc('caja_abrir', { p_inicial_cent: 0, p_request_id: 'perm-open-1' }))
  await assert.rejects(client.rpc('caja_dia_estado', { p_fecha: DAY }).then(ok), /permiso/)
  await assert.rejects(client.rpc('caja_cierres_dia').then(ok), /permiso/)
  await assert.rejects(client.rpc('caja_cerrar', { p_caja_id: shift, p_request_id: 'perm-close-1', p_revision: 0, p_contado_cent: 0 }).then(ok), /permiso/)
  assert.equal((await client.from('caja_cierres_diarios').select('*')).data.length, 0)
  await login(client, 'admin@angietech.demo')
  const permisos = client.demo.snapshot().tables.perfil_permisos.filter(p => p.perfil_id === 'demo-ana').map(p => p.permiso)
  ok(await client.rpc('guardar_empleado_demo', { id: 'demo-ana', datos: {}, permisos: [...permisos, 'cerrar_caja'] }))
  await login(client, 'ana@angietech.demo')
  const mine = ok(await client.rpc('caja_dia_estado', { p_fecha: DAY }))
  assert.equal(mine.resumen.alcance, 'responsable'); assert.equal(mine.resumen.responsable_id, 'demo-ana')
  await assert.rejects(client.rpc('caja_dia_estado', { p_fecha: DAY, p_responsable: 'demo-carlos' }).then(ok), /propio/)
  ok(await client.rpc('caja_cerrar', { p_caja_id: shift, p_request_id: 'perm-close-2', p_revision: 0, p_contado_cent: 0 }))
  const fresh = ok(await client.rpc('caja_dia_estado', { p_fecha: DAY }))
  const id = ok(await client.rpc('caja_cerrar_dia', { p_fecha: DAY, p_request_id: 'perm-day-1', p_huella: fresh.resumen.huella, p_contado_cent: fresh.resumen.efectivo.esperado_cent }))
  assert.deepEqual(ok(await client.rpc('caja_cierres_dia')).cierres.map(c => c.id), [id])
  // Otro vendedor con permiso no ve el cierre de Ana; el administrador sí.
  await login(client, 'admin@angietech.demo')
  ok(await client.rpc('guardar_empleado_demo', { id: 'demo-carlos', datos: {}, permisos: ['vender', 'cerrar_caja'] }))
  assert.equal(ok(await client.rpc('caja_cierres_dia')).cierres.length, 1)
  await login(client, 'carlos@angietech.demo')
  assert.equal(ok(await client.rpc('caja_cierres_dia')).cierres.length, 0)
  // Retirar el permiso bloquea de nuevo.
  await login(client, 'admin@angietech.demo')
  ok(await client.rpc('guardar_empleado_demo', { id: 'demo-ana', datos: {}, permisos }))
  await login(client, 'ana@angietech.demo')
  await assert.rejects(client.rpc('caja_cierres_dia').then(ok), /permiso/)
})

// ---------- SQL 14 + 17 en PGlite ----------
const ADMIN = '00000000-0000-0000-0000-000000000001', ANA = '00000000-0000-0000-0000-000000000002', CARLOS = '00000000-0000-0000-0000-000000000003', OTHER = '00000000-0000-0000-0000-000000000004'
async function fixture() {
  const db = new PGlite()
  await db.exec(`create role anon;create role authenticated;create schema auth;grant usage on schema auth to authenticated;grant usage on schema public to authenticated;
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('app.uid',true),'')::uuid$$;
  create type permiso_tipo as enum ('vender','ver_inventario');
  create table tienda(id int primary key,nombre text,activo boolean default true);insert into tienda values(1,'Angie',true),(2,'Otro',true);
  create table perfiles(id uuid primary key,nombre text,rol text,activo boolean default true,negocio_id int);
  insert into perfiles values('${ADMIN}','Admin','admin',true,1),('${ANA}','Ana','vendedor',true,1),('${CARLOS}','Carlos','vendedor',true,1),('${OTHER}','Admin B','admin',true,2);
  create table perfil_permisos(perfil_id uuid,permiso permiso_tipo,primary key(perfil_id,permiso));
  insert into perfil_permisos values('${ANA}','vender'),('${CARLOS}','vender');
  create function mi_negocio() returns int language sql stable security definer as $$select negocio_id from perfiles where id=auth.uid() and activo$$;
  create function es_activo() returns boolean language sql stable security definer as $$select exists(select 1 from perfiles where id=auth.uid() and activo)$$;
  create function es_admin() returns boolean language sql stable security definer as $$select exists(select 1 from perfiles where id=auth.uid() and activo and rol='admin')$$;
  create function tiene_permiso(p permiso_tipo) returns boolean language plpgsql stable security definer as $$begin return es_admin() or exists(select 1 from perfil_permisos pp join perfiles pf on pf.id=pp.perfil_id where pp.perfil_id=auth.uid() and pp.permiso=p and pf.activo);end$$;
  create table actividad(id bigserial primary key,accion text);
  create function registrar_actividad(a text,e text,i text,d jsonb) returns void language sql security definer as $$insert into actividad(accion) values(a)$$;
  create table facturas(id bigint primary key,negocio_id int default 1,vendedor_id uuid,metodo_pago text,total numeric,estado text default 'emitida',fecha timestamptz default now(),prefijo text default 'FV',numero int,anulada_en timestamptz,anulada_por uuid);
  create table devoluciones(id bigint primary key,factura_id bigint references facturas,total_devuelto numeric default 0,creado_por uuid,fecha timestamptz default now());`)
  await db.exec(readFileSync('supabase/14_caja.sql', 'utf8'))
  await db.exec(readFileSync('supabase/17_cierre_caja_diario.sql', 'utf8'))
  return db
}
const as = async (db, id) => { await db.exec('reset role'); await db.query("select set_config('app.uid',$1,false)", [id]); await db.exec('set role authenticated') }
const call = (db, sql, args = []) => db.query('select ' + sql + ' as v', args).then(r => r.rows[0].v)

test('SQL 17 compila sobre 14; totales iguales a la fórmula JS; permisos, duplicados y aislamiento', async () => {
  const db = await fixture()
  try {
    const today = (await db.query("select (now() at time zone 'America/Bogota')::date::text d")).rows[0].d
    await as(db, ANA)
    await assert.rejects(call(db, 'caja_dia_estado($1::date)', [today]), /permiso/)
    const shift = await call(db, 'caja_abrir($1,$2)', [5000000, 'sql-open-ana-1'])
    await assert.rejects(call(db, 'caja_cerrar($1,$2,$3,$4,$5)', [shift, 'sql-close-ana-0', 0, 5000000, '']), /permiso/)
    await db.exec('reset role')
    // Ventas de Ana (cada INSERT corre con su sesión: el trigger de 14 captura su caja).
    await db.query("select set_config('app.uid',$1,false)", [ANA])
    await db.exec(`insert into facturas(id,vendedor_id,metodo_pago,total,numero) values(1,'${ANA}','efectivo',250000,1),(2,'${ANA}','transferencia',350000,2),(3,'${ANA}','tarjeta',400000,3),(4,'${CARLOS}','efectivo',1000,4)`)
    await db.exec(`insert into devoluciones values(1,3,100000,'${ANA}',now())`)
    await db.exec(`update facturas set estado='anulada',anulada_en=now(),anulada_por='${ANA}' where id=1`)
    await db.exec(`insert into perfil_permisos values('${ANA}','cerrar_caja')`)
    await as(db, ANA)
    const state = await call(db, 'caja_dia_estado($1::date)', [today]), r = state.resumen
    assert.deepEqual(r.ventas.por_metodo, { efectivo: 25000000, transferencia: 35000000, tarjeta: 40000000 })
    assert.equal(r.ventas.bruto_cent, 100000000); assert.equal(r.ventas.cantidad, 3, 'no incluye la venta de Carlos')
    assert.equal(r.devoluciones.por_metodo.tarjeta, 10000000); assert.equal(r.anulaciones.por_metodo.efectivo, 25000000)
    assert.equal(r.neto_cent, 65000000); assert.equal(r.efectivo.esperado_cent, 5000000 + 25000000)
    assert.equal(r.pendientes.reembolsos_sin_confirmar, 2); assert.equal(r.pendientes.cajas_abiertas.length, 1)
    assert.equal(state.facturas.length, 3)
    // Paridad exacta con la fórmula JS usada en la demo y la interfaz.
    await db.exec('reset role')
    const rows = q => db.query(q).then(x => x.rows)
    const js = dailyCashSummary({ fecha: today, scopeId: ANA, responsableNombre: 'Ana', facturas: await rows('select * from facturas'), devoluciones: await rows('select * from devoluciones'), sesiones: await rows('select * from caja_sesiones'), eventos: await rows('select * from caja_eventos') })
    assert.equal(js.huella, r.huella); assert.deepEqual({ ...js, fecha: undefined }, { ...r, fecha: undefined })
    await as(db, ANA)
    await assert.rejects(call(db, 'caja_dia_estado($1::date,$2::uuid)', [today, CARLOS]), /propio/)
    await assert.rejects(call(db, 'caja_cerrar_dia($1::date,null,$2,$3,$4,$5)', [today, 'sql-day-1', r.huella, 30000000, '']), /turnos de caja abiertos/)
    const s = await call(db, 'caja_estado($1)', [shift])
    await call(db, 'caja_cerrar($1,$2,$3,$4,$5)', [shift, 'sql-close-ana-1', s.session.revision, s.summary.efectivo_esperado_cent, ''])
    const fresh = (await call(db, 'caja_dia_estado($1::date)', [today])).resumen
    await assert.rejects(call(db, 'caja_cerrar_dia($1::date,null,$2,$3,$4,$5)', [today, 'sql-day-1', r.huella, 30000000, '']), /movimientos nuevos/)
    await assert.rejects(call(db, 'caja_cerrar_dia($1::date,null,$2,$3,$4,$5)', [today, 'sql-day-1', fresh.huella, 1, '']), /sobrante o faltante/)
    const id = await call(db, 'caja_cerrar_dia($1::date,null,$2,$3,$4,$5)', [today, 'sql-day-1', fresh.huella, 30000000, ''])
    assert.equal(await call(db, 'caja_cerrar_dia($1::date,null,$2,$3,$4,$5)', [today, 'sql-day-1', fresh.huella, 30000000, '']), id)
    await assert.rejects(call(db, 'caja_cerrar_dia($1::date,null,$2,$3,$4,$5)', [today, 'sql-day-2', fresh.huella, 30000000, '']), /ya tiene un cierre/)
    await assert.rejects(db.query("insert into caja_cierres_diarios(negocio_id,fecha,alcance,resumen,huella,esperado_cent,contado_cent,diferencia_cent,cerrado_por,request_id) values(1,now(),'negocio','{}','x',0,0,0,$1,'direct-1')", [ANA]), /permission denied/)
    assert.equal((await db.query('select count(*)::int n from caja_cierres_diarios')).rows[0].n, 1)
    await as(db, CARLOS)
    await assert.rejects(call(db, 'caja_cierres_dia()'), /permiso/)
    assert.equal((await db.query('select * from caja_cierres_diarios')).rows.length, 0)
    await as(db, ADMIN)
    assert.equal((await call(db, 'caja_cierres_dia()')).cierres.length, 1)
    const all = await call(db, 'caja_dia_estado($1::date)', [today])
    assert.equal(all.resumen.alcance, 'negocio'); assert.equal(all.resumen.ventas.cantidad, 4); assert.equal(all.cierre, null)
    await as(db, OTHER)
    assert.equal((await call(db, 'caja_cierres_dia()')).cierres.length, 0)
    assert.equal((await call(db, 'caja_dia_estado($1::date)', [today])).resumen.ventas.cantidad, 0)
    await assert.rejects(call(db, 'caja_dia_estado($1::date,$2::uuid)', [today, ANA]), /no pertenece/)
    await db.exec('reset role')
    assert.equal((await db.query("select count(*)::int n from facturas where estado='emitida'")).rows[0].n, 3, 'cerrar no modifica facturas')
  } finally { await db.close() }
})
