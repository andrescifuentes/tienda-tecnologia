// Código de producto (SKU) legible:  CATEGORÍA-MARCA-MODELO-VARIANTE  (+ -002 solo si se repite)
// Ej.: CEL-APL-IP15-128N · FUN-GEN-IP15-TRA · CAR-APL-20W-USBC · AUD-JBL-T520-NEG

const sinTildes = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
const limpio = t => sinTildes(t).toUpperCase().replace(/[^A-Z0-9]/g, '')

const CATEGORIAS = [
  [/celular|telefono|smartphone/, 'CEL'], [/funda|estuche|case/, 'FUN'], [/protector|vidrio|templado/, 'PRO'],
  [/cargador|adaptador/, 'CAR'], [/cable/, 'CAB'], [/audifono|auricular|parlante|audio/, 'AUD'],
  [/computador|portatil|laptop/, 'COM'], [/tablet/, 'TAB'], [/televisor|tv/, 'TV'], [/gaming|consola|juego/, 'GAM'],
  [/reloj|watch/, 'REL'], [/accesorio/, 'ACC'],
]
const MARCAS = { APPLE: 'APL', SAMSUNG: 'SAM', XIAOMI: 'XIA', REDMI: 'XIA', MOTOROLA: 'MOT', HUAWEI: 'HUA', HONOR: 'HON', OPPO: 'OPP', REALME: 'RLM', VIVO: 'VIV', INFINIX: 'INF', TECNO: 'TEC', JBL: 'JBL', SONY: 'SNY', LENOVO: 'LNV', HP: 'HP', ANKER: 'ANK', BASEUS: 'BAS', GENERICA: 'GEN', GENERICO: 'GEN', LG: 'LG', ASUS: 'ASU', ACER: 'ACR', DELL: 'DEL', NINTENDO: 'NIN', PLAYSTATION: 'PS', XBOX: 'XBX' }
const COLORES = { NEGRO: 'NEG', BLANCO: 'BLA', TRANSPARENTE: 'TRA', GRIS: 'GRI', PLATEADO: 'PLA', DORADO: 'DOR', AZUL: 'AZU', ROJO: 'ROJ', ROSADO: 'ROS', MORADO: 'MOR', VERDE: 'VER', AMARILLO: 'AMA', NARANJA: 'NAR', MULTICOLOR: 'MUL' }
const RELLENO = new Set(['DE', 'PARA', 'CON', 'Y', 'EL', 'LA', 'LOS', 'LAS', 'A', 'EN', 'FUNDA', 'CARGADOR', 'CABLE', 'VIDRIO', 'PROTECTOR', 'TEMPLADO', 'AUDIFONOS', 'AUDIFONO', 'CELULAR', 'ESTUCHE', 'ADAPTADOR', 'BLUETOOTH', 'INALAMBRICO', 'INALAMBRICOS', 'PANTALLA', 'CARGA', 'RAPIDA', 'ORIGINAL', 'GENERICO', 'GENERICA'])

export function codigoCategoria(nombre) {
  const c = sinTildes(nombre).toLowerCase()
  for (const [re, code] of CATEGORIAS) if (re.test(c)) return code
  return limpio(nombre).slice(0, 3) || 'GEN'
}
export function codigoMarca(marca) {
  const m = limpio(marca)
  if (!m) return 'GEN'
  return MARCAS[m] || m.replace(/[AEIOU]/g, '').slice(0, 3).padEnd(3, m[0]) || m.slice(0, 3)
}
export function codigoColor(color) { const c = limpio(color); return COLORES[c] || (c ? c.slice(0, 3) : '') }

// Forma corta del modelo: "iPhone 15 Pro Max"→IP15PM, "Galaxy S24 Ultra"→S24U, "Redmi Note 13 Pro"→RN13P
export function codigoModelo(texto, marca = '') {
  let s = ' ' + sinTildes(texto).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ') + ' '
  for (const m of [marca, 'APPLE', 'SAMSUNG', 'XIAOMI', 'MOTOROLA']) if (m) s = s.replace(new RegExp(' ' + limpio(m) + ' ', 'g'), ' ')
  s = s.replace(/\b(\d{2,4}) ?(GB|TB|G|T)\b/g, ' ')                       // la capacidad va en la variante
  s = s.replace(/\bIPHONE ?(\d+)/g, 'IP$1').replace(/\bIPAD\b/g, 'IPAD').replace(/\bGALAXY\b/g, ' ')
  s = s.replace(/\bREDMI NOTE ?/g, 'RN').replace(/\bREDMI ?/g, 'R').replace(/\bMOTO ?G ?/g, 'MG').replace(/\bMOTO ?E ?/g, 'ME')
  s = s.replace(/\bPRO MAX\b/g, 'PM').replace(/\bULTRA\b/g, 'U').replace(/\bPLUS\b/g, 'PL').replace(/\bPRO\b/g, 'P').replace(/\bMINI\b/g, 'MN').replace(/\bLITE\b/g, 'L')
  s = s.replace(/\bTUNE ?/g, 'T').replace(/\bLIGHTNING\b/g, 'L').replace(/\bUSB ?C\b/g, 'USBC').replace(/\bUSB ?A\b/g, 'USBA').replace(/\bWATTS?\b/g, 'W')
  const tokens = s.split(/\s+/).filter(t => t && !RELLENO.has(t))
  // une el modelo con sus sufijos cortos (IP15 + P → IP15P)
  const out = []
  for (const t of tokens) { if (out.length && /^(P|PM|U|PL|MN|L|S|E)$/.test(t)) out[out.length - 1] += t; else out.push(t) }
  return out.slice(0, 2).join('-').slice(0, 12)
}

export function generarSku({ categoria, marca, modelo, nombre, color }) {
  const cat = codigoCategoria(categoria)
  const mar = codigoMarca(marca)
  const mod = codigoModelo(modelo || nombre, marca) || limpio(nombre).slice(0, 6)
  const cap = (sinTildes(`${nombre} ${modelo}`).match(/\b(\d{2,4}) ?(GB|TB|G|T)\b/i) || [])[1]
  const col = codigoColor(color)
  const variante = cap ? cap + (col ? col[0] : '') : col
  return [cat, mar, mod, variante].filter(Boolean).join('-')
}

export const limpiarSku = t => sinTildes(t).toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9-]/g, '').replace(/-{2,}/g, '-').slice(0, 40)

// Marca a partir del nombre del producto ("iPhone 15" → Apple, "Galaxy A55" → Samsung)
const PISTAS = [
  [/\b(IPHONE|IPAD|AIRPODS|MACBOOK|APPLE|MAGSAFE|LIGHTNING)\b/, 'Apple'], [/\b(SAMSUNG|GALAXY)\b/, 'Samsung'],
  [/\b(XIAOMI|REDMI|POCO)\b/, 'Xiaomi'], [/\b(MOTOROLA|MOTO)\b/, 'Motorola'], [/\bHUAWEI\b/, 'Huawei'], [/\bHONOR\b/, 'Honor'],
  [/\bOPPO\b/, 'Oppo'], [/\bREALME\b/, 'Realme'], [/\bVIVO\b/, 'Vivo'], [/\bINFINIX\b/, 'Infinix'], [/\bTECNO\b/, 'Tecno'],
  [/\bJBL\b/, 'JBL'], [/\bSONY\b/, 'Sony'], [/\bLENOVO\b/, 'Lenovo'], [/\bANKER\b/, 'Anker'], [/\bBASEUS\b/, 'Baseus'],
  [/\b(PLAYSTATION|PS5|PS4)\b/, 'PlayStation'], [/\bXBOX\b/, 'Xbox'], [/\bNINTENDO\b/, 'Nintendo'],
  [/\b(HP|PAVILION|VICTUS|OMEN)\b/, 'HP'], [/\b(DELL|INSPIRON|LATITUDE|XPS|ALIENWARE)\b/, 'Dell'], [/\b(ASUS|ROG|ZENBOOK|VIVOBOOK)\b/, 'Asus'],
  [/\b(ACER|ASPIRE|NITRO|PREDATOR)\b/, 'Acer'], [/\b(LG)\b/, 'LG'], [/\b(MSI)\b/, 'MSI'], [/\b(GOOGLE|PIXEL)\b/, 'Google'],
  [/\b(AMAZFIT)\b/, 'Amazfit'], [/\b(GARMIN)\b/, 'Garmin'], [/\b(LOGITECH)\b/, 'Logitech'], [/\b(NOKIA)\b/, 'Nokia'], [/\b(ZTE)\b/, 'ZTE'],
  [/\b(TCL)\b/, 'TCL'], [/\b(HISENSE)\b/, 'Hisense'], [/\b(BOSE)\b/, 'Bose'], [/\b(BEATS)\b/, 'Beats'], [/\b(MICROSOFT|SURFACE)\b/, 'Microsoft'],
]
// Palabras que describen el producto, no la marca ("Celular Tecno Spark" → la marca es la siguiente palabra)
const GENERICAS = new Set(['CELULAR', 'TELEFONO', 'SMARTPHONE', 'RELOJ', 'SMARTWATCH', 'CARGADOR', 'CABLE', 'AUDIFONOS', 'AURICULARES', 'DIADEMA', 'PARLANTE', 'BAFLE', 'COMPUTADOR', 'COMPUTADORA', 'PORTATIL', 'LAPTOP', 'TABLET', 'TELEVISOR', 'TV', 'MONITOR', 'MOUSE', 'TECLADO', 'CONSOLA', 'CONTROL', 'MEMORIA', 'USB', 'ADAPTADOR', 'BATERIA', 'POWERBANK', 'SOPORTE', 'BASE', 'KIT', 'COMBO', 'NUEVO', 'NUEVA', 'DE', 'PARA', 'CON', 'EL', 'LA', 'LOS', 'LAS', 'Y', 'INTELIGENTE', 'INALAMBRICO', 'INALAMBRICOS', 'BLUETOOTH', 'GAMER', 'DEPORTIVO', 'ORIGINAL', 'GENERICO', 'GENERICA', 'RAPIDO', 'CARGA', 'TIPO', 'MAGNETICO', 'NEGRO', 'NEGRA', 'BLANCO', 'BLANCA', 'AZUL', 'ROJO', 'ROJA', 'VERDE', 'ROSADO', 'ROSA', 'GRIS', 'DORADO', 'PLATEADO', 'MORADO', 'PRO', 'MAX', 'MINI', 'ULTRA', 'PLUS', 'LITE', 'PULGADAS', 'MICRO', 'LIGHTNING'])
const ACCESORIO = /\b(FUNDA|ESTUCHE|CASE|VIDRIO|PROTECTOR|TEMPLADO|FORRO)\b/
export function inferirMarca(nombre) {
  const n = ' ' + sinTildes(nombre).toUpperCase() + ' '
  if (ACCESORIO.test(n)) return 'Genérica'          // "Funda iPhone 15" es genérica, no Apple
  for (const [re, marca] of PISTAS) if (re.test(n)) return marca
  // Marca nueva: se toma la primera palabra que no sea descriptiva ("Tecno Spark 20" → Tecno)
  const palabra = sinTildes(nombre).split(/\s+/).find(w => /^[A-Za-z][A-Za-z&]{1,}$/.test(w) && !GENERICAS.has(w.toUpperCase()))
  if (palabra) return palabra.length <= 3 ? palabra.toUpperCase() : palabra.charAt(0).toUpperCase() + palabra.slice(1).toLowerCase()
  return 'Genérica'
}
