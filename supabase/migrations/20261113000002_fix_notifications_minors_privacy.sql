-- ============================================================================
-- CORRECCIONES DE AUDITORÍA FINAL (20261113000002_fix_notifications_minors_privacy.sql)
--
-- 1. Repara server_prepare_notification_email: elimina el INSERT roto en
--    notification_outbox (que violaba html_body NOT NULL) y restaura el evento
--    admin_ticket_replied junto con el nuevo minor_guardian_notice.
-- 2. Agrega tope antispam al aviso al tutor (guardian_notice_count): máximo 1
--    aviso cada 30 días y máximo 3 en total por cuenta, sin resetear al cambiar mail.
-- 3. Oculta completamente a los menores de 18 del directorio público anónimo
--    (ni age ni is_minor ni el perfil aparecen a visitantes sin sesión de comercio)
--    y oculta su foto también en employer_get_my_jobs_with_applicants.
-- 4. Cierra dos huecos de mask_contact_info ($2364456789 y 236.445.678).
-- 5. Recalcula email_hash de términos existentes con HMAC-SHA256 y quita clave fallback.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. HMAC sin clave hardcoded de respaldo + actualizar constancias existentes
-- ----------------------------------------------------------------------------
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
    RAISE EXCEPTION 'Falta configurar terms_hmac_key en app_settings.';
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

UPDATE public.terms_acceptances ta
SET email_hash = public.compute_terms_email_hash(p.email)
FROM public.profiles p
WHERE ta.user_id = p.id
  AND ta.email_hash <> public.compute_terms_email_hash(p.email);

-- ----------------------------------------------------------------------------
-- 2. Tope antispam en candidate_private + actualización de save_candidate_profile
-- ----------------------------------------------------------------------------
ALTER TABLE public.candidate_private
  ADD COLUMN IF NOT EXISTS guardian_notice_count integer NOT NULL DEFAULT 0;

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
  v_existing_notified_at timestamptz;
  v_existing_notice_count integer := 0;
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

  SELECT guardian_email, guardian_notified_at, COALESCE(guardian_notice_count, 0)
  INTO v_existing_g_email, v_existing_notified_at, v_existing_notice_count
  FROM public.candidate_private
  WHERE id = v_user.id;

  -- Tope antispam: solo autorizar envío si tiene email, no superó 3 envíos totales
  -- y pasaron al menos 30 días desde el último envío (o nunca fue notificado)
  IF v_age < 18
     AND v_clean_g_email IS NOT NULL
     AND COALESCE(v_existing_notice_count, 0) < 3
     AND (v_existing_notified_at IS NULL OR v_existing_notified_at < (now() - interval '30 days'))
     AND (v_existing_notified_at IS NULL OR v_clean_g_email IS DISTINCT FROM v_existing_g_email)
  THEN
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
    guardian_name, guardian_phone, guardian_email, guardian_notified_at, guardian_notice_count,
    updated_at
  )
  VALUES (
    v_user.id, p_birth_date, v_clean_phone, v_user.email,
    v_clean_g_name, NULLIF(v_clean_g_phone, ''), v_clean_g_email, NULL, 0,
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    birth_date = EXCLUDED.birth_date,
    phone = EXCLUDED.phone,
    guardian_name = EXCLUDED.guardian_name,
    guardian_phone = EXCLUDED.guardian_phone,
    guardian_email = EXCLUDED.guardian_email,
    -- NUNCA resetear guardian_notified_at ni guardian_notice_count al editar mail
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

-- ----------------------------------------------------------------------------
-- 3. Reparar server_prepare_notification_email (sin INSERT roto en notification_outbox,
--    restaurando admin_ticket_replied y aplicando tope de 30d / máx 3 al tutor)
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

  ELSIF p_event_type = 'admin_ticket_replied' THEN
    IF NOT public.is_app_admin(v_user) THEN
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

    IF COALESCE(v_cpriv.guardian_notice_count, 0) >= 3 THEN
      RAISE EXCEPTION 'Se alcanzó el límite máximo de avisos al adulto responsable para esta cuenta.';
    END IF;

    IF v_cpriv.guardian_notified_at IS NOT NULL AND v_cpriv.guardian_notified_at > (now() - interval '30 days') THEN
      RAISE EXCEPTION 'Ya se envió un aviso reciente al adulto responsable. Esperá 30 días para enviar otro.';
    END IF;

    UPDATE public.candidate_private
    SET guardian_notified_at = now(),
        guardian_notice_count = COALESCE(guardian_notice_count, 0) + 1
    WHERE id = v_user.id;

    SELECT * INTO v_cand FROM public.candidate_profiles WHERE id = v_user.id;

    v_to_email := v_cpriv.guardian_email;
    v_subject := 'Aviso de registro de menor (16-17 años) - Bolsa de Empleo Tejedor';
    v_html := '<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #e2e8f0;border-radius:16px;">'
      || '<h2 style="color:#0f172a;margin-top:0;">Aviso de Registro en Bolsa de Empleo Tejedor</h2>'
      || '<p style="color:#334155;">Hola <strong>' || public.escape_html(COALESCE(v_cpriv.guardian_name, 'Madre / Padre / Tutor')) || '</strong>,</p>'
      || '<p style="color:#334155;">Te informamos que <strong>' || public.escape_html(COALESCE(v_cand.first_name || ' ' || v_cand.last_name, 'un menor a tu cargo')) || '</strong> registró un perfil laboral como postulante (16-17 años, conforme a la Ley 26.390 de Trabajo Adolescente) indicándote como adulto responsable.</p>'
      || '<p style="color:#475569;font-size:14px;">Por resguardo de privacidad, su perfil no aparece en búsquedas públicas anónimas, su foto de perfil se mantiene oculta y sus datos solo están disponibles para comercios locales registrados cuando busca empleo.</p>'
      || '<p style="color:#475569;font-size:13px;">Si no autorizás este registro o querés darlo de baja, respondé este correo o escribinos a <strong>' || public.escape_html(public.get_admin_email()) || '</strong>.</p>'
      || '</div>';

  ELSE
    RAISE EXCEPTION 'Tipo de notificación desconocido.';
  END IF;

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

-- ----------------------------------------------------------------------------
-- 4. Ocultar menores de 18 del directorio público anónimo y proteger su edad/foto
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
      -- Los menores de 18 años NO aparecen en la vista pública anónima; solo visibles para comercios/admin
      AND (
        v_is_authorized_employer
        OR cpriv.birth_date IS NULL
        OR date_part('year', age(current_date, cpriv.birth_date))::integer >= 18
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

-- Ocultar foto del menor también en employer_get_my_jobs_with_applicants
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
              CASE
                WHEN cpriv.birth_date IS NOT NULL AND date_part('year', age(current_date, cpriv.birth_date))::integer < 18
                THEN NULL
                ELSE cp.avatar_url
              END AS avatar_url,
              CASE
                WHEN cpriv.birth_date IS NOT NULL
                THEN date_part('year', age(current_date, cpriv.birth_date))::integer
                ELSE NULL
              END AS age,
              (cpriv.birth_date IS NOT NULL AND date_part('year', age(current_date, cpriv.birth_date))::integer < 18) AS is_minor,
              cp.locality,
              cp.district,
              cp.province,
              cp.work_situation,
              cp.education_level,
              cp.availability,
              cp.industries,
              cp.positions,
              cp.bio_short,
              CASE
                WHEN cp.cv_path IS NOT NULL OR EXISTS (SELECT 1 FROM public.private_cv_files cv WHERE cv.candidate_id = cp.id)
                THEN '/ver-cv/' || cp.id::text
                ELSE NULL
              END AS cv_path,
              cpriv.phone
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

-- ----------------------------------------------------------------------------
-- 5. Cerrar los dos huecos de mask_contact_info ($2364456789 y 236.445.678)
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

  -- 2. Enmascarar enlaces directos de WhatsApp
  v_res := regexp_replace(
    v_res,
    '(https?://)?(wa\.me|api\.whatsapp\.com|whatsapp\.com)/[a-zA-Z0-9?&=._-]+',
    '[contacto protegido]',
    'gi'
  );

  -- 3. Enmascarar palabras clave de contacto seguidas de números cortos o largos
  v_res := regexp_replace(
    v_res,
    '(tel|cel|wssp?|wh?ats?app?|wpp|contacto|llamar?|fono)[:\s-]*(\+?54[\s.-]*)?(\(?\d[\d\s.()-]{4,18}\d)',
    '[contacto protegido]',
    'gi'
  );

  -- 4. Analizar corridas numéricas con posibles separadores
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

    -- Regla de montos con $: solo conservar si tiene formato de miles con puntos ($1.500.000) o <= 7 dígitos ($500000)
    IF v_token LIKE '$%' AND (v_token ~ '^\$\s?\d{1,3}(\.\d{3})+$' OR length(v_digits) <= 7) THEN
      v_out := v_out || v_token;
    -- Montos sin $ (ej: 12.500.000 o 1.500.000): exigir que termine en .000 para no dejar pasar 236.445.678
    ELSIF v_token ~ '^\d{1,3}(\.\d{3})*\.000$' THEN
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
