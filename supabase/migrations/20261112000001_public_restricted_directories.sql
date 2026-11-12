-- ============================================================================
-- VISTA PÚBLICA RESTRINGIDA DE DIRECTORIOS (20261112000001_public_restricted_directories.sql)
-- Permite que visitantes sin sesión activa recorran las búsquedas laborales (/vacantes)
-- y el directorio de oficios/postulantes (/postulantes) con datos de contacto protegidos.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_jobs_directory_data(p_token text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.profiles;
  v_jobs jsonb;
  v_employers jsonb;
  v_industries jsonb;
BEGIN
  IF p_token IS NOT NULL AND trim(p_token) <> '' THEN
    v_user := public.get_session_profile(p_token);
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

GRANT EXECUTE ON FUNCTION public.get_jobs_directory_data(text) TO anon, authenticated, service_role;

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
    'industries', v_industries,
    'is_restricted_view', NOT v_is_authorized_employer
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_candidates_directory_data(text) TO anon, authenticated, service_role;
