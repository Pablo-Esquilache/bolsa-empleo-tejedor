import React, { useState } from 'react';
import { MapPin, Briefcase, Clock } from 'lucide-react';
import {
  AVAILABILITY_OPTIONS,
  INITIAL_INDUSTRIES,
  INITIAL_LOCALITIES,
} from '../lib/constants';
import { ChipSelector } from '../components/ui/ChipSelector';

export const JobsDirectoryPage: React.FC = () => {
  const [selectedLocality, setSelectedLocality] = useState<string>('');
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>([]);
  const [selectedAvailability, setSelectedAvailability] = useState<string[]>([]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">
          Búsquedas Laborales Activas
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Filtrá con un clic por localidad, rubro o disponibilidad horaria.
        </p>
      </div>

      {/* Panel de Filtros Cliqueables */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-semibold text-slate-800 mb-1.5">
              Localidad
            </label>
            <select
              value={selectedLocality}
              onChange={(e) => setSelectedLocality(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm bg-white focus:border-brand-600 focus:outline-none"
            >
              <option value="">Todas las localidades</option>
              {INITIAL_LOCALITIES.map((loc) => (
                <option key={loc.id} value={loc.name}>
                  {loc.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <ChipSelector
          label="Rubro / Actividad"
          options={INITIAL_INDUSTRIES.map((i) => i.name)}
          selected={selectedIndustries}
          onChange={setSelectedIndustries}
        />

        <ChipSelector
          label="Disponibilidad Horaria"
          options={AVAILABILITY_OPTIONS}
          selected={selectedAvailability}
          onChange={setSelectedAvailability}
        />
      </div>

      {/* Estado inicial (se conectará con job_posts en Fase 2/5) */}
      <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-2">
        <Briefcase className="w-10 h-10 text-brand-600 mx-auto" />
        <h2 className="text-lg font-bold text-slate-900">
          Directorio listo para conectar con la base de datos
        </h2>
        <p className="text-sm text-slate-600 max-w-md mx-auto">
          En la Fase 2 conectaremos Supabase para listar todas las búsquedas laborales publicadas en Carlos Tejedor y la región.
        </p>
        <div className="flex flex-wrap justify-center gap-3 pt-2 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5" /> {selectedLocality || 'Todas las localidades'}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" /> {selectedAvailability.length} filtros de horario
          </span>
        </div>
      </div>
    </div>
  );
};
