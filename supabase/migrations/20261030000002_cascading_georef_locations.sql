-- ============================================================================
-- UBICACIÓN GEOGRÁFICA ENCADENADA (Provincia -> Partido -> Localidad / Ciudad)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.provinces (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.districts (
  id text PRIMARY KEY,
  province_id text NOT NULL REFERENCES public.provinces(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (province_id, name)
);

ALTER TABLE public.localities
  ADD COLUMN IF NOT EXISTS province_name text NOT NULL DEFAULT 'Buenos Aires',
  ADD COLUMN IF NOT EXISTS province_id text DEFAULT '06',
  ADD COLUMN IF NOT EXISTS district_id text;

ALTER TABLE public.candidate_profiles
  ADD COLUMN IF NOT EXISTS province text NOT NULL DEFAULT 'Buenos Aires',
  ADD COLUMN IF NOT EXISTS district text NOT NULL DEFAULT 'Carlos Tejedor';

ALTER TABLE public.employer_profiles
  ADD COLUMN IF NOT EXISTS province text NOT NULL DEFAULT 'Buenos Aires',
  ADD COLUMN IF NOT EXISTS district text NOT NULL DEFAULT 'Carlos Tejedor';

ALTER TABLE public.job_posts
  ADD COLUMN IF NOT EXISTS province text NOT NULL DEFAULT 'Buenos Aires',
  ADD COLUMN IF NOT EXISTS district text NOT NULL DEFAULT 'Carlos Tejedor';

ALTER TABLE public.provinces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.districts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "provinces_read_all" ON public.provinces;
CREATE POLICY "provinces_read_all" ON public.provinces FOR SELECT USING (true);

DROP POLICY IF EXISTS "districts_read_all" ON public.districts;
CREATE POLICY "districts_read_all" ON public.districts FOR SELECT USING (true);

INSERT INTO public.provinces (id, name) VALUES
  ('06', 'Buenos Aires'),
  ('14', 'Córdoba'),
  ('42', 'La Pampa'),
  ('82', 'Santa Fe'),
  ('02', 'Ciudad Autónoma de Buenos Aires'),
  ('30', 'Entre Ríos'),
  ('50', 'Mendoza'),
  ('58', 'Neuquén'),
  ('62', 'Río Negro'),
  ('74', 'San Luis')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.districts (id, province_id, name) VALUES
  ('06147', '06', 'Carlos Tejedor'),
  ('06679', '06', 'Rivadavia'),
  ('06357', '06', 'General Villegas'),
  ('06609', '06', 'Pehuajó'),
  ('06469', '06', 'Lincoln'),
  ('06826', '06', 'Trenque Lauquen'),
  ('06329', '06', 'General Pinto'),
  ('06126', '06', 'Carlos Casares'),
  ('06588', '06', 'Nueve de Julio'),
  ('06413', '06', 'Junín')
ON CONFLICT (id) DO NOTHING;
