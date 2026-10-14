const DATABASE = 'angie-tech:demo:images:v1'
export function imageKey() {
  return 'photo-' + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + '-' + Math.random().toString(36).slice(2))
}
function open() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('Este navegador no permite guardar fotografías locales.'))
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('photos')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('No se pudo abrir el almacenamiento de fotografías.'))
  })
}
async function operation(mode, action) {
  const db = await open()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('photos', mode)
      const request = action(transaction.objectStore('photos'))
      transaction.oncomplete = () => resolve(request.result)
      transaction.onerror = transaction.onabort = () => reject(new Error('No se pudo guardar la fotografía. Revisa el espacio disponible o el modo privado.'))
    })
  } finally { db.close() }
}
export const saveImage = (key, blob) => operation('readwrite', store => store.put(blob, key))
export const loadImage = key => operation('readonly', store => store.get(key))
export const removeImage = key => operation('readwrite', store => store.delete(key))
export const clearImages = () => operation('readwrite', store => store.clear())

export async function prepareImage(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error('Selecciona una fotografía JPG, PNG o WebP.')
  if (file.size > 12 * 1024 * 1024) throw new Error('La fotografía debe pesar menos de 12 MB.')
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('No se pudo leer la foto. Si es HEIC, guárdala como JPG y vuelve a seleccionarla.'))
      image.src = url
    })
    const scale = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
    return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('No se pudo preparar la fotografía.')), file.type === 'image/png' ? 'image/png' : 'image/jpeg', .85))
  } finally { URL.revokeObjectURL(url) }
}
