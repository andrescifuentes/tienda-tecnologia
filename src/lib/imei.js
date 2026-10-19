// IMEI / número de serie por unidad. Reutiliza unidades_serializadas (no hay tabla paralela).
// SQL 18 aplica las mismas reglas con un trigger, también para registrar_compra.
export const SERIAL_TYPES = Object.freeze({ imei: 'IMEI', serie: 'Número de serie' })
export const UNIT_ATTRIBUTES = Object.freeze([['imei2', 'IMEI 2 (doble SIM)'], ['color', 'Color'], ['capacidad', 'Capacidad'], ['nota', 'Nota']])
export const PRODUCT_ATTRIBUTE_LIMIT = 10

export function luhnValid(digits) {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let n = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9 }
    sum += n
  }
  return sum % 10 === 0
}
export const normalizeImei = value => String(value ?? '').replace(/[\s.-]/g, '')
export function isValidImei(value) { const d = normalizeImei(value); return /^\d{15}$/.test(d) && luhnValid(d) }

// tipo: 'imei' valida 15 dígitos + dígito verificador; 'serie' (o null, productos anteriores) solo limpia espacios.
export function normalizeSerial(value, tipo = null) {
  const raw = String(value ?? '').trim()
  if (!raw) throw Error('Escribe el ' + (tipo === 'imei' ? 'IMEI' : 'serial') + '.')
  if (tipo === 'imei') {
    const d = normalizeImei(raw)
    if (!/^\d{15}$/.test(d)) throw Error(`El IMEI ${raw} debe tener 15 dígitos.`)
    if (!luhnValid(d)) throw Error(`El IMEI ${raw} no es válido (dígito verificador). Revísalo en la caja o marcando *#06#.`)
    return d
  }
  if (raw.length > 60 || /[\u0000-\u001f\u007f]/.test(raw)) throw Error('El serial admite hasta 60 caracteres, sin saltos de línea.')
  return raw
}
// Text area «uno por línea» → lista normalizada; detecta repetidos dentro del mismo ingreso.
export function parseSerialList(text, tipo = null) {
  const list = String(text ?? '').split(/[\n,;]+/).map(s => s.trim()).filter(Boolean).map(s => normalizeSerial(s, tipo))
  const seen = new Set()
  for (const s of list) { if (seen.has(s)) throw Error(`El ${tipo === 'imei' ? 'IMEI' : 'serial'} ${s} está repetido.`); seen.add(s) }
  return list
}

export function validateUnitAttributes(input = {}, serial = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Datos de la unidad no válidos.')
  const allowed = new Set(UNIT_ATTRIBUTES.map(([k]) => k)), out = {}
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.has(key)) throw Error('Campo de unidad no permitido: ' + key)
    const text = String(value ?? '').trim()
    if (!text) continue
    if (text.length > (key === 'nota' ? 200 : 60) || /[\u0000-\u001f\u007f]/.test(text)) throw Error('El campo ' + key + ' es demasiado largo o tiene caracteres no válidos.')
    out[key] = text
  }
  if (out.imei2) {
    out.imei2 = normalizeImei(out.imei2)
    if (!isValidImei(out.imei2)) throw Error('El IMEI 2 no es válido (15 dígitos con dígito verificador).')
    if (serial && out.imei2 === serial) throw Error('El IMEI 2 no puede ser igual al IMEI principal.')
  }
  return out
}
export function validateProductAttributes(list = []) {
  if (!Array.isArray(list) || list.length > PRODUCT_ATTRIBUTE_LIMIT) throw Error('Máximo ' + PRODUCT_ATTRIBUTE_LIMIT + ' datos adicionales por producto.')
  return list.map(item => ({ etiqueta: String(item?.etiqueta ?? '').trim(), valor: String(item?.valor ?? '').trim() })).filter(item => item.valor).map(item => {
    if (!item.etiqueta) throw Error('Cada dato adicional necesita un nombre (ej. Capacidad).')
    if (item.etiqueta.length > 40 || item.valor.length > 120 || /[\u0000-\u001f\u007f]/.test(item.etiqueta + item.valor)) throw Error('Los datos adicionales admiten nombres de 40 y valores de 120 caracteres.')
    return item
  })
}
// Smartphones y tablets suelen tener IMEI; el administrador decide en cada producto.
export const suggestSerialType = categoria => /smart|celular|tel[eé]fono|m[oó]vil|tablet/i.test(String(categoria || '')) ? 'imei' : 'serie'
