export function localNotifications(tables, today) {
  const notices = []
  for (const p of tables.productos.filter(p => p.activo && p.stock <= p.stock_min)) notices.push({ id: `stock:${p.id}:${p.stock}`, title: p.stock === 0 ? 'Producto agotado' : 'Stock bajo', text: `${p.nombre} · ${p.stock} unidades`, to: '/inventario?q=' + encodeURIComponent(p.codigo), tone: p.stock === 0 ? 'bad' : 'warn' })
  for (const g of tables.garantias.filter(g => g.estado === 'vigente' && g.fin >= today && (Date.parse(g.fin) - Date.parse(today)) / 86400000 <= 30)) {
    const product = tables.productos.find(p => p.id === g.producto_id)
    notices.push({ id: `warranty:${g.id}:${g.fin}`, title: 'Garantía por vencer', text: `${product?.nombre || 'Producto'} · vence ${g.fin}`, to: '/garantias?garantia=' + g.id, tone: 'warn' })
  }
  for (const a of [...tables.actividad].filter(a => /venta|factura|devoluci|mercanc|stock/i.test(a.accion)).sort((a,b) => b.fecha.localeCompare(a.fecha)).slice(0,8)) notices.push({ id: 'activity:' + a.id, title: a.accion, text: a.detalle?.numero || a.fecha.slice(0,10), to: ['factura','facturas'].includes(a.entidad) ? '/facturas?factura=' + a.entidad_id : a.entidad === 'compra' ? '/proveedores?compra=' + a.entidad_id : '/inventario', tone: '' })
  return notices
}
