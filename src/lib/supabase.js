import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

let client = null
let configurationError = ''

if (!url || !anonKey || url.includes('TU-PROYECTO') || anonKey === 'TU_ANON_KEY_PUBLICA') {
  configurationError = 'Falta configurar la conexión a Supabase.'
} else {
  try { client = createClient(url, anonKey) }
  catch { configurationError = 'La configuración de Supabase no es válida. Revisa la URL y la clave pública.' }
}

export const supabase = client
export const supabaseConfigurationError = configurationError
