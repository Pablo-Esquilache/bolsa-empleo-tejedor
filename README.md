# Bolsa de Empleo Tejedor

Plataforma laboral comunitaria para el partido de **Carlos Tejedor** y sus localidades (Carlos Tejedor, Tres Algarrobos, Colonia Seré, Timote y Curarú).

Conecta **Postulantes** con **Comercios, Empresas y Productores locales** mediante búsquedas rápidas por botones, seguimiento de postulaciones y contacto directo por WhatsApp.

---

## Stack Tecnológico

- **Frontend:** React 18 + TypeScript + Vite + Tailwind CSS
- **Base de Datos y Seguridad:** Supabase (PostgreSQL, RLS y funciones RPC `SECURITY DEFINER` con `SET search_path = public, extensions`)
- **Ingreso sin contraseñas:** Código OTP de 6 dígitos por correo electrónico (hash SHA-256, máximo 5 intentos, sesiones de 30 días y protección anti-bots con Cloudflare Turnstile)
- **Backend Serverless:** Netlify Functions (`auth-request-otp.mjs`, `notify-event.mjs`) + Brevo API

---

## Variables de Entorno

Copiá `.env.example` y configurá las variables en Netlify (`Site configuration → Environment variables`):

- **Públicas (Vite):**
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `VITE_APP_NAME`
  - `VITE_TURNSTILE_SITE_KEY`
- **Privadas de Servidor (Netlify Functions — nunca con prefijo `VITE_`):**
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `BREVO_API_KEY`
  - `BREVO_SENDER_EMAIL`
  - `BREVO_SENDER_NAME`
  - `TURNSTILE_SECRET_KEY`

---

## Comandos de Desarrollo

```bash
npm install
npm run dev      # Servidor local Vite
npm run lint     # Verificación estricta de tipos (tsc --noEmit)
npm run build    # Compilación de producción
```

---

## Mantenimiento y Seguridad Operativa

### 1. Limpieza del bucket legado `cvs` en Supabase Storage
- Los Currículums Vitae en PDF se almacenan de forma privada en la tabla `public.private_cv_files` (con RLS activo y `REVOKE ALL` para `public, anon, authenticated`) y se sirven únicamente a través del RPC autorizado `public.get_authorized_cv_file` (registrando cada apertura en `public.access_log`).
- El antiguo bucket de Supabase Storage llamado `cvs` **ya no se utiliza** en ninguna parte del código (`src/`, `netlify/` ni funciones vigentes).
- **Acción recomendada en Supabase Studio:** ingresar a **Storage → `cvs`**, vaciar cualquier archivo PDF histórico que haya quedado de pruebas iniciales y eliminar el bucket (`Delete bucket`), o ejecutar un script local puntual utilizando `SUPABASE_SERVICE_ROLE_KEY` desde variables de entorno.

### 2. Decisión de Arquitectura sobre `Content-Security-Policy` (CSP)
- El archivo `netlify.toml` aplica cabeceras de seguridad estándar (`X-Frame-Options = "DENY"`, `X-Content-Type-Options = "nosniff"`, `Referrer-Policy = "strict-origin-when-cross-origin"` y `Permissions-Policy`).
- **Riesgo aceptado y documentado:** no se define una cabecera `Content-Security-Policy` restrictiva por el momento porque ciertas extensiones de navegador de uso frecuente inyectan llamadas `data:` dentro de iframes de terceros y provocan falsos positivos (`Error 600010`) en el widget de Cloudflare Turnstile. La mitigación de XSS descansa en el escape automático de React en el frontend y `public.escape_html()` en los correos transaccionales; si en el futuro se incorpora renderizado de HTML provisto por usuarios, deberá revisarse e incluirse una política CSP específica.
