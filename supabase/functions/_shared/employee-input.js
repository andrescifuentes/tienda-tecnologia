// Shared validation: the browser and Edge Function enforce the same existing rules.
export const EMPLOYEE_PERMISSIONS = [
  'vender', 'ver_inventario', 'editar_inventario', 'editar_precios', 'ver_costos',
  'crear_clientes', 'hacer_devoluciones', 'anular_facturas', 'registrar_compras', 'ver_finanzas',
]
export const DEFAULT_EMPLOYEE_PERMISSIONS = ['vender', 'ver_inventario', 'crear_clientes']

export function normalizeEmployeeInput(input, { demo = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Datos del empleado no v\u00e1lidos.')
  const text = value => typeof value === 'string' ? value.trim() : ''
  const nombre = text(input.nombre), correo = text(input.correo).toLowerCase()
  if (!nombre || !correo) throw new Error('Nombre y correo son obligatorios.')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) throw new Error('Ingresa un correo v\u00e1lido.')
  if (typeof input.password !== 'string' || input.password.length < 8) throw new Error('La contrase\u00f1a debe tener al menos 8 caracteres.')
  const rol = input.rol ?? 'vendedor'
  if (!['admin', 'vendedor'].includes(rol)) throw new Error('Rol de usuario no v\u00e1lido.')
  const commission = input.comision_pct
  const comision_pct = commission == null || commission === '' ? null : Number(commission)
  if (comision_pct !== null && (!Number.isFinite(comision_pct) || comision_pct < 0 || comision_pct > 100)) throw new Error('La comisi\u00f3n debe estar entre 0 y 100%.')
  const requested = input.permisos ?? DEFAULT_EMPLOYEE_PERMISSIONS
  if (!Array.isArray(requested) || requested.some(p => !EMPLOYEE_PERMISSIONS.includes(p))) throw new Error('Permiso de empleado no v\u00e1lido.')
  return {
    nombre, correo, password: input.password, telefono: text(input.telefono) || null,
    rol, comision_pct, permisos: [...new Set(requested)],
    ...(demo ? { documento: text(input.documento) || null } : {}),
  }
}
