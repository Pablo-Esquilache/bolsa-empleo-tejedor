import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Users,
  Search,
  MapPin,
  FileText,
  MessageCircle,
  X,
  UserCheck,
  RotateCcw,
  SlidersHorizontal,
  ArrowRight,
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
import { buildWhatsAppUrl, normalizeSearchText } from '../lib/emailService';
import { ReportAction } from '../components/ui/ReportModal';

export const CandidatesDirectoryPage: React.FC = () => {
  const { token, user } = useAuth();
  const navigate = useNavigate();

  const [industriesCatalog, setIndustriesCatalog] = useState<IndustryItem[]>(INITIAL_INDUSTRIES);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState('');
  const [locationFilter, setLocationFilter] = useState<LocationValue>({
    province: '',
    district: '',
    locality: '',
  });
  const [selectedSituations, setSelectedSituations] = useState<string[]>([]);
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>([]);
  const [selectedAvailability, setSelectedAvailability] = useState<string[]>([]);
  const [selectedEducation, setSelectedEducation] = useState<string[]>([]);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const [selectedCandidate, setSelectedCandidate] = useState<any | null>(null);
  const [contactPhone, setContactPhone] = useState<string | null>(null);
  const [requestingContact, setRequestingContact] = useState(false);

  useEffect(() => {
    // Si es postulante logueado, redirigir a vacantes
    if (user?.role === 'candidate') {
      navigate('/vacantes');
      return;
    }

    supabase.rpc('get_candidates_directory_data', { p_token: token || null }).then(({ data }) => {
      if (data?.industries && data.industries.length > 0) {
        setIndustriesCatalog(data.industries as IndustryItem[]);
      }
      if (Array.isArray(data?.candidates)) {
        setCandidates(data.candidates);
      }
      setLoading(false);
    });
  }, [user, token, navigate]);

  const resetFilters = () => {
    setSearchQuery('');
    setLocationFilter({ province: '', district: '', locality: '' });
    setSelectedSituations([]);
    setSelectedIndustries([]);
    setSelectedAvailability([]);
    setSelectedEducation([]);
  };

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
      const q = normalizeSearchText(searchQuery);
      const haystack = normalizeSearchText(
        `${cand.first_name || ''} ${cand.last_name || ''} ${(cand.positions || []).join(' ')} ${
          cand.bio_short || ''
        } ${cand.custom_other_text || ''}`
      );
      if (!haystack.includes(q)) {
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
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">
          Directorio de Postulantes ({filteredCandidates.length})
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Filtrá a la izquierda y hacé clic en cualquier postulante a la derecha para ver su perfil, oficios y disponibilidad.
        </p>
      </div>

      {(!user || user.role !== 'employer') && (
        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs sm:text-sm">
          <div>
            <p className="font-bold text-amber-950">Directorio de Oficios y Postulantes (Vista Protegida)</p>
            <p className="text-amber-800 text-xs mt-0.5">
              Por privacidad y protección de datos (Ley 25.326), los apellidos completos, teléfonos directos y CVs en PDF son exclusivos para comercios registrados.
            </p>
          </div>
          <Link
            to="/ingresar?rol=employer"
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shrink-0 shadow-sm"
          >
            <span>Ingresar como Comercio</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}

      {/* Diseño 20%-25% Filtros a la izquierda / 75%-80% Tarjetas una debajo de la otra a la derecha */}
      <div className="flex flex-col lg:flex-row items-start gap-6">
        <div className="w-full lg:hidden flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setMobileFiltersOpen((prev) => !prev)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-slate-300 text-xs font-bold text-slate-800 shadow-sm"
          >
            <SlidersHorizontal className="w-4 h-4 text-brand-600" />
            <span>{mobileFiltersOpen ? 'Ocultar Filtros' : 'Mostrar Filtros'}</span>
          </button>
          <button
            type="button"
            onClick={resetFilters}
            className="text-xs font-semibold text-brand-600 hover:underline"
          >
            Ver todos
          </button>
        </div>

        {/* Columna Izquierda (Filtros) */}
        <aside
          className={`w-full lg:w-[24%] shrink-0 bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-4 ${
            mobileFiltersOpen ? 'block' : 'hidden lg:block'
          }`}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900">Filtros</h2>
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Ver todos</span>
            </button>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar nombre u oficio..."
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-300 text-xs sm:text-sm focus:border-brand-600 focus:outline-none"
            />
          </div>

          <LocationSelector
            value={locationFilter}
            onChange={setLocationFilter}
            allowAllOption={true}
            stacked={true}
          />

          <ChipSelector
            label="Situación Laboral"
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
        </aside>

        {/* Columna Derecha (Tarjetas una debajo de la otra) */}
        <div className="w-full lg:w-[76%] space-y-3">
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
              <p className="text-sm text-slate-600">
                Tocá "Ver todos" en el panel izquierdo para limpiar los filtros.
              </p>
            </div>
          ) : (
            filteredCandidates.map((cand) => (
              <div
                key={cand.id}
                onClick={() => {
                  setSelectedCandidate(cand);
                  setContactPhone(null);
                }}
                className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md hover:border-brand-400 transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="flex items-start gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                    {cand.avatar_url ? (
                      <img
                        src={cand.avatar_url}
                        alt={cand.first_name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <UserCheck className="w-7 h-7 text-slate-400" />
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-bold text-slate-900 text-base sm:text-lg">
                        {cand.first_name} {cand.last_name}
                      </h3>
                      {typeof cand.age === 'number' && (
                        <span className="text-xs font-semibold text-slate-500">
                          ({cand.age} años)
                        </span>
                      )}
                      {cand.is_minor && (
                        <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-800 border border-indigo-200">
                          Menor autorizado · Ley 26.390
                        </span>
                      )}
                      <span
                        className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${
                          cand.work_situation === 'Employed_seeking_change'
                            ? 'bg-amber-50 text-amber-800 border border-amber-200'
                            : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        }`}
                      >
                        {cand.work_situation === 'Employed_seeking_change'
                          ? 'Trabajando · Busca cambiar / sumar horas'
                          : 'Buscando trabajo'}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {(cand.industries || []).map((ind: string) => (
                        <span
                          key={ind}
                          className="px-2 py-0.5 rounded-lg bg-brand-50 text-brand-800 text-xs font-medium"
                        >
                          {ind}
                        </span>
                      ))}
                      {(cand.positions || []).slice(0, 3).map((pos: string) => (
                        <span
                          key={pos}
                          className="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 text-xs"
                        >
                          {pos}
                        </span>
                      ))}
                    </div>

                    {cand.bio_short && (
                      <p className="text-xs text-slate-600 line-clamp-2">{cand.bio_short}</p>
                    )}
                  </div>
                </div>

                <div className="flex sm:flex-col items-start sm:items-end justify-between gap-2 shrink-0 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1 font-medium text-slate-700">
                    <MapPin className="w-3.5 h-3.5 text-brand-600" />
                    {cand.locality}, {cand.district}
                  </span>
                  <span>{cand.education_level}</span>
                  <div className="flex items-center gap-2">
                    {cand.cv_path && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-semibold">
                        <FileText className="w-3.5 h-3.5" /> Con CV
                      </span>
                    )}
                    <span className="px-3 py-1.5 rounded-xl bg-brand-50 text-brand-700 font-bold">
                      Ver ficha →
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

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
                    {typeof selectedCandidate.age === 'number' && (
                      <span className="ml-2 text-sm font-semibold text-slate-500">
                        ({selectedCandidate.age} años)
                      </span>
                    )}
                  </h2>
                  <p className="text-sm text-slate-600">
                    {selectedCandidate.locality}, {selectedCandidate.district} (
                    {selectedCandidate.province})
                  </p>
                  {selectedCandidate.is_minor && (
                    <span className="inline-block mt-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-800 border border-indigo-200">
                      Menor autorizado · Jornada reducida Ley 26.390
                    </span>
                  )}
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

            <div className="pt-3 border-t border-slate-200 space-y-3">
              {contactPhone && (
                <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                  Usá estos datos solo para contactarlo por una búsqueda laboral.
                </p>
              )}

              {!user || user.role !== 'employer' ? (
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold text-slate-900">¿Querés ver el CV o contactar a este postulante?</p>
                    <p className="text-[11px] text-slate-600">
                      Ingresá o registrate con tu comercio para habilitar el teléfono directo y descargar su CV.
                    </p>
                  </div>
                  <Link
                    to="/ingresar?rol=employer"
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs shrink-0 shadow-sm"
                  >
                    <span>Ingresar como Comercio</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
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
                    <ReportAction
                      targetType="candidate"
                      targetId={selectedCandidate.id}
                      targetLabel={`${selectedCandidate.first_name} ${selectedCandidate.last_name}`}
                    />
                  </div>

                  {contactPhone ? (
                    <a
                      href={buildWhatsAppUrl(contactPhone)}
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
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
