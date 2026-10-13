import { invoiceTable } from './invoiceQueries.js'
const TZ = 'America/Bogota'
const dayKey = date => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(date)
const shiftDay = (day, offset) => new Date(Date.parse(day + 'T12:00:00Z') + offset * 864e5).toISOString().slice(0, 10)

// Compare the same elapsed days; weeks begin on Monday in Bogotá.
export function periodoVendedor(periodo = 'hoy', now = new Date()) {
  const hasta = dayKey(now)
  if (periodo === 'hoy') return { desde: hasta, hasta, anteriorDesde: shiftDay(hasta, -1), anteriorHasta: shiftDay(hasta, -1), comparacion: 'vs. ayer' }
  if (periodo === 'semana') {
    const weekday = new Date(hasta + 'T12:00:00Z').getUTCDay()
    const desde = shiftDay(hasta, -((weekday + 6) % 7))
    return { desde, hasta, anteriorDesde: shiftDay(desde, -7), anteriorHasta: shiftDay(hasta, -7), comparacion: 'vs. semana anterior', nota: 'Mismos días de la semana' }
  }
  if (periodo !== 'mes') throw new Error('Período no válido.')
  const [year, month, day] = hasta.split('-').map(Number)
  const previous = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7)
  const previousLastDay = new Date(Date.UTC(year, month - 1, 0)).getUTCDate()
  return { desde: hasta.slice(0, 7) + '-01', hasta, anteriorDesde: previous + '-01', anteriorHasta: previous + '-' + String(Math.min(day, previousLastDay)).padStart(2, '0'), comparacion: 'vs. mes anterior', nota: 'Hasta el mismo día del mes' }
}

// Keep the owner constraint in the query, in addition to existing remote RLS/demo permissions.
export function consultarFacturasVisibles(client, { esAdmin = false, perfilId, net = false }, columnas) {
  if (!esAdmin && !perfilId) throw new Error('No se pudo identificar al vendedor.')
  const query = client.from(invoiceTable(client, { esAdmin }, net)).select(columnas)
  return esAdmin ? query : query.eq('vendedor_id', perfilId)
}

export async function cargarInicioVendedor(client, perfilId, periodo, now = new Date()) {
  if (!perfilId) throw new Error('No se pudo identificar al vendedor.')
  const rango = periodoVendedor(periodo, now)
  const results = await Promise.all([
    client.rpc('ventas_por_empleado', { p_desde: rango.desde, p_hasta: rango.hasta }),
    client.rpc('ventas_por_empleado', { p_desde: rango.anteriorDesde, p_hasta: rango.anteriorHasta }),
    consultarFacturasVisibles(client, { perfilId }, 'id,prefijo,numero,vendedor_id,total,estado,fecha,clientes(nombre)').order('fecha', { ascending: false }).limit(3),
  ])
  for (const result of results) if (result.error) throw result.error
  const own = rows => rows?.find(row => row.vendedor_id === perfilId)
  const current = own(results[0].data), previous = own(results[1].data)
  const total = Number(current?.total_vendido) || 0
  const facturas = Number(current?.facturas) || 0
  const anteriorTotal = Number(previous?.total_vendido) || 0
  const anteriorFacturas = Number(previous?.facturas) || 0
  return { rango, total, facturas, anteriorTotal, anteriorFacturas,
    variacion: anteriorFacturas > 0 && anteriorTotal > 0 ? Math.round((total - anteriorTotal) / anteriorTotal * 100) : null,
    // Defensive check; the server query already applies the owner constraint.
    ultimas: (results[2].data || []).filter(f => f.vendedor_id === perfilId),
  }
}
