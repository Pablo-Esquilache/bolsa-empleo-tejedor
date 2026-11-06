-- ============================================================================
-- RONDA FINAL DE PULIDO (20261102000002_final_polish.sql)
-- 1) Tope diario de 30 contactos nuevos en 24h en employer_request_contact + access_log
-- 5) Columnas explícitas en admin_get_full_dashboard (sin cp.*, ep.*, jp.* ni cp.cv_path)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Tope diario de contactos en el directorio y auditoría en access_log
-- ----------------------------------------------------------------------------
-- Asegurar índice único en contact_requests (employer_id, candidate_id) para ON CONFLICT
DELETE FROM public.contact_requests a
USING public.contact_requests b
WHERE a.id < b.id
  AND a.employer_id = b.employer_id
  AND a.candidate_id = b.candidate_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_requests_employer_candidate
  ON public.contact_requests (employer_id, candidate_id);

CREATE OR REPLACE FUNCTION public.employer_request_contact(
  p_token text,
  p_candidate_id uuid,
  p_message text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.profiles;
  v_emp public.employer_profiles%ROWTYPE;
  v_cand_priv public.candidate_private%ROWTYPE;
  v_recent_new_contacts integer;
  v_already_requested boolean;
  v_req_id uuid;
BEGIN
  v_user := public.get_session_profile(p_token);
  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Sesión inválida. Ingresá con tu cuenta de Comercio para contactar postulantes.';
  END IF;

  IF v_user.role <> 'employer' AND NOT public.is_app_admin(v_user) THEN
    RAISE EXCEPTION 'Solo los Comercios registrados pueden solicitar el contacto de un postulante.';
  END IF;

  SELECT * INTO v_emp FROM public.employer_profiles WHERE id = v_user.id;
  IF NOT FOUND AND NOT public.is_app_admin(v_user) THEN
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

  -- Tope de 30 contactos nuevos en 24 horas para comercios (el admin queda exceptuado).
  -- Re-contactar a un postulante ya contactado previamente (ON CONFLICT DO UPDATE) no suma al tope.
  IF NOT public.is_app_admin(v_user) THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.contact_requests
      WHERE employer_id = v_user.id
        AND candidate_id = p_candidate_id
    ) INTO v_already_requested;

    IF NOT v_already_requested THEN
      SELECT count(*)
      INTO v_recent_new_contacts
      FROM public.contact_requests
      WHERE employer_id = v_user.id
        AND created_at > (now() - interval '24 hours');

      IF v_recent_new_contacts >= 30 THEN
        RAISE EXCEPTION 'Alcanzaste el máximo de 30 contactos nuevos en 24 horas. Probá de nuevo más tarde.';
      END IF;
    END IF;
  END IF;

  IF v_emp.id IS NOT NULL THEN
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
  END IF;

  -- Registrar en access_log cada llamada exitosa (incluidas las repetidas)
  INSERT INTO public.access_log (actor_id, target_id, action)
  VALUES (v_user.id, p_candidate_id, 'request_contact');

  RETURN jsonb_build_object(
    'ok', true,
    'candidate_phone', v_cand_priv.phone,
    'employer_name', COALESCE(v_emp.trade_name, 'Administración')
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 5) Columnas explícitas en admin_get_full_dashboard (sin cp.*, ep.*, jp.* ni cp.cv_path)
-- ----------------------------------------------------------------------------
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

-- Proteger la cuenta de Administrador para que no pueda auto-pausarse ni auto-eliminarse por error
UPDATE public.profiles
SET status = 'active', deleted_at = NULL, updated_at = now()
WHERE lower(email) = public.get_admin_email();

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
  v_target_prof public.profiles%ROWTYPE;
BEGIN
  v_user := public.get_session_profile(p_token);
  IF NOT public.is_app_admin(v_user) THEN
    RAISE EXCEPTION 'Acceso exclusivo para el Administrador.';
  END IF;

  IF p_target_type NOT IN ('profile', 'job') OR p_action NOT IN ('pause', 'activate', 'delete') THEN
    RAISE EXCEPTION 'Parámetros de moderación inválidos.';
  END IF;

  IF p_target_type = 'profile' THEN
    SELECT * INTO v_target_prof FROM public.profiles WHERE id = p_target_id;
    IF p_action IN ('pause', 'delete') AND (
      p_target_id = v_user.id OR lower(COALESCE(v_target_prof.email, '')) = public.get_admin_email()
    ) THEN
      RAISE EXCEPTION 'No podés pausar ni eliminar tu propia cuenta de Administrador.';
    END IF;

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

  INSERT INTO public.access_log (actor_id, target_id, action)
  VALUES (v_user.id, p_target_id, 'moderate_' || p_target_type || '_' || p_action);

  RETURN jsonb_build_object('ok', true);
END;
$$;
