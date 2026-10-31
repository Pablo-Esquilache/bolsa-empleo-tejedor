import React, { useState } from 'react';
import { Users } from 'lucide-react';
import {
  AVAILABILITY_OPTIONS,
  EDUCATION_LEVELS,
  INITIAL_INDUSTRIES,
  INITIAL_LOCALITIES,
  WORK_SITUATIONS,
} from '../lib/constants';
import { ChipSelector } from '../components/ui/ChipSelector';

export const CandidatesDirectoryPage: React.FC = () => {
  const [selectedLocality, setSelectedLocality] = useState<string>('');
  const [selectedSituations, setSelectedSituations] = useState<string[]>([]);
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>([]);
  const [selectedAvailability, setSelectedAvailability] = useState<string[]>([]);
  const [selectedEducation, setSelectedEducation] = useState<string[]>([]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">
          Directorio de Postulantes
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Filtrá vecinos que buscan trabajo o quieren cambiar de empleo por rubro, estudios y disponibilidad.
        </p>
      </div>

      {/* Filtros Cliqueables */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
        <div className="max-w-xs">
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

        <ChipSelector
          label="Situación Laboral Actual"
          options={WORK_SITUATIONS.map((w) => w.label)}
          selected={selectedSituations}
          onChange={setSelectedSituations}
        />

        <ChipSelector
          label="Rubros de Interés"
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

        <ChipSelector
          label="Nivel de Formación"
          options={EDUCATION_LEVELS}
          selected={selectedEducation}
          onChange={setSelectedEducation}
        />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-2">
        <Users className="w-10 h-10 text-brand-600 mx-auto" />
        <h2 className="text-lg font-bold text-slate-900">
          Directorio de Postulantes preparado
        </h2>
        <p className="text-sm text-slate-600 max-w-md mx-auto">
          En la Fase 2 crearemos las tablas y vistas seguras en Supabase para mostrar las tarjetas de postulantes y solicitar contacto por WhatsApp.
        </p>
      </div>
    </div>
  );
};
