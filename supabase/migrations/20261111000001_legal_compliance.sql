-- ============================================================================
-- RESGUARDO LEGAL Y PRIVACIDAD (20261111000001_legal_compliance.sql)
-- a) Versión legal en app_settings
-- b) Constancias de aceptación en terms_acceptances
-- c) Validación y registro de terms_version en server_issue_otp_challenge
-- d) Inserción en terms_acceptances al verificar código en verify_otp_code
-- e) Mayoría de edad (+18 años obligatorio) en save_candidate_profile
-- f) Baja definitiva de cuenta y datos en delete_my_account
-- g) Exportación de datos propios en export_my_data
-- h) Sistema de denuncias (reports, create_report, admin_resolve_report, dashboard)
-- i) Limpieza automática de datos vencidos/inactivos en purge_inactive_data
-- ============================================================================

-- ----------------------------------------------------------------------------
-- a) Versión legal vigente en app_settings
-- ----------------------------------------------------------------------------
INSERT INTO public.app_settings (key, value)
VALUES ('legal_version', '2026-11-11')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

CREATE OR REPLACE FUNCTION public.get_legal_version()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT COALESCE(
    (SELECT trim(value) FROM public.app_settings WHERE key = 'legal_version' LIMIT 1),
    '2026-11-11'
  );
$$;

REVOKE ALL ON FUNCTION public.get_legal_version() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_legal_version() TO service_role;

-- ----------------------------------------------------------------------------
-- b) Tabla de constancias de aceptación de Términos y Política de Privacidad
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.terms_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  email_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('candidate', 'employer', 'admin')),
  version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  client_ip text
);

ALTER TABLE public.terms_acceptances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.terms_acceptances FROM public, anon, authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS idx_terms_acceptances_user_role_version
  ON public.terms_acceptances (user_id, role, version)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_terms_acceptances_email_hash
  ON public.terms_acceptances (email_hash);

-- ----------------------------------------------------------------------------
-- c) Validación de terms_version en server_issue_otp_challenge
-- ----------------------------------------------------------------------------
ALTER TABLE public.email_otp_codes
  ADD COLUMN IF NOT EXISTS terms_version text;

DROP FUNCTION IF EXISTS public.server_issue_otp_challenge(text, public.user_role, text);
DROP FUNCTION IF EXISTS public.server_issue_otp_challenge(text, public.user_role, text, text);

CREATE OR REPLACE FUNCTION public.server_issue_otp_challenge(
  p_email text,
  p_role public.user_role,
  p_client_ip text DEFAULT 'unknown',
  p_terms_version text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_clean_email text := lower(trim(COALESCE(p_email, '')));
  v_clean_ip text := COALESCE(NULLIF(trim(p_client_ip), ''), 'unknown');
  v_clean_terms text := NULLIF(trim(COALESCE(p_terms_version, '')), '');
  v_admin_email text := public.get_admin_email();
  v_legal_version text := public.get_legal_version();
  v_existing_profile public.profiles%ROWTYPE;
  v_recent_email_count integer;
  v_recent_ip_count integer;
  v_active_unused_created timestamptz;
  v_raw_bytes bytea;
  v_num integer;
  v_code text;
  v_hash text;
  v_generic_err text := 'No pudimos iniciar sesión con este correo. Si ya tenés cuenta, verificá el tipo de perfil elegido o escribinos.';
BEGIN
  IF v_clean_email = '' OR position('@' in v_clean_email) = 0 OR length(v_clean_email) > 160 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Ingresá un correo electrónico válido.');
  END IF;

  IF p_role = 'admin' AND v_clean_email <> v_admin_email THEN
    RETURN jsonb_build_object('ok', false, 'error', v_generic_err);
  END IF;

  -- Validar versión de Términos y Privacidad para Postulantes y Comercios (Admin exento)
  IF p_role IN ('candidate', 'employer') THEN
    IF v_clean_terms IS DISTINCT FROM v_legal_version THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'Tenés que aceptar los Términos y la Política de Privacidad vigentes. Si ya los aceptaste, recargá la página.'
      );
    END IF;
  END IF;

  -- Limpieza oportunista de códigos y sesiones viejas
  DELETE FROM public.email_otp_codes WHERE expires_at < (now() - interval '1 day');
  DELETE FROM public.user_sessions WHERE expires_at <= now();

  -- Límite por IP de 30 códigos por hora
  IF v_clean_ip <> 'unknown' THEN
    SELECT count(*)
    INTO v_recent_ip_count
    FROM public.email_otp_codes
    WHERE client_ip = v_clean_ip
      AND created_at > (now() - interval '1 hour');

    IF v_recent_ip_count >= 30 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Demasiadas solicitudes desde esta conexión. Probá más tarde.');
    END IF;
  END IF;

  -- Cooldown de 2 minutos mientras haya código activo sin usar
  SELECT max(created_at)
  INTO v_active_unused_created
  FROM public.email_otp_codes
  WHERE lower(email) = v_clean_email
    AND used_at IS NULL
    AND attempts < 5
    AND expires_at > now();

  IF v_active_unused_created IS NOT NULL AND v_active_unused_created > (now() - interval '2 minutes') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Esperá unos segundos antes de pedir un código nuevo.');
  END IF;

  -- Límite por email de 8 códigos por hora
  SELECT count(*)
  INTO v_recent_email_count
  FROM public.email_otp_codes
  WHERE lower(email) = v_clean_email
    AND created_at > (now() - interval '1 hour');

  IF v_recent_email_count >= 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Superaste el límite de códigos por hora para este correo. Intentá más tarde.');
  END IF;

  -- Mensaje genérico para cuenta pausada, eliminada o con otro rol
  SELECT * INTO v_existing_profile
  FROM public.profiles
  WHERE lower(email) = v_clean_email;

  IF FOUND THEN
    IF v_existing_profile.status IN ('deleted', 'paused') THEN
      RETURN jsonb_build_object('ok', false, 'error', v_generic_err);
    END IF;

    IF v_clean_email <> v_admin_email AND v_existing_profile.role <> p_role THEN
      RETURN jsonb_build_object('ok', false, 'error', v_generic_err);
    END IF;
  END IF;

  -- Invalidar códigos anteriores sin usar
  UPDATE public.email_otp_codes
  SET used_at = now()
  WHERE lower(email) = v_clean_email
    AND used_at IS NULL;

  -- Generar código criptográfico de 6 dígitos
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
    terms_version,
    expires_at
  ) VALUES (
    v_clean_email,
    'HASHED',
    v_hash,
    p_role,
    0,
    v_clean_ip,
    CASE WHEN p_role IN ('candidate', 'employer') THEN v_clean_terms ELSE NULL END,
    now() + interval '10 minutes'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'email', v_clean_email,
    'code', v_code
  );
END;
$$;

REVOKE ALL ON FUNCTION public.server_issue_otp_challenge(text, public.user_role, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.server_issue_otp_challenge(text, public.user_role, text, text) TO service_role;

-- ----------------------------------------------------------------------------
-- d) verify_otp_code registra constancia en terms_acceptances
-- ----------------------------------------------------------------------------
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
    INSERT INTO public.profiles (email, role, status)
    VALUES (v_clean_email, v_effective_role, 'active')
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
  END IF;

  -- Guardar constancia de aceptación de Términos y Política (una por usuario, rol y versión)
  IF v_otp_row.terms_version IS NOT NULL THEN
    INSERT INTO public.terms_acceptances (user_id, email_hash, role, version, client_ip)
    VALUES (
      v_profile.id,
      encode(digest(lower(trim(v_profile.email)), 'sha256'), 'hex'),
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
-- e) Mayoría de edad obligatoria (+18 años) en save_candidate_profile
-- ----------------------------------------------------------------------------
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

  IF v_user.role <> 'candidate' AND NOT public.is_app_admin(v_user) THEN
    RAISE EXCEPTION 'Esta acción corresponde solo a cuentas de Postulante.';
  END IF;

  IF length(v_clean_phone) < 8 OR length(v_clean_phone) > 13 THEN
    RAISE EXCEPTION 'Ingresá un número de teléfono válido con código de área (ej: 2314 123456).';
  END IF;

  IF p_birth_date IS NULL THEN
    RAISE EXCEPTION 'Ingresá tu fecha de nacimiento. El sitio es solo para mayores de 18 años.';
  END IF;

  IF p_birth_date > (current_date - interval '18 years')::date OR p_birth_date < '1920-01-01'::date THEN
    RAISE EXCEPTION 'Debés ser mayor de 18 años para registrarte como postulante.';
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

-- ----------------------------------------------------------------------------
-- f) Baja definitiva de cuenta y datos (delete_my_account)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_my_account(
  p_token text,
  p_confirm text
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
  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Sesión inválida. Volvé a ingresar.';
  END IF;

  IF p_confirm IS DISTINCT FROM 'ELIMINAR' THEN
    RAISE EXCEPTION 'Para confirmar la eliminación definitiva debés escribir exactamente ELIMINAR.';
  END IF;

  IF v_user.role = 'admin' OR lower(trim(v_user.email)) = public.get_admin_email() THEN
    RAISE EXCEPTION 'La cuenta de Administrador no puede eliminarse desde aquí.';
  END IF;

  -- Eliminar rastros de email en tablas auxiliares sin clave foránea
  DELETE FROM public.email_otp_codes WHERE lower(email) = lower(trim(v_user.email));
  DELETE FROM public.notification_outbox WHERE lower(recipient_email) = lower(trim(v_user.email));
  DELETE FROM public.user_sessions WHERE user_id = v_user.id;

  -- Registro anónimo estadístico de baja (sin actor_id ni target_id)
  INSERT INTO public.access_log (actor_id, target_id, action)
  VALUES (NULL, NULL, 'account_self_deleted');

  -- Borrar perfil base (ON DELETE CASCADE borra candidate_profiles, candidate_private,
  -- employer_profiles, employer_private, job_posts, applications, contact_requests,
  -- contact_grants, private_cv_files, admin_tickets y user_sessions;
  -- ON DELETE SET NULL anonimiza access_log, reports y terms_acceptances)
  DELETE FROM public.profiles WHERE id = v_user.id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ----------------------------------------------------------------------------
-- g) Exportación de datos propios (export_my_data)
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
    SELECT birth_date, phone, email, updated_at
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
      province, district, locality, description, is_verified,
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
      cr.status,
      cr.message,
      cr.responded_at,
      cr.created_at
    FROM public.contact_requests cr
    WHERE cr.employer_id = v_user.id
    ORDER BY cr.created_at DESC
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
      'updated_at', v_user.updated_at
    ),
    'candidate_profile', v_cand_pub,
    'candidate_private', v_cand_priv,
    'cv_metadata', v_cv_meta,
    'applications', v_applications,
    'employer_profile', v_emp_pub,
    'employer_private', v_emp_priv,
    'job_posts', v_job_posts,
    'contact_requests', v_contact_requests,
    'tickets', v_tickets,
    'terms_acceptances', v_acceptances
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- h) Sistema de Denuncias (reports, create_report, admin_resolve_report, dashboard)
-- ----------------------------------------------------------------------------
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS detail text;

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

DROP POLICY IF EXISTS "reports_insert_authenticated" ON public.reports;
DROP POLICY IF EXISTS "reports_admin_all" ON public.reports;

REVOKE ALL ON TABLE public.reports FROM public, anon, authenticated;
REVOKE ALL ON TABLE public.access_log FROM public, anon, authenticated;
REVOKE ALL ON TABLE public.notification_outbox FROM public, anon, authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_open_per_user_target
  ON public.reports (reporter_id, target_type, target_id)
  WHERE status = 'open' AND reporter_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_report(
  p_token text,
  p_target_type text,
  p_target_id uuid,
  p_reason text,
  p_detail text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.profiles;
  v_clean_reason text := trim(COALESCE(p_reason, ''));
  v_clean_detail text := left(NULLIF(trim(COALESCE(p_detail, '')), ''), 300);
  v_recent_count integer;
  v_target_exists boolean := false;
  v_target_owner_id uuid;
  v_report_id uuid;
BEGIN
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Ingresá con tu cuenta para poder enviar una denuncia.';
  END IF;

  IF p_target_type NOT IN ('candidate', 'employer', 'job_post') THEN
    RAISE EXCEPTION 'Tipo de denuncia inválido.';
  END IF;

  IF p_target_id IS NULL THEN
    RAISE EXCEPTION 'Elemento a denunciar inválido.';
  END IF;

  IF v_clean_reason NOT IN (
    'Aviso falso o estafa',
    'Discrimina',
    'Trabajo no registrado o ilegal',
    'Contenido inapropiado',
    'Uso indebido de datos personales',
    'Otro'
  ) THEN
    RAISE EXCEPTION 'Seleccioná un motivo de denuncia válido.';
  END IF;

  IF p_target_type = 'candidate' THEN
    SELECT cp.id INTO v_target_owner_id
    FROM public.candidate_profiles cp
    JOIN public.profiles p ON p.id = cp.id
    WHERE cp.id = p_target_id AND p.status <> 'deleted';
    v_target_exists := FOUND;
  ELSIF p_target_type = 'employer' THEN
    SELECT ep.id INTO v_target_owner_id
    FROM public.employer_profiles ep
    JOIN public.profiles p ON p.id = ep.id
    WHERE ep.id = p_target_id AND p.status <> 'deleted';
    v_target_exists := FOUND;
  ELSIF p_target_type = 'job_post' THEN
    SELECT jp.employer_id INTO v_target_owner_id
    FROM public.job_posts jp
    WHERE jp.id = p_target_id AND jp.deleted_at IS NULL;
    v_target_exists := FOUND;
  END IF;

  IF NOT v_target_exists THEN
    RAISE EXCEPTION 'El perfil o aviso que intentás denunciar ya no existe.';
  END IF;

  IF v_target_owner_id = v_user.id THEN
    RAISE EXCEPTION 'No podés denunciar tu propio perfil o aviso.';
  END IF;

  SELECT count(*) INTO v_recent_count
  FROM public.reports
  WHERE reporter_id = v_user.id
    AND created_at > (now() - interval '24 hours');

  IF v_recent_count >= 10 THEN
    RAISE EXCEPTION 'Alcanzaste el límite de 10 denuncias en 24 horas. Probá más tarde.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.reports
    WHERE reporter_id = v_user.id
      AND target_type = p_target_type
      AND target_id = p_target_id
      AND status = 'open'
  ) THEN
    RAISE EXCEPTION 'Ya enviaste una denuncia pendiente para este elemento. El administrador la revisará a la brevedad.';
  END IF;

  INSERT INTO public.reports (reporter_id, target_type, target_id, reason, detail, status)
  VALUES (v_user.id, p_target_type, p_target_id, v_clean_reason, v_clean_detail, 'open')
  RETURNING id INTO v_report_id;

  INSERT INTO public.access_log (actor_id, target_id, action)
  VALUES (v_user.id, p_target_id, 'create_report_' || p_target_type);

  RETURN jsonb_build_object(
    'ok', true,
    'report_id', v_report_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_resolve_report(
  p_token text,
  p_report_id uuid,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.profiles;
  v_report public.reports%ROWTYPE;
BEGIN
  v_user := public.get_session_profile(p_token);
  IF NOT public.is_app_admin(v_user) THEN
    RAISE EXCEPTION 'Acceso exclusivo para el Administrador.';
  END IF;

  IF p_status NOT IN ('resolved', 'dismissed') THEN
    RAISE EXCEPTION 'Estado de denuncia inválido.';
  END IF;

  SELECT * INTO v_report FROM public.reports WHERE id = p_report_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró la denuncia.';
  END IF;

  UPDATE public.reports
  SET status = p_status,
      resolved_at = now()
  WHERE id = p_report_id;

  INSERT INTO public.access_log (actor_id, target_id, action)
  VALUES (v_user.id, v_report.target_id, 'resolve_report_' || p_status);

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Actualizar admin_get_full_dashboard manteniendo columnas explícitas y sumando reports
CREATE OR REPLACE FUNCTION public.admin_get_full_dashboard(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.profiles;
  v_candidates jsonb;
  v_employers jsonb;
  v_jobs jsonb;
  v_tickets jsonb;
  v_reports jsonb;
BEGIN
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Sesión inválida.';
  END IF;

  IF NOT public.is_app_admin(v_user) THEN
    RAISE EXCEPTION 'Acceso exclusivo para el Administrador.';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_candidates
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
      cp.is_searching,
      cp.created_at,
      cp.updated_at,
      CASE
        WHEN EXISTS (SELECT 1 FROM public.private_cv_files cv WHERE cv.candidate_id = cp.id)
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
      ep.id,
      ep.trade_name,
      ep.legal_name,
      ep.cuit,
      ep.logo_url,
      ep.industry,
      ep.province,
      ep.district,
      ep.locality,
      ep.description,
      ep.is_verified,
      ep.created_at,
      ep.updated_at,
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
      jp.paused_by_admin,
      jp.expires_at,
      jp.created_at,
      jp.updated_at,
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
      at.messages,
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

  SELECT COALESCE(jsonb_agg(row_to_json(rp)), '[]'::jsonb) INTO v_reports
  FROM (
    SELECT
      r.id,
      r.target_type,
      r.target_id,
      r.reason,
      r.detail,
      r.status,
      r.created_at,
      r.resolved_at,
      COALESCE(rep_p.email, 'Cuenta eliminada') AS reporter_email,
      CASE
        WHEN r.target_type = 'candidate' THEN
          COALESCE(NULLIF(trim(COALESCE(cp.first_name, '') || ' ' || COALESCE(cp.last_name, '')), ''), tp.email, 'Postulante eliminado')
        WHEN r.target_type = 'employer' THEN
          COALESCE(ep.trade_name, tp.email, 'Comercio eliminado')
        WHEN r.target_type = 'job_post' THEN
          COALESCE(jp.title || COALESCE(' — ' || jep.trade_name, ''), 'Aviso eliminado')
        ELSE 'Elemento'
      END AS target_label,
      CASE
        WHEN r.target_type = 'job_post' THEN COALESCE(jp.status::text, 'deleted')
        ELSE COALESCE(tp.status::text, 'deleted')
      END AS target_status
    FROM public.reports r
    LEFT JOIN public.profiles rep_p ON rep_p.id = r.reporter_id
    LEFT JOIN public.profiles tp ON tp.id = r.target_id AND r.target_type IN ('candidate', 'employer')
    LEFT JOIN public.candidate_profiles cp ON cp.id = r.target_id AND r.target_type = 'candidate'
    LEFT JOIN public.employer_profiles ep ON ep.id = r.target_id AND r.target_type = 'employer'
    LEFT JOIN public.job_posts jp ON jp.id = r.target_id AND r.target_type = 'job_post'
    LEFT JOIN public.employer_profiles jep ON jep.id = jp.employer_id
    ORDER BY
      CASE WHEN r.status = 'open' THEN 0 ELSE 1 END,
      r.created_at DESC
  ) rp;

  RETURN jsonb_build_object(
    'candidates', v_candidates,
    'employers', v_employers,
    'jobs', v_jobs,
    'tickets', v_tickets,
    'reports', v_reports
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- i) Limpieza automática periódica (solo service_role)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_inactive_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_admin_email text := public.get_admin_email();
  v_deleted_profiles integer := 0;
  v_deleted_jobs integer := 0;
  v_deleted_otps integer := 0;
  v_deleted_sessions integer := 0;
  v_deleted_logs integer := 0;
  v_deleted_reports integer := 0;
  v_deleted_outbox integer := 0;
  v_inactive_emails text[];
BEGIN
  -- Identificar emails de cuentas no-admin sin actividad en los últimos 24 meses
  SELECT array_agg(lower(trim(p.email)))
  INTO v_inactive_emails
  FROM public.profiles p
  WHERE p.role <> 'admin'
    AND lower(trim(p.email)) <> v_admin_email
    AND GREATEST(
      p.updated_at,
      p.created_at,
      COALESCE((SELECT max(us.created_at) FROM public.user_sessions us WHERE us.user_id = p.id), p.created_at)
    ) < (now() - interval '24 months');

  -- Eliminar cuentas no-admin inactivas hace más de 24 meses
  WITH del_profiles AS (
    DELETE FROM public.profiles p
    WHERE p.role <> 'admin'
      AND lower(trim(p.email)) <> v_admin_email
      AND GREATEST(
        p.updated_at,
        p.created_at,
        COALESCE((SELECT max(us.created_at) FROM public.user_sessions us WHERE us.user_id = p.id), p.created_at)
      ) < (now() - interval '24 months')
    RETURNING p.id
  )
  SELECT count(*) INTO v_deleted_profiles FROM del_profiles;

  -- Eliminar avisos vencidos o borrados hace más de 90 días
  WITH del_jobs AS (
    DELETE FROM public.job_posts
    WHERE expires_at < (now() - interval '90 days')
       OR (deleted_at IS NOT NULL AND deleted_at < (now() - interval '90 days'))
    RETURNING id
  )
  SELECT count(*) INTO v_deleted_jobs FROM del_jobs;

  -- Eliminar códigos OTP de más de 7 días o pertenecientes a cuentas purgadas
  WITH del_otps AS (
    DELETE FROM public.email_otp_codes
    WHERE created_at < (now() - interval '7 days')
       OR (v_inactive_emails IS NOT NULL AND lower(trim(email)) = ANY(v_inactive_emails))
    RETURNING id
  )
  SELECT count(*) INTO v_deleted_otps FROM del_otps;

  -- Eliminar sesiones vencidas
  WITH del_sessions AS (
    DELETE FROM public.user_sessions
    WHERE expires_at <= now()
    RETURNING token
  )
  SELECT count(*) INTO v_deleted_sessions FROM del_sessions;

  -- Eliminar registros de seguridad de más de 12 meses
  WITH del_logs AS (
    DELETE FROM public.access_log
    WHERE created_at < (now() - interval '12 months')
    RETURNING id
  )
  SELECT count(*) INTO v_deleted_logs FROM del_logs;

  -- Eliminar denuncias cerradas de más de 12 meses
  WITH del_reports AS (
    DELETE FROM public.reports
    WHERE status IN ('resolved', 'dismissed')
      AND created_at < (now() - interval '12 months')
    RETURNING id
  )
  SELECT count(*) INTO v_deleted_reports FROM del_reports;

  -- Eliminar cola de notificaciones antiguas (> 90 días) o de cuentas purgadas
  WITH del_outbox AS (
    DELETE FROM public.notification_outbox
    WHERE created_at < (now() - interval '90 days')
       OR (v_inactive_emails IS NOT NULL AND lower(trim(recipient_email)) = ANY(v_inactive_emails))
    RETURNING id
  )
  SELECT count(*) INTO v_deleted_outbox FROM del_outbox;

  RETURN jsonb_build_object(
    'ok', true,
    'deleted_profiles', v_deleted_profiles,
    'deleted_jobs', v_deleted_jobs,
    'deleted_otps', v_deleted_otps,
    'deleted_sessions', v_deleted_sessions,
    'deleted_logs', v_deleted_logs,
    'deleted_reports', v_deleted_reports,
    'deleted_outbox', v_deleted_outbox,
    'executed_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_inactive_data() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_inactive_data() TO service_role;
