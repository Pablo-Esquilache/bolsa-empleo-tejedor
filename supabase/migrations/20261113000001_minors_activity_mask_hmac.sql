-- ============================================================================
-- MIGRACIÓN INTEGRAL: MENORES 16-17, FECHA INICIO COMERCIO, MÁSCARA PLPGSQL Y HMAC
-- (20261113000001_minors_activity_mask_hmac.sql)
--
-- 1. HMAC-SHA256 con clave secreta del servidor para terms_acceptances.email_hash.
-- 2. Nueva función mask_contact_info en PL/pgSQL que analiza corridas de dígitos
--    y cubre todos los formatos de teléfono (sin separadores, espacios, puntos,
--    paréntesis, wa.me/...) evitando falsos positivos ($1.500.000, 2015-2020, 12/11/2026).
-- 3. Habilita postulantes de 16 y 17 años (Ley 26.390) con datos de padre/madre/tutor
--    (nombre y teléfono obligatorios, email opcional para aviso automático Opción B).
-- 4. Calcula dinámicamente la edad en get_candidates_directory_data y resguarda
--    la foto de perfil de menores.
-- 5. Agrega activity_start_date (opcional) a employer_profiles.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Clave secreta interna en app_settings y función HMAC para email_hash
-- ----------------------------------------------------------------------------
INSERT INTO public.app_settings (key, value)
VALUES ('terms_hmac_key', encode(extensions.gen_random_bytes(32), 'hex'))
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.compute_terms_email_hash(p_email text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_key text;
  v_clean text := lower(trim(COALESCE(p_email, '')));
BEGIN
  SELECT value INTO v_key FROM public.app_settings WHERE key = 'terms_hmac_key' LIMIT 1;
  IF v_key IS NULL OR trim(v_key) = '' THEN
    v_key := 'bolsa-empleo-tejedor-fallback-hmac-key';
  END IF;

  RETURN encode(
    extensions.hmac(
      convert_to(v_clean, 'utf8'),
      convert_to(v_key, 'utf8'),
      'sha256'
    ),
    'hex'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.compute_terms_email_hash(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_terms_email_hash(text) TO service_role;

-- Actualizar verify_otp_code para usar compute_terms_email_hash
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
  v_admin_email text := public.get_admin_email();
  v_otp_row public.email_otp_codes%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_token text;
  v_effective_role public.user_role;
  v_has_profile boolean := false;
  v_new_attempts integer;
  v_generic_err text := 'No pudimos iniciar sesión con este correo. Si ya tenés cuenta, verificá el tipo de perfil elegido o escribinos.';
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
    SET attempts = v_new_attempts
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

  UPDATE public.email_otp_codes SET used_at = now() WHERE id = v_otp_row.id;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE lower(email) = v_clean_email;

  IF NOT FOUND THEN
    IF p_role = 'admin' AND v_clean_email <> v_admin_email THEN
      RETURN jsonb_build_object('ok', false, 'error', v_generic_err);
    END IF;
    v_effective_role := v_otp_row.requested_role;
    INSERT INTO public.profiles (email, role, status, last_login_at)
    VALUES (v_clean_email, v_effective_role, 'active', now())
    RETURNING * INTO v_profile;
  ELSE
    IF v_profile.status IN ('deleted', 'paused') THEN
      RETURN jsonb_build_object('ok', false, 'error', v_generic_err);
    END IF;

    IF v_clean_email = v_admin_email THEN
      v_effective_role := p_role;
    ELSE
      IF v_profile.role <> p_role THEN
        RETURN jsonb_build_object('ok', false, 'error', v_generic_err);
      END IF;
      v_effective_role := v_profile.role;
    END IF;

    UPDATE public.profiles
    SET last_login_at = now(),
        updated_at = now()
    WHERE id = v_profile.id;
  END IF;

  -- Guardar constancia de aceptación usando HMAC-SHA256 irreversible
  IF v_otp_row.terms_version IS NOT NULL THEN
    INSERT INTO public.terms_acceptances (user_id, email_hash, role, version, client_ip)
    VALUES (
      v_profile.id,
      public.compute_terms_email_hash(v_profile.email),
      v_effective_role::text,
      v_otp_row.terms_version,
      v_otp_row.client_ip
    )
    ON CONFLICT (user_id, role, version) WHERE user_id IS NOT NULL DO NOTHING;
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

-- ----------------------------------------------------------------------------
-- 2. Nueva función mask_contact_info basada en análisis de corridas de dígitos
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mask_contact_info(p_text text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_res text := COALESCE(p_text, '');
  v_out text := '';
  v_pos integer := 1;
  v_sub text;
  v_m text[];
  v_token text;
  v_digits text;
  v_rel integer;
  v_len integer;
BEGIN
  IF v_res = '' THEN
    RETURN v_res;
  END IF;

  -- 1. Enmascarar correos electrónicos
  v_res := regexp_replace(
    v_res,
    '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}',
    '[contacto protegido]',
    'gi'
  );

  -- 2. Enmascarar enlaces directos de WhatsApp (wa.me/..., api.whatsapp.com/...)
  v_res := regexp_replace(
    v_res,
    '(https?://)?(wa\.me|api\.whatsapp\.com|whatsapp\.com)/[a-zA-Z0-9?&=._-]+',
    '[contacto protegido]',
    'gi'
  );

  -- 3. Enmascarar palabras clave de contacto seguidas de números cortos o largos (ej: "cel 456789", "wsp: 236 4 45 67 89")
  v_res := regexp_replace(
    v_res,
    '(tel|cel|wssp?|wh?ats?app?|wpp|contacto|llamar?|fono)[:\s-]*(\+?54[\s.-]*)?(\(?\d[\d\s.()-]{4,18}\d)',
    '[contacto protegido]',
    'gi'
  );

  -- 4. Analizar cada corrida numérica con posibles separadores (+, paréntesis, espacios, guiones, puntos, barras)
  --    para enmascarar cualquier teléfono de 8+ dígitos respetando precios ($1.500.000), años (2015-2020) y fechas (12/11/2026)
  WHILE v_pos <= length(v_res) LOOP
    v_sub := substring(v_res FROM v_pos);
    v_m := regexp_match(v_sub, '(\$?\+?\(?[0-9][0-9\s.\-()/]*[0-9])');
    IF v_m IS NULL THEN
      v_out := v_out || v_sub;
      EXIT;
    END IF;

    v_token := v_m[1];
    v_rel := position(v_token IN v_sub);
    v_len := length(v_token);

    IF v_rel > 1 THEN
      v_out := v_out || substring(v_sub FROM 1 FOR v_rel - 1);
    END IF;

    v_digits := regexp_replace(v_token, '\D', '', 'g');

    IF v_token LIKE '$%' THEN
      v_out := v_out || v_token;
    ELSIF v_token ~ '^\d{1,3}(\.\d{3})+$' THEN
      v_out := v_out || v_token;
    ELSIF v_token ~ '^(19|20)\d{2}\s*-\s*(19|20)\d{2}$' THEN
      v_out := v_out || v_token;
    ELSIF v_token ~ '^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$' THEN
      v_out := v_out || v_token;
    ELSIF length(v_digits) >= 8 THEN
      v_out := v_out || '[contacto protegido]';
    ELSE
      v_out := v_out || v_token;
    END IF;

    v_pos := v_pos + v_rel - 1 + v_len;
  END LOOP;

  RETURN v_out;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Postulantes de 16 y 17 años (Ley 26.390) + Datos de Adulto Responsable
-- ----------------------------------------------------------------------------
ALTER TABLE public.candidate_private
  ADD COLUMN IF NOT EXISTS guardian_name text,
  ADD COLUMN IF NOT EXISTS guardian_phone text,
  ADD COLUMN IF NOT EXISTS guardian_email text,
  ADD COLUMN IF NOT EXISTS guardian_notified_at timestamptz;

DROP FUNCTION IF EXISTS public.save_candidate_profile(
  text, text, text, date, text, text, text, text, public.work_situation,
  text[], text, text[], text[], text, text, text, text, boolean
);

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
  p_is_searching boolean DEFAULT true,
  p_guardian_name text DEFAULT NULL,
  p_guardian_phone text DEFAULT NULL,
  p_guardian_email text DEFAULT NULL
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
  v_age integer;
  v_clean_g_name text := NULLIF(left(trim(COALESCE(p_guardian_name, '')), 120), '');
  v_clean_g_phone text := public.normalize_ar_phone(COALESCE(p_guardian_phone, ''));
  v_clean_g_email text := NULLIF(lower(left(trim(COALESCE(p_guardian_email, '')), 160)), '');
  v_existing_g_email text;
  v_should_notify_guardian boolean := false;
BEGIN
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Sesión inválida. Volvé a ingresar.';
  END IF;

  IF v_user.role <> 'candidate' AND NOT public.is_app_admin(v_user) THEN
    RAISE EXCEPTION 'Esta acción corresponde solo a cuentas de Postulante.';
  END IF;

  IF length(v_clean_phone) < 8 OR length(v_clean_phone) > 13 THEN
    RAISE EXCEPTION 'Ingresá un número de teléfono válido con código de área (ej: 2364 123456).';
  END IF;

  IF p_birth_date IS NULL THEN
    RAISE EXCEPTION 'Ingresá tu fecha de nacimiento.';
  END IF;

  IF p_birth_date < '1920-01-01'::date OR p_birth_date > current_date THEN
    RAISE EXCEPTION 'La fecha de nacimiento ingresada no es válida.';
  END IF;

  v_age := date_part('year', age(current_date, p_birth_date))::integer;

  IF v_age < 16 THEN
    RAISE EXCEPTION 'Por la Ley 26.390, debés tener al menos 16 años para registrarte y buscar empleo.';
  END IF;

  IF v_age < 18 THEN
    IF v_clean_g_name IS NULL THEN
      RAISE EXCEPTION 'Como tenés entre 16 y 17 años, ingresá el nombre completo de tu madre, padre o tutor.';
    END IF;
    IF length(v_clean_g_phone) < 8 OR length(v_clean_g_phone) > 13 THEN
      RAISE EXCEPTION 'Ingresá un teléfono válido de tu madre, padre o tutor.';
    END IF;
    IF v_clean_g_email IS NOT NULL AND (position('@' in v_clean_g_email) = 0 OR length(v_clean_g_email) < 5) THEN
      RAISE EXCEPTION 'El correo del adulto responsable no tiene un formato válido.';
    END IF;
  ELSE
    -- Si es mayor de 18, no requiere datos de adulto responsable
    v_clean_g_name := NULL;
    v_clean_g_phone := NULL;
    v_clean_g_email := NULL;
  END IF;

  IF v_safe_avatar IS NOT NULL THEN
    IF length(v_safe_avatar) > 600000 OR v_safe_avatar !~ '^data:image/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$' THEN
      RAISE EXCEPTION 'Formato de foto de perfil inválido.';
    END IF;
  END IF;

  v_expected_cv_route := '/ver-cv/' || v_user.id::text;
  IF EXISTS (SELECT 1 FROM public.private_cv_files WHERE candidate_id = v_user.id) THEN
    v_safe_cv := v_expected_cv_route;
  ELSE
    v_safe_cv := NULL;
  END IF;

  SELECT guardian_email INTO v_existing_g_email
  FROM public.candidate_private
  WHERE id = v_user.id;

  IF v_age < 18 AND v_clean_g_email IS NOT NULL AND v_clean_g_email IS DISTINCT FROM v_existing_g_email THEN
    v_should_notify_guardian := true;
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

  INSERT INTO public.candidate_private (
    id, birth_date, phone, email,
    guardian_name, guardian_phone, guardian_email, guardian_notified_at,
    updated_at
  )
  VALUES (
    v_user.id, p_birth_date, v_clean_phone, v_user.email,
    v_clean_g_name, NULLIF(v_clean_g_phone, ''), v_clean_g_email, NULL,
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    birth_date = EXCLUDED.birth_date,
    phone = EXCLUDED.phone,
    guardian_name = EXCLUDED.guardian_name,
    guardian_phone = EXCLUDED.guardian_phone,
    guardian_email = EXCLUDED.guardian_email,
    guardian_notified_at = CASE
      WHEN EXCLUDED.guardian_email IS DISTINCT FROM public.candidate_private.guardian_email THEN NULL
      ELSE public.candidate_private.guardian_notified_at
    END,
    updated_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_user.id,
    'age', v_age,
    'is_minor', (v_age < 18),
    'notify_guardian', v_should_notify_guardian
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_candidate_profile(
  text, text, text, date, text, text, text, text, public.work_situation,
  text[], text, text[], text[], text, text, text, text, boolean, text, text, text
) TO anon, authenticated, service_role;

-- Actualizar get_candidates_directory_data con edad dinámica, indicador de menor y resguardo de foto
CREATE OR REPLACE FUNCTION public.get_candidates_directory_data(p_token text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.profiles;
  v_is_authorized_employer boolean := false;
  v_candidates jsonb;
  v_industries jsonb;
BEGIN
  IF p_token IS NOT NULL AND trim(p_token) <> '' THEN
    v_user := public.get_session_profile(p_token);
    IF v_user.id IS NOT NULL AND (
      v_user.role IN ('employer', 'admin') OR lower(trim(v_user.email)) = public.get_admin_email()
    ) THEN
      v_is_authorized_employer := true;
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(c)), '[]'::jsonb) INTO v_candidates
  FROM (
    SELECT
      cp.id,
      cp.first_name,
      CASE
        WHEN v_is_authorized_employer THEN cp.last_name
        ELSE COALESCE(NULLIF(left(cp.last_name, 1) || '.', '.'), '')
      END AS last_name,
      -- Calcular edad dinámicamente al vuelo sin exponer birth_date
      CASE
        WHEN cpriv.birth_date IS NOT NULL THEN date_part('year', age(current_date, cpriv.birth_date))::integer
        ELSE NULL
      END AS age,
      (cpriv.birth_date IS NOT NULL AND date_part('year', age(current_date, cpriv.birth_date))::integer < 18) AS is_minor,
      -- Ocultar foto a visitantes anónimos y también si es menor de edad (por resguardo)
      CASE
        WHEN v_is_authorized_employer AND NOT (cpriv.birth_date IS NOT NULL AND date_part('year', age(current_date, cpriv.birth_date))::integer < 18)
        THEN cp.avatar_url
        ELSE NULL
      END AS avatar_url,
      cp.province,
      cp.district,
      cp.locality,
      cp.work_situation,
      cp.availability,
      cp.education_level,
      cp.industries,
      cp.positions,
      CASE
        WHEN v_is_authorized_employer THEN cp.custom_other_text
        ELSE public.mask_contact_info(cp.custom_other_text)
      END AS custom_other_text,
      CASE
        WHEN v_is_authorized_employer THEN cp.bio_short
        ELSE public.mask_contact_info(cp.bio_short)
      END AS bio_short,
      CASE
        WHEN v_is_authorized_employer AND (
          cp.cv_path IS NOT NULL OR EXISTS (SELECT 1 FROM public.private_cv_files cv WHERE cv.candidate_id = cp.id)
        )
        THEN '/ver-cv/' || cp.id::text
        ELSE NULL
      END AS cv_path,
      cp.is_searching,
      cp.created_at
    FROM public.candidate_profiles cp
    JOIN public.profiles p ON p.id = cp.id
    LEFT JOIN public.candidate_private cpriv ON cpriv.id = cp.id
    WHERE cp.is_searching = true
      AND p.status = 'active'
    ORDER BY cp.created_at DESC
    LIMIT 100
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

GRANT EXECUTE ON FUNCTION public.get_candidates_directory_data(text) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. Fecha de inicio de actividades en Comercios (activity_start_date)
-- ----------------------------------------------------------------------------
ALTER TABLE public.employer_profiles
  ADD COLUMN IF NOT EXISTS activity_start_date date;

DROP FUNCTION IF EXISTS public.save_employer_profile(
  text, text, text, text, text, text, text, text, text, text, text, text
);

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
  p_logo_url text,
  p_activity_start_date date DEFAULT NULL
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

  IF v_user.role <> 'employer' AND NOT public.is_app_admin(v_user) THEN
    RAISE EXCEPTION 'Esta acción corresponde solo a cuentas de Comercio.';
  END IF;

  IF length(v_clean_phone) < 8 OR length(v_clean_phone) > 13 THEN
    RAISE EXCEPTION 'Ingresá un número de teléfono válido con código de área (ej: 2364 123456).';
  END IF;

  IF p_activity_start_date IS NOT NULL AND (p_activity_start_date > current_date OR p_activity_start_date < '1850-01-01'::date) THEN
    RAISE EXCEPTION 'La fecha de inicio de actividades no es válida.';
  END IF;

  IF v_safe_logo IS NOT NULL THEN
    IF length(v_safe_logo) > 600000 OR v_safe_logo !~ '^data:image/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$' THEN
      RAISE EXCEPTION 'Formato de logo inválido.';
    END IF;
  END IF;

  INSERT INTO public.employer_profiles (
    id, trade_name, legal_name, cuit, logo_url, industry,
    province, district, locality, description, activity_start_date, updated_at
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
    p_activity_start_date,
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
    activity_start_date = EXCLUDED.activity_start_date,
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

GRANT EXECUTE ON FUNCTION public.save_employer_profile(
  text, text, text, text, text, text, text, text, text, text, text, text, date
) TO anon, authenticated, service_role;

-- Actualizar get_jobs_directory_data para exponer activity_start_date
CREATE OR REPLACE FUNCTION public.get_jobs_directory_data(p_token text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.profiles;
  v_is_admin boolean := false;
  v_jobs jsonb;
  v_employers jsonb;
  v_industries jsonb;
BEGIN
  IF p_token IS NOT NULL AND trim(p_token) <> '' THEN
    v_user := public.get_session_profile(p_token);
    IF v_user.id IS NOT NULL AND (
      v_user.role = 'admin' OR lower(trim(v_user.email)) = public.get_admin_email()
    ) THEN
      v_is_admin := true;
    END IF;
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
      CASE
        WHEN v_is_admin OR (v_user.id IS NOT NULL AND v_user.id = jp.employer_id) THEN jp.description
        ELSE public.mask_contact_info(jp.description)
      END AS description,
      jp.status,
      jp.created_at,
      jsonb_build_object(
        'trade_name', ep.trade_name,
        'logo_url', ep.logo_url,
        'locality', ep.locality,
        'industry', ep.industry,
        'activity_start_date', ep.activity_start_date,
        'description', CASE
          WHEN v_is_admin OR (v_user.id IS NOT NULL AND v_user.id = ep.id) THEN ep.description
          ELSE public.mask_contact_info(ep.description)
        END
      ) AS employer_profiles
    FROM public.job_posts jp
    JOIN public.employer_profiles ep ON ep.id = jp.employer_id
    JOIN public.profiles p ON p.id = jp.employer_id
    WHERE jp.status = 'active'
      AND jp.deleted_at IS NULL
      AND p.status = 'active'
      AND (jp.expires_at IS NULL OR jp.expires_at > now())
    ORDER BY jp.created_at DESC
    LIMIT 100
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
      ep.activity_start_date,
      CASE
        WHEN v_is_admin OR (v_user.id IS NOT NULL AND v_user.id = ep.id) THEN ep.description
        ELSE public.mask_contact_info(ep.description)
      END AS description,
      ep.created_at
    FROM public.employer_profiles ep
    JOIN public.profiles p ON p.id = ep.id
    WHERE p.status = 'active'
    ORDER BY ep.created_at DESC
    LIMIT 100
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

GRANT EXECUTE ON FUNCTION public.get_jobs_directory_data(text) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. Notificación al padre/madre/tutor cuando el postulante tiene 16-17 años
-- ----------------------------------------------------------------------------
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
  v_cpriv public.candidate_private%ROWTYPE;
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

    IF v_app.last_notified_status IS NOT DISTINCT FROM v_app.status THEN
      RAISE EXCEPTION 'El postulante ya fue notificado de este estado.';
    END IF;

    UPDATE public.applications
    SET last_notified_status = v_app.status,
        status_notified_at = now()
    WHERE id = v_app.id;

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
    v_to_email := public.get_admin_email();
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

  ELSIF p_event_type = 'minor_guardian_notice' THEN
    IF p_target_id <> v_user.id THEN
      RAISE EXCEPTION 'Acceso denegado.';
    END IF;

    SELECT * INTO v_cpriv
    FROM public.candidate_private
    WHERE id = v_user.id
    FOR UPDATE;

    IF NOT FOUND OR v_cpriv.guardian_email IS NULL THEN
      RAISE EXCEPTION 'No hay email de adulto responsable configurado.';
    END IF;

    IF v_cpriv.guardian_notified_at IS NOT NULL THEN
      RAISE EXCEPTION 'El aviso al adulto responsable ya fue enviado.';
    END IF;

    UPDATE public.candidate_private SET guardian_notified_at = now() WHERE id = v_user.id;
    SELECT * INTO v_cand FROM public.candidate_profiles WHERE id = v_user.id;

    v_to_email := v_cpriv.guardian_email;
    v_subject := 'Aviso de registro de menor (16-17 años) - Bolsa de Empleo Tejedor';
    v_html := '<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #e2e8f0;border-radius:16px;">'
      || '<h2 style="color:#0f172a;margin-top:0;">Aviso de Registro en Bolsa de Empleo Tejedor</h2>'
      || '<p style="color:#334155;">Hola <strong>' || public.escape_html(COALESCE(v_cpriv.guardian_name, 'Madre / Padre / Tutor')) || '</strong>,</p>'
      || '<p style="color:#334155;">Te informamos que <strong>' || public.escape_html(COALESCE(v_cand.first_name || ' ' || v_cand.last_name, 'un menor a tu cargo')) || '</strong> registró un perfil laboral como postulante (16-17 años, conforme a la Ley 26.390 de Trabajo Adolescente) indicándote como adulto responsable.</p>'
      || '<p style="color:#475569;font-size:14px;">Por resguardo de privacidad, su foto de perfil se mantiene oculta y sus datos de contacto solo se habilitan a comercios locales registrados cuando busca trabajo.</p>'
      || '<p style="color:#475569;font-size:13px;">Si no autorizás este registro o querés darlo de baja, respondé este correo o escribinos a <strong>' || public.escape_html(public.get_admin_email()) || '</strong>.</p>'
      || '</div>';

  ELSE
    RAISE EXCEPTION 'Tipo de notificación desconocido.';
  END IF;

  INSERT INTO public.notification_outbox (recipient_email, subject, status, sent_at)
  VALUES (v_to_email, v_subject, 'prepared', now());

  RETURN jsonb_build_object(
    'ok', true,
    'to_email', v_to_email,
    'subject', v_subject,
    'html', v_html
  );
END;
$$;

REVOKE ALL ON FUNCTION public.server_prepare_notification_email(text, text, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.server_prepare_notification_email(text, text, uuid) TO service_role;

-- Actualizar server_unmark_notification para minor_guardian_notice
DROP FUNCTION IF EXISTS public.server_unmark_notification(text, uuid);

CREATE OR REPLACE FUNCTION public.server_unmark_notification(
  p_event_type text,
  p_target_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_event_type = 'new_application' THEN
    UPDATE public.applications SET notified_at = NULL WHERE id = p_target_id;
  ELSIF p_event_type = 'admin_ticket_created' THEN
    UPDATE public.admin_tickets SET notified_at = NULL WHERE id = p_target_id;
  ELSIF p_event_type = 'minor_guardian_notice' THEN
    UPDATE public.candidate_private SET guardian_notified_at = NULL WHERE id = p_target_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.server_unmark_notification(text, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.server_unmark_notification(text, uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 6. Actualizar export_my_data para incluir datos de tutor y activity_start_date
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.export_my_data(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.profiles;
  v_cand_pub jsonb;
  v_cand_priv jsonb;
  v_cv_meta jsonb;
  v_applications jsonb;
  v_emp_pub jsonb;
  v_emp_priv jsonb;
  v_job_posts jsonb;
  v_contact_requests jsonb;
  v_access_history jsonb;
  v_tickets jsonb;
  v_acceptances jsonb;
BEGIN
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Sesión inválida. Volvé a ingresar.';
  END IF;

  SELECT to_jsonb(t) INTO v_cand_pub
  FROM (
    SELECT
      id, first_name, last_name, avatar_url, province, district, locality,
      work_situation, availability, education_level, industries, positions,
      custom_other_text, bio_short, is_searching, created_at, updated_at
    FROM public.candidate_profiles
    WHERE id = v_user.id
  ) t;

  SELECT to_jsonb(t) INTO v_cand_priv
  FROM (
    SELECT birth_date, phone, email, guardian_name, guardian_phone, guardian_email, updated_at
    FROM public.candidate_private
    WHERE id = v_user.id
  ) t;

  SELECT to_jsonb(t) INTO v_cv_meta
  FROM (
    SELECT filename, size_bytes, updated_at
    FROM public.private_cv_files
    WHERE candidate_id = v_user.id
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_applications
  FROM (
    SELECT
      a.id,
      a.job_post_id,
      jp.title AS job_title,
      ep.trade_name AS employer_trade_name,
      a.status,
      a.message,
      a.created_at,
      a.updated_at
    FROM public.applications a
    JOIN public.job_posts jp ON jp.id = a.job_post_id
    LEFT JOIN public.employer_profiles ep ON ep.id = jp.employer_id
    WHERE a.candidate_id = v_user.id
    ORDER BY a.created_at DESC
  ) t;

  SELECT to_jsonb(t) INTO v_emp_pub
  FROM (
    SELECT
      id, trade_name, legal_name, cuit, logo_url, industry,
      province, district, locality, description, activity_start_date, is_verified,
      created_at, updated_at
    FROM public.employer_profiles
    WHERE id = v_user.id
  ) t;

  SELECT to_jsonb(t) INTO v_emp_priv
  FROM (
    SELECT contact_person_name, phone, email, updated_at
    FROM public.employer_private
    WHERE id = v_user.id
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_job_posts
  FROM (
    SELECT
      id, title, industry, position_tag, custom_other_text,
      province, district, locality, availability, required_education,
      description, status, expires_at, created_at, updated_at
    FROM public.job_posts
    WHERE employer_id = v_user.id AND deleted_at IS NULL
    ORDER BY created_at DESC
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_contact_requests
  FROM (
    SELECT
      cr.id,
      cr.candidate_id,
      cr.employer_id,
      ep.trade_name AS employer_trade_name,
      cr.status,
      cr.message,
      cr.responded_at,
      cr.created_at
    FROM public.contact_requests cr
    LEFT JOIN public.employer_profiles ep ON ep.id = cr.employer_id
    WHERE (v_user.role = 'employer' AND cr.employer_id = v_user.id)
       OR (v_user.role = 'candidate' AND cr.candidate_id = v_user.id)
    ORDER BY cr.created_at DESC
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_access_history
  FROM (
    SELECT
      al.action,
      al.created_at,
      ep.trade_name AS actor_employer
    FROM public.access_log al
    LEFT JOIN public.employer_profiles ep ON ep.id = al.actor_id
    WHERE al.target_id = v_user.id
    ORDER BY al.created_at DESC
    LIMIT 50
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_tickets
  FROM (
    SELECT id, category, message, messages, status, created_at, replied_at
    FROM public.admin_tickets
    WHERE employer_id = v_user.id
    ORDER BY created_at DESC
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_acceptances
  FROM (
    SELECT role, version, accepted_at
    FROM public.terms_acceptances
    WHERE user_id = v_user.id
    ORDER BY accepted_at DESC
  ) t;

  RETURN jsonb_build_object(
    'exported_at', now(),
    'account', jsonb_build_object(
      'id', v_user.id,
      'email', v_user.email,
      'role', v_user.role,
      'status', v_user.status,
      'created_at', v_user.created_at,
      'last_login_at', v_user.last_login_at
    ),
    'candidate_profile', v_cand_pub,
    'candidate_private', v_cand_priv,
    'cv_file', v_cv_meta,
    'applications', v_applications,
    'contact_requests', v_contact_requests,
    'access_history', v_access_history,
    'employer_profile', v_emp_pub,
    'employer_private', v_emp_priv,
    'job_posts', v_job_posts,
    'tickets', v_tickets,
    'terms_acceptances', v_acceptances
  );
END;
$$;
