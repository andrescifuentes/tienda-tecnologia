// IndexedDB is authoritative for writes: a localStorage cache in another renderer
// can still be stale even while holding a cross-tab lock. Keep the existing JSON
// mirror for synchronous queries and compatibility, but never base a subsequent
// write on that mirror once the state has been imported into IndexedDB.
let connection
let pendingRead
function database() {
  if (!globalThis.indexedDB) return Promise.reject(new Error('No se pudo coordinar el guardado local. Habilita el almacenamiento del navegador.'))
  if (!connection) connection = new Promise((resolve, reject) => {
    const request = indexedDB.open('angie-demo-coordination', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('writes')
    request.onerror = () => { connection = null; reject(new Error('No se pudo abrir el almacenamiento local.')) }
    request.onblocked = () => { connection = null; reject(new Error('Cierra las otras pestañas e intenta guardar de nuevo.')) }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => { db.close(); connection = null }
      resolve(db)
    }
  })
  return connection
}

export async function coordinateDemoWrite(action) {
  const db = await database()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('writes', 'readwrite')
    let result, failure
    tx.oncomplete = () => resolve(result)
    tx.onabort = tx.onerror = () => reject(failure || new Error('No se pudo guardar. Inténtalo de nuevo.'))
    const store = tx.objectStore('writes'), request = store.get('store')
    request.onsuccess = () => {
      // Must remain synchronous: read, validate and commit while the exclusive
      // transaction is active. No async callback or snapshot obtained beforehand.
      try { result = action(request.result, serialized => store.put(serialized, 'store')) } catch (error) { failure = error; tx.abort() }
    }
  })
}

export async function readDemoState() {
  const db = await database()
  if (pendingRead) return pendingRead
  const tx = db.transaction('writes', 'readonly')
  const result = new Promise((resolve, reject) => {
    const request = tx.objectStore('writes').get('store')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('No se pudieron leer los datos locales.'))
  })
  // A logical screen load issues several queries together. Share only the
  // currently active read transaction, never a persistent in-memory cache.
  pendingRead = result
  const clear = () => { if (pendingRead === result) pendingRead = null }
  tx.oncomplete = tx.onabort = clear
  return result
}
