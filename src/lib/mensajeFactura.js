// Mensaje que recibe el cliente con su factura (WhatsApp y correo).
// El administrador lo personaliza en Más › Configuración › Mensaje al cliente.
export const MENSAJE_FACTURA_BASE = [
  'Hola {cliente},',
  '',
  'Gracias por tu compra en {negocio}.',
  'Aquí puedes ver y descargar tu factura {factura} por {total}:',
  '{enlace}',
  '',
  '¡Quedamos atentos a lo que necesites!',
].join('\n')

export const CAMPOS_MENSAJE = [
  ['{cliente}', 'Nombre del cliente'],
  ['{negocio}', 'Nombre del negocio'],
  ['{factura}', 'Número de factura'],
  ['{total}', 'Total'],
  ['{enlace}', 'Enlace a la factura'],
]

export const plantillaFactura = tienda => String(tienda?.mensaje_factura || '').trim() || MENSAJE_FACTURA_BASE

// Sin enlace se quita la línea del enlace (el PDF se adjunta aparte).
export function armarMensajeFactura(plantilla, { cliente, negocio, factura, total, enlace = '' }) {
  let texto = String(plantilla || MENSAJE_FACTURA_BASE)
  if (!enlace) {
    // Sin enlace, la frase que lo presentaba no debe quedar terminando en «:».
    const esEnlace = l => /^\s*\{enlace\}\s*$/.test(l || '')
    const lineas = texto.split('\n')
    texto = lineas.map((l, i) => esEnlace(lineas[i + 1]) ? l.replace(/:\s*$/, '.') : l).filter(l => !esEnlace(l)).join('\n')
  }
  else if (!texto.includes('{enlace}')) texto += '\n\n' + enlace
  const valores = { cliente: cliente || '', negocio, factura, total, enlace }
  return texto.replace(/\{(cliente|negocio|factura|total|enlace)\}/g, (_, k) => valores[k] ?? '').replace(/ +([,.:!?])/g, '$1').replace(/\n{3,}/g, '\n\n').trim()
}
