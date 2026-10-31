-- ============================================================================
-- AGREGAR ESTADOS DE SEGUIMIENTO DE POSTULACIONES ('in_review', 'hired')
-- ============================================================================

ALTER TYPE public.application_status ADD VALUE IF NOT EXISTS 'in_review';
ALTER TYPE public.application_status ADD VALUE IF NOT EXISTS 'hired';
