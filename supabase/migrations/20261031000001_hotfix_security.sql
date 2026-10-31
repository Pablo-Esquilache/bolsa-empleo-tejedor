-- ============================================================================
-- AUDITORÍA DE SEGURIDAD (ETAPA 0 + ETAPA 1) Y CANAL DE CONSULTAS AL ADMIN
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- 1. Tabla privada de configuración del servidor (secreto compartido con funciones backend)
CREATE TABLE IF NOT EXISTS public.private_server_secrets (
  key text PRIMARY KEY,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.private_server_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.private_server_secrets FROM public, anon, authenticated;

INSERT INTO public.private_server_secrets (key, value)
VALUES ('internal_rpc_key', 'bt_srv_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c')
ON CONFLICT (key) DO NOTHING;

-- 2. Endurecer email_otp_codes (hash SHA-256, intentos máximos y límite de tasa)
ALTER TABLE public.email_otp_codes
  ADD COLUMN IF NOT EXISTS code_hash text,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS client_ip text;

-- Migrar códigos previos si hubiera alguno sin hash
UPDATE public.email_otp_codes
SET code_hash = encode(digest(code, 'sha256'), 'hex'),
    code = 'HASHED'
WHERE code_hash IS NULL;

-- Revocar create_otp_challenge del acceso público y dejar que falle si se invoca directo
CREATE OR REPLACE FUNCTION public.create_otp_challenge(
  p_email text,
  p_role public.user_role DEFAULT 'candidate'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Por seguridad, solicitá el código desde el formulario de ingreso (/api/auth-request-otp).';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_otp_challenge(text, public.user_role) FROM public, anon, authenticated;

-- Nueva función exclusiva para el servidor (/api/auth-request-otp)
CREATE OR REPLACE FUNCTION public.server_issue_otp_challenge(
  p_email text,
  p_role public.user_role,
  p_server_key text,
  p_client_ip text DEFAULT 'unknown'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expected_key text;
  v_clean_email text := lower(trim(COALESCE(p_email, '')));
  v_existing_profile public.profiles%ROWTYPE;
  v_recent_count integer;
  v_last_sent timestamptz;
  v_raw_bytes bytea;
  v_num integer;
  v_code text;
  v_hash text;
BEGIN
  SELECT value INTO v_expected_key
  FROM public.private_server_secrets
  WHERE key = 'internal_rpc_key';

  IF p_server_key IS NULL OR p_server_key <> v_expected_key THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;

  IF v_clean_email = '' OR position('@' in v_clean_email) = 0 OR length(v_clean_email) > 160 THEN
    RAISE EXCEPTION 'Ingresá un correo electrónico válido.';
  END IF;

  IF p_role = 'admin' AND v_clean_email <> 'pabloesquilache@gmail.com' THEN
    RAISE EXCEPTION 'Este correo no tiene permisos de Administrador.';
  END IF;

  -- Límite de 1 código cada 45 segundos por email
  SELECT max(created_at), count(*)
  INTO v_last_sent, v_recent_count
  FROM public.email_otp_codes
  WHERE lower(email) = v_clean_email
    AND created_at > (now() - interval '1 hour');

  IF v_last_sent IS NOT NULL AND v_last_sent > (now() - interval '45 seconds') THEN
    RAISE EXCEPTION 'Esperá unos segundos antes de pedir un código nuevo.';
  END IF;

  IF v_recent_count >= 10 THEN
    RAISE EXCEPTION 'Demasiados intentos recientes para este correo. Probá más tarde.';
  END IF;

  SELECT * INTO v_existing_profile
  FROM public.profiles
  WHERE lower(email) = v_clean_email;

  IF FOUND THEN
    IF v_existing_profile.status = 'deleted' THEN
      RAISE EXCEPTION 'Esta cuenta fue dada de baja por el Administrador.';
    END IF;
    IF v_existing_profile.status = 'paused' THEN
      RAISE EXCEPTION 'Esta cuenta se encuentra pausada temporalmente por el Administrador.';
    END IF;

    IF v_clean_email <> 'pabloesquilache@gmail.com' AND v_existing_profile.role <> p_role THEN
      IF v_existing_profile.role = 'candidate' THEN
        RAISE EXCEPTION 'Este correo ya está registrado como Postulante. Elegí "Soy Postulante" para ingresar.';
      ELSIF v_existing_profile.role = 'employer' THEN
        RAISE EXCEPTION 'Este correo ya está registrado como Comercio. Elegí "Soy Comercio" para ingresar.';
      END IF;
    END IF;
  END IF;

  -- Invalidar códigos anteriores sin usar del mismo email
  UPDATE public.email_otp_codes
  SET used_at = now()
  WHERE lower(email) = v_clean_email
    AND used_at IS NULL;

  -- Generar código criptográfico de 6 dígitos con gen_random_bytes
  v_raw_bytes := gen_random_bytes(4);
  v_num := (
    (get_byte(v_raw_bytes, 0) << 24) |
    (get_byte(v_raw_bytes, 1) << 16) |
    (get_byte(v_raw_bytes, 2) << 8)  |
    get_byte(v_raw_bytes, 3)
  );
  v_num := abs(v_num) % 900000 + 100000;
  v_code := lpad(v_num::text, 6, '0');
  v_hash := encode(digest(v_code, 'sha256'), 'hex');

  INSERT INTO public.email_otp_codes (
    email,
    code,
    code_hash,
    requested_role,
    attempts,
    client_ip,
    expires_at
  ) VALUES (
    v_clean_email,
    'HASHED',
    v_hash,
    p_role,
    0,
    COALESCE(p_client_ip, 'unknown'),
    now() + interval '10 minutes'
  );

  RETURN jsonb_build_object(
    'email', v_clean_email,
    'code', v_code
  );
END;
$$;

-- 3. Verificar código OTP comparando contra el hash SHA-256 y máximo 5 intentos
CREATE OR REPLACE FUNCTION public.verify_otp_code(
  p_email text,
  p_code text,
  p_role public.user_role DEFAULT 'candidate'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean_email text := lower(trim(COALESCE(p_email, '')));
  v_clean_code text := regexp_replace(trim(COALESCE(p_code, '')), '\D', '', 'g');
  v_code_hash text := encode(digest(v_clean_code, 'sha256'), 'hex');
  v_otp_row public.email_otp_codes%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_token text;
  v_effective_role public.user_role;
  v_has_profile boolean := false;
BEGIN
  SELECT * INTO v_otp_row
  FROM public.email_otp_codes
  WHERE lower(email) = v_clean_email
    AND used_at IS NULL
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El código ingresado venció o no existe. Pedí uno nuevo.';
  END IF;

  IF v_otp_row.attempts >= 5 THEN
    UPDATE public.email_otp_codes SET used_at = now() WHERE id = v_otp_row.id;
    RAISE EXCEPTION 'Superaste el máximo de 5 intentos. Pedí un código nuevo.';
  END IF;

  IF v_otp_row.code_hash IS DISTINCT FROM v_code_hash THEN
    UPDATE public.email_otp_codes
    SET attempts = attempts + 1,
        used_at = CASE WHEN attempts + 1 >= 5 THEN now() ELSE used_at END
    WHERE id = v_otp_row.id;

    IF v_otp_row.attempts + 1 >= 5 THEN
      RAISE EXCEPTION 'Código incorrecto. Se agotaron los 5 intentos; pedí un código nuevo.';
    ELSE
      RAISE EXCEPTION 'Código incorrecto. Te quedan % intentos.', (5 - (v_otp_row.attempts + 1));
    END IF;
  END IF;

  -- Marcar como usado
  UPDATE public.email_otp_codes SET used_at = now() WHERE id = v_otp_row.id;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE lower(email) = v_clean_email;

  IF NOT FOUND THEN
    v_effective_role := v_otp_row.requested_role;
    INSERT INTO public.profiles (email, role, status)
    VALUES (v_clean_email, v_effective_role, 'active')
    RETURNING * INTO v_profile;
  ELSE
    IF v_profile.status = 'deleted' THEN
      RAISE EXCEPTION 'Esta cuenta fue dada de baja.';
    END IF;
    IF v_profile.status = 'paused' THEN
      RAISE EXCEPTION 'Tu cuenta está pausada temporalmente por el Administrador.';
    END IF;

    IF v_clean_email = 'pabloesquilache@gmail.com' THEN
      v_effective_role := p_role;
    ELSE
      v_effective_role := v_profile.role;
    END IF;
  END IF;

  IF v_effective_role = 'candidate' THEN
    SELECT EXISTS(SELECT 1 FROM public.candidate_profiles WHERE id = v_profile.id) INTO v_has_profile;
  ELSIF v_effective_role = 'employer' THEN
    SELECT EXISTS(SELECT 1 FROM public.employer_profiles WHERE id = v_profile.id) INTO v_has_profile;
  ELSE
    v_has_profile := true;
  END IF;

  -- Limpiar sesiones vencidas y crear sesión de 30 días
  DELETE FROM public.user_sessions WHERE expires_at <= now();

  INSERT INTO public.user_sessions (user_id, expires_at)
  VALUES (v_profile.id, now() + interval '30 days')
  RETURNING token INTO v_token;

  RETURN jsonb_build_object(
    'token', v_token,
    'has_completed_profile', v_has_profile,
    'user', jsonb_build_object(
      'id', v_profile.id,
      'email', v_profile.email,
      'role', v_effective_role,
      'status', v_profile.status
    )
  );
END;
$$;

-- 4. Función para revocar sesión en el servidor al cerrar sesión (A3)
CREATE OR REPLACE FUNCTION public.logout_user_session(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.user_sessions WHERE token = p_token;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Actualizar get_session_profile para rechazar cuentas pausadas y eliminadas
CREATE OR REPLACE FUNCTION public.get_session_profile(p_token text)
RETURNS public.profiles
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
BEGIN
  IF p_token IS NULL OR trim(p_token) = '' THEN
    RETURN NULL;
  END IF;

  SELECT p.* INTO v_profile
  FROM public.user_sessions s
  JOIN public.profiles p ON p.id = s.user_id
  WHERE s.token = p_token
    AND s.expires_at > now()
    AND p.status = 'active';

  RETURN v_profile;
END;
$$;

-- 5. Cerrar Storage público (C3, S3, S4) y almacenar CVs de forma privada y controlada
UPDATE storage.buckets SET public = false WHERE id = 'cvs';

DROP POLICY IF EXISTS "avatars_app_insert" ON storage.objects;
DROP POLICY IF EXISTS "avatars_app_update" ON storage.objects;
DROP POLICY IF EXISTS "cvs_app_insert" ON storage.objects;
DROP POLICY IF EXISTS "cvs_app_select" ON storage.objects;
DROP POLICY IF EXISTS "cvs_select_authorized" ON storage.objects;
DROP POLICY IF EXISTS "cvs_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "cvs_update_own" ON storage.objects;
DROP POLICY IF EXISTS "cvs_delete_own" ON storage.objects;

CREATE TABLE IF NOT EXISTS public.private_cv_files (
  candidate_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  filename text NOT NULL,
  content_base64 text NOT NULL,
  size_bytes integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.private_cv_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.private_cv_files FROM public, anon, authenticated;

-- Subir CV validando sesión, firma %PDF- y tamaño en el servidor
CREATE OR REPLACE FUNCTION public.upload_candidate_cv(
  p_token text,
  p_filename text,
  p_base64_pdf text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.profiles;
  v_raw bytea;
  v_header text;
  v_size integer;
  v_route text;
BEGIN
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Sesión inválida. Volvé a iniciar sesión.';
  END IF;

  IF v_user.role <> 'candidate' AND lower(v_user.email) <> 'pabloesquilache@gmail.com' THEN
    RAISE EXCEPTION 'Solo los postulantes pueden subir un Currículum.';
  END IF;

  IF p_base64_pdf IS NULL OR length(p_base64_pdf) < 20 THEN
    RAISE EXCEPTION 'Archivo PDF vacío o inválido.';
  END IF;

  v_raw := decode(p_base64_pdf, 'base64');
  v_size := octet_length(v_raw);

  IF v_size > 5 * 1024 * 1024 THEN
    RAISE EXCEPTION 'El archivo supera el límite máximo de 5 MB.';
  END IF;

  v_header := convert_from(substring(v_raw from 1 for 5), 'LATIN1');
  IF v_header <> '%PDF-' THEN
    RAISE EXCEPTION 'El archivo no es un documento PDF auténtico.';
  END IF;

  INSERT INTO public.private_cv_files (candidate_id, filename, content_base64, size_bytes, updated_at)
  VALUES (
    v_user.id,
    COALESCE(NULLIF(trim(p_filename), ''), 'curriculum.pdf'),
    p_base64_pdf,
    v_size,
    now()
  )
  ON CONFLICT (candidate_id) DO UPDATE SET
    filename = EXCLUDED.filename,
    content_base64 = EXCLUDED.content_base64,
    size_bytes = EXCLUDED.size_bytes,
    updated_at = now();

  v_route := '/ver-cv/' || v_user.id::text;

  UPDATE public.candidate_profiles
  SET cv_path = v_route, updated_at = now()
  WHERE id = v_user.id;

  RETURN jsonb_build_object(
    'ok', true,
    'cv_path', v_route
  );
END;
$$;

-- Leer CV solo si tiene sesión activa y permiso (dueño, comercio activo o admin)
CREATE OR REPLACE FUNCTION public.get_authorized_cv_file(
  p_token text,
  p_candidate_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.profiles;
  v_cv public.private_cv_files%ROWTYPE;
  v_cand public.candidate_profiles%ROWTYPE;
  v_allowed boolean := false;
BEGIN
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Acceso denegado. Iniciá sesión para ver este CV.';
  END IF;

  IF v_user.id = p_candidate_id
     OR v_user.role = 'admin'
     OR lower(v_user.email) = 'pabloesquilache@gmail.com'
     OR v_user.role = 'employer' THEN
    v_allowed := true;
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'No tenés permiso para ver el CV de otro postulante.';
  END IF;

  SELECT * INTO v_cv FROM public.private_cv_files WHERE candidate_id = p_candidate_id;
  SELECT * INTO v_cand FROM public.candidate_profiles WHERE id = p_candidate_id;

  IF v_cv.candidate_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'filename', v_cv.filename,
      'content_base64', v_cv.content_base64,
      'legacy_url', NULL
    );
  ELSIF v_cand.cv_path IS NOT NULL AND v_cand.cv_path LIKE 'http%' THEN
    RETURN jsonb_build_object(
      'filename', 'curriculum.pdf',
      'content_base64', NULL,
      'legacy_url', v_cand.cv_path
    );
  ELSE
    RAISE EXCEPTION 'Este postulante no tiene un CV cargado.';
  END IF;
END;
$$;

-- 6. Normalización de teléfono argentino y validación de URLs/rutas en perfiles (A4, A6, E5)
CREATE OR REPLACE FUNCTION public.normalize_ar_phone(p_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_digits text := regexp_replace(COALESCE(p_raw, ''), '\D', '', 'g');
BEGIN
  -- Quitar prefijo internacional 549 o 54 si ya lo pusieron
  IF v_digits ~ '^549\d{10}$' THEN
    v_digits := substring(v_digits from 4);
  ELSIF v_digits ~ '^54\d{10,11}$' THEN
    v_digits := substring(v_digits from 3);
  END IF;

  -- Quitar el 0 inicial del código de área (ej. 02314 -> 2314)
  IF v_digits ~ '^0\d+$' THEN
    v_digits := substring(v_digits from 2);
  END IF;

  -- Quitar el 15 después del código de área si quedó de 12 dígitos (ej. 231415123456 -> 2314123456)
  IF length(v_digits) = 12 AND substring(v_digits from 5 for 2) = '15' THEN
    v_digits := substring(v_digits from 1 for 4) || substring(v_digits from 7);
  ELSIF length(v_digits) = 11 AND substring(v_digits from 4 for 2) = '15' THEN
    v_digits := substring(v_digits from 1 for 3) || substring(v_digits from 6);
  END IF;

  RETURN v_digits;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_candidate_profile(
  p_token text,
  p_first_name text,
  p_last_name text,
  p_birth_date date,
  p_phone text,
  p_province text,
  p_district text,
  p_locality text,
  p_work_situation public.work_situation,
  p_availability text[],
  p_education_level text,
  p_industries text[],
  p_positions text[],
  p_custom_other_text text,
  p_bio_short text,
  p_avatar_url text,
  p_cv_path text,
  p_is_searching boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.profiles;
  v_clean_phone text := public.normalize_ar_phone(p_phone);
  v_safe_avatar text := NULLIF(trim(COALESCE(p_avatar_url, '')), '');
  v_safe_cv text := NULLIF(trim(COALESCE(p_cv_path, '')), '');
BEGIN
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Sesión inválida. Volvé a ingresar.';
  END IF;

  IF v_user.role <> 'candidate' AND lower(v_user.email) <> 'pabloesquilache@gmail.com' THEN
    RAISE EXCEPTION 'Esta acción corresponde solo a cuentas de Postulante.';
  END IF;

  IF length(v_clean_phone) < 8 OR length(v_clean_phone) > 13 THEN
    RAISE EXCEPTION 'Ingresá un número de teléfono válido con código de área (ej: 2314 123456).';
  END IF;

  IF p_birth_date IS NOT NULL THEN
    IF p_birth_date > (current_date - interval '16 years')::date OR p_birth_date < '1930-01-01'::date THEN
      RAISE EXCEPTION 'Ingresá una fecha de nacimiento válida (mayor de 16 años).';
    END IF;
  END IF;

  -- Validar que avatar_url no contenga javascript: ni esquemas peligrosos (A6)
  IF v_safe_avatar IS NOT NULL AND NOT (
    v_safe_avatar LIKE 'data:image/%' OR
    v_safe_avatar LIKE 'https://%.supabase.co/%' OR
    v_safe_avatar LIKE '/%'
  ) THEN
    RAISE EXCEPTION 'Formato de imagen no permitido.';
  END IF;

  IF v_safe_cv IS NOT NULL AND NOT (
    v_safe_cv LIKE ('/ver-cv/' || v_user.id::text || '%') OR
    v_safe_cv LIKE 'https://%.supabase.co/%'
  ) THEN
    v_safe_cv := '/ver-cv/' || v_user.id::text;
  END IF;

  INSERT INTO public.candidate_profiles (
    id, first_name, last_name, avatar_url, province, district, locality,
    work_situation, availability, education_level, industries, positions,
    custom_other_text, bio_short, cv_path, is_searching, updated_at
  ) VALUES (
    v_user.id,
    left(trim(p_first_name), 80),
    left(trim(p_last_name), 80),
    v_safe_avatar,
    COALESCE(NULLIF(trim(p_province), ''), 'Buenos Aires'),
    COALESCE(NULLIF(trim(p_district), ''), 'Carlos Tejedor'),
    left(trim(p_locality), 100),
    p_work_situation,
    COALESCE(p_availability, '{}'),
    p_education_level,
    COALESCE(p_industries, '{}'),
    COALESCE(p_positions, '{}'),
    left(NULLIF(trim(COALESCE(p_custom_other_text, '')), ''), 120),
    left(COALESCE(trim(p_bio_short), ''), 600),
    v_safe_cv,
    COALESCE(p_is_searching, true),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    avatar_url = COALESCE(EXCLUDED.avatar_url, public.candidate_profiles.avatar_url),
    province = EXCLUDED.province,
    district = EXCLUDED.district,
    locality = EXCLUDED.locality,
    work_situation = EXCLUDED.work_situation,
    availability = EXCLUDED.availability,
    education_level = EXCLUDED.education_level,
    industries = EXCLUDED.industries,
    positions = EXCLUDED.positions,
    custom_other_text = EXCLUDED.custom_other_text,
    bio_short = EXCLUDED.bio_short,
    cv_path = COALESCE(EXCLUDED.cv_path, public.candidate_profiles.cv_path),
    is_searching = EXCLUDED.is_searching,
    updated_at = now();

  INSERT INTO public.candidate_private (id, birth_date, phone, email, updated_at)
  VALUES (v_user.id, p_birth_date, v_clean_phone, v_user.email, now())
  ON CONFLICT (id) DO UPDATE SET
    birth_date = EXCLUDED.birth_date,
    phone = EXCLUDED.phone,
    updated_at = now();

  RETURN jsonb_build_object('ok', true, 'id', v_user.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.save_employer_profile(
  p_token text,
  p_trade_name text,
  p_legal_name text,
  p_cuit text,
  p_contact_person_name text,
  p_phone text,
  p_industry text,
  p_province text,
  p_district text,
  p_locality text,
  p_description text,
  p_logo_url text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.profiles;
  v_clean_phone text := public.normalize_ar_phone(p_phone);
  v_safe_logo text := NULLIF(trim(COALESCE(p_logo_url, '')), '');
BEGIN
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Sesión inválida. Volvé a ingresar.';
  END IF;

  IF v_user.role <> 'employer' AND lower(v_user.email) <> 'pabloesquilache@gmail.com' THEN
    RAISE EXCEPTION 'Esta acción corresponde solo a cuentas de Comercio.';
  END IF;

  IF length(v_clean_phone) < 8 OR length(v_clean_phone) > 13 THEN
    RAISE EXCEPTION 'Ingresá un número de teléfono válido con código de área (ej: 2314 123456).';
  END IF;

  IF v_safe_logo IS NOT NULL AND NOT (
    v_safe_logo LIKE 'data:image/%' OR
    v_safe_logo LIKE 'https://%.supabase.co/%' OR
    v_safe_logo LIKE '/%'
  ) THEN
    RAISE EXCEPTION 'Formato de logo no permitido.';
  END IF;

  INSERT INTO public.employer_profiles (
    id, trade_name, legal_name, cuit, logo_url, industry,
    province, district, locality, description, updated_at
  ) VALUES (
    v_user.id,
    left(trim(p_trade_name), 120),
    left(NULLIF(trim(COALESCE(p_legal_name, '')), ''), 120),
    left(NULLIF(trim(COALESCE(p_cuit, '')), ''), 20),
    v_safe_logo,
    left(trim(p_industry), 80),
    COALESCE(NULLIF(trim(p_province), ''), 'Buenos Aires'),
    COALESCE(NULLIF(trim(p_district), ''), 'Carlos Tejedor'),
    left(trim(p_locality), 100),
    left(COALESCE(trim(p_description), ''), 1000),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    trade_name = EXCLUDED.trade_name,
    legal_name = EXCLUDED.legal_name,
    cuit = EXCLUDED.cuit,
    logo_url = COALESCE(EXCLUDED.logo_url, public.employer_profiles.logo_url),
    industry = EXCLUDED.industry,
    province = EXCLUDED.province,
    district = EXCLUDED.district,
    locality = EXCLUDED.locality,
    description = EXCLUDED.description,
    updated_at = now();

  INSERT INTO public.employer_private (id, contact_person_name, phone, email, updated_at)
  VALUES (v_user.id, left(trim(p_contact_person_name), 100), v_clean_phone, v_user.email, now())
  ON CONFLICT (id) DO UPDATE SET
    contact_person_name = EXCLUDED.contact_person_name,
    phone = EXCLUDED.phone,
    updated_at = now();

  RETURN jsonb_build_object('ok', true, 'id', v_user.id);
END;
$$;

-- 7. Mejorar postulaciones y revocación de permisos (A1, S8, S9, F3)
CREATE OR REPLACE FUNCTION public.apply_to_job_post(
  p_token text,
  p_job_post_id uuid,
  p_message text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.profiles;
  v_job public.job_posts%ROWTYPE;
  v_candidate public.candidate_profiles%ROWTYPE;
  v_existing_app public.applications%ROWTYPE;
  v_app_id uuid;
BEGIN
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Ingresá con tu cuenta de Postulante para postularte.';
  END IF;

  IF v_user.role <> 'candidate' AND lower(v_user.email) <> 'pabloesquilache@gmail.com' THEN
    RAISE EXCEPTION 'Solo las cuentas de Postulante pueden postularse a búsquedas.';
  END IF;

  SELECT * INTO v_candidate FROM public.candidate_profiles WHERE id = v_user.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Primero completá tu perfil de Postulante para poder postularte.';
  END IF;

  SELECT jp.* INTO v_job
  FROM public.job_posts jp
  JOIN public.profiles ep_prof ON ep_prof.id = jp.employer_id
  WHERE jp.id = p_job_post_id
    AND jp.status = 'active'
    AND jp.deleted_at IS NULL
    AND ep_prof.status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esta búsqueda laboral ya no está activa.';
  END IF;

  SELECT * INTO v_existing_app
  FROM public.applications
  WHERE job_post_id = p_job_post_id AND candidate_id = v_user.id;

  IF FOUND AND v_existing_app.status <> 'withdrawn' THEN
    RAISE EXCEPTION 'Ya te postulaste a esta búsqueda laboral.';
  END IF;

  IF FOUND AND v_existing_app.status = 'withdrawn' THEN
    UPDATE public.applications
    SET status = 'received',
        message = left(COALESCE(p_message, ''), 500),
        updated_at = now()
    WHERE id = v_existing_app.id
    RETURNING id INTO v_app_id;
  ELSE
    INSERT INTO public.applications (job_post_id, candidate_id, message, status)
    VALUES (p_job_post_id, v_user.id, left(COALESCE(p_message, ''), 500), 'received')
    RETURNING id INTO v_app_id;
  END IF;

  -- Habilitar permiso de contacto para ese comercio sin duplicar filas activas
  UPDATE public.contact_grants
  SET revoked_at = NULL, source_id = v_app_id
  WHERE employer_id = v_job.employer_id AND candidate_id = v_user.id;

  IF NOT FOUND THEN
    INSERT INTO public.contact_grants (employer_id, candidate_id, source_type, source_id)
    VALUES (v_job.employer_id, v_user.id, 'application', v_app_id);
  END IF;

  -- Nunca devolver employer_email al navegador
  RETURN jsonb_build_object(
    'ok', true,
    'application_id', v_app_id,
    'candidate_name', v_candidate.first_name || ' ' || v_candidate.last_name,
    'job_title', v_job.title
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.candidate_cancel_application(
  p_token text,
  p_job_post_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.profiles;
  v_job public.job_posts%ROWTYPE;
BEGIN
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Sesión inválida.';
  END IF;

  SELECT * INTO v_job FROM public.job_posts WHERE id = p_job_post_id;

  UPDATE public.applications
  SET status = 'withdrawn', updated_at = now()
  WHERE candidate_id = v_user.id
    AND job_post_id = p_job_post_id;

  -- Revocar el permiso de contacto si no tiene otra postulación activa con ese comercio
  IF v_job.employer_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.applications a
      JOIN public.job_posts jp ON jp.id = a.job_post_id
      WHERE a.candidate_id = v_user.id
        AND jp.employer_id = v_job.employer_id
        AND a.status NOT IN ('withdrawn', 'rejected')
    ) THEN
      UPDATE public.contact_grants
      SET revoked_at = now()
      WHERE employer_id = v_job.employer_id
        AND candidate_id = v_user.id
        AND revoked_at IS NULL;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- 8. Moderación efectiva (paused_by_admin y bloqueo de reactivación por comercio - S11, A7)
ALTER TABLE public.job_posts
  ADD COLUMN IF NOT EXISTS paused_by_admin boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.employer_manage_job_post(
  p_token text,
  p_job_id uuid,
  p_action text -- 'pause' | 'activate' | 'delete'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.profiles;
  v_job public.job_posts%ROWTYPE;
BEGIN
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Sesión inválida.';
  END IF;

  SELECT * INTO v_job
  FROM public.job_posts
  WHERE id = p_job_id AND employer_id = v_user.id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró la búsqueda laboral.';
  END IF;

  IF p_action = 'pause' THEN
    UPDATE public.job_posts
    SET status = 'paused', updated_at = now()
    WHERE id = p_job_id;
  ELSIF p_action = 'activate' THEN
    IF v_job.paused_by_admin THEN
      RAISE EXCEPTION 'Este aviso fue pausado por el Administrador. Enviale una consulta desde tu panel para reactivarlo.';
    END IF;
    UPDATE public.job_posts
    SET status = 'active', updated_at = now()
    WHERE id = p_job_id;
  ELSIF p_action = 'delete' THEN
    UPDATE public.job_posts
    SET status = 'closed', deleted_at = now(), updated_at = now()
    WHERE id = p_job_id;
  ELSE
    RAISE EXCEPTION 'Acción no válida.';
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_moderate_item(
  p_token text,
  p_target_type text, -- 'profile' | 'job'
  p_target_id uuid,
  p_action text       -- 'pause' | 'activate' | 'delete'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.profiles;
BEGIN
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL OR (v_user.role <> 'admin' AND lower(v_user.email) <> 'pabloesquilache@gmail.com') THEN
    RAISE EXCEPTION 'Acceso exclusivo para el Administrador.';
  END IF;

  IF p_target_type = 'profile' THEN
    IF p_action = 'pause' THEN
      UPDATE public.profiles SET status = 'paused', updated_at = now() WHERE id = p_target_id;
    ELSIF p_action = 'activate' THEN
      UPDATE public.profiles SET status = 'active', updated_at = now() WHERE id = p_target_id;
    ELSIF p_action = 'delete' THEN
      UPDATE public.profiles SET status = 'deleted', deleted_at = now(), updated_at = now() WHERE id = p_target_id;
      DELETE FROM public.user_sessions WHERE user_id = p_target_id;
    END IF;
  ELSIF p_target_type = 'job' THEN
    IF p_action = 'pause' THEN
      UPDATE public.job_posts SET status = 'paused', paused_by_admin = true, updated_at = now() WHERE id = p_target_id;
    ELSIF p_action = 'activate' THEN
      UPDATE public.job_posts SET status = 'active', paused_by_admin = false, updated_at = now() WHERE id = p_target_id;
    ELSIF p_action = 'delete' THEN
      UPDATE public.job_posts SET status = 'closed', deleted_at = now(), updated_at = now() WHERE id = p_target_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Actualizar employer_update_application_status para validar pertenencia y revocar permiso si se descarta
CREATE OR REPLACE FUNCTION public.employer_update_application_status(
  p_token text,
  p_application_id uuid,
  p_next_status public.application_status
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.profiles;
  v_app public.applications%ROWTYPE;
  v_job public.job_posts%ROWTYPE;
BEGIN
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Sesión inválida.';
  END IF;

  IF p_next_status = 'withdrawn' THEN
    RAISE EXCEPTION 'Estado no permitido para el comercio.';
  END IF;

  SELECT a.* INTO v_app
  FROM public.applications a
  JOIN public.job_posts jp ON jp.id = a.job_post_id
  WHERE a.id = p_application_id
    AND jp.employer_id = v_user.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró la postulación en tus búsquedas.';
  END IF;

  SELECT * INTO v_job FROM public.job_posts WHERE id = v_app.job_post_id;

  UPDATE public.applications
  SET status = p_next_status, updated_at = now()
  WHERE id = p_application_id;

  RETURN jsonb_build_object(
    'ok', true,
    'application_id', p_application_id,
    'next_status', p_next_status,
    'job_title', v_job.title
  );
END;
$$;

-- 9. Cerrar lectura anónima directa de tablas sensibles (C5, S5, A5)
DROP POLICY IF EXISTS "profiles_select_own_or_admin" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own_or_admin" ON public.profiles;
DROP POLICY IF EXISTS "candidate_profiles_select_visible" ON public.candidate_profiles;
DROP POLICY IF EXISTS "candidate_profiles_insert_own" ON public.candidate_profiles;
DROP POLICY IF EXISTS "candidate_profiles_update_own_or_admin" ON public.candidate_profiles;
DROP POLICY IF EXISTS "employer_profiles_select_visible" ON public.employer_profiles;
DROP POLICY IF EXISTS "employer_profiles_insert_own" ON public.employer_profiles;
DROP POLICY IF EXISTS "employer_profiles_update_own_or_admin" ON public.employer_profiles;
DROP POLICY IF EXISTS "job_posts_select_visible" ON public.job_posts;
DROP POLICY IF EXISTS "job_posts_insert_employer" ON public.job_posts;
DROP POLICY IF EXISTS "job_posts_update_employer_or_admin" ON public.job_posts;

REVOKE ALL ON TABLE public.profiles FROM public, anon, authenticated;
REVOKE ALL ON TABLE public.candidate_profiles FROM public, anon, authenticated;
REVOKE ALL ON TABLE public.employer_profiles FROM public, anon, authenticated;
REVOKE ALL ON TABLE public.candidate_private FROM public, anon, authenticated;
REVOKE ALL ON TABLE public.employer_private FROM public, anon, authenticated;
REVOKE ALL ON TABLE public.email_otp_codes FROM public, anon, authenticated;
REVOKE ALL ON TABLE public.user_sessions FROM public, anon, authenticated;
REVOKE ALL ON TABLE public.applications FROM public, anon, authenticated;
REVOKE ALL ON TABLE public.contact_requests FROM public, anon, authenticated;
REVOKE ALL ON TABLE public.contact_grants FROM public, anon, authenticated;
REVOKE ALL ON TABLE public.job_posts FROM public, anon, authenticated;

-- Funciones seguras para cargar los Directorios (exigen sesión activa y validan rol)
CREATE OR REPLACE FUNCTION public.get_jobs_directory_data(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.profiles;
  v_jobs jsonb;
  v_employers jsonb;
  v_industries jsonb;
BEGIN
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Iniciá sesión para ver las búsquedas laborales y comercios.';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_jobs
  FROM (
    SELECT
      jp.id,
      jp.employer_id,
      jp.title,
      jp.industry,
      jp.position_tag,
      jp.custom_other_text,
      jp.province,
      jp.district,
      jp.locality,
      jp.availability,
      jp.required_education,
      jp.description,
      jp.status,
      jp.created_at,
      jsonb_build_object(
        'trade_name', ep.trade_name,
        'logo_url', ep.logo_url,
        'locality', ep.locality,
        'industry', ep.industry,
        'description', ep.description
      ) AS employer_profiles
    FROM public.job_posts jp
    JOIN public.employer_profiles ep ON ep.id = jp.employer_id
    JOIN public.profiles p ON p.id = jp.employer_id
    WHERE jp.status = 'active'
      AND jp.deleted_at IS NULL
      AND p.status = 'active'
      AND (jp.expires_at IS NULL OR jp.expires_at > now())
    ORDER BY jp.created_at DESC
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(e)), '[]'::jsonb) INTO v_employers
  FROM (
    SELECT
      ep.id,
      ep.trade_name,
      ep.logo_url,
      ep.industry,
      ep.province,
      ep.district,
      ep.locality,
      ep.description,
      ep.created_at
    FROM public.employer_profiles ep
    JOIN public.profiles p ON p.id = ep.id
    WHERE p.status = 'active'
    ORDER BY ep.created_at DESC
  ) e;

  SELECT COALESCE(jsonb_agg(row_to_json(i)), '[]'::jsonb) INTO v_industries
  FROM (
    SELECT id, slug, name, suggested_positions, is_active
    FROM public.industries
    WHERE is_active = true
    ORDER BY name ASC
  ) i;

  RETURN jsonb_build_object(
    'jobs', v_jobs,
    'employers', v_employers,
    'industries', v_industries
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_candidates_directory_data(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.profiles;
  v_candidates jsonb;
  v_industries jsonb;
BEGIN
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Iniciá sesión con tu cuenta de Comercio para ver postulantes.';
  END IF;

  IF v_user.role NOT IN ('employer', 'admin') AND lower(v_user.email) <> 'pabloesquilache@gmail.com' THEN
    RAISE EXCEPTION 'Acceso exclusivo para Comercios registrados.';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(c)), '[]'::jsonb) INTO v_candidates
  FROM (
    SELECT
      cp.id,
      cp.first_name,
      cp.last_name,
      cp.avatar_url,
      cp.province,
      cp.district,
      cp.locality,
      cp.work_situation,
      cp.availability,
      cp.education_level,
      cp.industries,
      cp.positions,
      cp.custom_other_text,
      cp.bio_short,
      CASE
        WHEN cp.cv_path IS NOT NULL OR EXISTS (SELECT 1 FROM public.private_cv_files cv WHERE cv.candidate_id = cp.id)
        THEN '/ver-cv/' || cp.id::text
        ELSE NULL
      END AS cv_path,
      cp.is_searching,
      cp.created_at
    FROM public.candidate_profiles cp
    JOIN public.profiles p ON p.id = cp.id
    WHERE cp.is_searching = true
      AND p.status = 'active'
    ORDER BY cp.created_at DESC
  ) c;

  SELECT COALESCE(jsonb_agg(row_to_json(i)), '[]'::jsonb) INTO v_industries
  FROM (
    SELECT id, slug, name, suggested_positions, is_active
    FROM public.industries
    WHERE is_active = true
    ORDER BY name ASC
  ) i;

  RETURN jsonb_build_object(
    'candidates', v_candidates,
    'industries', v_industries
  );
END;
$$;

-- Actualizar employer_request_contact para validar rol y no exponer emails
CREATE OR REPLACE FUNCTION public.employer_request_contact(
  p_token text,
  p_candidate_id uuid,
  p_message text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.profiles;
  v_emp public.employer_profiles%ROWTYPE;
  v_cand_priv public.candidate_private%ROWTYPE;
  v_req_id uuid;
BEGIN
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Ingresá con tu cuenta de Comercio para contactar postulantes.';
  END IF;

  IF v_user.role NOT IN ('employer', 'admin') AND lower(v_user.email) <> 'pabloesquilache@gmail.com' THEN
    RAISE EXCEPTION 'Solo los Comercios registrados pueden solicitar el contacto de un postulante.';
  END IF;

  SELECT * INTO v_emp FROM public.employer_profiles WHERE id = v_user.id;
  IF NOT FOUND AND v_user.role <> 'admin' AND lower(v_user.email) <> 'pabloesquilache@gmail.com' THEN
    RAISE EXCEPTION 'Completá primero los datos de tu Comercio en "Mi Comercio" antes de contactar postulantes.';
  END IF;

  SELECT * INTO v_cand_priv
  FROM public.candidate_private cpriv
  JOIN public.profiles p ON p.id = cpriv.id
  JOIN public.candidate_profiles cp ON cp.id = cpriv.id
  WHERE cpriv.id = p_candidate_id
    AND p.status = 'active'
    AND cp.is_searching = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Este postulante no se encuentra disponible actualmente.';
  END IF;

  INSERT INTO public.contact_requests (employer_id, candidate_id, message, status, responded_at)
  VALUES (v_user.id, p_candidate_id, left(COALESCE(p_message, ''), 300), 'accepted', now())
  ON CONFLICT (employer_id, candidate_id) DO UPDATE SET
    responded_at = now()
  RETURNING id INTO v_req_id;

  UPDATE public.contact_grants
  SET revoked_at = NULL, source_id = v_req_id
  WHERE employer_id = v_user.id AND candidate_id = p_candidate_id;

  IF NOT FOUND THEN
    INSERT INTO public.contact_grants (employer_id, candidate_id, source_type, source_id)
    VALUES (v_user.id, p_candidate_id, 'request', v_req_id);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'candidate_phone', v_cand_priv.phone,
    'employer_name', COALESCE(v_emp.trade_name, 'Administración')
  );
END;
$$;

-- 10. Canal de Consultas / Pedidos de Comercios hacia el Administrador
CREATE TABLE IF NOT EXISTS public.admin_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category text NOT NULL DEFAULT 'Pedir Rubro o Puesto',
  message text NOT NULL,
  admin_reply text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  replied_at timestamptz
);

ALTER TABLE public.admin_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_tickets FROM public, anon, authenticated;

-- Comercio crea consulta al Administrador
CREATE OR REPLACE FUNCTION public.employer_create_admin_ticket(
  p_token text,
  p_category text,
  p_message text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.profiles;
  v_ticket_id uuid;
BEGIN
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Sesión inválida.';
  END IF;

  IF trim(COALESCE(p_message, '')) = '' THEN
    RAISE EXCEPTION 'Escribí tu consulta o el rubro/puesto que necesitás agregar.';
  END IF;

  INSERT INTO public.admin_tickets (employer_id, category, message, status)
  VALUES (
    v_user.id,
    left(COALESCE(NULLIF(trim(p_category), ''), 'Consulta general'), 100),
    left(trim(p_message), 1000),
    'pending'
  )
  RETURNING id INTO v_ticket_id;

  RETURN jsonb_build_object(
    'ok', true,
    'ticket_id', v_ticket_id
  );
END;
$$;

-- Comercio obtiene su historial de consultas y respuestas del Administrador
CREATE OR REPLACE FUNCTION public.employer_get_my_tickets(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.profiles;
  v_res jsonb;
BEGIN
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_res
  FROM (
    SELECT
      id,
      category,
      message,
      admin_reply,
      status,
      created_at,
      replied_at
    FROM public.admin_tickets
    WHERE employer_id = v_user.id
    ORDER BY created_at DESC
  ) t;

  RETURN v_res;
END;
$$;

-- Administrador responde o cambia estado de una consulta de un comercio
CREATE OR REPLACE FUNCTION public.admin_reply_ticket(
  p_token text,
  p_ticket_id uuid,
  p_reply text,
  p_status text DEFAULT 'resolved'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.profiles;
BEGIN
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL OR (v_user.role <> 'admin' AND lower(v_user.email) <> 'pabloesquilache@gmail.com') THEN
    RAISE EXCEPTION 'Acceso exclusivo para el Administrador.';
  END IF;

  UPDATE public.admin_tickets
  SET admin_reply = CASE WHEN trim(COALESCE(p_reply, '')) <> '' THEN left(trim(p_reply), 1000) ELSE admin_reply END,
      status = CASE WHEN p_status IN ('pending', 'resolved') THEN p_status ELSE 'resolved' END,
      replied_at = CASE WHEN trim(COALESCE(p_reply, '')) <> '' THEN now() ELSE replied_at END
  WHERE id = p_ticket_id;

  RETURN jsonb_build_object('ok', true, 'ticket_id', p_ticket_id);
END;
$$;

-- Actualizar admin_get_full_dashboard para incluir los tickets de consulta de comercios
CREATE OR REPLACE FUNCTION public.admin_get_full_dashboard(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.profiles;
  v_candidates jsonb;
  v_employers jsonb;
  v_jobs jsonb;
  v_tickets jsonb;
BEGIN
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL OR (v_user.role <> 'admin' AND lower(v_user.email) <> 'pabloesquilache@gmail.com') THEN
    RAISE EXCEPTION 'Acceso exclusivo para el Administrador.';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_candidates
  FROM (
    SELECT
      cp.*,
      CASE
        WHEN cp.cv_path IS NOT NULL OR EXISTS (SELECT 1 FROM public.private_cv_files cv WHERE cv.candidate_id = cp.id)
        THEN '/ver-cv/' || cp.id::text
        ELSE NULL
      END AS safe_cv_path,
      p.status AS account_status,
      p.email,
      cpriv.phone,
      cpriv.birth_date
    FROM public.candidate_profiles cp
    JOIN public.profiles p ON p.id = cp.id
    LEFT JOIN public.candidate_private cpriv ON cpriv.id = cp.id
    WHERE p.status <> 'deleted'
    ORDER BY cp.created_at DESC
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_employers
  FROM (
    SELECT
      ep.*,
      p.status AS account_status,
      p.email,
      epriv.contact_person_name,
      epriv.phone,
      (SELECT count(*) FROM public.job_posts jp WHERE jp.employer_id = ep.id AND jp.deleted_at IS NULL) AS jobs_count
    FROM public.employer_profiles ep
    JOIN public.profiles p ON p.id = ep.id
    LEFT JOIN public.employer_private epriv ON epriv.id = ep.id
    WHERE p.status <> 'deleted'
    ORDER BY ep.created_at DESC
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_jobs
  FROM (
    SELECT
      jp.*,
      ep.trade_name,
      ep.logo_url,
      epriv.contact_person_name,
      epriv.phone AS employer_phone,
      (SELECT count(*) FROM public.applications a WHERE a.job_post_id = jp.id AND a.status <> 'withdrawn') AS applications_count
    FROM public.job_posts jp
    JOIN public.employer_profiles ep ON ep.id = jp.employer_id
    LEFT JOIN public.employer_private epriv ON epriv.id = ep.id
    WHERE jp.deleted_at IS NULL
    ORDER BY jp.created_at DESC
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(tk)), '[]'::jsonb) INTO v_tickets
  FROM (
    SELECT
      at.id,
      at.employer_id,
      at.category,
      at.message,
      at.admin_reply,
      at.status,
      at.created_at,
      at.replied_at,
      COALESCE(ep.trade_name, p.email) AS trade_name,
      ep.locality,
      ep.district,
      epriv.contact_person_name,
      epriv.phone AS employer_phone,
      p.email AS employer_email
    FROM public.admin_tickets at
    JOIN public.profiles p ON p.id = at.employer_id
    LEFT JOIN public.employer_profiles ep ON ep.id = at.employer_id
    LEFT JOIN public.employer_private epriv ON epriv.id = at.employer_id
    ORDER BY
      CASE WHEN at.status = 'pending' THEN 0 ELSE 1 END,
      at.created_at DESC
  ) tk;

  RETURN jsonb_build_object(
    'candidates', v_candidates,
    'employers', v_employers,
    'jobs', v_jobs,
    'tickets', v_tickets
  );
END;
$$;

-- Actualizar employer_get_my_jobs_with_applicants para no exponer candidate_email y usar ruta segura de CV
CREATE OR REPLACE FUNCTION public.employer_get_my_jobs_with_applicants(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.profiles;
  v_result jsonb;
BEGIN
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Sesión inválida.';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_result
  FROM (
    SELECT
      jp.*,
      COALESCE(
        (
          SELECT jsonb_agg(row_to_json(app_row))
          FROM (
            SELECT
              a.id AS application_id,
              a.status AS application_status,
              a.message,
              a.created_at AS applied_at,
              cp.id AS candidate_id,
              cp.first_name,
              cp.last_name,
              cp.avatar_url,
              cp.locality,
              cp.district,
              cp.province,
              cp.work_situation,
              cp.education_level,
              cp.availability,
              cp.industries,
              cp.positions,
              cp.bio_short,
              CASE
                WHEN cp.cv_path IS NOT NULL OR EXISTS (SELECT 1 FROM public.private_cv_files cv WHERE cv.candidate_id = cp.id)
                THEN '/ver-cv/' || cp.id::text
                ELSE NULL
              END AS cv_path,
              cpriv.phone
            FROM public.applications a
            JOIN public.candidate_profiles cp ON cp.id = a.candidate_id
            LEFT JOIN public.candidate_private cpriv ON cpriv.id = cp.id
            WHERE a.job_post_id = jp.id
              AND a.status <> 'withdrawn'
            ORDER BY a.created_at DESC
          ) app_row
        ),
        '[]'::jsonb
      ) AS applicants
    FROM public.job_posts jp
    WHERE jp.employer_id = v_user.id
      AND jp.deleted_at IS NULL
    ORDER BY jp.created_at DESC
  ) t;

  RETURN v_result;
END;
$$;

-- 11. Función de servidor para preparar correos transaccionales seguros (escapando HTML y sin exponer emails al cliente)
CREATE OR REPLACE FUNCTION public.escape_html(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT replace(
    replace(
      replace(
        replace(
          replace(COALESCE(p_text, ''), '&', '&amp;'),
          '<', '&lt;'
        ),
        '>', '&gt;'
      ),
      '"', '&quot;'
    ),
    '''', '&#39;'
  );
$$;

CREATE OR REPLACE FUNCTION public.server_prepare_notification_email(
  p_token text,
  p_event_type text,
  p_target_id uuid,
  p_server_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expected_key text;
  v_user public.profiles;
  v_app public.applications%ROWTYPE;
  v_job public.job_posts%ROWTYPE;
  v_cand public.candidate_profiles%ROWTYPE;
  v_emp public.employer_profiles%ROWTYPE;
  v_ticket public.admin_tickets%ROWTYPE;
  v_to_email text;
  v_subject text;
  v_html text;
  v_status_label text;
BEGIN
  SELECT value INTO v_expected_key
  FROM public.private_server_secrets
  WHERE key = 'internal_rpc_key';

  IF p_server_key IS NULL OR p_server_key <> v_expected_key THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;

  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Sesión inválida.';
  END IF;

  IF p_event_type = 'new_application' THEN
    SELECT * INTO v_app FROM public.applications WHERE id = p_target_id AND candidate_id = v_user.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Postulación no encontrada.'; END IF;
    SELECT * INTO v_job FROM public.job_posts WHERE id = v_app.job_post_id;
    SELECT * INTO v_cand FROM public.candidate_profiles WHERE id = v_user.id;
    SELECT email INTO v_to_email FROM public.profiles WHERE id = v_job.employer_id;

    v_subject := 'Nueva postulación en "' || v_job.title || '" - Bolsa de Empleo Tejedor';
    v_html := '<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #e2e8f0;border-radius:16px;">'
      || '<h2 style="color:#0f172a;margin-top:0;">Nueva postulación recibida</h2>'
      || '<p style="color:#334155;"><strong>' || public.escape_html(v_cand.first_name || ' ' || v_cand.last_name) || '</strong> se postuló a tu búsqueda <strong>' || public.escape_html(v_job.title) || '</strong>.</p>'
      || '<p style="color:#475569;font-size:14px;">Ingresá a <strong>Mi Comercio → Mis Búsquedas y Seguimiento</strong> en Bolsa de Empleo Tejedor para ver su CV, cambiar su estado o contactarlo por WhatsApp.</p>'
      || '</div>';

  ELSIF p_event_type = 'application_status_changed' THEN
    SELECT a.* INTO v_app
    FROM public.applications a
    JOIN public.job_posts jp ON jp.id = a.job_post_id
    WHERE a.id = p_target_id AND jp.employer_id = v_user.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Postulación no encontrada.'; END IF;

    SELECT * INTO v_job FROM public.job_posts WHERE id = v_app.job_post_id;
    SELECT * INTO v_emp FROM public.employer_profiles WHERE id = v_user.id;
    SELECT email INTO v_to_email FROM public.profiles WHERE id = v_app.candidate_id;

    v_status_label := CASE v_app.status
      WHEN 'received' THEN 'Recibida'
      WHEN 'in_review' THEN 'En revisión'
      WHEN 'shortlisted' THEN 'Preseleccionado'
      WHEN 'hired' THEN 'Confirmado / Contratado'
      WHEN 'rejected' THEN 'No seleccionado en esta oportunidad'
      ELSE 'Actualizada'
    END;

    v_subject := 'Novedades de tu postulación a "' || v_job.title || '"';
    v_html := '<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #e2e8f0;border-radius:16px;">'
      || '<h2 style="color:#0f172a;margin-top:0;">Actualización de tu postulación</h2>'
      || '<p style="color:#334155;">El comercio <strong>' || public.escape_html(COALESCE(v_emp.trade_name, '')) || '</strong> actualizó el estado de tu postulación para <strong>' || public.escape_html(v_job.title) || '</strong> a:</p>'
      || '<div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:12px;padding:14px;text-align:center;font-weight:bold;color:#0f172a;margin:16px 0;">'
      || public.escape_html(v_status_label)
      || '</div>'
      || '<p style="color:#475569;font-size:14px;">Podés consultar el seguimiento desde la pestaña <strong>Mis Postulaciones</strong> en la plataforma.</p>'
      || '</div>';

  ELSIF p_event_type = 'admin_ticket_created' THEN
    SELECT * INTO v_ticket FROM public.admin_tickets WHERE id = p_target_id AND employer_id = v_user.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Consulta no encontrada.'; END IF;
    SELECT * INTO v_emp FROM public.employer_profiles WHERE id = v_user.id;
    v_to_email := 'pabloesquilache@gmail.com';
    v_subject := 'Nueva consulta de Comercio (' || COALESCE(v_emp.trade_name, v_user.email) || ') - Bolsa de Empleo Tejedor';
    v_html := '<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #e2e8f0;border-radius:16px;">'
      || '<h2 style="color:#0f172a;margin-top:0;">Nueva consulta al Administrador</h2>'
      || '<p style="color:#334155;"><strong>Comercio:</strong> ' || public.escape_html(COALESCE(v_emp.trade_name, v_user.email)) || '</p>'
      || '<p style="color:#334155;"><strong>Motivo:</strong> ' || public.escape_html(v_ticket.category) || '</p>'
      || '<div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:12px;padding:14px;color:#0f172a;margin:16px 0;">'
      || public.escape_html(v_ticket.message)
      || '</div>'
      || '<p style="color:#475569;font-size:14px;">Ingresá al panel <strong>/admin → Consultas</strong> para responderle.</p>'
      || '</div>';

  ELSIF p_event_type = 'admin_ticket_replied' THEN
    IF v_user.role <> 'admin' AND lower(v_user.email) <> 'pabloesquilache@gmail.com' THEN
      RAISE EXCEPTION 'No autorizado.';
    END IF;
    SELECT * INTO v_ticket FROM public.admin_tickets WHERE id = p_target_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Consulta no encontrada.'; END IF;
    SELECT email INTO v_to_email FROM public.profiles WHERE id = v_ticket.employer_id;

    v_subject := 'Respuesta del Administrador a tu consulta - Bolsa de Empleo Tejedor';
    v_html := '<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #e2e8f0;border-radius:16px;">'
      || '<h2 style="color:#0f172a;margin-top:0;">Respuesta del Administrador</h2>'
      || '<p style="color:#475569;font-size:13px;">Tu consulta (' || public.escape_html(v_ticket.category) || '): <em>"' || public.escape_html(v_ticket.message) || '"</em></p>'
      || '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:14px;color:#14532d;margin:16px 0;">'
      || '<strong>Respuesta:</strong><br/>' || public.escape_html(COALESCE(v_ticket.admin_reply, ''))
      || '</div>'
      || '</div>';

  ELSE
    RAISE EXCEPTION 'Tipo de notificación no soportado.';
  END IF;

  RETURN jsonb_build_object(
    'to_email', v_to_email,
    'subject', v_subject,
    'html', v_html
  );
END;
$$;
