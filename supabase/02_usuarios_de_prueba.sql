-- =====================================================================
--  TechStore · Usuarios de prueba (genéricos)
--  Ejecutar DESPUÉS de 01_esquema.sql. Reemplaza a 02_primer_admin.sql
--  mientras se desarrolla la app. Se pueden borrar con
--  99_borrar_usuarios_de_prueba.sql
--
--  Cuentas creadas (correo / contraseña):
--    Administrador:  admin@prueba.com     /  Admin12345
--    Vendedor:       vendedor@prueba.com  /  Vendedor12345
-- =====================================================================

do $$
declare
  u record;
  v_id uuid;
begin
  for u in
    select * from (values
      ('admin@prueba.com',    'Admin12345',    'Administrador de prueba', 'admin'::rol_usuario,    null::numeric),
      ('vendedor@prueba.com', 'Vendedor12345', 'Vendedor de prueba',      'vendedor'::rol_usuario, 3::numeric)
    ) as t(correo, clave, nombre, rol, comision)
  loop
    select id into v_id from auth.users where email = u.correo;

    if v_id is null then
      v_id := gen_random_uuid();

      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change, email_change_token_new
      ) values (
        '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
        u.correo, extensions.crypt(u.clave, extensions.gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
        '', '', '', ''
      );

      insert into auth.identities (
        id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
      ) values (
        gen_random_uuid(), v_id, v_id::text,
        jsonb_build_object('sub', v_id::text, 'email', u.correo, 'email_verified', true),
        'email', now(), now(), now()
      );
    end if;

    insert into perfiles (id, nombre, correo, rol, comision_pct)
    values (v_id, u.nombre, u.correo, u.rol, u.comision)
    on conflict (id) do nothing;
  end loop;
end $$;

-- Verificación: deben aparecer 2 filas (admin y vendedor), ambas activas
select id, nombre, correo, rol, comision_pct, activo from perfiles order by rol;
