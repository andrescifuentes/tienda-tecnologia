import { mensajeError } from './format.js'

// Venta rápida: cliente "Consumidor final" (documento 000000) de cada negocio (script 14).
export const DOC_CONSUMIDOR_FINAL = '000000'
export const NOTA_SIN_DATOS = 'Venta sin datos del cliente'
export const esConsumidorFinal = c => !!c && String(c.documento || '') === DOC_CONSUMIDOR_FINAL

export async function obtenerConsumidorFinal(client) {
  const r = await client.rpc('cliente_consumidor_final')
  if (!r.error && r.data) {
    const c = await client.from('clientes').select('*').eq('id', r.data).maybeSingle()
    return c.data || { id: r.data, nombre: 'Consumidor final', tipo_documento: 'CC', documento: DOC_CONSUMIDOR_FINAL }
  }
  // Demo local, o el script 14 aún no se ejecutó: se busca o se crea con los permisos del usuario
  const f = await client.from('clientes').select('*').eq('documento', DOC_CONSUMIDOR_FINAL).limit(1)
  if (f.data?.[0]) return f.data[0]
  const n = await client.from('clientes').insert({ tipo_documento: 'CC', documento: DOC_CONSUMIDOR_FINAL, nombre: 'Consumidor final' }).select().single()
  if (n.error) throw new Error(r.error?.code === 'PGRST202' ? 'Falta activar la venta sin datos: ejecuta el script 14 en Supabase.' : mensajeError(n.error))
  return n.data
}

// La nota "Venta sin datos del cliente" queda en la factura junto a la nota del vendedor
export const notaVenta = (cliente, notas = '') => {
  const propia = String(notas || '').trim()
  if (!esConsumidorFinal(cliente)) return propia || null
  return propia ? NOTA_SIN_DATOS + ' · ' + propia : NOTA_SIN_DATOS
}
