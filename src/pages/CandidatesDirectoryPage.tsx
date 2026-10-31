import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users,
  Search,
  MapPin,
  FileText,
  MessageCircle,
  X,
  UserCheck,
} from 'lucide-react';
import {
  AVAILABILITY_OPTIONS,
  EDUCATION_LEVELS,
  INITIAL_INDUSTRIES,
  WORK_SITUATIONS,
} from '../lib/constants';
import { ChipSelector } from '../components/ui/ChipSelector';
import { LocationSelector, LocationValue } from '../components/ui/LocationSelector';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { IndustryItem } from '../types/database';

export const CandidatesDirectoryPage: React.FC = () => {
  const { token, user } = useAuth();
  const navigate = useNavigate();

  const [industriesCatalog, setIndustriesCatalog] = useState<IndustryItem[]>(INITIAL_INDUSTRIES);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState('');
  const [locationFilter, setLocationFilter] = useState<LocationValue>({
    province: 'Buenos Aires',
    district: 'Carlos Tejedor',
    locality: '',
  });
  const [selectedSituations, setSelectedSituations] = useState<string[]>([]);
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>([]);
  const [selectedAvailability, setSelectedAvailability] = useState<string[]>([]);
  const [selectedEducation, setSelectedEducation] = useState<string[]>([]);

  const [selectedCandidate, setSelectedCandidate] = useState<any | null>(null);
  const [contactPhone, setContactPhone] = useState<string | null>(null);
  const [requestingContact, setRequestingContact] = useState(false);

  useEffect(() => {
    if (!user) {
      navigate('/');
      return;
    }

    supabase
      .from('industries')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .then(({ data }) => {
        if (data && data.length > 0) setIndustriesCatalog(data as IndustryItem[]);
      });

    supabase
      .from('candidate_profiles')
      .select('*')
      .eq('is_searching', true)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) setCandidates(data);
        setLoading(false);
      });
  }, []);

  const filteredCandidates = candidates.filter((cand) => {
    if (locationFilter.province && cand.province !== locationFilter.province) return false;
    if (locationFilter.district && cand.district !== locationFilter.district) return false;
    if (locationFilter.locality && cand.locality !== locationFilter.locality) return false;

    if (selectedSituations.length > 0) {
      const label =
        cand.work_situation === 'Employed_seeking_change'
          ? 'Tengo trabajo, pero busco cambiar o sumar horas'
          : 'Estoy buscando trabajo';
      if (!selectedSituations.includes(label)) return false;
    }

    if (selectedIndustries.length > 0) {
      const cInds: string[] = cand.industries || [];
      if (!selectedIndustries.some((i) => cInds.includes(i))) return false;
    }

    if (selectedAvailability.length > 0) {
      const cAv: string[] = cand.availability || [];
      if (!selectedAvailability.some((a) => cAv.includes(a))) return false;
    }

    if (selectedEducation.length > 0 && !selectedEducation.includes(cand.education_level)) {
      return false;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const fullName = `${cand.first_name || ''} ${cand.last_name || ''}`.toLowerCase();
      const positions = (cand.positions || []).join(' ').toLowerCase();
      const bio = (cand.bio_short || '').toLowerCase();
      const other = (cand.custom_other_text || '').toLowerCase();
      if (!fullName.includes(q) && !positions.includes(q) && !bio.includes(q) && !other.includes(q)) {
        return false;
      }
    }

    return true;
  });

  const handleContactCandidate = async (candidate: any) => {
    if (!user || !token) {
      navigate('/ingresar?rol=employer');
      return;
    }

    setRequestingContact(true);
    try {
      const { data, error } = await supabase.rpc('employer_request_contact', {
        p_token: token,
        p_candidate_id: candidate.id,
        p_message: 'Contacto desde directorio de postulantes',
      });

      if (error) throw new Error(error.message);

      if (data?.candidate_phone) {
        setContactPhone(data.candidate_phone);
      }
    } catch (err: any) {
      alert(err.message || 'No se pudo obtener el contacto.');
    } finally {
      setRequestingContact(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">
          Directorio de Postulantes
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Filtrá por Provincia, Partido y Ciudad/Localidad, situación laboral, rubro, estudios y disponibilidad.
        </p>
      </div>

      {/* Panel de Filtros con Buscador + 3 Selects encadenados + Chips */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-5">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por nombre, puesto, oficio o palabra clave..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:border-brand-600 focus:outline-none"
          />
        </div>

        <LocationSelector
          value={locationFilter}
          onChange={setLocationFilter}
          allowAllOption={true}
        />

        <ChipSelector
          label="Situación Laboral Actual"
          options={WORK_SITUATIONS.map((w) => w.label)}
          selected={selectedSituations}
          onChange={setSelectedSituations}
        />

        <ChipSelector
          label="Rubros de Interés"
          options={industriesCatalog.map((i) => i.name)}
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

      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500">
          Cargando postulantes...
        </div>
      ) : filteredCandidates.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-2">
          <Users className="w-10 h-10 text-brand-600 mx-auto" />
          <h2 className="text-lg font-bold text-slate-900">
            No se encontraron postulantes con estos filtros
          </h2>
          <p className="text-sm text-slate-600 max-w-md mx-auto">
            Probá quitando algún filtro o cambiando la localidad seleccionada.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCandidates.map((cand) => (
            <div
              key={cand.id}
              onClick={() => {
                setSelectedCandidate(cand);
                setContactPhone(null);
              }}
              className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md hover:border-brand-400 transition-all cursor-pointer flex flex-col justify-between gap-4"
            >
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-2xl bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                    {cand.avatar_url ? (
                      <img
                        src={cand.avatar_url}
                        alt={cand.first_name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <UserCheck className="w-6 h-6 text-slate-400" />
                    )}
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 text-base">
                      {cand.first_name} {cand.last_name}
                    </h3>
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                      <MapPin className="w-3.5 h-3.5 text-brand-600" />
                      {cand.locality}, {cand.district}
                    </span>
                  </div>
                </div>

                <span
                  className={`inline-block text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${
                    cand.work_situation === 'Employed_seeking_change'
                      ? 'bg-amber-50 text-amber-800 border border-amber-200'
                      : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  }`}
                >
                  {cand.work_situation === 'Employed_seeking_change'
                    ? 'Trabajando · Busca cambiar / sumar horas'
                    : 'Buscando trabajo'}
                </span>

                <div className="flex flex-wrap gap-1.5">
                  {(cand.industries || []).slice(0, 3).map((ind: string) => (
                    <span
                      key={ind}
                      className="px-2 py-0.5 rounded-lg bg-brand-50 text-brand-800 text-xs font-medium"
                    >
                      {ind}
                    </span>
                  ))}
                </div>

                {cand.bio_short && (
                  <p className="text-xs text-slate-600 line-clamp-2">{cand.bio_short}</p>
                )}
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                <span>{cand.education_level}</span>
                {cand.cv_path && (
                  <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                    <FileText className="w-3.5 h-3.5" /> CV adjunto
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pop-up con el perfil completo del Postulante */}
      {selectedCandidate && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3.5">
                <div className="w-16 h-16 rounded-2xl bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                  {selectedCandidate.avatar_url ? (
                    <img
                      src={selectedCandidate.avatar_url}
                      alt={selectedCandidate.first_name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <UserCheck className="w-7 h-7 text-slate-400" />
                  )}
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900">
                    {selectedCandidate.first_name} {selectedCandidate.last_name}
                  </h2>
                  <p className="text-sm text-slate-600">
                    {selectedCandidate.locality}, {selectedCandidate.district} (
                    {selectedCandidate.province})
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedCandidate(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <div>
                <span className="font-semibold text-slate-800">Situación actual: </span>
                <span className="text-slate-700">
                  {selectedCandidate.work_situation === 'Employed_seeking_change'
                    ? 'Tengo trabajo, pero busco cambiar o sumar horas'
                    : 'Estoy buscando trabajo'}
                </span>
              </div>

              <div>
                <span className="font-semibold text-slate-800">Nivel de formación: </span>
                <span className="text-slate-700">{selectedCandidate.education_level}</span>
              </div>

              <div>
                <p className="font-semibold text-slate-800 mb-1">Rubros y Puestos:</p>
                <div className="flex flex-wrap gap-1.5">
                  {(selectedCandidate.industries || []).map((i: string) => (
                    <span
                      key={i}
                      className="px-2.5 py-1 rounded-lg bg-brand-50 text-brand-800 text-xs font-medium"
                    >
                      {i}
                    </span>
                  ))}
                  {(selectedCandidate.positions || []).map((pos: string) => (
                    <span
                      key={pos}
                      className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs"
                    >
                      {pos}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <p className="font-semibold text-slate-800 mb-1">Disponibilidad horaria:</p>
                <div className="flex flex-wrap gap-1.5">
                  {(selectedCandidate.availability || []).map((av: string) => (
                    <span
                      key={av}
                      className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 text-xs font-medium"
                    >
                      {av}
                    </span>
                  ))}
                </div>
              </div>

              {selectedCandidate.bio_short && (
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                  <p className="font-semibold text-slate-800 mb-1">Presentación:</p>
                  <p className="text-slate-700 whitespace-pre-line">
                    {selectedCandidate.bio_short}
                  </p>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
              {selectedCandidate.cv_path && (
                <a
                  href={selectedCandidate.cv_path}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs sm:text-sm font-semibold"
                >
                  <FileText className="w-4 h-4 text-brand-700" />
                  <span>Ver CV en PDF</span>
                </a>
              )}

              {contactPhone ? (
                <a
                  href={`https://wa.me/549${contactPhone}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold shadow-sm"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span>Abrir WhatsApp ({contactPhone})</span>
                </a>
              ) : (
                <button
                  type="button"
                  disabled={requestingContact}
                  onClick={() => handleContactCandidate(selectedCandidate)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold shadow-sm"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span>
                    {requestingContact ? 'Habilitando...' : 'Contactar por WhatsApp'}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
