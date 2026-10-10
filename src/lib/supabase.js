import { createClient } from '@supabase/supabase-js'
import { createDemoClient } from './demo/client.js'

export const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

let client = null
let configurationError = ''

if (isDemoMode) {
  client = createDemoClient()
} else if (!url || !anonKey || url.includes('TU-PROYECTO') || anonKey === 'TU_ANON_KEY_PUBLICA') {
  configurationError = 'Falta configurar la conexión a Supabase.'
} else {
  try { client = createClient(url, anonKey) }
  catch { configurationError = 'La configuración de Supabase no es válida. Revisa la URL y la clave pública.' }
}

export const supabase = client
export const supabaseConfigurationError = configurationError


// Ejecuta una acción con la sesión de un administrador sin cerrar la sesión actual
// (se usa cuando un vendedor necesita autorización, p. ej. para anular una factura).
export async function conAutorizacionAdmin(correo, clave, accion) {
  if (isDemoMode || !url || !anonKey) throw new Error('La autorización de administrador no está disponible en este modo.')
  const temp = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'angie-autorizacion' } })
  const { data, error } = await temp.auth.signInWithPassword({ email: correo.trim(), password: clave })
  if (error || !data?.user) throw new Error('Correo o contraseña del administrador incorrectos.')
  try {
    const { data: p } = await temp.from('perfiles').select('nombre,rol,activo').eq('id', data.user.id).single()
    if (!p || p.rol !== 'admin' || p.activo === false) throw new Error('Esas credenciales no son de un administrador activo.')
    return await accion(temp, p)
  } finally { await temp.auth.signOut({ scope: 'local' }).catch(() => {}) }
}
