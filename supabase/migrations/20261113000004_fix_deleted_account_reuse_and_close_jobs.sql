-- ============================================================================
-- Migración: Liberar email al eliminar cuenta e inhabilitar búsquedas del comercio
-- 1. En admin_moderate_item:
--    - Al pausar un perfil ('pause'), pausa también sus avisos activos y su búsqueda laboral.
--    - Al eliminar un perfil ('delete'), cierra/inhabilita todos sus avisos (status = 'closed')
--      sin borrarlos (conservando el historial de postulaciones pero impidiendo nuevas),
--      limpia sus datos privados y sesiones, y libera el correo en profiles para que pueda
--      volver a registrarse de cero como comercio o postulante.
-- 2. En delete_my_account:
--    - Si es un comercio con avisos publicados, inhabilita los avisos (status = 'closed'),
--      limpia los datos privados del comercio y libera su email en profiles sin borrar las
--      postulaciones históricas; en caso contrario elimina el perfil en cascada.
-- ============================================================================

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
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El perfil indicado no existe.';
    END IF;

    IF p_action IN ('pause', 'delete') AND (
      p_target_id = v_user.id OR lower(COALESCE(v_target_prof.email, '')) = public.get_admin_email()
    ) THEN
      RAISE EXCEPTION 'No podés pausar ni eliminar tu propia cuenta de Administrador.';
    END IF;

    IF p_action = 'pause' THEN
      UPDATE public.profiles SET status = 'paused', updated_at = now() WHERE id = p_target_id;
      UPDATE public.candidate_profiles SET is_searching = false, updated_at = now() WHERE id = p_target_id;
      UPDATE public.job_posts
      SET status = 'paused', paused_by_admin = true, updated_at = now()
      WHERE employer_id = p_target_id AND status = 'active';
      DELETE FROM public.user_sessions WHERE user_id = p_target_id;

    ELSIF p_action = 'activate' THEN
      UPDATE public.profiles SET status = 'active', updated_at = now() WHERE id = p_target_id;

    ELSIF p_action = 'delete' THEN
      -- Cerrar/inhabilitar todas las búsquedas del comercio sin borrarlas para conservar postulaciones
      UPDATE public.job_posts
      SET status = 'closed', paused_by_admin = true, updated_at = now()
      WHERE employer_id = p_target_id AND status <> 'closed';

      -- Desactivar visibilidad si era postulante y limpiar datos privados/sesiones
      UPDATE public.candidate_profiles
      SET is_searching = false, avatar_url = NULL, cv_path = NULL, updated_at = now()
      WHERE id = p_target_id;

      DELETE FROM public.private_cv_files WHERE candidate_id = p_target_id;
      DELETE FROM public.candidate_private WHERE id = p_target_id;
      DELETE FROM public.employer_private WHERE id = p_target_id;
      DELETE FROM public.user_sessions WHERE user_id = p_target_id;
      DELETE FROM public.email_otp_codes WHERE lower(email) = lower(trim(v_target_prof.email));
      UPDATE public.terms_acceptances SET client_ip = NULL WHERE user_id = p_target_id;

      -- Liberar el email para que pueda volver a registrarse de cero en cualquier rol
      UPDATE public.profiles
      SET status = 'deleted',
          email = 'deleted+' || replace(p_target_id::text, '-', '') || '@baja.local',
          deleted_at = now(),
          updated_at = now()
      WHERE id = p_target_id;
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

GRANT EXECUTE ON FUNCTION public.admin_moderate_item(text, text, uuid, text) TO anon, authenticated, service_role;

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

  -- Si el usuario tenía búsquedas laborales publicadas, las cerramos/inhabilitamos y
  -- anonimizamos el comercio liberando su email para no romper el historial de postulaciones
  IF EXISTS (SELECT 1 FROM public.job_posts WHERE employer_id = v_user.id) THEN
    UPDATE public.job_posts
    SET status = 'closed',
        paused_by_admin = true,
        updated_at = now()
    WHERE employer_id = v_user.id AND status <> 'closed';

    DELETE FROM public.employer_private WHERE id = v_user.id;
    DELETE FROM public.candidate_private WHERE id = v_user.id;
    DELETE FROM public.private_cv_files WHERE candidate_id = v_user.id;

    UPDATE public.employer_profiles
    SET legal_name = NULL,
        cuit = NULL,
        logo_url = NULL,
        description = 'Comercio dado de baja.',
        updated_at = now()
    WHERE id = v_user.id;

    UPDATE public.profiles
    SET status = 'deleted',
        email = 'deleted+' || replace(v_user.id::text, '-', '') || '@baja.local',
        deleted_at = now(),
        updated_at = now()
    WHERE id = v_user.id;
  ELSE
    DELETE FROM public.profiles WHERE id = v_user.id;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_my_account(text, text) TO anon, authenticated, service_role;
