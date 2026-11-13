-- ============================================================================
-- AUDITORÍA FINAL: AJUSTES OBLIGATORIOS (20261112000003_audit_final_polish.sql)
--
-- 1. Elimina la sobrecarga antigua de purge_inactive_data() sin parámetros.
-- 2. Refina mask_contact_info para evitar falsos positivos con montos ($1.500.000)
--    y rangos de años (2015-2020), manteniendo enmascaramiento estricto de teléfonos.
-- 3. Máscara estricta en get_jobs_directory_data: los candidatos (logueados o anónimos)
--    SIEMPRE ven la descripción con contactos enmascarados para forzar la postulación web.
--    Solo el comercio autor del aviso o el admin ven el texto sin máscara.
-- 4. Borrado de IP en terms_acceptances al ejecutar delete_my_account y minimización
--    de datos en purge_inactive_data.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Eliminar la función antigua sin parámetros para evitar ambigüedades
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.purge_inactive_data();

-- ----------------------------------------------------------------------------
-- 2. Refinar mask_contact_info
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

  -- 1. Enmascarar correos electrónicos
  v_res := regexp_replace(
    v_res,
    '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}',
    '[contacto protegido]',
    'gi'
  );

  -- 2. Teléfonos precedidos por palabra clave de contacto (tel, cel, whatsapp, etc.)
  v_res := regexp_replace(
    v_res,
    '((tel|cel|wssp?|wh?ats?app?|wpp|contacto|llamar?|fono)[:\s-]*)(\+?54[\s-]*)?(9[\s-]*)?(\(?0?[1-9]\d{1,4}\)?[\s-]*)?(15[\s-]*)?[0-9\s-]{6,14}',
    '[contacto protegido]',
    'gi'
  );

  -- 3. Teléfonos con prefijo internacional +54
  v_res := regexp_replace(
    v_res,
    '\+54[\s-]*9?[\s-]*(\(?0?[1-9]\d{1,4}\)?[\s-]*)?(15[\s-]*)?[0-9\s-]{6,14}',
    '[contacto protegido]',
    'gi'
  );

  -- 4. Teléfonos con código de área + 15 (ej: 02364-15-456789 o 2364 15 456789)
  v_res := regexp_replace(
    v_res,
    '(\(?0?[1-9]\d{1,4}\)?[\s-]*)15[\s-]*[0-9\s-]{6,10}',
    '[contacto protegido]',
    'gi'
  );

  -- 5. Teléfonos con guión y número local de 5 a 8 dígitos (ej: 2364-333333 o 011-4455-6677)
  -- Se exige 5 a 8 dígitos en la segunda parte para no tocar años (ej: 2015-2020 solo tiene 4 dígitos)
  v_res := regexp_replace(
    v_res,
    '[0-9]{2,5}-[0-9]{5,8}',
    '[contacto protegido]',
    'gi'
  );

  -- 6. Teléfonos con bloques de dígitos separados por espacios (ej: 2364 12 34 56)
  v_res := regexp_replace(
    v_res,
    '0?[1-9]\d{1,4}[\s]+\d{2,4}[\s]+\d{2,4}([\s]+\d{2,4})*',
    '[contacto protegido]',
    'gi'
  );

  RETURN v_res;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Actualizar get_jobs_directory_data: candidatos y anónimos SIEMPRE enmascarados
-- ----------------------------------------------------------------------------
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
        -- Solo el comercio autor de la búsqueda o el Administrador ven la descripción completa.
        -- Los candidatos logueados y los visitantes anónimos SIEMPRE la ven con máscara para que
        -- la postulación ocurra exclusivamente dentro de la web.
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
-- 4. Actualizar delete_my_account: borrar client_ip de terms_acceptances
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

  -- Eliminar rastros de email en tablas auxiliares
  DELETE FROM public.email_otp_codes WHERE lower(email) = lower(trim(v_user.email));
  DELETE FROM public.notification_outbox WHERE lower(recipient_email) = lower(trim(v_user.email));
  DELETE FROM public.user_sessions WHERE user_id = v_user.id;

  -- Anonimizar la constancia legal de términos eliminando de inmediato la dirección IP
  UPDATE public.terms_acceptances
  SET client_ip = NULL
  WHERE user_id = v_user.id;

  -- Registro anónimo estadístico de baja
  INSERT INTO public.access_log (actor_id, target_id, action)
  VALUES (NULL, NULL, 'account_self_deleted');

  -- Borrar perfil base (ON DELETE CASCADE borra perfil candidato/comercio, CVs, búsquedas, etc.)
  DELETE FROM public.profiles WHERE id = v_user.id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. Actualizar purge_inactive_data: minimizar IP y limpiar aceptaciones viejas
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
  v_deleted_acceptances integer := 0;
  v_inactive_emails text[];
BEGIN
  -- Identificar emails de cuentas no-admin sin actividad en los últimos 12 meses
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

  -- Borrar perfiles inactivos de más de 12 meses
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

  -- Borrar avisos vencidos o dados de baja hace más de 90 días
  WITH del_jobs AS (
    DELETE FROM public.job_posts
    WHERE expires_at < (now() - interval '90 days')
       OR (deleted_at IS NOT NULL AND deleted_at < (now() - interval '90 days'))
    RETURNING id
  )
  SELECT count(*) INTO v_deleted_jobs FROM del_jobs;

  -- Borrar OTPs antiguos o de emails purgados
  WITH del_otps AS (
    DELETE FROM public.email_otp_codes
    WHERE created_at < (now() - interval '7 days')
       OR (v_inactive_emails IS NOT NULL AND lower(trim(email)) = ANY(v_inactive_emails))
    RETURNING id
  )
  SELECT count(*) INTO v_deleted_otps FROM del_otps;

  -- Borrar sesiones expiradas
  WITH del_sessions AS (
    DELETE FROM public.user_sessions
    WHERE expires_at <= now()
    RETURNING token
  )
  SELECT count(*) INTO v_deleted_sessions FROM del_sessions;

  -- Borrar registros de auditoría de más de 12 meses
  WITH del_logs AS (
    DELETE FROM public.access_log
    WHERE created_at < (now() - interval '12 months')
    RETURNING id
  )
  SELECT count(*) INTO v_deleted_logs FROM del_logs;

  -- Borrar denuncias cerradas de más de 12 meses
  WITH del_reports AS (
    DELETE FROM public.reports
    WHERE status IN ('resolved', 'dismissed')
      AND created_at < (now() - interval '12 months')
    RETURNING id
  )
  SELECT count(*) INTO v_deleted_reports FROM del_reports;

  -- Borrar notificaciones de más de 90 días
  WITH del_outbox AS (
    DELETE FROM public.notification_outbox
    WHERE created_at < (now() - interval '90 days')
       OR (v_inactive_emails IS NOT NULL AND lower(trim(recipient_email)) = ANY(v_inactive_emails))
    RETURNING id
  )
  SELECT count(*) INTO v_deleted_outbox FROM del_outbox;

  -- Minimización de datos: borrar direcciones IP de constancias de más de 90 días
  UPDATE public.terms_acceptances
  SET client_ip = NULL
  WHERE client_ip IS NOT NULL
    AND accepted_at < (now() - interval '90 days');

  -- Purgar constancias de cuentas eliminadas hace más de 24 meses
  WITH del_acc AS (
    DELETE FROM public.terms_acceptances
    WHERE user_id IS NULL
      AND accepted_at < (now() - interval '24 months')
    RETURNING id
  )
  SELECT count(*) INTO v_deleted_acceptances FROM del_acc;

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
    'deleted_acceptances', v_deleted_acceptances,
    'executed_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_inactive_data(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_inactive_data(integer) TO service_role;
