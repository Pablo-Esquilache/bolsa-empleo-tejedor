-- ============================================================================
-- BOLSA DE EMPLEO TEJEDOR — ESQUEMA COMPLETO (FASE 2)
-- Separación de datos públicos y privados, RLS estricto, Catálogos y Storage
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- 1. TIPOS ENUMERADOS
DO $$ BEGIN
  CREATE TYPE public.user_role AS ENUM ('candidate', 'employer', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.account_status AS ENUM ('active', 'paused', 'deleted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.work_situation AS ENUM ('seeking_job', 'Employed_seeking_change');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.job_status AS ENUM ('active', 'paused', 'closed', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.application_status AS ENUM ('received', 'shortlisted', 'rejected', 'withdrawn');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.contact_request_status AS ENUM ('pending', 'accepted', 'rejected', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. CATÁLOGOS ADMINISTRABLES (Localidades y Rubros)
CREATE TABLE IF NOT EXISTS public.localities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  district text NOT NULL DEFAULT 'Carlos Tejedor',
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.industries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL UNIQUE,
  suggested_positions text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3. TABLA BASE DE PERFILES / ROLES (1 email = 1 rol)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  role public.user_role NOT NULL DEFAULT 'candidate',
  status public.account_status NOT NULL DEFAULT 'active',
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 4. POSTULANTES: DATOS PÚBLICOS Y DATOS PRIVADOS SEPARADOS
CREATE TABLE IF NOT EXISTS public.candidate_profiles (
  id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  first_name text NOT NULL,
  last_name text NOT NULL,
  avatar_url text,
  locality text NOT NULL,
  work_situation public.work_situation NOT NULL DEFAULT 'seeking_job',
  availability text[] NOT NULL DEFAULT '{}',
  education_level text NOT NULL,
  industries text[] NOT NULL DEFAULT '{}',
  positions text[] NOT NULL DEFAULT '{}',
  custom_other_text text,
  bio_short text NOT NULL DEFAULT '',
  cv_path text,
  is_searching boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.candidate_private (
  id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  birth_date date,
  phone text NOT NULL,
  email text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 5. COMERCIOS / EMPLEADORES: DATOS PÚBLICOS Y DATOS PRIVADOS SEPARADOS
CREATE TABLE IF NOT EXISTS public.employer_profiles (
  id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  trade_name text NOT NULL,
  legal_name text,
  cuit text,
  logo_url text,
  industry text NOT NULL,
  locality text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_verified boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.employer_private (
  id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  contact_person_name text NOT NULL,
  phone text NOT NULL,
  email text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 6. BÚSQUEDAS LABORALES (Publicación inmediata con moderación reactiva)
CREATE TABLE IF NOT EXISTS public.job_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id uuid NOT NULL REFERENCES public.employer_profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  industry text NOT NULL,
  position_tag text NOT NULL,
  custom_other_text text,
  locality text NOT NULL,
  availability text[] NOT NULL DEFAULT '{}',
  required_education text NOT NULL DEFAULT 'Primario',
  description text NOT NULL,
  status public.job_status NOT NULL DEFAULT 'active',
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '45 days'),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 7. POSTULACIONES, SOLICITUDES Y PERMISOS DE CONTACTO (WhatsApp + CV)
CREATE TABLE IF NOT EXISTS public.applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_post_id uuid NOT NULL REFERENCES public.job_posts(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.candidate_profiles(id) ON DELETE CASCADE,
  status public.application_status NOT NULL DEFAULT 'received',
  message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_post_id, candidate_id)
);

CREATE TABLE IF NOT EXISTS public.contact_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id uuid NOT NULL REFERENCES public.employer_profiles(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.candidate_profiles(id) ON DELETE CASCADE,
  message text,
  status public.contact_request_status NOT NULL DEFAULT 'pending',
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.contact_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id uuid NOT NULL REFERENCES public.employer_profiles(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.candidate_profiles(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('application', 'request')),
  source_id uuid NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 8. DENUNCIAS, COLA DE CORREOS Y AUDITORÍA
CREATE TABLE IF NOT EXISTS public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  target_type text NOT NULL CHECK (target_type IN ('candidate', 'employer', 'job_post')),
  target_id uuid NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_email text NOT NULL,
  subject text NOT NULL,
  html_body text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  target_id uuid,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 9. ÍNDICES DE RENDIMIENTO Y FILTROS
CREATE INDEX IF NOT EXISTS idx_candidate_profiles_locality ON public.candidate_profiles(locality);
CREATE INDEX IF NOT EXISTS idx_candidate_profiles_industries ON public.candidate_profiles USING GIN(industries);
CREATE INDEX IF NOT EXISTS idx_candidate_profiles_availability ON public.candidate_profiles USING GIN(availability);
CREATE INDEX IF NOT EXISTS idx_job_posts_locality ON public.job_posts(locality);
CREATE INDEX IF NOT EXISTS idx_job_posts_industry ON public.job_posts(industry);
CREATE INDEX IF NOT EXISTS idx_job_posts_status ON public.job_posts(status);
CREATE INDEX IF NOT EXISTS idx_contact_grants_pair ON public.contact_grants(employer_id, candidate_id) WHERE revoked_at IS NULL;

-- 10. FUNCIONES DE SEGURIDAD (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
      AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.has_contact_grant(p_employer_id uuid, p_candidate_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.contact_grants
    WHERE employer_id = p_employer_id
      AND candidate_id = p_candidate_id
      AND revoked_at IS NULL
  );
$$;

-- 11. HABILITAR ROW LEVEL SECURITY (RLS) EN TODAS LAS TABLAS
ALTER TABLE public.localities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.industries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_private ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employer_private ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_log ENABLE ROW LEVEL SECURITY;

-- Políticas de Catálogos (Lectura pública, edición solo Admin)
DROP POLICY IF EXISTS "localities_read_all" ON public.localities;
CREATE POLICY "localities_read_all" ON public.localities FOR SELECT USING (true);
DROP POLICY IF EXISTS "localities_admin_all" ON public.localities;
CREATE POLICY "localities_admin_all" ON public.localities FOR ALL USING (public.is_admin());

DROP POLICY IF EXISTS "industries_read_all" ON public.industries;
CREATE POLICY "industries_read_all" ON public.industries FOR SELECT USING (true);
DROP POLICY IF EXISTS "industries_admin_all" ON public.industries;
CREATE POLICY "industries_admin_all" ON public.industries FOR ALL USING (public.is_admin());

-- Políticas de Profiles
DROP POLICY IF EXISTS "profiles_select_public_or_own_or_admin" ON public.profiles;
CREATE POLICY "profiles_select_public_or_own_or_admin" ON public.profiles
  FOR SELECT USING (status = 'active' OR id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "profiles_update_own_or_admin" ON public.profiles;
CREATE POLICY "profiles_update_own_or_admin" ON public.profiles
  FOR UPDATE USING (id = auth.uid() OR public.is_admin());

-- Políticas de Candidate Profiles (Datos visibles)
DROP POLICY IF EXISTS "candidate_profiles_select" ON public.candidate_profiles;
CREATE POLICY "candidate_profiles_select" ON public.candidate_profiles
  FOR SELECT USING (
    id = auth.uid()
    OR public.is_admin()
    OR (
      is_searching = true
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = candidate_profiles.id AND p.status = 'active'
      )
    )
    OR public.has_contact_grant(auth.uid(), id)
  );

DROP POLICY IF EXISTS "candidate_profiles_insert_own" ON public.candidate_profiles;
CREATE POLICY "candidate_profiles_insert_own" ON public.candidate_profiles
  FOR INSERT WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "candidate_profiles_update_own_or_admin" ON public.candidate_profiles;
CREATE POLICY "candidate_profiles_update_own_or_admin" ON public.candidate_profiles
  FOR UPDATE USING (id = auth.uid() OR public.is_admin());

-- Políticas de Candidate Private (Teléfono, nacimiento, email: NUNCA públicos)
DROP POLICY IF EXISTS "candidate_private_select_strict" ON public.candidate_private;
CREATE POLICY "candidate_private_select_strict" ON public.candidate_private
  FOR SELECT USING (
    id = auth.uid()
    OR public.is_admin()
    OR public.has_contact_grant(auth.uid(), id)
  );

DROP POLICY IF EXISTS "candidate_private_insert_own" ON public.candidate_private;
CREATE POLICY "candidate_private_insert_own" ON public.candidate_private
  FOR INSERT WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "candidate_private_update_own_or_admin" ON public.candidate_private;
CREATE POLICY "candidate_private_update_own_or_admin" ON public.candidate_private
  FOR UPDATE USING (id = auth.uid() OR public.is_admin());

-- Políticas de Employer Profiles
DROP POLICY IF EXISTS "employer_profiles_select" ON public.employer_profiles;
CREATE POLICY "employer_profiles_select" ON public.employer_profiles
  FOR SELECT USING (
    id = auth.uid()
    OR public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = employer_profiles.id AND p.status = 'active'
    )
  );

DROP POLICY IF EXISTS "employer_profiles_insert_own" ON public.employer_profiles;
CREATE POLICY "employer_profiles_insert_own" ON public.employer_profiles
  FOR INSERT WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "employer_profiles_update_own_or_admin" ON public.employer_profiles;
CREATE POLICY "employer_profiles_update_own_or_admin" ON public.employer_profiles
  FOR UPDATE USING (id = auth.uid() OR public.is_admin());

-- Políticas de Employer Private (Solo dueño o Admin)
DROP POLICY IF EXISTS "employer_private_select_strict" ON public.employer_private;
CREATE POLICY "employer_private_select_strict" ON public.employer_private
  FOR SELECT USING (id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "employer_private_insert_own" ON public.employer_private;
CREATE POLICY "employer_private_insert_own" ON public.employer_private
  FOR INSERT WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "employer_private_update_own_or_admin" ON public.employer_private;
CREATE POLICY "employer_private_update_own_or_admin" ON public.employer_private
  FOR UPDATE USING (id = auth.uid() OR public.is_admin());

-- Políticas de Job Posts
DROP POLICY IF EXISTS "job_posts_select" ON public.job_posts;
CREATE POLICY "job_posts_select" ON public.job_posts
  FOR SELECT USING (
    (status = 'active' AND deleted_at IS NULL)
    OR employer_id = auth.uid()
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "job_posts_insert_employer" ON public.job_posts;
CREATE POLICY "job_posts_insert_employer" ON public.job_posts
  FOR INSERT WITH CHECK (employer_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "job_posts_update_employer_or_admin" ON public.job_posts;
CREATE POLICY "job_posts_update_employer_or_admin" ON public.job_posts
  FOR UPDATE USING (employer_id = auth.uid() OR public.is_admin());

-- Políticas de Applications
DROP POLICY IF EXISTS "applications_select" ON public.applications;
CREATE POLICY "applications_select" ON public.applications
  FOR SELECT USING (
    candidate_id = auth.uid()
    OR public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.job_posts jp
      WHERE jp.id = applications.job_post_id AND jp.employer_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "applications_insert_candidate" ON public.applications;
CREATE POLICY "applications_insert_candidate" ON public.applications
  FOR INSERT WITH CHECK (candidate_id = auth.uid());

DROP POLICY IF EXISTS "applications_update_parties" ON public.applications;
CREATE POLICY "applications_update_parties" ON public.applications
  FOR UPDATE USING (
    candidate_id = auth.uid()
    OR public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.job_posts jp
      WHERE jp.id = applications.job_post_id AND jp.employer_id = auth.uid()
    )
  );

-- Políticas de Contact Requests & Contact Grants
DROP POLICY IF EXISTS "contact_requests_select" ON public.contact_requests;
CREATE POLICY "contact_requests_select" ON public.contact_requests
  FOR SELECT USING (employer_id = auth.uid() OR candidate_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "contact_requests_insert_employer" ON public.contact_requests;
CREATE POLICY "contact_requests_insert_employer" ON public.contact_requests
  FOR INSERT WITH CHECK (employer_id = auth.uid());

DROP POLICY IF EXISTS "contact_requests_update_parties" ON public.contact_requests;
CREATE POLICY "contact_requests_update_parties" ON public.contact_requests
  FOR UPDATE USING (employer_id = auth.uid() OR candidate_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "contact_grants_select" ON public.contact_grants;
CREATE POLICY "contact_grants_select" ON public.contact_grants
  FOR SELECT USING (employer_id = auth.uid() OR candidate_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "contact_grants_insert" ON public.contact_grants;
CREATE POLICY "contact_grants_insert" ON public.contact_grants
  FOR INSERT WITH CHECK (employer_id = auth.uid() OR candidate_id = auth.uid() OR public.is_admin());

-- Políticas de Denuncias (Reports)
DROP POLICY IF EXISTS "reports_insert_authenticated" ON public.reports;
CREATE POLICY "reports_insert_authenticated" ON public.reports
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "reports_admin_all" ON public.reports;
CREATE POLICY "reports_admin_all" ON public.reports
  FOR ALL USING (public.is_admin());

-- 12. PRECARGA DE LOCALIDADES Y RUBROS (SEEDS)
INSERT INTO public.localities (name, district, sort_order) VALUES
  ('Carlos Tejedor', 'Carlos Tejedor', 1),
  ('Tres Algarrobos (Cuenca)', 'Carlos Tejedor', 2),
  ('Colonia Seré', 'Carlos Tejedor', 3),
  ('Timote', 'Carlos Tejedor', 4),
  ('Curarú', 'Carlos Tejedor', 5),
  ('América (Rivadavia)', 'Rivadavia', 10),
  ('General Villegas', 'General Villegas', 11),
  ('Pehuajó', 'Pehuajó', 12),
  ('Lincoln', 'Lincoln', 13),
  ('Trenque Lauquen', 'Trenque Lauquen', 14)
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.industries (slug, name, suggested_positions, sort_order) VALUES
  ('comercio-ventas', 'Comercio y Ventas', ARRAY['Vendedor/a de salón', 'Cajero/a', 'Repositor/a', 'Atención al público', 'Encargado/a de local', 'Reparto / Cadetería'], 1),
  ('agro-campo', 'Agro y Campo', ARRAY['Tractorista / Maquinista', 'Peón general de campo', 'Casero/a rural', 'Tambero/a', 'Recorredor / Ganadería', 'Ingeniero/a Agrónomo / Veterinario/a', 'Encargado/a de establecimiento'], 2),
  ('administracion-contable', 'Administración y Contable', ARRAY['Administrativo/a general', 'Secretario/a / Recepcionista', 'Facturación y Cobranzas', 'Auxiliar contable', 'Atención telefónica / WhatsApp'], 3),
  ('gastronomia-alimentos', 'Gastronomía y Alimentos', ARRAY['Cocinero/a', 'Ayudante de cocina', 'Mozo / Camarero/a', 'Panadero/a / Pastelero/a', 'Carnicero/a', 'Delivery gastronómico'], 4),
  ('construccion-mantenimiento', 'Construcción, Mantenimiento y Oficios', ARRAY['Albañil / Ayudante de albañil', 'Electricista', 'Plomero / Gasista', 'Pintor', 'Soldador / Herrero', 'Carpintero', 'Mantenimiento general / Parquero'], 5),
  ('transporte-logistica', 'Transporte y Logística', ARRAY['Chofer de camión / Cerealero', 'Chofer de reparto / Camioneta', 'Operario/a de depósito / Carga y descarga', 'Mecánico / Gomero'], 6),
  ('salud-cuidado', 'Salud y Cuidado de Personas', ARRAY['Cuidado de adultos mayores', 'Niñera / Cuidado infantil', 'Acompañante terapéutico', 'Enfermería / Auxiliar de farmacia'], 7),
  ('servicios-domesticos-limpieza', 'Limpieza y Servicios Generales', ARRAY['Empleada doméstica / Tareas del hogar', 'Limpieza de comercios / oficinas', 'Lavandería y planchado', 'Sereno / Vigilancia'], 8)
ON CONFLICT (slug) DO NOTHING;

-- 13. CONFIGURACIÓN DE STORAGE BUCKETS (avatars_and_logos público, cvs privado)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('avatars_and_logos', 'avatars_and_logos', true, 1048576, ARRAY['image/webp', 'image/jpeg', 'image/png']),
  ('cvs', 'cvs', false, 5242880, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- Políticas de Storage para avatars_and_logos
DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
CREATE POLICY "avatars_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars_and_logos');

DROP POLICY IF EXISTS "avatars_auth_upload" ON storage.objects;
CREATE POLICY "avatars_auth_upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'avatars_and_logos'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "avatars_auth_update" ON storage.objects;
CREATE POLICY "avatars_auth_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'avatars_and_logos'
    AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin())
  );

-- Políticas de Storage para cvs (Privado: dueño, admin o empleador con contact_grant)
DROP POLICY IF EXISTS "cvs_strict_read" ON storage.objects;
CREATE POLICY "cvs_strict_read" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'cvs'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin()
      OR public.has_contact_grant(auth.uid(), ((storage.foldername(name))[1])::uuid)
    )
  );

DROP POLICY IF EXISTS "cvs_owner_upload" ON storage.objects;
CREATE POLICY "cvs_owner_upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'cvs'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "cvs_owner_update" ON storage.objects;
CREATE POLICY "cvs_owner_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'cvs'
    AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin())
  );
