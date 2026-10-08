// Browser-only fixtures, served by the local test runner through CDP interception.
// Never imported by the app. They contain no credentials or production data.
export const isDemoMode = false
const products = Array.from({ length: 10 }, (_, index) => ({
  id: index + 1,
  nombre: ['Cargador rápido USB-C 30 W', 'Smartphone con pantalla AMOLED 256 GB', 'Audífonos inalámbricos con cancelación de ruido', 'Power bank 20.000 mAh', 'Smartwatch deportivo', 'Cable USB-C trenzado de 2 metros', 'Tablet con pantalla de 11 pulgadas', 'Adaptador multipuerto', 'Control inalámbrico', 'Soporte para portátil'][index],
  codigo: `AT-${String(index + 1).padStart(4, '0')}`, codigo_barras: `770000000000${index}`,
  marca: 'Marca de prueba', categorias: { nombre: 'Accesorios' }, categoria: 'Accesorios',
  precio_venta: index === 1 ? 1234567 : 89000 + index * 12000, precio_compra: 50000,
  stock: index === 0 ? 3 : index === 1 ? 2 : index === 2 ? 0 : 10,
  stock_min: 3, activo: true, maneja_serial: index === 1, garantia_meses: 12,
}))
const profiles = [
  { id: 'ui-admin', nombre: 'Angela Ríos', correo: 'admin@example.test', rol: 'admin', activo: true, comision_pct: null },
  { id: 'ui-seller', nombre: 'Laura Torres', correo: 'vendedor@example.test', rol: 'vendedor', activo: true, comision_pct: 3 },
]
const invoices = ['emitida', 'anulada', 'pendiente'].map((estado, i) => ({
  id: i + 1, prefijo: 'AT', numero: i + 1, total: 1234567 + i * 12000, estado,
  fecha: '2026-10-07T15:20:00Z', vendedor_id: 'ui-seller', metodo_pago: 'efectivo', descuento: 0,
  clientes: { id: 1, nombre: 'Cliente con nombre completo de prueba', documento: '123456789', telefono: '', correo: 'cliente@example.test' },
  perfiles: { nombre: 'Laura Torres' },
}))
const tables = {
  perfiles: profiles, perfil_permisos: ['vender', 'ver_inventario', 'crear_clientes'].map((permiso) => ({ perfil_id: 'ui-seller', permiso })),
  tienda: [{ id: 1, nombre: 'ANGIE TECH', factura_pie: 'Gracias por tu compra.' }],
  productos: products, productos_venta: products, stock_bajo: products.filter((p) => p.stock <= p.stock_min),
  facturas: invoices,
  factura_items: [{ id: 1, factura_id: 1, nombre: products[0].nombre, cantidad: 1, precio_unitario: 89000, descuento: 0 }],
  devoluciones: [], unidades_serializadas: [{ id: 1, producto_id: 2, serial: 'SERIAL-PRUEBA-001', estado: 'disponible' }],
  categorias: [{ id: 1, nombre: 'Accesorios', activa: true }],
  proveedores: [{ id: 1, nombre: 'Proveedor de prueba', contacto: 'Contacto local', activo: true }],
  clientes: [invoices[0].clientes], compras_saldo: [], movimientos: [], garantias: [], actividad: [], movimientos_inventario: [],
}
class Query {
  constructor(table) { this.rows = [...(tables[table] || [])]; this.one = false }
  select() { return this }
  order() { return this }
  limit(n) { this.rows = this.rows.slice(0, n); return this }
  eq(key, value) { this.rows = this.rows.filter((r) => r[key] === value); return this }
  gt(key, value) { this.rows = this.rows.filter((r) => r[key] > value); return this }
  gte() { return this }
  lte() { return this }
  in(key, values) { this.rows = this.rows.filter((r) => values.includes(r[key])); return this }
  or() { return this }
  single() { this.one = true; return this }
  maybeSingle() { this.one = true; return this }
  then(resolve, reject) { return Promise.resolve({ data: this.one ? this.rows[0] || null : this.rows, error: null }).then(resolve, reject) }
  insert() { throw new Error('Writes are disabled in local UI tests') }
  update() { throw new Error('Writes are disabled in local UI tests') }
  delete() { throw new Error('Writes are disabled in local UI tests') }
}
export const supabaseConfigurationError = ''
export const supabase = {
  from: (table) => new Query(table),
  rpc: async (name) => {
    if (name === 'resumen_dashboard') return { data: [{ ventas_hoy: 1234567, ventas_mes: 123456789, ingresos_mes: 480000, gastos_mes: 240000, utilidad_mes: 1240000, valor_inventario: 987654321, productos_stock_bajo: 3, facturas_hoy: 12, facturas_mes: 142 }], error: null }
    if (name === 'ventas_por_empleado') return { data: [{ vendedor_id: 'ui-seller', nombre: 'Laura Torres', facturas: 12, total_vendido: 1234567, comision: 37037 }], error: null }
    throw new Error(`RPC writes are disabled in local UI tests: ${name}`)
  },
  auth: {
    getSession: async () => ({ data: { session: window.__UI_TEST_ROLE__ === 'login' ? null : { user: { id: window.__UI_TEST_ROLE__ === 'seller' ? 'ui-seller' : 'ui-admin' } } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signInWithPassword: async (credentials) => { window.__loginAttempt = credentials; return { error: { message: 'Invalid login credentials' } } },
    signOut: async () => ({ error: null }),
  },
}
