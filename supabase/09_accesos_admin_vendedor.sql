-- =====================================================================
--  Angie Tech · 09 · Accesos: registro de administradores y
--  restablecimiento de vendedores
--  Ejecutar en Supabase > SQL Editor, DESPUÉS de 08.
--  Se puede ejecutar más de una vez. No borra datos.
--
--  1. Código de registro: solo quien conozca el código de la tienda puede
--     crear una cuenta de administrador. El código se guarda cifrado.
--  2. Registro de administrador: crea su perfil al validar el código.
--  3. El administrador cambia el correo y/o la contraseña de un vendedor
--     (cierra las sesiones abiertas de ese vendedor).
--  CAMBIA EL CÓDIGO INICIAL (línea marcada abajo) o defínelo luego en
--  la app: Más > Configuración > Registro de administradores.
-- =====================================================================

-- 1. Código de registro (tabla sin acceso directo desde la app)
create table if not exists registro_admin (
  id          smallint primary key default 1 check (id = 1),
  codigo_hash text not null,
  cambiado_en timestamptz not null default now(),
  cambiado_por uuid references perfiles(id)
);
alter table registro_admin enable row level security;   -- sin políticas: nadie la lee por la API

-- >>> Código inicial: cámbialo por uno tuyo antes de ejecutar <<<
insert into registro_admin (id, codigo_hash)
values (1, extensions.crypt('ANGIE-ADMIN-2026', extensions.gen_salt('bf')))
on conflict (id) do nothing;

create or replace function definir_codigo_registro(p_codigo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not es_admin() then raise exception 'Solo un administrador puede cambiar el código de registro'; end if;
  if length(trim(coalesce(p_codigo, ''))) < 6 then raise exception 'El código debe tener al menos 6 caracteres'; end if;
  insert into registro_admin (id, codigo_hash, cambiado_en, cambiado_por)
  values (1, extensions.crypt(trim(p_codigo), extensions.gen_salt('bf')), now(), auth.uid())
  on conflict (id) do update set codigo_hash = excluded.codigo_hash, cambiado_en = now(), cambiado_por = auth.uid();
  perform registrar_actividad('registro.codigo_cambiado', 'registro_admin', '1', null);
end $$;

create or replace function validar_codigo_registro(p_codigo text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from registro_admin
                 where codigo_hash = extensions.crypt(trim(coalesce(p_codigo, '')), codigo_hash))
$$;

-- 2. Registro de administrador (el usuario ya creó su cuenta con su correo y contraseña)
create or replace function registrar_administrador(p_nombre text, p_codigo text, p_telefono text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_correo text;
begin
  if auth.uid() is null then raise exception 'Inicia sesión para completar el registro'; end if;
  if exists (select 1 from perfiles where id = auth.uid()) then raise exception 'Esta cuenta ya tiene un perfil'; end if;
  if coalesce(trim(p_nombre), '') = '' then raise exception 'Escribe tu nombre'; end if;
  if not validar_codigo_registro(p_codigo) then raise exception 'El código de registro no es correcto'; end if;
  select email into v_correo from auth.users where id = auth.uid();
  insert into perfiles (id, nombre, correo, telefono, rol)
  values (auth.uid(), trim(p_nombre), lower(v_correo), nullif(trim(coalesce(p_telefono, '')), ''), 'admin');
  perform registrar_actividad('registro.administrador', 'perfiles', auth.uid()::text, jsonb_build_object('correo', v_correo));
end $$;

-- 3. El administrador restablece el acceso de un vendedor
create or replace function admin_actualizar_acceso(p_perfil uuid, p_correo text default null, p_clave text default null)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_rol rol_usuario; v_correo text := lower(trim(coalesce(p_correo, '')));
begin
  if not es_admin() then raise exception 'Solo un administrador puede restablecer accesos'; end if;
  select rol into v_rol from perfiles where id = p_perfil;
  if not found then raise exception 'El empleado no existe'; end if;
  if v_rol <> 'vendedor' then raise exception 'Solo se restablece el acceso de vendedores. Un administrador usa «¿Olvidaste tu contraseña?»'; end if;
  if v_correo = '' and coalesce(p_clave, '') = '' then raise exception 'Escribe el nuevo correo o la nueva contraseña'; end if;

  if v_correo <> '' then
    if v_correo !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'Escribe un correo válido'; end if;
    if exists (select 1 from auth.users where lower(email) = v_correo and id <> p_perfil) then
      raise exception 'Ese correo ya lo usa otra cuenta';
    end if;
    update auth.users set email = v_correo, email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now()
     where id = p_perfil;
    update auth.identities set identity_data = identity_data || jsonb_build_object('email', v_correo), updated_at = now()
     where user_id = p_perfil and provider = 'email';
    update perfiles set correo = v_correo where id = p_perfil;
  end if;

  if coalesce(p_clave, '') <> '' then
    if length(p_clave) < 8 then raise exception 'La contraseña debe tener al menos 8 caracteres'; end if;
    update auth.users set encrypted_password = extensions.crypt(p_clave, extensions.gen_salt('bf')), updated_at = now()
     where id = p_perfil;
  end if;

  delete from auth.sessions where user_id = p_perfil;   -- cierra sus sesiones abiertas
  perform registrar_actividad('empleado.acceso_restablecido', 'perfiles', p_perfil::text,
          jsonb_build_object('correo_cambiado', v_correo <> '', 'clave_cambiada', coalesce(p_clave, '') <> ''));
end $$;

revoke all on function definir_codigo_registro(text) from public, anon;
revoke all on function registrar_administrador(text, text, text) from public, anon;
revoke all on function admin_actualizar_acceso(uuid, text, text) from public, anon;
grant execute on function definir_codigo_registro(text) to authenticated;
grant execute on function registrar_administrador(text, text, text) to authenticated;
grant execute on function admin_actualizar_acceso(uuid, text, text) to authenticated;
grant execute on function validar_codigo_registro(text) to anon, authenticated;

-- Verificación: debe devolver 4 filas
select proname from pg_proc
 where proname in ('definir_codigo_registro','validar_codigo_registro','registrar_administrador','admin_actualizar_acceso');
