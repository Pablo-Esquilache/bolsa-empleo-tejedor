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
  - `VITE_SITE_OWNER_NAME` (Nombre o razón del responsable mostrado en los textos legales y pie de página)
  - `VITE_PRIVACY_CONTACT_EMAIL` (Correo para ejercer derechos de acceso, rectificación o supresión)
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

---

## Legal y Privacidad (Ley 25.326)

- **Versión vigente de los textos:** `2026-11-11` (definida en `src/lib/legalTexts.ts` y en `public.app_settings` con clave `'legal_version'`).
- **Variables de entorno públicas en Netlify:** `VITE_SITE_OWNER_NAME` y `VITE_PRIVACY_CONTACT_EMAIL`.
- **Cómo forzar nueva aceptación de Términos y Política:**
  1. Actualizá los textos y `LEGAL_VERSION` en `src/lib/legalTexts.ts`.
  2. Actualizá el valor `'legal_version'` en `public.app_settings` (vía migración SQL o SQL Editor en Supabase). Ambos valores deben coincidir; de lo contrario, el servidor rechazará la solicitud de OTP hasta que el usuario recargue la web y acepte la nueva versión.
- **Limpieza automática semanal:** la Netlify Scheduled Function `netlify/functions/purge-inactive.mjs` (`schedule = "@weekly"` en `netlify.toml`) llama a `public.purge_inactive_data()` con `SUPABASE_SERVICE_ROLE_KEY`. Purga cuentas no-admin sin actividad en 24 meses, avisos vencidos o eliminados hace más de 90 días, OTP de más de 7 días, sesiones vencidas, `access_log` y denuncias cerradas de más de 12 meses y `notification_outbox` de más de 90 días.
- **Cómo detectar y pausar cuentas existentes de menores de 18 años:**
  ```sql
  SELECT cp.id, p.email, cp.first_name, cp.last_name, cpriv.birth_date
  FROM public.candidate_profiles cp
  JOIN public.profiles p ON p.id = cp.id
  LEFT JOIN public.candidate_private cpriv ON cpriv.id = cp.id
  WHERE p.status = 'active'
    AND (cpriv.birth_date IS NULL OR cpriv.birth_date > (current_date - interval '18 years')::date);
  ```
  Para pausarlas:
  ```sql
  UPDATE public.profiles p
  SET status = 'paused', updated_at = now()
  FROM public.candidate_private cpriv
  WHERE p.id = cpriv.id
    AND p.role = 'candidate'
    AND p.status = 'active'
    AND (cpriv.birth_date IS NULL OR cpriv.birth_date > (current_date - interval '18 years')::date);
  ```
