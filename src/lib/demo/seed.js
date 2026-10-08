export const DEMO_KEY = 'angie-tech:demo:v1'
export const DEMO_PASSWORD = 'AngieDemo123!'
const PASSWORD_HASH = 'ccff3fcfe4139142e77882039627d1e359fa111ea8ae3d0c94dbdee335faf236'
export const demoDate = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(date)
export const DEMO_ACCOUNTS = [
  ['demo-admin', 'Valentina Gómez', 'admin@angietech.demo', 'admin', null],
  ['demo-ana', 'Ana López', 'ana@angietech.demo', 'vendedor', 3],
  ['demo-carlos', 'Carlos Ruiz', 'carlos@angietech.demo', 'vendedor', 2.5],
  ['demo-maria', 'María Torres', 'maria@angietech.demo', 'vendedor', 3],
  ['demo-juan', 'Juan Pérez', 'juan@angietech.demo', 'vendedor', 2],
]
export function createDemoSeed(now = new Date()) {
  const today = demoDate(now), month = today.slice(0, 7), day = Number(today.slice(8))
  const when = (i) => {
    const historical = `${month}-${String(Math.max(1, day - Math.floor(i / 3))).padStart(2, '0')}T${String(15 + i % 5).padStart(2, '0')}:20:00Z`
    // Keep historical dates where valid; examples on the current day must
    // precede real actions, even at midnight or on the first of the month.
    return new Date(Math.min(Date.parse(historical), now.getTime() - (i + 1) * 60000)).toISOString()
  }
  const rows = [
    ['IP15P-128', 'iPhone 15 Pro 128GB', 1, 'Apple', 3350000, 4299900, 3, 5, true],
    ['SGS24-256', 'Samsung Galaxy S24 256GB', 1, 'Samsung', 2700000, 3499900, 0, 3, true],
    ['RN13P-256', 'Xiaomi Redmi Note 13 Pro', 1, 'Xiaomi', 980000, 1399900, 8, 3, true],
    ['APP2-USBC', 'AirPods Pro 2 USB-C', 2, 'Apple', 720000, 999900, 12, 5, true],
    ['BUDS-FE', 'Galaxy Buds FE', 2, 'Samsung', 220000, 329900, 7, 3, false],
    ['AWS9-45', 'Apple Watch Series 9 45mm', 3, 'Apple', 1300000, 1899900, 4, 2, true],
    ['GW6-44', 'Galaxy Watch 6 44mm', 3, 'Samsung', 740000, 1099900, 2, 3, true],
    ['MBA-M2', 'MacBook Air M2 256GB', 4, 'Apple', 3800000, 4799900, 4, 2, true],
    ['LIS3-I5', 'Lenovo IdeaPad Slim 3 Core i5', 4, 'Lenovo', 1650000, 2299900, 6, 2, true],
    ['IPAD10-64', 'iPad 10ª generación 64GB', 5, 'Apple', 1500000, 2099900, 3, 3, true],
    ['ANK20K', 'Power Bank Anker 20.000mAh', 6, 'Anker', 125000, 199900, 10, 4, false],
    ['USBC20W', 'Cargador USB-C 20W', 6, 'Apple', 58000, 99900, 18, 6, false],
    ['LIGHT1M', 'Cable Lightning 1 metro', 6, 'Belkin', 24000, 49900, 2, 5, false],
    ['USBC2M', 'Cable USB-C trenzado 2 metros', 6, 'Anker', 19000, 39900, 25, 8, false],
    ['GLASS15', 'Protector de pantalla iPhone 15', 6, 'Spigen', 12000, 29900, 0, 8, false],
    ['MAGSAFE15', 'Case MagSafe iPhone 15 Pro', 6, 'Spigen', 38000, 79900, 14, 5, false],
    ['JBL-TUNE', 'Audífonos JBL Tune 520BT', 2, 'JBL', 145000, 229900, 9, 3, false],
    ['HUB7-USBC', 'Hub USB-C 7 en 1', 6, 'Ugreen', 105000, 169900, 5, 3, false],
  ]
  const t = Object.fromEntries(['perfiles','perfil_permisos','actividad','categorias','proveedores','productos','unidades_serializadas','movimientos_inventario','compras','compra_items','pagos_proveedor','clientes','facturas','factura_items','factura_envios','devoluciones','devolucion_items','garantias','reclamos_garantia','movimientos','tienda'].map((name) => [name, []]))
  const add = (table, data) => { const row = { id: t[table].length + 1, ...data }; t[table].push(row); return row }
  t.perfiles = DEMO_ACCOUNTS.map(([id, nombre, correo, rol, comision_pct], i) => ({ id, nombre, correo, rol, comision_pct, activo: true, telefono: `300000010${i}`, password_hash: PASSWORD_HASH }))
  for (const p of t.perfiles.filter((p) => p.rol !== 'admin')) for (const permiso of ['vender','ver_inventario','crear_clientes']) add('perfil_permisos', { perfil_id: p.id, permiso })
  for (const nombre of ['Smartphones','Audio','Wearables','Computadores','Tablets','Accesorios']) add('categorias', { nombre, activa: true })
  for (const [i, nombre] of ['Distribuciones Mobile SAS','Tech Import Colombia','Smart Supply Colombia','Accesorios Premium SAS','Digital World Mayoristas'].entries()) add('proveedores', { nombre, nit: `90000010${i}-0`, contacto: ['Diana Mejía','Andrés Rojas','Camila Vega','Santiago Gil','Laura Jiménez'][i], telefono: `300000020${i}`, correo: `compras${i}@mayorista.example.test`, ciudad: ['Bogotá','Medellín','Cali','Bogotá','Barranquilla'][i], direccion: 'Dirección ficticia · Colombia', activo: true })
  for (const [i, nombre] of ['Juan Carlos Ramírez','Camila Restrepo','Sofía Martínez','Andrés Felipe Rojas','Daniela Gómez','Mateo Álvarez','Valeria Herrera','Nicolás Castro','Isabella Moreno','Sebastián Vargas'].entries()) add('clientes', { nombre, tipo_documento: 'CC', documento: `100000010${i}`, telefono: `300000030${i}`, correo: `cliente${i}@example.test`, ciudad: ['Bogotá','Medellín','Cali'][i % 3], direccion: 'Dirección ficticia · ' + ['Bogotá','Medellín','Cali'][i % 3] })
  rows.forEach(([codigo,nombre,categoria_id,marca,precio_compra,precio_venta,stock,stock_min,maneja_serial], i) => add('productos', { codigo,nombre,categoria_id,marca,precio_compra,precio_venta,stock,stock_min,maneja_serial,codigo_barras:`7700000000${String(i+1).padStart(3,'0')}`, proveedor_id: i % 5 + 1, garantia_meses: maneja_serial ? 12 : 6, activo: true }))
  for (let i = 0; i < 16; i++) {
    const p = t.productos[[0,7,3,8,2,5,9,4,10,11,16,17,0,3,6,8][i]], profile = t.perfiles[1 + i % 4]
    const estado = i === 12 || i === 13 ? 'anulada' : i === 14 || i === 15 ? 'pendiente' : 'emitida'
    const f = add('facturas', { prefijo:'FV',numero:1243+i,cliente_id:i%10+1,vendedor_id:profile.id,subtotal:p.precio_venta,descuento:0,total:p.precio_venta,costo_total:p.precio_compra,comision_pct:profile.comision_pct,comision:Math.round(p.precio_venta*profile.comision_pct/100),estado,fecha:when(i),metodo_pago:['efectivo','tarjeta','transferencia'][i%3], motivo_anulacion: estado === 'anulada' ? 'Cambio de referencia solicitado por el cliente' : null })
    const item = add('factura_items', { factura_id:f.id,producto_id:p.id,nombre:p.nombre,cantidad:1,precio_unitario:p.precio_venta,costo_unitario:p.precio_compra,descuento:0,unidad_id:null })
    if (p.maneja_serial && estado === 'emitida') item.unidad_id = add('unidades_serializadas', { producto_id:p.id,serial:`AT-VENDIDO-${String(i+1).padStart(5,'0')}`,estado:'vendida',factura_item_id:item.id }).id
    if (estado === 'emitida') {
      add('movimientos', { tipo:'ingreso',categoria:'Ventas',descripcion:`Factura FV-${f.numero}`,monto:f.total,fecha:demoDate(new Date(f.fecha)),origen:'venta',factura_id:f.id,registrado_por:profile.id })
      if(i < 8) add('garantias', { factura_item_id:item.id,producto_id:p.id,cliente_id:f.cliente_id,unidad_id:item.unidad_id,inicio:demoDate(new Date(f.fecha)),fin:`${Number(today.slice(0,4))+1}${today.slice(4)}`,estado: i === 0 ? 'en_reclamo' : 'vigente' })
    }
    add('actividad', { perfil_id:profile.id,accion:estado==='anulada'?'Factura anulada':estado==='pendiente'?'Factura pendiente':'Nueva venta realizada',entidad:'factura',entidad_id:f.id,detalle:{numero:`FV-${f.numero}`,total:f.total},fecha:f.fecha })
  }
  // Opening purchases + sales give an inventory ledger that reconciles with current stock.
  for (const provider of t.proveedores) {
    const products = t.productos.filter((p) => p.proveedor_id === provider.id)
    const c = add('compras', { proveedor_id:provider.id,numero_documento:`TC-2026-${101+provider.id}`,forma_pago:provider.id%2?'credito':'contado',vence_el:today,estado:'recibida',fecha:today,total:0,creado_por:'demo-admin' })
    for (const p of products) {
      const sold = t.factura_items.filter((i) => i.producto_id===p.id && t.facturas.find((f)=>f.id===i.factura_id).estado==='emitida')
      const initial = p.stock + sold.length
      if (initial) { const item=add('compra_items',{compra_id:c.id,producto_id:p.id,cantidad:initial,costo_unitario:p.precio_compra}); c.total+=initial*p.precio_compra; add('movimientos_inventario',{producto_id:p.id,tipo:'entrada_compra',cantidad:initial,stock_despues:initial,costo_unitario:p.precio_compra,referencia_tipo:'compra',referencia_id:c.id,fecha:when(20),creado_por:'demo-admin'}); let left=initial; for(const sale of sold) add('movimientos_inventario',{producto_id:p.id,tipo:'salida_venta',cantidad:-1,stock_despues:--left,costo_unitario:p.precio_compra,referencia_tipo:'factura',referencia_id:sale.factura_id,fecha:t.facturas.find(f=>f.id===sale.factura_id).fecha,creado_por:'demo-admin'}); for(let n=0;n<p.stock && p.maneja_serial;n++)add('unidades_serializadas',{producto_id:p.id,serial:`AT-${p.codigo}-${String(n+1).padStart(4,'0')}`,estado:'disponible',compra_item_id:item.id}) }
    }
    if(c.total) { const amount=c.forma_pago==='contado'?c.total:Math.round(c.total*.4); add('pagos_proveedor',{compra_id:c.id,monto:amount,metodo_pago:'transferencia',fecha:today}); add('movimientos',{tipo:'gasto',categoria:'Compra de mercancía',descripcion:provider.nombre,monto:amount,fecha:today,origen:'compra',compra_id:c.id,registrado_por:'demo-admin'}) }
  }
  for(const [categoria,monto] of [['Arriendo',1200000],['Servicios públicos',185000],['Publicidad',260000],['Transporte',85000],['Compra de insumos',95000]]) add('movimientos',{tipo:'gasto',categoria,monto,fecha:today,descripcion:'Operación de la tienda · dato ficticio',registrado_por:'demo-admin'})
  add('movimientos',{tipo:'ingreso',categoria:'Servicio técnico',monto:280000,fecha:today,descripcion:'Instalación y mantenimiento de equipos',registrado_por:'demo-admin'})
  add('reclamos_garantia',{garantia_id:1,descripcion:'Revisión de batería solicitada por el cliente',estado:'en_revision',creado_por:'demo-admin',fecha:when(2)})
  for(const [i,estado] of ['resuelto','rechazado'].entries()) { t.garantias[i+1].estado='resuelta'; add('reclamos_garantia',{garantia_id:i+2,descripcion:'Revisión de conectividad',estado,resolucion:estado==='resuelto'?'Equipo revisado y entregado':'Daño por humedad fuera de cobertura',creado_por:'demo-admin',fecha:when(4+i)}) }
  t.garantias[3].estado='en_reclamo'
  add('reclamos_garantia',{garantia_id:4,descripcion:'Cambio de conector aprobado por cobertura',estado:'aprobado',creado_por:'demo-admin',fecha:when(3)})
  add('actividad',{perfil_id:'demo-admin',accion:'Ingreso de mercancía',entidad:'compra',entidad_id:1,detalle:{proveedor:t.proveedores[0].nombre},fecha:when(0)})
  add('actividad',{perfil_id:'demo-admin',accion:'Producto actualizado',entidad:'producto',entidad_id:1,detalle:{nombre:t.productos[0].nombre},fecha:when(1)})
  add('tienda',{nombre:'ANGIE TECH',nit:'900000999-0',moneda:'COP',zona_horaria:'America/Bogota',factura_prefijo:'FV',ultimo_numero_factura:1258,factura_pie:'Gracias por elegir Angie Tech · demostración local'})
  return { version:1,session:null,tables:t }
}
