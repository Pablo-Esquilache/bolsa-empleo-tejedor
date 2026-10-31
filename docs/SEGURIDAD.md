# Políticas de Seguridad — Bolsa de Empleo Tejedor

1. **Row Level Security (RLS) Obligatorio:**
   Todas las tablas del esquema `public` tienen RLS habilitado. Ningún dato privado (`candidate_private`, `employer_private`) se expone en consultas abiertas.

2. **Protección Real del Panel `/admin`:**
   Que la ruta `/admin` no tenga un botón visible en la barra pública es solo orden visual; la seguridad real reside en la validación `is_admin()` en las políticas RLS y funciones RPC de PostgreSQL.

3. **Archivos Seguros en Supabase Storage:**
   - **Fotos y Logos (`avatars_and_logos`):** Redimensionados en el cliente a máximo `512x512 px` en formato WebP (50–150 KB), eliminando metadatos EXIF de ubicación antes de subir.
   - **Currículum Vitae (`cvs`):** Bucket privado. Se valida tamaño máximo (5 MB), tipo MIME `application/pdf` y los primeros 5 bytes (`%PDF-`). Solo se accede mediante URL firmada temporal de 60 segundos cuando existe permiso (`contact_grants`), postulación activa o rol `admin`.

4. **Variables de Entorno:**
   - En el navegador (`VITE_*`) solo se exponen `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` y `VITE_APP_NAME`.
   - Las claves privadas (`SUPABASE_SERVICE_ROLE_KEY`, `BREVO_API_KEY`) viven únicamente en el entorno seguro del servidor (Supabase / Netlify Functions).
