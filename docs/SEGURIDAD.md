# Políticas de Seguridad — Bolsa de Empleo Tejedor

1. **Acceso por Funciones RPC Autenticadas y RLS:**
   Todas las tablas sensibles del esquema `public` tienen RLS habilitado y permisos directos revocados para `anon` y `authenticated`. Toda lectura y escritura pasa por funciones `SECURITY DEFINER` que validan el token de sesión (`get_session_profile`), el estado activo de la cuenta (`status = 'active'`) y el rol (`candidate`, `employer`, `admin`).

2. **Códigos OTP de 6 Dígitos en el Servidor:**
   - El código se genera en el servidor (`gen_random_bytes`), se almacena únicamente su hash SHA-256 (`code_hash`), vence a los 10 minutos, admite un máximo de 5 intentos y se envía desde el backend (`/api/auth-request-otp`) sin viajar nunca al navegador.
   - El envío de correos transaccionales (`/api/notify-event`) valida la sesión en base de datos, escapa contenido HTML y utiliza plantillas fijas en el servidor.

3. **Protección de Currículums (PDF) e Imágenes:**
   - **Fotos y Logos:** Redimensionados y comprimidos a formato WebP eliminando metadatos EXIF y validando el esquema antes de guardar.
   - **Currículum Vitae:** Validación de firma `%PDF-` y límite de 5 MB tanto en cliente como en servidor (`upload_candidate_cv`). La visualización (`/ver-cv/:candidateId`) exige sesión activa autorizada (`get_authorized_cv_file`).
