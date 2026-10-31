import React, { useEffect, useState } from 'react';

export interface LocationValue {
  province: string;
  district: string;
  locality: string;
}

interface LocationSelectorProps {
  value: LocationValue;
  onChange: (next: LocationValue) => void;
  allowAllOption?: boolean;
}

interface GeorefItem {
  id: string;
  nombre: string;
}

const FALLBACK_PROVINCES: GeorefItem[] = [
  { id: '06', nombre: 'Buenos Aires' },
  { id: '02', nombre: 'Ciudad Autónoma de Buenos Aires' },
  { id: '14', nombre: 'Córdoba' },
  { id: '30', nombre: 'Entre Ríos' },
  { id: '42', nombre: 'La Pampa' },
  { id: '50', nombre: 'Mendoza' },
  { id: '58', nombre: 'Neuquén' },
  { id: '62', nombre: 'Río Negro' },
  { id: '74', nombre: 'San Luis' },
  { id: '82', nombre: 'Santa Fe' },
];

const FALLBACK_DISTRICTS_BA: GeorefItem[] = [
  { id: '06147', nombre: 'Carlos Tejedor' },
  { id: '06679', nombre: 'Rivadavia' },
  { id: '06357', nombre: 'General Villegas' },
  { id: '06609', nombre: 'Pehuajó' },
  { id: '06469', nombre: 'Lincoln' },
  { id: '06826', nombre: 'Trenque Lauquen' },
  { id: '06329', nombre: 'General Pinto' },
  { id: '06126', nombre: 'Carlos Casares' },
  { id: '06588', nombre: 'Nueve de Julio' },
  { id: '06413', nombre: 'Junín' },
];

const FALLBACK_LOCALITIES_BY_DISTRICT: Record<string, string[]> = {
  'Carlos Tejedor': [
    'Carlos Tejedor',
    'Tres Algarrobos (Cuenca)',
    'Colonia Seré',
    'Timote',
    'Curarú',
  ],
  Rivadavia: ['América', 'González Moreno', 'Fortín Olavarría', 'Sansinena', 'Roosevelt'],
  'General Villegas': ['General Villegas', 'Piedritas', 'Emilio V. Bunge', 'Banderaló', 'Charlone'],
  Pehuajó: ['Pehuajó', 'Juan José Paso', 'Mones Cazón', 'Francisco Madero', 'Magdala'],
  Lincoln: ['Lincoln', 'Roberts', 'Pasteur', 'Arenaza', 'El Triunfo', 'Bayauca'],
  'Trenque Lauquen': ['Trenque Lauquen', 'Treinta de Agosto', 'Beruti', 'Garré'],
};

export const LocationSelector: React.FC<LocationSelectorProps> = ({
  value,
  onChange,
  allowAllOption = false,
}) => {
  const [provinces, setProvinces] = useState<GeorefItem[]>(FALLBACK_PROVINCES);
  const [districts, setDistricts] = useState<GeorefItem[]>([]);
  const [localities, setLocalities] = useState<string[]>([]);
  const [loadingDistricts, setLoadingDistricts] = useState(false);
  const [loadingLocalities, setLoadingLocalities] = useState(false);

  // 1. Cargar Provincias desde Georef
  useEffect(() => {
    let mounted = true;
    fetch('https://apis.datos.gob.ar/georef/api/provincias?campos=id,nombre&max=30&orden=nombre')
      .then((res) => res.json())
      .then((data) => {
        if (mounted && Array.isArray(data?.provincias) && data.provincias.length > 0) {
          setProvinces(data.provincias);
        }
      })
      .catch(() => {
        // Usa el fallback local
      });
    return () => {
      mounted = false;
    };
  }, []);

  // 2. Cargar Partidos / Departamentos al cambiar Provincia
  useEffect(() => {
    if (!value.province) {
      setDistricts([]);
      setLocalities([]);
      return;
    }

    let mounted = true;
    setLoadingDistricts(true);

    fetch(
      `https://apis.datos.gob.ar/georef/api/departamentos?provincia=${encodeURIComponent(
        value.province
      )}&campos=id,nombre&max=200&orden=nombre`
    )
      .then((res) => res.json())
      .then((data) => {
        if (!mounted) return;
        if (Array.isArray(data?.departamentos) && data.departamentos.length > 0) {
          setDistricts(data.departamentos);
        } else if (value.province === 'Buenos Aires') {
          setDistricts(FALLBACK_DISTRICTS_BA);
        }
      })
      .catch(() => {
        if (mounted && value.province === 'Buenos Aires') {
          setDistricts(FALLBACK_DISTRICTS_BA);
        }
      })
      .finally(() => {
        if (mounted) setLoadingDistricts(false);
      });

    return () => {
      mounted = false;
    };
  }, [value.province]);

  // 3. Cargar Ciudades / Localidades al cambiar Partido
  useEffect(() => {
    if (!value.province || !value.district) {
      setLocalities([]);
      return;
    }

    let mounted = true;
    setLoadingLocalities(true);

    fetch(
      `https://apis.datos.gob.ar/georef/api/localidades?provincia=${encodeURIComponent(
        value.province
      )}&departamento=${encodeURIComponent(
        value.district
      )}&campos=id,nombre&max=200&orden=nombre`
    )
      .then((res) => res.json())
      .then((data) => {
        if (!mounted) return;
        const fallbackList = FALLBACK_LOCALITIES_BY_DISTRICT[value.district] || [];
        if (Array.isArray(data?.localidades) && data.localidades.length > 0) {
          const apiNames: string[] = data.localidades.map((l: GeorefItem) => l.nombre);
          const merged = Array.from(new Set([...fallbackList, ...apiNames])).sort((a, b) =>
            a.localeCompare(b, 'es')
          );
          setLocalities(merged);
        } else {
          setLocalities(fallbackList);
        }
      })
      .catch(() => {
        if (mounted) {
          setLocalities(FALLBACK_LOCALITIES_BY_DISTRICT[value.district] || []);
        }
      })
      .finally(() => {
        if (mounted) setLoadingLocalities(false);
      });

    return () => {
      mounted = false;
    };
  }, [value.province, value.district]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {/* SELECT 1: PROVINCIA */}
      <div>
        <label className="block text-sm font-semibold text-slate-800 mb-1.5">
          Provincia
        </label>
        <select
          value={value.province}
          onChange={(e) =>
            onChange({
              province: e.target.value,
              district: '',
              locality: '',
            })
          }
          className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm bg-white focus:border-brand-600 focus:outline-none"
        >
          <option value="">{allowAllOption ? 'Todas las provincias' : 'Seleccionar provincia...'}</option>
          {provinces.map((prov) => (
            <option key={prov.id} value={prov.nombre}>
              {prov.nombre}
            </option>
          ))}
        </select>
      </div>

      {/* SELECT 2: PARTIDO / DEPARTAMENTO */}
      <div>
        <label className="block text-sm font-semibold text-slate-800 mb-1.5">
          Partido / Departamento
        </label>
        <select
          value={value.district}
          disabled={!value.province || loadingDistricts}
          onChange={(e) =>
            onChange({
              ...value,
              district: e.target.value,
              locality: '',
            })
          }
          className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm bg-white disabled:bg-slate-100 disabled:text-slate-400 focus:border-brand-600 focus:outline-none"
        >
          <option value="">
            {!value.province
              ? 'Elegí primero provincia'
              : loadingDistricts
              ? 'Cargando partidos...'
              : allowAllOption
              ? 'Todos los partidos'
              : 'Seleccionar partido...'}
          </option>
          {districts.map((dist) => (
            <option key={dist.id} value={dist.nombre}>
              {dist.nombre}
            </option>
          ))}
        </select>
      </div>

      {/* SELECT 3: CIUDAD / LOCALIDAD */}
      <div>
        <label className="block text-sm font-semibold text-slate-800 mb-1.5">
          Ciudad / Localidad
        </label>
        <select
          value={value.locality}
          disabled={!value.district || loadingLocalities}
          onChange={(e) =>
            onChange({
              ...value,
              locality: e.target.value,
            })
          }
          className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm bg-white disabled:bg-slate-100 disabled:text-slate-400 focus:border-brand-600 focus:outline-none"
        >
          <option value="">
            {!value.district
              ? 'Elegí primero partido'
              : loadingLocalities
              ? 'Cargando localidades...'
              : allowAllOption
              ? 'Todas las localidades'
              : 'Seleccionar localidad...'}
          </option>
          {localities.map((locName) => (
            <option key={locName} value={locName}>
              {locName}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};
