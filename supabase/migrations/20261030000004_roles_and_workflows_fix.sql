-- ============================================================================
-- AJUSTES DE ROLES, REDIRECCIONES, GESTIÓN DE POSTULACIONES Y RUBROS EN /ADMIN
-- ============================================================================

-- 1. Ajustar create_otp_challenge para permitir que el correo admin pruebe en el sitio público
CREATE OR REPLACE FUNCTION public.create_otp_challenge(
  p_email text,
  p_role public.user_role DEFAULT 'candidate'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean_email text := lower(trim(p_email));
  v_existing_profile public.profiles%ROWTYPE;
  v_code text;
BEGIN
  IF v_clean_email = '' OR position('@' in v_clean_email) = 0 THEN
    RAISE EXCEPTION 'Ingresá un correo electrónico válido.';
  END IF;

  IF p_role = 'admin' AND v_clean_email <> 'pabloesquilache@gmail.com' THEN
    RAISE EXCEPTION 'Este correo no tiene permisos de Administrador.';
  END IF;

  SELECT * INTO v_existing_profile
  FROM public.profiles
  WHERE lower(email) = v_clean_email;

  IF FOUND THEN
    IF v_existing_profile.status = 'deleted' THEN
      RAISE EXCEPTION 'Esta cuenta fue dada de baja.';
    END IF;
    -- Para usuarios normales: 1 email = 1 rol
    IF v_clean_email <> 'pabloesquilache@gmail.com' AND v_existing_profile.role <> p_role THEN
      IF v_existing_profile.role = 'candidate' THEN
        RAISE EXCEPTION 'Este correo ya está registrado como Postulante. Para registrar un Comercio usá otro correo.';
      ELSIF v_existing_profile.role = 'employer' THEN
        RAISE EXCEPTION 'Este correo ya está registrado como Comercio. Para registrarte como Postulante usá otro correo.';
      END IF;
    END IF;
  END IF;

  v_code := lpad((floor(random() * 900000) + 100000)::int::text, 6, '0');

  INSERT INTO public.email_otp_codes (email, code, requested_role)
  VALUES (v_clean_email, v_code, p_role);

  RETURN jsonb_build_object(
    'email', v_clean_email,
    'code', v_code,
    'existing_role', COALESCE(v_existing_profile.role::text, p_role::text)
  );
END;
$$;

-- 2. Ajustar verify_otp_code para devolver el rol exacto elegido y si ya completó el perfil
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
  v_clean_email text := lower(trim(p_email));
  v_clean_code text := trim(p_code);
  v_otp_row public.email_otp_codes%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_token text;
  v_effective_role public.user_role;
  v_has_profile boolean := false;
BEGIN
  SELECT * INTO v_otp_row
  FROM public.email_otp_codes
  WHERE lower(email) = v_clean_email
    AND code = v_clean_code
    AND used_at IS NULL
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El código ingresado es incorrecto o venció. Pedí uno nuevo.';
  END IF;

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
    -- Si es pabloesquilache@gmail.com, toma el rol según por dónde entró (candidate, employer o admin)
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

  INSERT INTO public.user_sessions (user_id)
  VALUES (v_profile.id)
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

-- 3. Obtener datos propios (incluyendo teléfono privado) para editar Mi Perfil / Mi Comercio
CREATE OR REPLACE FUNCTION public.get_my_candidate_data(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.profiles;
  v_pub public.candidate_profiles%ROWTYPE;
  v_priv public.candidate_private%ROWTYPE;
BEGIN
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_pub FROM public.candidate_profiles WHERE id = v_user.id;
  SELECT * INTO v_priv FROM public.candidate_private WHERE id = v_user.id;

  IF v_pub.id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'profile', row_to_json(v_pub),
    'private', row_to_json(v_priv)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_employer_data(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.profiles;
  v_pub public.employer_profiles%ROWTYPE;
  v_priv public.employer_private%ROWTYPE;
BEGIN
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_pub FROM public.employer_profiles WHERE id = v_user.id;
  SELECT * INTO v_priv FROM public.employer_private WHERE id = v_user.id;

  IF v_pub.id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'profile', row_to_json(v_pub),
    'private', row_to_json(v_priv)
  );
END;
$$;

-- 4. Funciones del Comercio sobre sus Búsquedas y Postulaciones recibidas
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
              cp.cv_path,
              cpriv.phone,
              cpriv.email
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
BEGIN
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Sesión inválida.';
  END IF;

  IF p_action = 'pause' THEN
    UPDATE public.job_posts
    SET status = 'paused', updated_at = now()
    WHERE id = p_job_id AND employer_id = v_user.id;
  ELSIF p_action = 'activate' THEN
    UPDATE public.job_posts
    SET status = 'active', updated_at = now()
    WHERE id = p_job_id AND employer_id = v_user.id;
  ELSIF p_action = 'delete' THEN
    UPDATE public.job_posts
    SET status = 'closed', deleted_at = now(), updated_at = now()
    WHERE id = p_job_id AND employer_id = v_user.id;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.employer_update_application_status(
  p_token text,
  p_application_id uuid,
  p_next_status public.application_status -- 'shortlisted' | 'rejected'
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
  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Sesión inválida.';
  END IF;

  UPDATE public.applications a
  SET status = p_next_status, updated_at = now()
  FROM public.job_posts jp
  WHERE a.id = p_application_id
    AND a.job_post_id = jp.id
    AND jp.employer_id = v_user.id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- 5. Funciones del Postulante sobre sus Postulaciones (ver y cancelar)
CREATE OR REPLACE FUNCTION public.candidate_get_my_applications(p_token text)
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
      a.id AS application_id,
      a.job_post_id,
      a.status,
      a.created_at,
      jp.title AS job_title,
      jp.industry,
      jp.locality,
      jp.district,
      ep.trade_name,
      ep.logo_url
    FROM public.applications a
    JOIN public.job_posts jp ON jp.id = a.job_post_id
    JOIN public.employer_profiles ep ON ep.id = jp.employer_id
    WHERE a.candidate_id = v_user.id
      AND a.status <> 'withdrawn'
    ORDER BY a.created_at DESC
  ) t;

  RETURN v_res;
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
BEGIN
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Sesión inválida.';
  END IF;

  DELETE FROM public.applications
  WHERE candidate_id = v_user.id
    AND job_post_id = p_job_post_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- 6. Eliminar Rubro desde /admin
CREATE OR REPLACE FUNCTION public.admin_delete_industry(
  p_token text,
  p_industry_id uuid
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

  DELETE FROM public.industries WHERE id = p_industry_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;
