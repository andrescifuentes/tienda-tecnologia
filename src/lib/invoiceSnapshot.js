const pick = (record, keys) => record ? Object.fromEntries(keys.map(key => [key, record[key] ?? null])) : null

// Additive compatibility: freeze the best data available for older local invoices.
// Existing item names/prices already represent the sale and must never be replaced.
export function freezeInvoiceIdentity(state, invoice) {
  const t = state.tables
  if (!Object.hasOwn(invoice, 'cliente_snapshot')) invoice.cliente_snapshot = pick(t.clientes.find(c => c.id === invoice.cliente_id), ['nombre','tipo_documento','documento','telefono','correo','direccion','ciudad'])
  invoice.vendedor_snapshot ??= pick(t.perfiles.find(p => p.id === invoice.vendedor_id), ['nombre'])
  invoice.tienda_snapshot ??= pick(t.tienda[0], ['nombre','nit','telefono','direccion','factura_pie','factura_prefijo'])
  for (const item of t.factura_items.filter(i => i.factura_id === invoice.id)) item.codigo ??= t.productos.find(p => p.id === item.producto_id)?.codigo || ''
}

export const invoiceBusiness = (invoice, fallback) => invoice?.tienda_snapshot || fallback

// Document callers can supply either raw records or hydrated demo API records.
// Prefer the historical identity in both cases, including a cash sale with no client.
export function invoiceIdentity(invoice) {
  return {
    ...invoice,
    clientes: Object.hasOwn(invoice, 'cliente_snapshot') ? invoice.cliente_snapshot : invoice.clientes,
    perfiles: invoice.vendedor_snapshot || invoice.perfiles,
  }
}
