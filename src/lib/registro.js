import { supabase } from './supabase'

export const faltaScript10 = e => e?.code === 'PGRST202' || /Could not find the function/i.test(e?.message || '')

// Crea el perfil del administrador: negocio nuevo (código de alta) o negocio existente (código de registro).
export async function completarRegistro({ modo, nombre, negocio, codigo, telefono }) {
  const r = modo === 'nuevo'
    ? await supabase.rpc('registrar_negocio', { p_nombre: nombre.trim(), p_negocio: negocio.trim(), p_codigo_alta: codigo, p_telefono: telefono?.trim() || null })
    : await supabase.rpc('registrar_administrador', { p_nombre: nombre.trim(), p_codigo: codigo, p_telefono: telefono?.trim() || null })
  if (r.error && faltaScript10(r.error)) throw new Error('Falta activar los negocios: ejecuta el script 10 en Supabase.')
  if (r.error) throw r.error
}
