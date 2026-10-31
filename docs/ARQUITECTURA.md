# Arquitectura de la Aplicación — Bolsa de Empleo Tejedor

## 1. Visión General
Aplicación web progresiva (SPA en React + TypeScript + Vite) respaldada por **Supabase** (PostgreSQL, Row Level Security, Storage, Auth con OTP de 6 dígitos vía SMTP de Brevo y Edge Functions) y desplegada en **Netlify**.

## 2. Separación de Datos Públicos y Privados
Para garantizar que ningún dato sensible (teléfono, fecha de nacimiento, correo o archivo CV) se filtre por accidente en consultas públicas:
- **Tablas de perfil visible:** `candidate_profiles`, `employer_profiles`, `job_posts`.
- **Tablas privadas (`*_private`):** `candidate_private`, `employer_private`. Ningún visitante ni usuario común tiene permiso `SELECT` directo sobre estas tablas.
- **Permisos de contacto (`contact_grants`):** Determina qué empleador tiene autorización vigente para contactar por WhatsApp o abrir el CV de un postulante.

## 3. Estructura de Carpetas (`src/`)
- `src/components/layout/`: Estructura visual para el sitio público (`MainLayout`) y el panel de administración (`AdminLayout`).
- `src/components/ui/`: Componentes reutilizables, incluyendo `ChipSelector` (botones cliqueables con soporte para opción `"Otro"`).
- `src/lib/`:
  - `supabase.ts`: Cliente tipado de Supabase.
  - `constants.ts`: Catálogos iniciales cliqueables (Situación laboral actual, Disponibilidad horaria, Nivel de formación, Rubros, Puestos sugeridos y Localidades de Carlos Tejedor y la región).
  - `imageCompression.ts`: Compresión en el navegador a WebP (`512x512 px`, 50–150 KB, sin metadatos EXIF).
  - `pdfValidation.ts`: Validación de firma binaria `%PDF-` y tamaño máximo (5 MB).
- `src/pages/`: Vistas principales con carga diferida (`React.lazy`).
- `src/types/`: Definiciones TypeScript del esquema de base de datos.
