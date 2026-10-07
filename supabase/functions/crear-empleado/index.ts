// Edge Function: crear-empleado
// Crea el usuario en Supabase Auth (correo + contraseña) y su perfil.
// Solo la puede ejecutar un administrador activo. La clave service_role
// vive únicamente aquí, en el servidor; nunca va dentro de la app.
//
// Despliegue:  supabase functions deploy crear-empleado
// Llamada:     supabase.functions.invoke('crear-empleado', { body: {...} })
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const PERMISOS = [
  'vender', 'ver_inventario', 'editar_inventario', 'editar_precios', 'ver_costos',
  'crear_clientes', 'hacer_devoluciones', 'anular_facturas', 'registrar_compras', 'ver_finanzas',
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // 1. Quién llama
  const caller = createClient(url, anon, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: auth } = await caller.auth.getUser()
  if (!auth?.user) return json({ error: 'No autenticado' }, 401)

  const admin = createClient(url, service)
  const { data: yo } = await admin.from('perfiles').select('rol, activo').eq('id', auth.user.id).single()
  if (!yo || yo.rol !== 'admin' || !yo.activo) {
    return json({ error: 'Solo un administrador activo puede crear empleados' }, 403)
  }

  // 2. Validar datos
  const body = await req.json().catch(() => ({}))
  const { nombre, correo, password, telefono = null, rol = 'vendedor', comision_pct = null, permisos } = body
  if (!nombre || !correo || !password) return json({ error: 'Nombre, correo y contraseña son obligatorios' }, 400)
  if (String(password).length < 6) return json({ error: 'La contraseña debe tener mínimo 6 caracteres' }, 400)
  if (!['admin', 'vendedor'].includes(rol)) return json({ error: 'Rol inválido' }, 400)
  if (Array.isArray(permisos) && permisos.some((p: string) => !PERMISOS.includes(p))) {
    return json({ error: 'Permiso inválido' }, 400)
  }

  // 3. Crear usuario en Auth
  const { data: created, error: errAuth } = await admin.auth.admin.createUser({
    email: correo, password, email_confirm: true,
  })
  if (errAuth || !created?.user) return json({ error: errAuth?.message ?? 'No se pudo crear el usuario' }, 400)
  const id = created.user.id

  // 4. Crear perfil (el trigger asigna los permisos por defecto a los vendedores)
  const { error: errPerfil } = await admin.from('perfiles').insert({
    id, nombre, correo, telefono, rol, comision_pct, creado_por: auth.user.id,
  })
  if (errPerfil) {
    await admin.auth.admin.deleteUser(id)   // no dejar un usuario sin perfil
    return json({ error: errPerfil.message }, 400)
  }

  // 5. Permisos personalizados (opcional)
  if (rol === 'vendedor' && Array.isArray(permisos)) {
    await admin.from('perfil_permisos').delete().eq('perfil_id', id)
    if (permisos.length) {
      await admin.from('perfil_permisos').insert(permisos.map((permiso: string) => ({ perfil_id: id, permiso })))
    }
  }

  return json({ id, correo })
})
