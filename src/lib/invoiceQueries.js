export const SELLER_INVOICE_FIELDS = 'id,prefijo,numero,cliente_id,vendedor_id,metodo_pago,subtotal,descuento,total,estado,notas,fecha,comision_pct,comision,motivo_anulacion,anulada_por,anulada_en'
export const SELLER_ITEM_FIELDS = 'id,factura_id,producto_id,unidad_id,nombre,cantidad,precio_unitario,descuento'
export const invoiceFields = (admin, demo = false) => admin ? '*' : SELLER_INVOICE_FIELDS + (demo ? ',cliente_snapshot,vendedor_snapshot,tienda_snapshot' : '')
export const invoiceItemFields = (admin, demo = false) => admin ? '*' : SELLER_ITEM_FIELDS + (demo ? ',codigo' : '')
export function invoiceTable(client, { esAdmin = false } = {}, net = false) {
  return client.secureInvoiceViews && !esAdmin ? (net ? 'facturas_venta_netas' : 'facturas_venta') : (net ? 'facturas_netas' : 'facturas')
}
export const invoiceItemsTable = (client, admin) => client.secureInvoiceViews && !admin ? 'factura_items_venta' : 'factura_items'
