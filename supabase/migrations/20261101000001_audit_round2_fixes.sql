-- ============================================================================
-- AUDITORÍA RONDA 2: CORRECCIÓN DE N1, N2, A2, A4, M1-M6, B4, B6
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- 1. N1: Eliminar secretos hardcodeados en la base y cerrar funciones de servidor solo a service_role
DROP TABLE IF EXISTS public.private_server_secrets;

-- Borrar firmas anteriores con p_server_key
DROP FUNCTION IF EXISTS public.server_issue_otp_challenge(text, public.user_role, text, text);
DROP FUNCTION IF EXISTS public.server_prepare_notification_email(text, text, uuid, text);

-- Crear server_issue_otp_challenge accesible ÚNICAMENTE por service_role (con search_path = public, extensions para B6)
CREATE OR REPLACE FUNCTION public.server_issue_otp_challenge(
  p_email text,
  p_role public.user_role,
  p_client_ip text DEFAULT 'unknown'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_clean_email text := lower(trim(COALESCE(p_email, '')));
  v_clean_ip text := COALESCE(NULLIF(trim(p_client_ip), ''), 'unknown');
  v_existing_profile public.profiles%ROWTYPE;
  v_recent_email_count integer;
  v_recent_ip_count integer;
  v_last_sent timestamptz;
  v_raw_bytes bytea;
  v_num integer;
  v_code text;
  v_hash text;
BEGIN
  IF v_clean_email = '' OR position('@' in v_clean_email) = 0 OR length(v_clean_email) > 160 THEN
    RAISE EXCEPTION 'Ingresá un correo electrónico válido.';
  END IF;

  IF p_role = 'admin' AND v_clean_email <> 'pabloesquilache@gmail.com' THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;

  -- Limpieza oportunista de códigos y sesiones viejas (A3)
  DELETE FROM public.email_otp_codes WHERE expires_at < (now() - interval '1 day');
  DELETE FROM public.user_sessions WHERE expires_at <= now();

  -- Límite por IP (A2 / M5): máximo 12 códigos por hora desde la misma IP
  IF v_clean_ip <> 'unknown' THEN
    SELECT count(*)
    INTO v_recent_ip_count
    FROM public.email_otp_codes
    WHERE client_ip = v_clean_ip
      AND created_at > (now() - interval '1 hour');

    IF v_recent_ip_count >= 12 THEN
      RAISE EXCEPTION 'Demasiadas solicitudes desde esta conexión. Probá más tarde.';
    END IF;
  END IF;

  -- Límite por email: 1 cada 45 segundos y máximo 8 por hora
  SELECT max(created_at), count(*)
  INTO v_last_sent, v_recent_email_count
  FROM public.email_otp_codes
  WHERE lower(email) = v_clean_email
    AND created_at > (now() - interval '1 hour');

  IF v_last_sent IS NOT NULL AND v_last_sent > (now() - interval '45 seconds') THEN
    RAISE EXCEPTION 'Esperá unos segundos antes de pedir un código nuevo.';
  END IF;

  IF v_recent_email_count >= 8 THEN
    RAISE EXCEPTION 'Superaste el límite de códigos por hora para este correo. Intentá más tarde.';
  END IF;

  SELECT * INTO v_existing_profile
  FROM public.profiles
  WHERE lower(email) = v_clean_email;

  IF FOUND THEN
    IF v_existing_profile.status = 'deleted' THEN
      RAISE EXCEPTION 'Esta cuenta no se encuentra habilitada para operar.';
    END IF;
    IF v_existing_profile.status = 'paused' THEN
      RAISE EXCEPTION 'Esta cuenta se encuentra pausada temporalmente por el Administrador.';
    END IF;

    IF v_clean_email <> 'pabloesquilache@gmail.com' AND v_existing_profile.role <> p_role THEN
      RAISE EXCEPTION 'Este correo ya está vinculado a otro tipo de perfil en la plataforma. Verificá si elegiste Postulante o Comercio.';
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
    v_clean_ip,
    now() + interval '10 minutes'
  );

  RETURN jsonb_build_object(
    'email', v_clean_email,
    'code', v_code
  );
END;
$$;

REVOKE ALL ON FUNCTION public.server_issue_otp_challenge(text, public.user_role, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.server_issue_otp_challenge(text, public.user_role, text) TO service_role;

-- 2. N2: verify_otp_code con FOR UPDATE y RETURN {ok: false, error: ...} para que attempts se persista siempre
CREATE OR REPLACE FUNCTION public.verify_otp_code(
  p_email text,
  p_code text,
  p_role public.user_role DEFAULT 'candidate'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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
  v_new_attempts integer;
BEGIN
  SELECT * INTO v_otp_row
  FROM public.email_otp_codes
  WHERE lower(email) = v_clean_email
    AND used_at IS NULL
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'El código ingresado venció o no es válido. Pedí uno nuevo.'
    );
  END IF;

  IF v_otp_row.attempts >= 5 THEN
    UPDATE public.email_otp_codes SET used_at = now() WHERE id = v_otp_row.id;
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Superaste el máximo de 5 intentos. Pedí un código nuevo.'
    );
  END IF;

  IF v_otp_row.code_hash IS DISTINCT FROM v_code_hash THEN
    v_new_attempts := v_otp_row.attempts + 1;

    UPDATE public.email_otp_codes
    SET attempts = v_new_attempts,
        used_at = CASE WHEN v_new_attempts >= 5 THEN now() ELSE used_at END
    WHERE id = v_otp_row.id;

    IF v_new_attempts >= 5 THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'Código incorrecto. Se agotaron los 5 intentos; pedí un código nuevo.'
      );
    ELSE
      RETURN jsonb_build_object(
        'ok', false,
        'error', format('Código incorrecto. Te quedan %s intentos.', 5 - v_new_attempts)
      );
    END IF;
  END IF;

  -- Código correcto: marcar como usado
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
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'Esta cuenta fue dada de baja.'
      );
    END IF;
    IF v_profile.status = 'paused' THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'Tu cuenta está pausada temporalmente por el Administrador.'
      );
    END IF;

    IF v_clean_email = 'pabloesquilache@gmail.com' THEN
      v_effective_role := p_role;
    ELSE
      IF v_profile.role <> p_role THEN
        RETURN jsonb_build_object(
          'ok', false,
          'error', 'Este correo pertenece a otro tipo de cuenta (Postulante / Comercio).'
        );
      END IF;
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

  DELETE FROM public.user_sessions WHERE expires_at <= now();

  INSERT INTO public.user_sessions (user_id, expires_at)
  VALUES (v_profile.id, now() + interval '30 days')
  RETURNING token INTO v_token;

  RETURN jsonb_build_object(
    'ok', true,
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

-- 3. M1, M2, M3: Limpiar referencias de CVs legacy, validar rutas exactas y auditar acceso a CVs
UPDATE public.candidate_profiles
SET cv_path = NULL
WHERE cv_path IS NOT NULL
  AND cv_path <> ('/ver-cv/' || id::text);

CREATE OR REPLACE FUNCTION public.get_authorized_cv_file(
  p_token text,
  p_candidate_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.profiles;
  v_cand_prof public.profiles%ROWTYPE;
  v_cand public.candidate_profiles%ROWTYPE;
  v_cv public.private_cv_files%ROWTYPE;
  v_allowed boolean := false;
BEGIN
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Acceso denegado. Iniciá sesión para ver este CV.';
  END IF;

  SELECT * INTO v_cand_prof FROM public.profiles WHERE id = p_candidate_id;
  SELECT * INTO v_cand FROM public.candidate_profiles WHERE id = p_candidate_id;

  IF v_cand_prof.id IS NULL THEN
    RAISE EXCEPTION 'El perfil solicitado no existe.';
  END IF;

  -- El propio postulante o el administrador siempre pueden verlo
  IF v_user.id = p_candidate_id
     OR v_user.role = 'admin'
     OR lower(v_user.email) = 'pabloesquilache@gmail.com' THEN
    v_allowed := true;
  ELSIF v_user.role = 'employer' THEN
    -- M3: Un comercio solo puede ver el CV si el postulante tiene cuenta activa
    -- y además está buscando activamente o tiene una postulación activa con ese comercio
    IF v_cand_prof.status = 'active' AND (
      v_cand.is_searching = true OR EXISTS (
        SELECT 1
        FROM public.applications a
        JOIN public.job_posts jp ON jp.id = a.job_post_id
        WHERE a.candidate_id = p_candidate_id
          AND jp.employer_id = v_user.id
          AND a.status <> 'withdrawn'
      )
    ) THEN
      v_allowed := true;
    END IF;
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Este Currículum no se encuentra disponible o el postulante pausó su búsqueda.';
  END IF;

  SELECT * INTO v_cv FROM public.private_cv_files WHERE candidate_id = p_candidate_id;

  IF v_cv.candidate_id IS NULL THEN
    RAISE EXCEPTION 'Este postulante todavía no subió un archivo PDF de Currículum.';
  END IF;

  -- Registrar acceso en access_log (M3)
  INSERT INTO public.access_log (actor_id, target_candidate_id, action)
  VALUES (v_user.id, p_candidate_id, 'view_cv');

  RETURN jsonb_build_object(
    'filename', v_cv.filename,
    'content_base64', v_cv.content_base64
  );
END;
$$;

-- 4. M6: Normalización de teléfonos argentinos para prefijos de 2 (11), 3 y 4 dígitos
CREATE OR REPLACE FUNCTION public.normalize_ar_phone(p_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_digits text := regexp_replace(COALESCE(p_raw, ''), '\D', '', 'g');
BEGIN
  IF v_digits ~ '^549\d{10}$' THEN
    v_digits := substring(v_digits from 4);
  ELSIF v_digits ~ '^54\d{10,12}$' THEN
    v_digits := substring(v_digits from 3);
  END IF;

  IF v_digits ~ '^0\d+$' THEN
    v_digits := substring(v_digits from 2);
  END IF;

  -- Caso AMBA (código 11 + 15 + 8 dígitos = 12 dígitos)
  IF length(v_digits) = 12 AND substring(v_digits from 1 for 4) = '1115' THEN
    v_digits := '11' || substring(v_digits from 5);
  -- Caso códigos de 3 dígitos (221, 223, 261, 291, 299, 341, 342, 343, 351, 376, 379, 381, 385, 387, 388) + 15 + 7 dígitos = 12 dígitos
  ELSIF length(v_digits) = 12
    AND substring(v_digits from 1 for 3) IN ('221','223','261','291','299','341','342','343','351','376','379','381','385','387','388')
    AND substring(v_digits from 4 for 2) = '15' THEN
    v_digits := substring(v_digits from 1 for 3) || substring(v_digits from 6);
  -- Caso interior de 4 dígitos (ej. 2314, 2355, 2396) + 15 + 6 dígitos = 12 dígitos
  ELSIF length(v_digits) = 12 AND substring(v_digits from 5 for 2) = '15' THEN
    v_digits := substring(v_digits from 1 for 4) || substring(v_digits from 7);
  END IF;

  RETURN v_digits;
END;
$$;

-- 5. M2: Validación estricta de cv_path, avatar_url y logo_url en perfiles
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
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.profiles;
  v_clean_phone text := public.normalize_ar_phone(p_phone);
  v_safe_avatar text := NULLIF(trim(COALESCE(p_avatar_url, '')), '');
  v_safe_cv text := NULLIF(trim(COALESCE(p_cv_path, '')), '');
  v_expected_cv_route text;
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

  -- M2: Aceptar únicamente data URL WebP/PNG/JPEG propia y liviana
  IF v_safe_avatar IS NOT NULL THEN
    IF length(v_safe_avatar) > 600000 OR v_safe_avatar !~ '^data:image/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$' THEN
      RAISE EXCEPTION 'Formato de foto de perfil inválido.';
    END IF;
  END IF;

  -- M2: cv_path solo puede ser exactamente '/ver-cv/' || v_user.id si existe archivo en private_cv_files
  v_expected_cv_route := '/ver-cv/' || v_user.id::text;
  IF EXISTS (SELECT 1 FROM public.private_cv_files WHERE candidate_id = v_user.id) THEN
    v_safe_cv := v_expected_cv_route;
  ELSE
    v_safe_cv := NULL;
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
    cv_path = v_safe_cv,
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
SET search_path = public, extensions
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

  IF v_safe_logo IS NOT NULL THEN
    IF length(v_safe_logo) > 600000 OR v_safe_logo !~ '^data:image/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$' THEN
      RAISE EXCEPTION 'Formato de logo inválido.';
    END IF;
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

-- 6. A4 y B4: Validar rol en las funciones restantes, límites en create_job_post y bloqueo de re-postulación si fue rechazado
CREATE OR REPLACE FUNCTION public.create_job_post(
  p_token text,
  p_title text,
  p_industry text,
  p_position_tag text,
  p_custom_other_text text,
  p_province text,
  p_district text,
  p_locality text,
  p_availability text[],
  p_required_education text,
  p_description text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.profiles;
  v_active_jobs integer;
  v_job_id uuid;
BEGIN
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Debés iniciar sesión con tu cuenta de Comercio.';
  END IF;

  IF v_user.role <> 'employer' AND lower(v_user.email) <> 'pabloesquilache@gmail.com' THEN
    RAISE EXCEPTION 'Solo las cuentas de Comercio pueden publicar búsquedas laborales.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.employer_profiles WHERE id = v_user.id) THEN
    RAISE EXCEPTION 'Primero completá los datos básicos de tu Comercio.';
  END IF;

  SELECT count(*) INTO v_active_jobs
  FROM public.job_posts
  WHERE employer_id = v_user.id AND status = 'active' AND deleted_at IS NULL;

  IF v_active_jobs >= 20 THEN
    RAISE EXCEPTION 'Alcanzaste el límite de 20 búsquedas activas simultáneas.';
  END IF;

  INSERT INTO public.job_posts (
    employer_id, title, industry, position_tag, custom_other_text,
    province, district, locality, availability, required_education, description, status
  ) VALUES (
    v_user.id,
    left(trim(p_title), 140),
    left(trim(p_industry), 80),
    left(trim(p_position_tag), 100),
    left(NULLIF(trim(COALESCE(p_custom_other_text, '')), ''), 120),
    COALESCE(NULLIF(trim(p_province), ''), 'Buenos Aires'),
    COALESCE(NULLIF(trim(p_district), ''), 'Carlos Tejedor'),
    left(trim(p_locality), 100),
    COALESCE(p_availability, '{}'),
    left(COALESCE(p_required_education, 'Sin requisito excluyente'), 80),
    left(trim(p_description), 2000),
    'active'
  ) RETURNING id INTO v_job_id;

  RETURN jsonb_build_object('ok', true, 'job_id', v_job_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_to_job_post(
  p_token text,
  p_job_post_id uuid,
  p_message text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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

  IF FOUND THEN
    IF v_existing_app.status = 'rejected' THEN
      RAISE EXCEPTION 'Tu postulación para esta búsqueda ya fue evaluada por el comercio.';
    ELSIF v_existing_app.status <> 'withdrawn' THEN
      RAISE EXCEPTION 'Ya te postulaste a esta búsqueda laboral.';
    END IF;

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

  UPDATE public.contact_grants
  SET revoked_at = NULL, source_id = v_app_id
  WHERE employer_id = v_job.employer_id AND candidate_id = v_user.id;

  IF NOT FOUND THEN
    INSERT INTO public.contact_grants (employer_id, candidate_id, source_type, source_id)
    VALUES (v_job.employer_id, v_user.id, 'application', v_app_id);
  END IF;

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
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.profiles;
  v_job public.job_posts%ROWTYPE;
BEGIN
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Sesión inválida.';
  END IF;

  IF v_user.role <> 'candidate' AND lower(v_user.email) <> 'pabloesquilache@gmail.com' THEN
    RAISE EXCEPTION 'Acción permitida solo para Postulantes.';
  END IF;

  SELECT * INTO v_job FROM public.job_posts WHERE id = p_job_post_id;

  -- B4: No permitir retirar una postulación que ya fue descartada (para evitar que re-aplique)
  UPDATE public.applications
  SET status = 'withdrawn', updated_at = now()
  WHERE candidate_id = v_user.id
    AND job_post_id = p_job_post_id
    AND status <> 'rejected';

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

CREATE OR REPLACE FUNCTION public.employer_manage_job_post(
  p_token text,
  p_job_id uuid,
  p_action text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.profiles;
  v_job public.job_posts%ROWTYPE;
BEGIN
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Sesión inválida.';
  END IF;

  IF v_user.role <> 'employer' AND lower(v_user.email) <> 'pabloesquilache@gmail.com' THEN
    RAISE EXCEPTION 'Acción permitida solo para Comercios.';
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

CREATE OR REPLACE FUNCTION public.employer_create_admin_ticket(
  p_token text,
  p_category text,
  p_message text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.profiles;
  v_ticket_id uuid;
BEGIN
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Sesión inválida.';
  END IF;

  IF v_user.role <> 'employer' AND lower(v_user.email) <> 'pabloesquilache@gmail.com' THEN
    RAISE EXCEPTION 'Solo las cuentas de Comercio pueden enviar consultas desde este panel.';
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

CREATE OR REPLACE FUNCTION public.admin_moderate_item(
  p_token text,
  p_target_type text,
  p_target_id uuid,
  p_action text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.profiles;
BEGIN
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL OR (v_user.role <> 'admin' AND lower(v_user.email) <> 'pabloesquilache@gmail.com') THEN
    RAISE EXCEPTION 'Acceso exclusivo para el Administrador.';
  END IF;

  IF p_target_type NOT IN ('profile', 'job') OR p_action NOT IN ('pause', 'activate', 'delete') THEN
    RAISE EXCEPTION 'Parámetros de moderación inválidos.';
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

-- 7. M4: Evitar notificaciones repetidas con marcas de tiempo (notified_at) y cerrar función a service_role
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_notified_at timestamptz;

ALTER TABLE public.admin_tickets
  ADD COLUMN IF NOT EXISTS notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS reply_notified_at timestamptz;

CREATE OR REPLACE FUNCTION public.server_prepare_notification_email(
  p_token text,
  p_event_type text,
  p_target_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
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
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Sesión inválida.';
  END IF;

  IF p_event_type = 'new_application' THEN
    SELECT * INTO v_app
    FROM public.applications
    WHERE id = p_target_id AND candidate_id = v_user.id
    FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'Postulación no encontrada.'; END IF;
    IF v_app.notified_at IS NOT NULL THEN
      RAISE EXCEPTION 'La notificación de esta postulación ya fue enviada.';
    END IF;

    UPDATE public.applications SET notified_at = now() WHERE id = v_app.id;

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
    WHERE a.id = p_target_id AND jp.employer_id = v_user.id
    FOR UPDATE OF a;

    IF NOT FOUND THEN RAISE EXCEPTION 'Postulación no encontrada.'; END IF;
    IF v_app.status_notified_at IS NOT NULL AND v_app.status_notified_at > (now() - interval '15 seconds') THEN
      RAISE EXCEPTION 'Esperá unos segundos antes de volver a notificar.';
    END IF;

    UPDATE public.applications SET status_notified_at = now() WHERE id = v_app.id;

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
    SELECT * INTO v_ticket
    FROM public.admin_tickets
    WHERE id = p_target_id AND employer_id = v_user.id
    FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'Consulta no encontrada.'; END IF;
    IF v_ticket.notified_at IS NOT NULL THEN
      RAISE EXCEPTION 'La consulta ya fue notificada.';
    END IF;

    UPDATE public.admin_tickets SET notified_at = now() WHERE id = v_ticket.id;

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
    SELECT * INTO v_ticket FROM public.admin_tickets WHERE id = p_target_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Consulta no encontrada.'; END IF;
    IF v_ticket.reply_notified_at IS NOT NULL AND v_ticket.reply_notified_at > (now() - interval '15 seconds') THEN
      RAISE EXCEPTION 'La respuesta ya fue notificada recientemente.';
    END IF;

    UPDATE public.admin_tickets SET reply_notified_at = now() WHERE id = v_ticket.id;
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

REVOKE ALL ON FUNCTION public.server_prepare_notification_email(text, text, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.server_prepare_notification_email(text, text, uuid) TO service_role;

-- Asegurar search_path = public, extensions en admin_upsert_industry (usa unaccent - B6)
CREATE OR REPLACE FUNCTION public.admin_upsert_industry(
  p_token text,
  p_name text,
  p_positions text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.profiles;
  v_slug text;
BEGIN
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL OR (v_user.role <> 'admin' AND lower(v_user.email) <> 'pabloesquilache@gmail.com') THEN
    RAISE EXCEPTION 'Acceso exclusivo para el Administrador.';
  END IF;

  v_slug := lower(regexp_replace(unaccent(trim(p_name)), '[^a-zA-Z0-9]+', '-', 'g'));

  INSERT INTO public.industries (slug, name, suggested_positions, is_active)
  VALUES (v_slug, left(trim(p_name), 80), COALESCE(p_positions, '{}'), true)
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    suggested_positions = EXCLUDED.suggested_positions,
    is_active = true;

  RETURN jsonb_build_object('ok', true);
END;
$$;
