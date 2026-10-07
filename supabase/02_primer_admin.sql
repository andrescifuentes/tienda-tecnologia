-- =====================================================================
--  TechStore · Crear el primer administrador
--  Ejecutar DESPUÉS de 01_esquema.sql
-- =====================================================================
-- Paso 1. En Supabase: Authentication > Users > Add user > Create new user
--         Escribe el correo y la contraseña del administrador y marca
--         "Auto Confirm User". Copia el UUID que aparece en la lista.
--
-- Paso 2. Reemplaza los tres valores de abajo y ejecuta este script.

insert into perfiles (id, nombre, correo, rol)
values (
  'PEGA-AQUI-EL-UUID-DEL-USUARIO',
  'Marcela Herrera',
  'tu-correo@ejemplo.com',
  'admin'
);

-- Verificación: debe devolver 1 fila con rol = admin y activo = true
select id, nombre, correo, rol, activo from perfiles;
