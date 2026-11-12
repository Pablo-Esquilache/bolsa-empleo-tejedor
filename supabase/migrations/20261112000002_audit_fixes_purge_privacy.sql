-- ============================================================================
-- REFUERZO DE PRIVACIDAD, CORRECCIÓN DE PURGA Y PROTECCIÓN CONTRA FUGAS
-- (20261112000002_audit_fixes_purge_privacy.sql)
--
-- 1. Agrega profiles.last_login_at y actualiza verify_otp_code para evitar
--    que la purga elimine usuarios activos cuyas sesiones de 30 días expiraron.
-- 2. Unifica y corrige purge_inactive_data a 12 meses evaluando last_login_at.
-- 3. Crea la función mask_contact_info para enmascarar teléfonos y emails
--    en textos libres (biografías y avisos) frente a visitantes anónimos.
-- 4. Oculta avatar_url de postulantes a anónimos (evita identificación visual en pueblos).
-- 5. Actualiza get_jobs_directory_data y get_candidates_directory_data aplicando
--    enmascaramiento y límites seguros.
-- 6. Amplía export_my_data para incluir solicitudes de contacto recibidas e
--    historial de accesos al CV por parte de comercios (Ley 25.326).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Agregar last_login_at a profiles e inicializar existentes
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz DEFAULT now();

UPDATE public.profiles
SET last_login_at = GREATEST(updated_at, created_at)
WHERE last_login_at IS NULL;

-- ----------------------------------------------------------------------------
-- 2. Actualizar verify_otp_code para renovar last_login_at en cada ingreso
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
-- 3. Función de enmascaramiento de teléfonos y correos en texto libre
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mask_contact_info(p_text text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_res text := COALESCE(p_text, '');
BEGIN
  IF v_res = '' THEN
    RETURN v_res;
  END IF;

  -- Enmascarar correos electrónicos (ej: maria@gmail.com -> [contacto protegido])
  v_res := regexp_replace(
    v_res,
    '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}',
    '[contacto protegido]',
    'gi'
  );

  -- Enmascarar teléfonos y números de WhatsApp (7 o más dígitos con separadores de espacio, guión o punto)
  v_res := regexp_replace(
    v_res,
    '(?:\+?54[\s.-]*)?(?:9[\s.-]*)?(?:\(?0?\d{2,4}\)?[\s.-]*)?(?:15[\s.-]*)?\d(?:[\s.-]*\d){6,13}',
    '[contacto protegido]',
    'g'
  );

  RETURN v_res;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. Purga automática de inactivos corregida (12 meses exactos y usando last_login_at)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_inactive_data(p_months integer DEFAULT 12)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_admin_email text := public.get_admin_email();
  v_cutoff_interval interval := (COALESCE(p_months, 12) || ' months')::interval;
  v_deleted_profiles integer := 0;
  v_deleted_jobs integer := 0;
  v_deleted_otps integer := 0;
  v_deleted_sessions integer := 0;
  v_deleted_logs integer := 0;
  v_deleted_reports integer := 0;
  v_deleted_outbox integer := 0;
  v_inactive_emails text[];
BEGIN
  -- Identificar emails de cuentas no-admin sin actividad en los últimos 12 meses.
  -- Se evalúa la fecha MÁS RECIENTE entre:
  --   a) last_login_at (renovado cada vez que ingresa con OTP)
  --   b) updated_at (renovado cada vez que edita perfil o aviso)
  --   c) created_at (fecha de creación)
  -- Además se excluye explícitamente a cualquier usuario que conserve una sesión activa no vencida.
  SELECT array_agg(lower(trim(p.email)))
  INTO v_inactive_emails
  FROM public.profiles p
  WHERE p.role <> 'admin'
    AND lower(trim(p.email)) <> v_admin_email
    AND GREATEST(
      COALESCE(p.last_login_at, p.created_at),
      p.updated_at,
      p.created_at
    ) < (now() - v_cutoff_interval)
    AND NOT EXISTS (
      SELECT 1 FROM public.user_sessions us
      WHERE us.user_id = p.id AND us.expires_at > now()
    );

  -- Eliminar perfiles inactivos de más de 12 meses
  WITH del_profiles AS (
    DELETE FROM public.profiles p
    WHERE p.role <> 'admin'
      AND lower(trim(p.email)) <> v_admin_email
      AND GREATEST(
        COALESCE(p.last_login_at, p.created_at),
        p.updated_at,
        p.created_at
      ) < (now() - v_cutoff_interval)
      AND NOT EXISTS (
        SELECT 1 FROM public.user_sessions us
        WHERE us.user_id = p.id AND us.expires_at > now()
      )
    RETURNING p.id
  )
  SELECT count(*) INTO v_deleted_profiles FROM del_profiles;

  -- Eliminar avisos vencidos o dados de baja hace más de 90 días
  WITH del_jobs AS (
    DELETE FROM public.job_posts
    WHERE expires_at < (now() - interval '90 days')
       OR (deleted_at IS NOT NULL AND deleted_at < (now() - interval '90 days'))
    RETURNING id
  )
  SELECT count(*) INTO v_deleted_jobs FROM del_jobs;

  -- Eliminar códigos OTP antiguos (> 7 días) o de emails inactivos purgados
  WITH del_otps AS (
    DELETE FROM public.email_otp_codes
    WHERE created_at < (now() - interval '7 days')
       OR (v_inactive_emails IS NOT NULL AND lower(trim(email)) = ANY(v_inactive_emails))
    RETURNING id
  )
  SELECT count(*) INTO v_deleted_otps FROM del_otps;

  -- Eliminar sesiones expiradas
  WITH del_sessions AS (
    DELETE FROM public.user_sessions
    WHERE expires_at <= now()
    RETURNING token
  )
  SELECT count(*) INTO v_deleted_sessions FROM del_sessions;

  -- Eliminar registros de auditoría de seguridad de más de 12 meses
  WITH del_logs AS (
    DELETE FROM public.access_log
    WHERE created_at < (now() - interval '12 months')
    RETURNING id
  )
  SELECT count(*) INTO v_deleted_logs FROM del_logs;

  -- Eliminar denuncias cerradas o desestimadas de más de 12 meses
  WITH del_reports AS (
    DELETE FROM public.reports
    WHERE status IN ('resolved', 'dismissed')
      AND created_at < (now() - interval '12 months')
    RETURNING id
  )
  SELECT count(*) INTO v_deleted_reports FROM del_reports;

  -- Eliminar notificaciones enviadas de más de 90 días
  WITH del_outbox AS (
    DELETE FROM public.notification_outbox
    WHERE created_at < (now() - interval '90 days')
       OR (v_inactive_emails IS NOT NULL AND lower(trim(recipient_email)) = ANY(v_inactive_emails))
    RETURNING id
  )
  SELECT count(*) INTO v_deleted_outbox FROM del_outbox;

  RETURN jsonb_build_object(
    'ok', true,
    'cutoff_months', COALESCE(p_months, 12),
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

REVOKE ALL ON FUNCTION public.purge_inactive_data(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_inactive_data(integer) TO service_role;

-- ----------------------------------------------------------------------------
-- 5. Actualizar get_jobs_directory_data: enmascarar contactos a anónimos
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_jobs_directory_data(p_token text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.profiles;
  v_is_logged_in boolean := false;
  v_jobs jsonb;
  v_employers jsonb;
  v_industries jsonb;
BEGIN
  IF p_token IS NOT NULL AND trim(p_token) <> '' THEN
    v_user := public.get_session_profile(p_token);
    IF v_user.id IS NOT NULL THEN
      v_is_logged_in := true;
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
        WHEN v_is_logged_in THEN jp.description
        ELSE public.mask_contact_info(jp.description)
      END AS description,
      jp.status,
      jp.created_at,
      jsonb_build_object(
        'trade_name', ep.trade_name,
        'logo_url', ep.logo_url,
        'locality', ep.locality,
        'industry', ep.industry,
        'description', CASE
          WHEN v_is_logged_in THEN ep.description
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
      CASE
        WHEN v_is_logged_in THEN ep.description
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
-- 6. Actualizar get_candidates_directory_data:
--    - Enmascarar datos de contacto en bio_short y custom_other_text
--    - Ocultar avatar_url (foto) a anónimos
--    - Ocultar apellido completo y CV a anónimos
-- ----------------------------------------------------------------------------
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
      -- La foto de perfil se preserva para comercios autenticados; se anonimiza frente a visitantes anónimos
      CASE
        WHEN v_is_authorized_employer THEN cp.avatar_url
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
-- 7. Actualizar export_my_data para incluir solicitudes de contacto recibidas
--    e historial de visualización de datos (Ley 25.326 Art. 14)
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

  -- Solicitudes de contacto: enviadas (si es comercio) o recibidas (si es postulante)
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

  -- Historial de accesos legítimos a los datos (quién vio el perfil/CV)
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
