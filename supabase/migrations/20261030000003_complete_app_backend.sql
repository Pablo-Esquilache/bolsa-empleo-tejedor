-- ============================================================================
-- FASE 3 A 6: FLUJO COMPLETO DE OTP CON BREVO, PERFILES, BÚSQUEDAS Y ADMIN
-- ============================================================================

-- 1. Permitir que public.profiles funcione directo con nuestro sistema OTP de Brevo
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;
ALTER TABLE public.profiles ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- 2. Tabla de códigos OTP de 6 dígitos
CREATE TABLE IF NOT EXISTS public.email_otp_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  code text NOT NULL,
  requested_role public.user_role NOT NULL DEFAULT 'candidate',
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Tabla de sesiones persistentes (dura meses en el celular/navegador)
CREATE TABLE IF NOT EXISTS public.user_sessions (
  token text PRIMARY KEY DEFAULT encode(gen_random_bytes(32), 'hex'),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '180 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_otp_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

-- 4. Función RPC: Generar código de 6 dígitos para ingresar o registrarse
-- Regla: 1 email = 1 rol (salvo el administrador que puede entrar a /admin)
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

  SELECT * INTO v_existing_profile
  FROM public.profiles
  WHERE lower(email) = v_clean_email;

  IF FOUND THEN
    IF v_existing_profile.status = 'deleted' THEN
      RAISE EXCEPTION 'Esta cuenta fue dada de baja.';
    END IF;
    -- Si no es admin y quiere entrar con un rol distinto al que registró ese email, avisar:
    IF v_existing_profile.role <> 'admin' AND p_role <> 'admin' AND v_existing_profile.role <> p_role THEN
      IF v_existing_profile.role = 'candidate' THEN
        RAISE EXCEPTION 'Este correo ya está registrado como Postulante. Para registrar un Comercio usá otro correo o elegí "Soy Postulante".';
      ELSE
        RAISE EXCEPTION 'Este correo ya está registrado como Comercio. Para registrarte como Postulante usá otro correo o elegí "Soy Comercio".';
      END IF;
    END IF;
  END IF;

  -- Generar código numérico de 6 dígitos
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

-- 5. Función RPC: Verificar código de 6 dígitos y abrir sesión persistente
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
  v_final_role public.user_role;
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
    IF v_clean_email = 'pabloesquilache@gmail.com' THEN
      v_final_role := 'admin';
    ELSE
      v_final_role := v_otp_row.requested_role;
    END IF;

    INSERT INTO public.profiles (email, role, status)
    VALUES (v_clean_email, v_final_role, 'active')
    RETURNING * INTO v_profile;
  ELSE
    -- Si es el correo del administrador principal, asegurar rol admin si entra a admin
    IF v_clean_email = 'pabloesquilache@gmail.com' AND p_role = 'admin' THEN
      UPDATE public.profiles SET role = 'admin' WHERE id = v_profile.id RETURNING * INTO v_profile;
    END IF;
  END IF;

  INSERT INTO public.user_sessions (user_id)
  VALUES (v_profile.id)
  RETURNING token INTO v_token;

  RETURN jsonb_build_object(
    'token', v_token,
    'user', jsonb_build_object(
      'id', v_profile.id,
      'email', v_profile.email,
      'role', v_profile.role,
      'status', v_profile.status
    )
  );
END;
$$;

-- 6. Función auxiliar para validar token de sesión en funciones RPC
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
  SELECT p.* INTO v_profile
  FROM public.user_sessions s
  JOIN public.profiles p ON p.id = s.user_id
  WHERE s.token = p_token
    AND s.expires_at > now()
    AND p.status <> 'deleted';

  RETURN v_profile;
END;
$$;

-- 7. Guardar Perfil Completo del Postulante (Datos públicos + privados)
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
  v_clean_phone text := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
BEGIN
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Sesión inválida. Volvé a ingresar.';
  END IF;

  INSERT INTO public.candidate_profiles (
    id, first_name, last_name, avatar_url, province, district, locality,
    work_situation, availability, education_level, industries, positions,
    custom_other_text, bio_short, cv_path, is_searching, updated_at
  ) VALUES (
    v_user.id, trim(p_first_name), trim(p_last_name), p_avatar_url,
    COALESCE(NULLIF(trim(p_province), ''), 'Buenos Aires'),
    COALESCE(NULLIF(trim(p_district), ''), 'Carlos Tejedor'),
    trim(p_locality),
    p_work_situation, COALESCE(p_availability, '{}'), p_education_level,
    COALESCE(p_industries, '{}'), COALESCE(p_positions, '{}'),
    NULLIF(trim(COALESCE(p_custom_other_text, '')), ''),
    COALESCE(trim(p_bio_short), ''), p_cv_path, COALESCE(p_is_searching, true), now()
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

-- 8. Guardar Perfil Completo del Comercio / Empleador
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
  v_clean_phone text := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
BEGIN
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Sesión inválida. Volvé a ingresar.';
  END IF;

  INSERT INTO public.employer_profiles (
    id, trade_name, legal_name, cuit, logo_url, industry,
    province, district, locality, description, updated_at
  ) VALUES (
    v_user.id, trim(p_trade_name), NULLIF(trim(COALESCE(p_legal_name, '')), ''),
    NULLIF(trim(COALESCE(p_cuit, '')), ''), p_logo_url, trim(p_industry),
    COALESCE(NULLIF(trim(p_province), ''), 'Buenos Aires'),
    COALESCE(NULLIF(trim(p_district), ''), 'Carlos Tejedor'),
    trim(p_locality), COALESCE(trim(p_description), ''), now()
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
  VALUES (v_user.id, trim(p_contact_person_name), v_clean_phone, v_user.email, now())
  ON CONFLICT (id) DO UPDATE SET
    contact_person_name = EXCLUDED.contact_person_name,
    phone = EXCLUDED.phone,
    updated_at = now();

  RETURN jsonb_build_object('ok', true, 'id', v_user.id);
END;
$$;

-- 9. Publicar Búsqueda Laboral (Activa inmediatamente sin aprobación previa)
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
SET search_path = public
AS $$
DECLARE
  v_user public.profiles;
  v_job_id uuid;
BEGIN
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Debés iniciar sesión con tu cuenta de Comercio.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.employer_profiles WHERE id = v_user.id) THEN
    RAISE EXCEPTION 'Primero completá los datos básicos de tu Comercio.';
  END IF;

  INSERT INTO public.job_posts (
    employer_id, title, industry, position_tag, custom_other_text,
    province, district, locality, availability, required_education, description, status
  ) VALUES (
    v_user.id, trim(p_title), trim(p_industry), trim(p_position_tag),
    NULLIF(trim(COALESCE(p_custom_other_text, '')), ''),
    COALESCE(NULLIF(trim(p_province), ''), 'Buenos Aires'),
    COALESCE(NULLIF(trim(p_district), ''), 'Carlos Tejedor'),
    trim(p_locality), COALESCE(p_availability, '{}'),
    COALESCE(p_required_education, 'Sin requisito excluyente'),
    trim(p_description), 'active'
  ) RETURNING id INTO v_job_id;

  RETURN jsonb_build_object('ok', true, 'job_id', v_job_id);
END;
$$;

-- 10. Postularse a una Búsqueda (Crea postulación + habilita contacto/CV al comercio)
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
  v_employer_priv public.employer_private%ROWTYPE;
  v_candidate public.candidate_profiles%ROWTYPE;
  v_app_id uuid;
BEGIN
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Ingresá con tu cuenta de Postulante para postularte.';
  END IF;

  SELECT * INTO v_candidate FROM public.candidate_profiles WHERE id = v_user.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Primero completá tu perfil de Postulante para poder postularte.';
  END IF;

  SELECT * INTO v_job FROM public.job_posts WHERE id = p_job_post_id AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esta búsqueda laboral ya no está activa.';
  END IF;

  INSERT INTO public.applications (job_post_id, candidate_id, message, status)
  VALUES (p_job_post_id, v_user.id, p_message, 'received')
  ON CONFLICT (job_post_id, candidate_id) DO UPDATE SET
    message = EXCLUDED.message,
    updated_at = now()
  RETURNING id INTO v_app_id;

  -- Al postularse, habilita permiso de contacto y visualización de CV para ese comercio
  INSERT INTO public.contact_grants (employer_id, candidate_id, source_type, source_id)
  VALUES (v_job.employer_id, v_user.id, 'application', v_app_id);

  SELECT * INTO v_employer_priv FROM public.employer_private WHERE id = v_job.employer_id;

  RETURN jsonb_build_object(
    'ok', true,
    'application_id', v_app_id,
    'employer_email', v_employer_priv.email,
    'candidate_name', v_candidate.first_name || ' ' || v_candidate.last_name,
    'job_title', v_job.title
  );
END;
$$;

-- 11. Solicitar / Habilitar contacto desde Comercio hacia Postulante
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
  v_emp_priv public.employer_private%ROWTYPE;
  v_cand_priv public.candidate_private%ROWTYPE;
  v_req_id uuid;
BEGIN
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Ingresá con tu cuenta de Comercio para contactar postulantes.';
  END IF;

  SELECT * INTO v_emp FROM public.employer_profiles WHERE id = v_user.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Completá primero la ficha de tu Comercio para contactar postulantes.';
  END IF;

  SELECT * INTO v_emp_priv FROM public.employer_private WHERE id = v_user.id;
  SELECT * INTO v_cand_priv FROM public.candidate_private WHERE id = p_candidate_id;

  INSERT INTO public.contact_requests (employer_id, candidate_id, message, status, responded_at)
  VALUES (v_user.id, p_candidate_id, p_message, 'accepted', now())
  RETURNING id INTO v_req_id;

  INSERT INTO public.contact_grants (employer_id, candidate_id, source_type, source_id)
  VALUES (v_user.id, p_candidate_id, 'request', v_req_id);

  RETURN jsonb_build_object(
    'ok', true,
    'candidate_phone', v_cand_priv.phone,
    'candidate_email', v_cand_priv.email,
    'employer_name', v_emp.trade_name,
    'employer_phone', v_emp_priv.phone
  );
END;
$$;

-- 12. Funciones del Panel /admin: Obtener todos los datos completos + Moderación + Rubros
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
BEGIN
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL OR (v_user.role <> 'admin' AND lower(v_user.email) <> 'pabloesquilache@gmail.com') THEN
    RAISE EXCEPTION 'Acceso exclusivo para el Administrador.';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_candidates
  FROM (
    SELECT
      cp.*,
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
      (SELECT count(*) FROM public.applications a WHERE a.job_post_id = jp.id) AS applications_count
    FROM public.job_posts jp
    JOIN public.employer_profiles ep ON ep.id = jp.employer_id
    LEFT JOIN public.employer_private epriv ON epriv.id = ep.id
    WHERE jp.deleted_at IS NULL
    ORDER BY jp.created_at DESC
  ) t;

  RETURN jsonb_build_object(
    'candidates', v_candidates,
    'employers', v_employers,
    'jobs', v_jobs
  );
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
    END IF;
  ELSIF p_target_type = 'job' THEN
    IF p_action = 'pause' THEN
      UPDATE public.job_posts SET status = 'paused', updated_at = now() WHERE id = p_target_id;
    ELSIF p_action = 'activate' THEN
      UPDATE public.job_posts SET status = 'active', updated_at = now() WHERE id = p_target_id;
    ELSIF p_action = 'delete' THEN
      UPDATE public.job_posts SET status = 'closed', deleted_at = now(), updated_at = now() WHERE id = p_target_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_industry(
  p_token text,
  p_name text,
  p_positions text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  VALUES (v_slug, trim(p_name), COALESCE(p_positions, '{}'), true)
  ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    suggested_positions = EXCLUDED.suggested_positions,
    is_active = true;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- 13. Permitir subida y lectura en Storage buckets para nuestra app
DROP POLICY IF EXISTS "avatars_app_insert" ON storage.objects;
CREATE POLICY "avatars_app_insert" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'avatars_and_logos');

DROP POLICY IF EXISTS "avatars_app_update" ON storage.objects;
CREATE POLICY "avatars_app_update" ON storage.objects
  FOR UPDATE USING (bucket_id = 'avatars_and_logos');

DROP POLICY IF EXISTS "cvs_app_insert" ON storage.objects;
CREATE POLICY "cvs_app_insert" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'cvs');

DROP POLICY IF EXISTS "cvs_app_select" ON storage.objects;
CREATE POLICY "cvs_app_select" ON storage.objects
  FOR SELECT USING (bucket_id = 'cvs');

UPDATE storage.buckets SET public = true WHERE id = 'cvs';
