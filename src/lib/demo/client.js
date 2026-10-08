import { createDemoSeed, DEMO_KEY, demoDate } from './seed.js'
import { exigirEntornoDemoPermitido } from './environment.js'
import { hashDemoPassword } from './password.js'

const clone = (value) => structuredClone(value)
const fail = (message) => { throw new Error(message) }
const amount = (value, label = 'Monto') => { const n = Number(value); if (!Number.isFinite(n) || n < 0) fail(`${label} inválido`); return n }
const quantity = (value) => { const n = Number(value); if (!Number.isInteger(n) || n <= 0) fail('La cantidad debe ser un entero mayor que cero'); return n }
const sum = (rows, field) => rows.reduce((total, row) => total + Number(row[field] || 0), 0)
const safe = async (action) => { try { return { data: await action(), error: null } } catch (error) { return { data: null, error: { message: error.message } } } }
const requiredPermission = { productos:'editar_inventario', clientes:'crear_clientes', proveedores:'registrar_compras', categorias:'editar_inventario', movimientos:'ver_finanzas', garantias:'editar_inventario', reclamos_garantia:'editar_inventario', perfiles:'admin', perfil_permisos:'admin', tienda:'admin', factura_envios:'vender' }

export function createDemoClient({ storage = globalThis.localStorage, now = () => new Date(), location = globalThis.location, crypto = globalThis.crypto } = {}) {
  const listeners = new Set()
  function read() {
    exigirEntornoDemoPermitido(location)
    const raw = storage.getItem(DEMO_KEY)
    if (!raw) { const state = createDemoSeed(now()); storage.setItem(DEMO_KEY, JSON.stringify(state)); return state }
    const state = JSON.parse(raw)
    if (state.version !== 1 || !state.tables?.productos) fail('Los datos demo locales no son compatibles. Restablece la demo desde Configuración.')
    // Additive migration: keep all existing transactions and sessions.
    for (const table of ['garantia_eventos','notificaciones_leidas']) state.tables[table] ||= []
    state.sequences ||= {}
    for (const [table, records] of Object.entries(state.tables)) state.sequences[table] = Math.max(state.sequences[table] || 0, ...records.map(r => Number(r.id) || 0))
    for (const row of state.tables.clientes) row.activo ??= true
    const computing = state.tables.categorias.find(c => c.nombre === 'Computadores')
    if (computing) computing.nombre = 'Cómputo'
    for (const nombre of ['Smartphones','Audio','Accesorios','Cómputo','Wearables','Tablets','Otros']) if (!state.tables.categorias.some(c => c.nombre === nombre)) state.tables.categorias.push({id:++state.sequences.categorias,nombre,activa:true})
    const settings = state.tables.tienda[0]
    settings.ultimo_numero_factura = Math.max(settings.ultimo_numero_factura, ...state.tables.facturas.map(f => f.numero))
    return state
  }
  function transaction(action) {
    const state = read()
    const result = action(state)
    // Commit all related modules together; failed validation/quota leaves the previous store intact.
    storage.setItem(DEMO_KEY, JSON.stringify(state))
    globalThis.window?.dispatchEvent(new Event('demo-data-change'))
    return clone(result ?? null)
  }
  const user = (state) => state.tables.perfiles.find((p) => p.id === state.session?.user.id)
  function permit(state, permission) {
    const profile = user(state)
    if (!profile?.activo || !(profile.rol === 'admin' || permission !== 'admin' && state.tables.perfil_permisos.some((p) => p.perfil_id === profile.id && p.permiso === permission))) fail('No tienes permiso para esta acción.')
    return profile
  }
  function authenticated(state) { if (!user(state)?.activo) fail('Inicia sesión en la demo para continuar') }
  function add(state, table, data) {
    const id = state.sequences[table] = (state.sequences[table] || 0) + 1
    const row = { id, ...data }; state.tables[table].push(row); return row
  }
  const find = (state, table, id) => state.tables[table].find((row) => String(row.id) === String(id)) || fail('El registro no existe')
  function activity(state, accion, entidad, id, detalle = {}) { add(state,'actividad',{perfil_id:state.session?.user.id,accion,entidad,entidad_id:String(id),detalle,fecha:now().toISOString()}) }
  function move(state, product, count, type, reference, id, cost = product.precio_compra, reason = null) {
    if (product.stock + count < 0) fail(`Stock insuficiente para ${product.nombre}`)
    product.stock += count
    add(state,'movimientos_inventario',{producto_id:product.id,tipo:type,cantidad:count,stock_despues:product.stock,costo_unitario:cost,referencia_tipo:reference,referencia_id:id,motivo:reason,creado_por:state.session?.user.id,fecha:now().toISOString()})
  }
  function ledger(state, tipo, categoria, monto, extra = {}) {
    if (monto > 0) add(state,'movimientos',{tipo,categoria,monto,fecha:demoDate(now()),registrado_por:state.session?.user.id,...extra})
  }
  function net(state, invoice) {
    const refunds = state.tables.devoluciones.filter((d) => d.factura_id === invoice.id)
    const reintegrated = refunds.filter((d) => d.reintegra_stock).flatMap((d) => state.tables.devolucion_items.filter((i) => i.devolucion_id === d.id))
    return { ...invoice, total_neto:invoice.total-sum(refunds,'total_devuelto'), comision_neta:(invoice.comision||0)-sum(refunds,'comision_revertida'), costo_neto:invoice.costo_total-reintegrated.reduce((n,i)=>n+i.cantidad*find(state,'factura_items',i.factura_item_id).costo_unitario,0) }
  }
  function hydrate(state, table, row) {
    const t = state.tables, copy = { ...row }
    if (table === 'productos' || table === 'productos_venta') { copy.categorias = t.categorias.find((c)=>c.id===row.categoria_id); copy.categoria=copy.categorias?.nombre; copy.proveedores=t.proveedores.find(p=>p.id===row.proveedor_id); if(table==='productos_venta') delete copy.precio_compra }
    if (table === 'facturas' || table === 'facturas_netas') { copy.clientes=t.clientes.find(c=>c.id===row.cliente_id)||null; copy.perfiles=t.perfiles.filter(p=>p.id===row.vendedor_id).map(({nombre})=>({nombre}))[0] }
    if (table === 'devoluciones') copy.devolucion_items=t.devolucion_items.filter(i=>i.devolucion_id===row.id)
    if (table === 'garantias') { copy.historial=t.garantia_eventos.filter(e=>e.garantia_id===row.id); const item=t.factura_items.find(i=>i.id===row.factura_item_id); copy.factura=item?t.facturas.find(f=>f.id===item.factura_id):null; copy.productos=t.productos.find(p=>p.id===row.producto_id); copy.clientes=t.clientes.find(c=>c.id===row.cliente_id); copy.unidades_serializadas=t.unidades_serializadas.find(u=>u.id===row.unidad_id); copy.reclamos_garantia=t.reclamos_garantia.filter(r=>r.garantia_id===row.id) }
    if (table === 'perfiles') delete copy.password_hash
    return copy
  }
  function rows(state, table) {
    let data
    if(table==='productos_venta') data=state.tables.productos.filter(p=>p.activo)
    else if(table==='stock_bajo') data=state.tables.productos.filter(p=>p.activo && p.stock<=p.stock_min)
    else if(table==='compras_saldo') data=state.tables.compras.map(c=>({...c,saldo:c.total-sum(state.tables.pagos_proveedor.filter(p=>p.compra_id===c.id),'monto')}))
    else if(table==='facturas_netas') data=state.tables.facturas.map(f=>net(state,f))
    else data=state.tables[table] || fail(`Módulo demo desconocido: ${table}`)
    const profile=user(state)
    if(profile.rol!=='admin') { if(table==='facturas'||table==='facturas_netas') data=data.filter(f=>f.vendedor_id===profile.id); if(table==='perfiles')data=data.filter(p=>p.id===profile.id); if(['movimientos','compras_saldo','actividad'].includes(table) && !state.tables.perfil_permisos.some(p=>p.perfil_id===profile.id && p.permiso==='ver_finanzas')) data=table==='actividad'?data.filter(a=>a.perfil_id===profile.id):[] }
    return data.map(row=>hydrate(state,table,row))
  }
  function validate(state, table, data, id) {
    if(table==='productos') { if(!data.codigo?.trim()||!data.nombre?.trim())fail('Código y nombre son obligatorios.'); for(const key of ['codigo','codigo_barras'])if(data[key]&&state.tables.productos.some(p=>p.id!==id&&p[key]===data[key]))fail(`duplicate key ${key}`); for(const key of ['precio_compra','precio_venta','stock_min','garantia_meses'])data[key]=amount(data[key]??0,key); if(!Number.isInteger(data.stock_min)||!Number.isInteger(data.garantia_meses))fail('Stock mínimo y garantía deben ser enteros'); if(data.proveedor_id)find(state,'proveedores',data.proveedor_id); if(data.categoria_id)find(state,'categorias',data.categoria_id) }
    if(table==='clientes') { if(!data.nombre?.trim())fail('El nombre es obligatorio.'); if(data.documento&&state.tables.clientes.some(c=>c.id!==id&&c.documento===data.documento))fail('duplicate key documento') }
    if (['clientes','proveedores','perfiles'].includes(table) && data.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.correo)) fail('Escribe un correo válido.')
    if (table === 'perfiles') {
      if (!data.nombre?.trim() || !['admin','vendedor'].includes(data.rol)) fail('Nombre y rol válidos son obligatorios.')
      if ((!data.activo || data.rol !== 'admin') && state.tables.perfiles.find(p => p.id === id)?.rol === 'admin' && !state.tables.perfiles.some(p => p.id !== id && p.rol === 'admin' && p.activo)) fail('Debe quedar al menos un administrador activo.')
    }
    if(table==='proveedores'&&!data.nombre?.trim())fail('El nombre del proveedor es obligatorio.')
    if(table==='movimientos') { if(!data.categoria?.trim()||!['gasto','ingreso'].includes(data.tipo)||!(amount(data.monto)>0))fail('Categoría, tipo y monto válido son obligatorios.'); if(!/^\d{4}-\d{2}-\d{2}$/.test(data.fecha||''))fail('La fecha es obligatoria.') }
    if(table==='perfiles'&&data.comision_pct!=null&&(amount(data.comision_pct)>100))fail('Comisión fuera de rango')
  }
  class Query {
    constructor(table) { this.table=table; this.filters=[]; this.sort=[]; this.operation='read'; this.returning=true }
    select() { this.returning=true; return this }
    eq(key,value) { this.filters.push(r=>String(r[key])===String(value)); return this }
    in(key,values) { this.filters.push(r=>values.some(v=>String(v)===String(r[key]))); return this }
    gt(key,value) { this.filters.push(r=>r[key]>value); return this }
    gte(key,value) { this.filters.push(r=>r[key]>=value); return this }
    lte(key,value) { this.filters.push(r=>r[key]<=value); return this }
    or(expression) { const terms=expression.split(',').map(term=>{const [key,op,...rest]=term.split('.');const value=rest.join('.');return r=>op==='eq'?String(r[key])===value:op==='ilike'?String(r[key]||'').toLocaleLowerCase('es').includes(value.replaceAll('%','').toLocaleLowerCase('es')):false}); this.filters.push(r=>terms.some(term=>term(r))); return this }
    order(key,{ascending=true}={}) { this.sort.push({key,ascending}); return this }
    limit(count) { this.count=count; return this }
    single() { this.one=true; this.mustExist=true; return this }
    maybeSingle() { this.one=true; return this }
    insert(data) { this.operation='insert';this.payload=data;this.returning=false;return this }
    update(data) { this.operation='update';this.payload=data;this.returning=false;return this }
    delete() { this.operation='delete';this.returning=false;return this }
    execute() {
      const action=(state)=>{
        authenticated(state)
        let data=rows(state,this.table).filter(r=>this.filters.every(test=>test(r)))
        if(this.operation!=='read') {
          permit(state,requiredPermission[this.table]||'admin')
          const table=state.tables[this.table] || fail('La vista es de solo lectura')
          if(this.operation==='insert') { data=[]; for(const payload of Array.isArray(this.payload)?this.payload:[this.payload]) { const value={...payload}; if(this.table==='productos')Object.assign(value,{stock:0,activo:true,maneja_serial:!!value.maneja_serial}); if(['proveedores','clientes'].includes(this.table))value.activo=true; if(this.table==='reclamos_garantia'){find(state,'garantias',value.garantia_id);Object.assign(value,{estado:'abierto',fecha:now().toISOString()})} validate(state,this.table,value); const row=add(state,this.table,value); data.push(hydrate(state,this.table,row)); activity(state,'Registro creado',this.table,row.id) } }
          if(this.operation==='update'){for(const match of data){const record=find(state,this.table,match.id),value={...record,...this.payload}; if(this.table==='productos'&&this.payload.stock!==undefined)fail('El stock cambia mediante ingresos o ajustes'); validate(state,this.table,value,record.id);Object.assign(record,value);activity(state,'Registro actualizado',this.table,record.id)}data=data.map(match=>hydrate(state,this.table,find(state,this.table,match.id)))}
          if(this.operation==='delete') { if (['facturas','factura_items','compras','compra_items','movimientos_inventario','garantias','devoluciones','devolucion_items','clientes','proveedores'].includes(this.table)) fail('Conserva el historial: desactiva el registro o usa su operación de reverso.'); if(this.table==='movimientos'&&data.some(r=>r.origen))fail('Los movimientos automáticos se revierten desde su factura o compra.'); if(this.table==='productos'&&data.some(p=>state.tables.factura_items.some(i=>i.producto_id===p.id)))fail('Desactiva el producto para conservar su historial'); state.tables[this.table]=table.filter(r=>!data.some(d=>d.id===r.id)); activity(state,'Registro eliminado',this.table,data[0]?.id||'') }
          data=clone(data)
        }
        data.sort((a,b)=>{for(const {key,ascending} of this.sort){const order=typeof a[key]==='string'?a[key].localeCompare(b[key]||'','es'):Number(a[key]||0)-Number(b[key]||0);if(order)return ascending?order:-order}return 0})
        if(this.count!==undefined)data=data.slice(0,this.count)
        if(this.mustExist&&data.length!==1)fail('No se encontró un único registro')
        return !this.returning?null:this.one?data[0]||null:data
      }
      return this.operation==='read'?action(read()):transaction(action)
    }
    then(resolve,reject) { this.promise ||= safe(()=>this.execute()); return this.promise.then(resolve,reject) }
  }
  function sell(state, args) {
    const actor=permit(state,'vender'), items=args.p_items
    const previous = args.p_request_id && state.tables.facturas.find(f => f.request_id === args.p_request_id && f.creado_por === actor.id)
    if (previous) return previous.id
    const profile = args.p_vendedor_id ? (permit(state,'admin'),find(state,'perfiles',args.p_vendedor_id)) : actor
    if (!profile.activo) fail('El vendedor está desactivado.')
    if(!Array.isArray(items)||!items.length)fail('Agrega al menos un producto.')
    if(args.p_cliente_id&&!find(state,'clientes',args.p_cliente_id).activo)fail('El cliente está desactivado.')
    if(!['efectivo','tarjeta','transferencia'].includes(args.p_metodo_pago))fail('Método de pago inválido')
    const discount=amount(args.p_descuento||0,'Descuento'); if(discount)permit(state,'editar_precios')
    const prepared=items.map(item=>{const p=find(state,'productos',item.producto_id),qty=quantity(item.cantidad),lineDiscount=amount(item.descuento||0);if(!p.activo)fail('Producto inactivo');if(lineDiscount)permit(state,'editar_precios');if(lineDiscount>qty*p.precio_venta)fail('Descuento de línea inválido');let unit=null;if(p.maneja_serial){unit=find(state,'unidades_serializadas',item.unidad_id);if(qty!==1||unit.producto_id!==p.id||unit.estado!=='disponible')fail('Serial no disponible')}return {p,qty,lineDiscount,unit}})
    const seen=new Set();for(const item of prepared){if(item.unit){if(seen.has(item.unit.id))fail('Serial repetido en la venta');seen.add(item.unit.id)}const totalQty=prepared.filter(i=>i.p.id===item.p.id).reduce((n,i)=>n+i.qty,0);if(totalQty>item.p.stock)fail(`Stock insuficiente para ${item.p.nombre}`)}
    const subtotal=prepared.reduce((n,i)=>n+i.qty*i.p.precio_venta,0), totalDiscount=discount+sum(prepared,'lineDiscount')
    if(totalDiscount>subtotal)fail('El descuento no puede superar el subtotal')
    const settings=state.tables.tienda[0], date=demoDate(now())
    const invoice=add(state,'facturas',{prefijo:settings.factura_prefijo,numero:++settings.ultimo_numero_factura,cliente_id:args.p_cliente_id||null,vendedor_id:profile.id,creado_por:actor.id,request_id:args.p_request_id||null,subtotal,descuento:totalDiscount,total:subtotal-totalDiscount,costo_total:prepared.reduce((n,i)=>n+i.qty*i.p.precio_compra,0),estado:'emitida',fecha:now().toISOString(),metodo_pago:args.p_metodo_pago,notas:args.p_notas,comision_pct:profile.comision_pct,comision:profile.comision_pct==null?null:Math.round((subtotal-totalDiscount)*profile.comision_pct/100)})
    for(const {p,qty,lineDiscount,unit} of prepared){const item=add(state,'factura_items',{factura_id:invoice.id,producto_id:p.id,unidad_id:unit?.id||null,nombre:p.nombre,cantidad:qty,precio_unitario:p.precio_venta,costo_unitario:p.precio_compra,descuento:lineDiscount});if(unit){unit.estado='vendida';unit.factura_item_id=item.id}move(state,p,-qty,'salida_venta','factura',invoice.id);if(p.garantia_meses){const end=new Date(date+'T12:00:00Z');end.setUTCMonth(end.getUTCMonth()+p.garantia_meses);add(state,'garantias',{factura_item_id:item.id,producto_id:p.id,cliente_id:invoice.cliente_id,unidad_id:unit?.id||null,inicio:date,fin:demoDate(end),estado:'vigente'})}}
    ledger(state,'ingreso','Ventas',invoice.total,{origen:'venta',factura_id:invoice.id,descripcion:`Factura ${invoice.prefijo}-${invoice.numero}`})
    activity(state,'Nueva venta realizada','factura',invoice.id,{numero:`${invoice.prefijo}-${invoice.numero}`,total:invoice.total})
    return invoice.id
  }
  function purchase(state,args){
    permit(state,'registrar_compras');if(!find(state,'proveedores',args.p_proveedor_id).activo)fail('El proveedor está desactivado.')
    const previous=args.p_request_id&&state.tables.compras.find(c=>c.request_id===args.p_request_id&&c.creado_por===state.session.user.id);if(previous)return previous.id
    if(args.p_fecha&&!/^\d{4}-\d{2}-\d{2}$/.test(args.p_fecha))fail('La fecha de compra no es válida.')
    if(!args.p_items?.length)fail('Agrega al menos un producto');if(!['contado','credito'].includes(args.p_forma_pago))fail('Forma de pago inválida');if(args.p_forma_pago==='credito'&&!args.p_vence_el)fail('Indica el vencimiento')
    const serials=args.p_seriales||[], seen=new Set()
    for(const entry of serials){const serial=entry.serial?.trim();if(!serial||seen.has(serial)||state.tables.unidades_serializadas.some(u=>u.serial===serial))fail('duplicate key serial');seen.add(serial)}
    const seenProducts=new Set();const entries=args.p_items.map(item=>{const p=find(state,'productos',item.producto_id),count=quantity(item.cantidad),cost=amount(item.costo_unitario);if(seenProducts.has(p.id))fail('Producto repetido en la compra');seenProducts.add(p.id);if(!p.activo)fail('Producto inactivo');const units=serials.filter(s=>s.producto_id===p.id);if(p.maneja_serial&&units.length!==count)fail(`Escribe ${count} seriales para ${p.nombre}`);if(!p.maneja_serial&&units.length)fail('El producto no usa seriales');return {p,count,cost,units}})
    if(serials.some(s=>!seenProducts.has(s.producto_id)))fail('Serial de un producto ajeno a la compra')
    const c=add(state,'compras',{proveedor_id:args.p_proveedor_id,numero_documento:args.p_numero_documento,forma_pago:args.p_forma_pago,vence_el:args.p_vence_el,estado:'recibida',fecha:args.p_fecha||demoDate(now()),notas:args.p_notas||null,request_id:args.p_request_id||null,total:entries.reduce((n,i)=>n+i.count*i.cost,0),creado_por:state.session.user.id})
    for(const {p,count,cost,units} of entries){const item=add(state,'compra_items',{compra_id:c.id,producto_id:p.id,cantidad:count,costo_unitario:cost});p.precio_compra=cost;p.proveedor_id=args.p_proveedor_id;move(state,p,count,'entrada_compra','compra',c.id,cost);for(const u of units)add(state,'unidades_serializadas',{producto_id:p.id,serial:u.serial.trim(),estado:'disponible',compra_item_id:item.id})}
    if(c.forma_pago==='contado'&&c.total){add(state,'pagos_proveedor',{compra_id:c.id,monto:c.total,metodo_pago:args.p_metodo_pago,fecha:demoDate(now())});ledger(state,'gasto','Compra de mercancía',c.total,{origen:'compra',compra_id:c.id})}
    activity(state,'Ingreso de mercancía','compra',c.id,{proveedor:find(state,'proveedores',c.proveedor_id).nombre,total:c.total});return c.id
  }
  function refund(state,args){
    permit(state,'hacer_devoluciones');const f=find(state,'facturas',args.p_factura_id)
    if(f.estado!=='emitida'||!args.p_motivo?.trim()||!args.p_items?.length)fail('Factura emitida, productos y motivo son obligatorios')
    const invoiceItems=state.tables.factura_items.filter(i=>i.factura_id===f.id),base=invoiceItems.reduce((n,i)=>n+i.precio_unitario*i.cantidad-i.descuento,0),lineTotals=new Map();let accumulated=0,allocated=0
    for(const i of invoiceItems){accumulated+=i.precio_unitario*i.cantidad-i.descuento;const target=base?Math.round(accumulated*f.total/base):0;lineTotals.set(i.id,target-allocated);allocated=target}
    const seen=new Set();const prepared=args.p_items.map(entry=>{const i=find(state,'factura_items',entry.factura_item_id),count=quantity(entry.cantidad);if(i.factura_id!==f.id||seen.has(i.id))fail('Producto inválido o repetido');seen.add(i.id);const previous=state.tables.devolucion_items.filter(d=>d.factura_item_id===i.id),returned=sum(previous,'cantidad');if(count>i.cantidad-returned)fail('La devolución supera la cantidad disponible');return {i,count,monto:Math.round(lineTotals.get(i.id)*(returned+count)/i.cantidad)-sum(previous,'monto')}})
    const previousRefunds=state.tables.devoluciones.filter(d=>d.factura_id===f.id),value=sum(prepared,'monto'),commission=Math.round((sum(previousRefunds,'total_devuelto')+value)*(f.comision_pct||0)/100)-sum(previousRefunds,'comision_revertida'),d=add(state,'devoluciones',{factura_id:f.id,motivo:args.p_motivo,reintegra_stock:!!args.p_reintegra_stock,total_devuelto:value,comision_revertida:commission,creado_por:state.session.user.id,fecha:now().toISOString()})
    for(const {i,count,monto} of prepared){add(state,'devolucion_items',{devolucion_id:d.id,factura_item_id:i.id,cantidad:count,monto});if(d.reintegra_stock){move(state,find(state,'productos',i.producto_id),count,'devolucion_cliente','devolucion',d.id,i.costo_unitario);if(i.unidad_id){const u=find(state,'unidades_serializadas',i.unidad_id);u.estado='disponible';u.factura_item_id=null}}else{move(state,find(state,'productos',i.producto_id),0,'devolucion_danada','devolucion',d.id,i.costo_unitario,d.motivo);if(i.unidad_id)find(state,'unidades_serializadas',i.unidad_id).estado='defectuosa'}state.tables.garantias.filter(g=>g.factura_item_id===i.id).forEach(g=>{if(sum(state.tables.devolucion_items.filter(di=>di.factura_item_id===i.id),'cantidad')>=i.cantidad)g.estado='resuelta';warrantyEvent(state,g,g.estado,'Devolución: '+d.motivo)})}
    ledger(state,'gasto','Devoluciones',value,{origen:'devolucion',factura_id:f.id,devolucion_id:d.id});activity(state,'Devolución registrada','factura',f.id,{total:value});return d.id
  }
  function cancel(state,args){
    permit(state,'anular_facturas');const f=find(state,'facturas',args.p_factura_id)
    if(f.estado==='anulada'||!args.p_motivo?.trim())fail('La factura ya está anulada o falta el motivo')
    if(f.estado==='emitida')for(const i of state.tables.factura_items.filter(i=>i.factura_id===f.id)){const refunded=sum(state.tables.devolucion_items.filter(d=>d.factura_item_id===i.id),'cantidad'),remaining=i.cantidad-refunded;if(remaining){move(state,find(state,'productos',i.producto_id),remaining,'devolucion_cliente','anulacion',f.id,i.costo_unitario);if(i.unidad_id){const u=find(state,'unidades_serializadas',i.unidad_id);if(u.factura_item_id===i.id){u.estado='disponible';u.factura_item_id=null}}}state.tables.garantias.filter(g=>g.factura_item_id===i.id).forEach(g=>{g.estado='resuelta'})}
    const remaining=net(state,f).total_neto;if(f.estado==='emitida')ledger(state,'gasto','Anulación de venta',remaining,{origen:'anulacion',factura_id:f.id})
    Object.assign(f,{estado:'anulada',motivo_anulacion:args.p_motivo,anulada_por:state.session.user.id,anulada_en:now().toISOString()});activity(state,'Factura anulada','factura',f.id);return null
  }
  function employeeSales(state,args){
    authenticated(state);const admin=user(state).rol==='admin';const invoices=state.tables.facturas.filter(f=>f.estado==='emitida'&&demoDate(new Date(f.fecha))>=args.p_desde&&demoDate(new Date(f.fecha))<=args.p_hasta&&(admin||f.vendedor_id===state.session.user.id)).map(f=>net(state,f))
    return state.tables.perfiles.filter(p=>admin||p.id===state.session.user.id).map(p=>{const f=invoices.filter(f=>f.vendedor_id===p.id);return {vendedor_id:p.id,nombre:p.nombre,facturas:f.length,total_vendido:sum(f,'total_neto'),comision:sum(f,'comision_neta')}}).filter(p=>p.facturas).sort((a,b)=>b.total_vendido-a.total_vendido)
  }
  function dashboard(state,args={}){
    permit(state,'ver_finanzas');const today=demoDate(now()),month=today.slice(0,7),within=date=>args.p_desde?date>=args.p_desde&&date<=args.p_hasta:date.startsWith(month),f=state.tables.facturas.filter(f=>f.estado==='emitida'&&within(demoDate(new Date(f.fecha)))).map(f=>net(state,f)),day=f.filter(f=>demoDate(new Date(f.fecha))===today),manual=state.tables.movimientos.filter(m=>within(m.fecha)&&!m.origen),income=sum(manual.filter(m=>m.tipo==='ingreso'),'monto'),expenses=sum(manual.filter(m=>m.tipo==='gasto'),'monto')
    const lostCost=state.tables.devoluciones.filter(d=>!d.reintegra_stock&&find(state,'facturas',d.factura_id).estado==='anulada'&&within(demoDate(new Date(d.fecha)))).reduce((total,d)=>total+state.tables.devolucion_items.filter(i=>i.devolucion_id===d.id).reduce((n,i)=>n+i.cantidad*find(state,'factura_items',i.factura_item_id).costo_unitario,0),0)
    return [{ventas_hoy:sum(day,'total_neto'),facturas_hoy:day.length,ventas_mes:sum(f,'total_neto'),facturas_mes:f.length,ingresos_mes:sum(f,'total_neto')+income,otros_ingresos_mes:income,gastos_mes:expenses,utilidad_mes:sum(f,'total_neto')-sum(f,'costo_neto')+income-expenses-lostCost,valor_inventario:state.tables.productos.filter(p=>p.activo).reduce((n,p)=>n+p.stock*p.precio_compra,0),productos_stock_bajo:state.tables.productos.filter(p=>p.activo&&p.stock<=p.stock_min).length}]
  }
  function warrantyEvent(state,g,estado,nota) {
    add(state,'garantia_eventos',{garantia_id:g.id,estado,nota,fecha:now().toISOString(),creado_por:state.session.user.id})
  }
  function rpcAction(state,name,args){
    if(name==='leer_notificacion_demo'){authenticated(state);if(!state.tables.notificaciones_leidas.some(n=>n.perfil_id===state.session.user.id&&n.notificacion_id===args.id))add(state,'notificaciones_leidas',{perfil_id:state.session.user.id,notificacion_id:args.id});return null}
    if (name === 'actualizar_perfil_demo') { authenticated(state); const p=user(state); if(!args.nombre?.trim())fail('El nombre es obligatorio.'); p.nombre=args.nombre.trim(); p.telefono=args.telefono?.trim()||null; activity(state,'Perfil actualizado','perfil',p.id); return hydrate(state,'perfiles',p) }
    if (name === 'desactivar_registro_demo') { const table=args.tabla; if(!['productos','clientes','proveedores'].includes(table))fail('Registro inválido.'); permit(state,requiredPermission[table]); const r=find(state,table,args.id); r.activo=!args.desactivar; activity(state,r.activo?'Registro activado':'Registro desactivado',table,r.id); return hydrate(state,table,r) }
    if (name === 'actualizar_garantia_demo') { permit(state,'editar_inventario'); const g=find(state,'garantias',args.id); if(!['vigente','en_reclamo','resuelta','rechazada','vencida'].includes(args.estado))fail('Estado de garantía inválido.'); if(!args.nota?.trim())fail('Escribe una nota para el historial.'); if(g.fin<demoDate(now())&&args.estado==='vigente')fail('La cobertura ya venció.'); g.estado=args.estado; g.descripcion=args.descripcion??g.descripcion; warrantyEvent(state,g,args.estado,args.nota.trim()); activity(state,'Garantía actualizada','garantia',g.id); return g.id }
    if (name === 'guardar_empleado_demo') { permit(state,'admin'); const p=find(state,'perfiles',args.id),value={...p,...args.datos}; validate(state,'perfiles',value,p.id); Object.assign(p,value); state.tables.perfil_permisos=state.tables.perfil_permisos.filter(r=>r.perfil_id!==p.id); for(const permiso of args.permisos||[])add(state,'perfil_permisos',{perfil_id:p.id,permiso}); activity(state,'Empleado actualizado','perfil',p.id); return hydrate(state,'perfiles',p) }
    if (name === 'ajustar_stock_fisico_demo') { permit(state,'editar_inventario'); const p=find(state,'productos',args.id),target=amount(args.stock,'Stock físico'); if(!Number.isInteger(target)||!args.motivo?.trim())fail('Stock entero y motivo son obligatorios.'); if(p.maneja_serial)fail('Para equipos serializados registra cada unidad mediante compras o devoluciones.'); const delta=target-p.stock; if(!delta)fail('El stock físico coincide con el sistema.'); move(state,p,delta,delta>0?'ajuste_entrada':'ajuste_salida','ajuste',p.id,p.precio_compra,args.motivo.trim());activity(state,'Stock físico conciliado','producto',p.id,{stock:target});return p.id }

    if(name==='abrir_reclamo_demo'){permit(state,'editar_inventario');const g=find(state,'garantias',args.id);if(g.estado!=='vigente'||g.fin<demoDate(now())||!args.descripcion?.trim())fail('Garantía vigente y descripción son obligatorias.');const r=add(state,'reclamos_garantia',{garantia_id:g.id,descripcion:args.descripcion.trim(),estado:'abierto',fecha:now().toISOString(),creado_por:state.session.user.id});g.estado='en_reclamo';warrantyEvent(state,g,'en_reclamo',r.descripcion);activity(state,'Reclamo registrado','garantia',g.id);return r.id}
    if(name==='resolver_reclamo_demo'){permit(state,'editar_inventario');const r=find(state,'reclamos_garantia',args.id),g=find(state,'garantias',r.garantia_id);if(!['abierto','en_revision','aprobado'].includes(r.estado)||!['en_revision','aprobado','resuelto','rechazado'].includes(args.estado))fail('El reclamo ya terminó o el estado es inválido.');r.estado=args.estado;r.resolucion=args.nota?.trim()||({'resuelto':'Equipo revisado y entregado','rechazado':'Fuera de cobertura'})[args.estado]||null;r.resuelto_en=['resuelto','rechazado'].includes(r.estado)?now().toISOString():null;g.estado=r.estado==='rechazado'?'rechazada':r.estado==='resuelto'?'resuelta':'en_reclamo';warrantyEvent(state,g,g.estado,r.resolucion||'Estado del reclamo: '+r.estado);activity(state,'Reclamo actualizado','garantia',g.id);return r.id}
    if(name==='crear_garantia_demo'){permit(state,'editar_inventario');const i=find(state,'factura_items',args.factura_item_id),f=find(state,'facturas',i.factura_id),p=find(state,'productos',i.producto_id);if(f.estado!=='emitida'||state.tables.garantias.some(g=>g.factura_item_id===i.id))fail('El producto ya tiene garantía o la factura no está vigente');if(!p.garantia_meses&&!args.fin)fail('Indica el vencimiento de la cobertura.');const inicio=args.inicio||demoDate(new Date(f.fecha)),end=new Date(inicio+'T12:00:00Z');end.setUTCMonth(end.getUTCMonth()+(p.garantia_meses||12));const fin=args.fin||demoDate(end);if(!/^\d{4}-\d{2}-\d{2}$/.test(inicio)||!/^\d{4}-\d{2}-\d{2}$/.test(fin)||fin<inicio)fail('Fechas de cobertura inválidas.');const g=add(state,'garantias',{factura_item_id:i.id,producto_id:p.id,cliente_id:f.cliente_id,unidad_id:i.unidad_id,inicio,fin,estado:'vigente',motivo:args.motivo||null,descripcion:args.descripcion||null});warrantyEvent(state,g,'vigente','Cobertura registrada');activity(state,'Garantía registrada','garantia',g.id);return g.id}
    if(name==='emitir_factura')return sell(state,args)
    if(name==='registrar_compra')return purchase(state,args)
    if(name==='registrar_devolucion')return refund(state,args)
    if(name==='anular_factura')return cancel(state,args)
    if(name==='registrar_pago_proveedor'){permit(state,'registrar_compras');const c=find(state,'compras',args.p_compra_id),n=amount(args.p_monto);if(n<=0||n>c.total-sum(state.tables.pagos_proveedor.filter(p=>p.compra_id===c.id),'monto'))fail('El pago supera el saldo o es inválido');const p=add(state,'pagos_proveedor',{compra_id:c.id,monto:n,metodo_pago:args.p_metodo_pago,fecha:demoDate(now())});ledger(state,'gasto','Pago a proveedor',n,{origen:'compra',compra_id:c.id});activity(state,'Pago a proveedor','compra',c.id,{monto:n});return p.id}
    if(name==='ajustar_inventario'){permit(state,'editar_inventario');const p=find(state,'productos',args.p_producto_id);if(p.maneja_serial)fail('Los equipos serializados se ingresan por compra');if(!args.p_motivo?.trim())fail('Escribe el motivo');if(!['ajuste_entrada','ajuste_salida','devolucion_proveedor'].includes(args.p_tipo))fail('Tipo de ajuste inválido');const count=quantity(args.p_cantidad);move(state,p,args.p_tipo==='ajuste_entrada'?count:-count,args.p_tipo,'ajuste',p.id,p.precio_compra,args.p_motivo.trim());activity(state,'Inventario ajustado','producto',p.id);return p.id}
    if(name==='crear_producto_demo'){permit(state,'editar_inventario');const data={...args.producto,stock:0,activo:true};validate(state,'productos',data);const p=add(state,'productos',data),count=amount(args.stock||0,'Stock');if(!Number.isInteger(count))fail('Stock debe ser entero');const serials=(args.seriales||[]).map(s=>s.trim());if(p.maneja_serial&&(serials.length!==count||new Set(serials).size!==count||serials.some(s=>!s||state.tables.unidades_serializadas.some(u=>u.serial===s))))fail('Debes registrar un serial único por unidad');if(count)move(state,p,count,'ajuste_entrada','producto',p.id);if(p.maneja_serial)for(const serial of serials)add(state,'unidades_serializadas',{producto_id:p.id,serial,estado:'disponible'});activity(state,'Producto creado','producto',p.id);return hydrate(state,'productos',p)}
    fail(`Operación demo no implementada: ${name}`)
  }
  const hash = password => hashDemoPassword(password, { location, crypto })
  function newProfileId(state) {
    let number = 1
    while (state.tables.perfiles.some(p => p.id === `demo-employee-${number}`)) number++
    return `demo-employee-${number}`
  }
  const emit=(event,session)=>{for(const callback of listeners)queueMicrotask(()=>callback(event,clone(session)))}
  return {
    from:(table)=>new Query(table),
    rpc:(name,args={})=>safe(()=>name==='resumen_dashboard'?dashboard(read(),args):name==='ventas_por_empleado'?employeeSales(read(),args):transaction(state=>rpcAction(state,name,args))),
    auth:{
      getSession:async()=>{const result=await safe(()=>read().session);return {data:{session:result.data},error:result.error}},
      onAuthStateChange:(callback)=>{listeners.add(callback);return {data:{subscription:{unsubscribe:()=>listeners.delete(callback)}}}},
      signInWithPassword:async({email,password})=>{const result=await safe(async()=>{const digest=await hash(password);return transaction(state=>{const p=state.tables.perfiles.find(p=>p.correo===email.toLowerCase().trim()&&p.password_hash===digest);if(!p)fail('Invalid login credentials');if(!p.activo)fail('Este usuario demo está desactivado');state.session={user:{id:p.id,email:p.correo},access_token:'local-demo-only'};return {session:state.session,user:state.session.user}})});if(!result.error)emit('SIGNED_IN',result.data.session);return result},
      signOut:async()=>{const result=await safe(()=>transaction(state=>{state.session=null}));if(!result.error)emit('SIGNED_OUT',null);return result},
    },
    functions:{invoke:async(name,{body})=>safe(async()=>{if(name!=='crear-empleado')fail('Función demo desconocida');const password_hash=await hash(body.password);return transaction(state=>{permit(state,'admin');if(!body.nombre?.trim()||!body.correo?.trim()||body.password.length<8)fail('Nombre, correo y contraseña de al menos 8 caracteres son obligatorios');if(state.tables.perfiles.some(p=>p.correo===body.correo))fail('duplicate key correo');if(body.comision_pct!=null)amount(body.comision_pct);const {password,permisos,...rest}=body;const p=add(state,'perfiles',{...rest,id:newProfileId(state),password_hash,activo:true});validate(state,'perfiles',p,p.id);for(const permiso of permisos||[])add(state,'perfil_permisos',{perfil_id:p.id,permiso});activity(state,'Empleado creado','perfil',p.id);return {id:p.id}})})},
    demo:{snapshot:()=>clone(read()),reset:()=>{exigirEntornoDemoPermitido(location);permit(read(),'admin');storage.setItem(DEMO_KEY,JSON.stringify(createDemoSeed(now())));emit('SIGNED_OUT',null)}},
  }
}
