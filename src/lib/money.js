export const MONEY_LIMIT = Number.MAX_SAFE_INTEGER
export const MONEY_RANGE_ERROR = 'El valor ingresado es demasiado grande.'

export function monetaryError(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || Math.abs(number) > MONEY_LIMIT) return MONEY_RANGE_ERROR
  if (typeof value === 'string' && value.trim() && !/^\d+$/.test(value.trim())) return 'Ingresa un valor entero no negativo.'
  if (!Number.isSafeInteger(number) || number < 0) return 'Ingresa un valor entero no negativo.'
  return ''
}

export function monetaryAmount(value) {
  const error = monetaryError(value)
  if (error) throw new Error(error)
  return Number(value)
}
