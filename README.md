# TechStore — app de tienda de tecnología

Misma tecnología que la app de la herrería: **React + Vite + Tailwind + Supabase + Capacitor**.

## Primera vez (Windows)
1. Instalar Node.js LTS desde https://nodejs.org (Windows Installer .msi).
2. En esta carpeta: copia `.env.example` a `.env` y pon tu `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`
   (Supabase → Project Settings → API).
3. `npm install`
4. `npm run dev` → abre http://localhost:5173

Usuarios de prueba (si ejecutaste `supabase/02_usuarios_de_prueba.sql`):
- admin@prueba.com / Admin12345
- vendedor@prueba.com / Vendedor12345

## Base de datos (`supabase/`)
Orden: `01_esquema.sql` → `02_usuarios_de_prueba.sql` (o `02_primer_admin.sql`) → desplegar `functions/crear-empleado`.
Para borrar los usuarios de prueba: `99_borrar_usuarios_de_prueba.sql`.

### Función para crear empleados
Instala la CLI de Supabase y, desde esta carpeta:
```
supabase login
supabase link --project-ref TU_REF
supabase functions deploy crear-empleado
```
Y en Supabase → Authentication → Providers → Email: desactiva "Allow new users to sign up".

## Móvil (Capacitor)
```
npm run build
npx cap add android
npm run cap:sync
npx cap open android
```
