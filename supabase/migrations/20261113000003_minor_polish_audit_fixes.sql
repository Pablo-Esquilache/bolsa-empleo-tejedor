-- ============================================================================
-- Ajustes finales post-auditoría (puntos 1 y 4):
-- 1. En get_candidates_directory_data, tratar birth_date IS NULL como oculto
--    para visitantes anónimos (solo comercios/admin ven perfiles sin fecha).
-- 2. En server_unmark_notification, descontar guardian_notice_count cuando
--    falla el envío al tutor (y conservar todas las ramas de notificación).
-- ============================================================================

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
      -- Solo comercios autorizados ven la edad calculada y el indicador de menor; anónimos reciben NULL / false
      CASE
        WHEN v_is_authorized_employer AND cpriv.birth_date IS NOT NULL
        THEN date_part('year', age(current_date, cpriv.birth_date))::integer
        ELSE NULL
      END AS age,
      CASE
        WHEN v_is_authorized_employer AND cpriv.birth_date IS NOT NULL
        THEN (date_part('year', age(current_date, cpriv.birth_date))::integer < 18)
        ELSE false
      END AS is_minor,
      -- Foto oculta para anónimos y también oculta si el postulante es menor de 18
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
      -- Solo comercios/admin ven perfiles sin fecha de nacimiento o menores de 18;
      -- visitantes anónimos solo ven mayores de 18 con fecha de nacimiento confirmada
      AND (
        v_is_authorized_employer
        OR (
          cpriv.birth_date IS NOT NULL
          AND date_part('year', age(current_date, cpriv.birth_date))::integer >= 18
        )
      )
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
  ELSIF p_event_type = 'application_status_changed' THEN
    UPDATE public.applications
    SET last_notified_status = NULL,
        status_notified_at = NULL
    WHERE id = p_target_id;
  ELSIF p_event_type = 'admin_ticket_created' THEN
    UPDATE public.admin_tickets SET notified_at = NULL WHERE id = p_target_id;
  ELSIF p_event_type = 'admin_ticket_replied' THEN
    UPDATE public.admin_tickets SET reply_notified_at = NULL WHERE id = p_target_id;
  ELSIF p_event_type = 'minor_guardian_notice' THEN
    UPDATE public.candidate_private
    SET guardian_notified_at = NULL,
        guardian_notice_count = GREATEST(guardian_notice_count - 1, 0)
    WHERE id = p_target_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.server_unmark_notification(text, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.server_unmark_notification(text, uuid) TO service_role;
