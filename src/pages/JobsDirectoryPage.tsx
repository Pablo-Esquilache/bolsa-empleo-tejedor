import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MapPin,
  Briefcase,
  Clock,
  Search,
  Building2,
  X,
  CheckCircle2,
  Send,
  Trash2,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react';
import {
  AVAILABILITY_OPTIONS,
  INITIAL_INDUSTRIES,
} from '../lib/constants';
import { ChipSelector } from '../components/ui/ChipSelector';
import { LocationSelector, LocationValue } from '../components/ui/LocationSelector';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { IndustryItem } from '../types/database';
import { normalizeSearchText, notifyServerEvent } from '../lib/emailService';
import { ReportAction } from '../components/ui/ReportModal';

function getCandidateApplicationBadge(status: string): { label: string; className: string } {
  switch (status) {
    case 'in_review':
      return { label: 'En revisión por el comercio', className: 'bg-amber-100 text-amber-900' };
    case 'shortlisted':
      return { label: 'Preseleccionado / En contacto', className: 'bg-purple-100 text-purple-800' };
    case 'hired':
      return { label: '¡Confirmado / Contratado!', className: 'bg-emerald-100 text-emerald-800' };
    case 'rejected':
      return { label: 'No seleccionado', className: 'bg-rose-100 text-rose-800' };
    default:
      return { label: 'Recibida por el comercio', className: 'bg-blue-100 text-blue-800' };
  }
}

export const JobsDirectoryPage: React.FC = () => {
  const { token, user } = useAuth();
  const navigate = useNavigate();

  const [activeView, setActiveView] = useState<'jobs' | 'employers' | 'my_applications'>('jobs');
  const [industriesCatalog, setIndustriesCatalog] = useState<IndustryItem[]>(INITIAL_INDUSTRIES);
  const [jobs, setJobs] = useState<any[]>([]);
  const [employers, setEmployers] = useState<any[]>([]);
  const [myApplications, setMyApplications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState('');
  const [locationFilter, setLocationFilter] = useState<LocationValue>({
    province: '',
    district: '',
    locality: '',
  });
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>([]);
  const [selectedAvailability, setSelectedAvailability] = useState<string[]>([]);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const [selectedJob, setSelectedJob] = useState<any | null>(null);
  const [selectedEmployer, setSelectedEmployer] = useState<any | null>(null);
  const [applyStatus, setApplyStatus] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const loadMyApplications = async (currentToken: string) => {
    const { data } = await supabase.rpc('candidate_get_my_applications', {
      p_token: currentToken,
    });
    if (Array.isArray(data)) {
      setMyApplications(data);
    }
  };

  useEffect(() => {
    if (!user || !token) {
      navigate('/');
      return;
    }

    Promise.all([
      supabase.rpc('get_jobs_directory_data', { p_token: token }),
      loadMyApplications(token),
    ]).then(([dirRes]) => {
      const payload = dirRes.data;
      if (payload?.industries && payload.industries.length > 0) {
        setIndustriesCatalog(payload.industries as IndustryItem[]);
      }
      if (Array.isArray(payload?.jobs)) {
        setJobs(payload.jobs);
      }
      if (Array.isArray(payload?.employers)) {
        setEmployers(payload.employers);
      }
      setLoading(false);
    });
  }, [user, token, navigate]);

  useEffect(() => {
    if (!token) return;
    if (activeView === 'my_applications') {
      loadMyApplications(token);
    }

    const handleRefresh = () => {
      if (document.visibilityState === 'visible') {
        loadMyApplications(token);
      }
    };

    window.addEventListener('focus', handleRefresh);
    document.addEventListener('visibilitychange', handleRefresh);
    return () => {
      window.removeEventListener('focus', handleRefresh);
      document.removeEventListener('visibilitychange', handleRefresh);
    };
  }, [token, activeView]);

  const appliedJobIds = new Set(myApplications.map((a) => a.job_post_id));

  const resetFilters = () => {
    setSearchQuery('');
    setLocationFilter({ province: '', district: '', locality: '' });
    setSelectedIndustries([]);
    setSelectedAvailability([]);
  };

  const filteredJobs = jobs.filter((job) => {
    if (locationFilter.province && job.province !== locationFilter.province) return false;
    if (locationFilter.district && job.district !== locationFilter.district) return false;
    if (locationFilter.locality && job.locality !== locationFilter.locality) return false;

    if (selectedIndustries.length > 0 && !selectedIndustries.includes(job.industry)) {
      return false;
    }

    if (selectedAvailability.length > 0) {
      const jobAv: string[] = job.availability || [];
      if (!selectedAvailability.some((a) => jobAv.includes(a))) return false;
    }

    if (searchQuery.trim()) {
      const q = normalizeSearchText(searchQuery);
      const haystack = normalizeSearchText(
        `${job.title || ''} ${job.position_tag || ''} ${job.description || ''} ${
          job.employer_profiles?.trade_name || ''
        }`
      );
      if (!haystack.includes(q)) return false;
    }

    return true;
  });

  const filteredEmployers = employers.filter((emp) => {
    if (locationFilter.province && emp.province !== locationFilter.province) return false;
    if (locationFilter.district && emp.district !== locationFilter.district) return false;
    if (locationFilter.locality && emp.locality !== locationFilter.locality) return false;

    if (selectedIndustries.length > 0 && !selectedIndustries.includes(emp.industry)) {
      return false;
    }

    if (searchQuery.trim()) {
      const q = normalizeSearchText(searchQuery);
      const text = normalizeSearchText(
        `${emp.trade_name || ''} ${emp.industry || ''} ${emp.description || ''}`
      );
      if (!text.includes(q)) return false;
    }
    return true;
  });

  const handleApply = async (job: any) => {
    if (!user || !token) return;

    setApplying(true);
    setApplyStatus(null);
    try {
      const { data, error } = await supabase.rpc('apply_to_job_post', {
        p_token: token,
        p_job_post_id: job.id,
        p_message: 'Me interesa esta búsqueda laboral.',
      });

      if (error) throw new Error(error.message);

      if (data?.application_id) {
        notifyServerEvent({
          token,
          eventType: 'new_application',
          targetId: data.application_id,
        });
      }

      await loadMyApplications(token);
      setApplyStatus('¡Te postulaste con éxito! El comercio ya puede ver tu perfil y CV.');
    } catch (err: any) {
      setApplyStatus(`Error: ${err.message}`);
    } finally {
      setApplying(false);
    }
  };

  const handleCancelApplication = async (jobPostId: string) => {
    if (!token) return;
    setApplying(true);
    setApplyStatus(null);
    try {
      const { data, error } = await supabase.rpc('candidate_cancel_application', {
        p_token: token,
        p_job_post_id: jobPostId,
      });
      if (error) throw new Error(error.message);
      if (data?.ok === false) {
        throw new Error(
          data.error || 'Esta postulación ya fue evaluada y no puede retirarse.'
        );
      }
      await loadMyApplications(token);
      setApplyStatus('Postulación cancelada.');
    } catch (err: any) {
      setApplyStatus(`Error: ${err.message}`);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">
      {/* Pestañas superiores */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveView('jobs')}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
              activeView === 'jobs'
                ? 'bg-brand-600 text-white'
                : 'bg-white text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Briefcase className="w-4 h-4" />
            <span>Búsquedas Laborales ({filteredJobs.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveView('employers')}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
              activeView === 'employers'
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Building2 className="w-4 h-4" />
            <span>Comercios Registrados ({filteredEmployers.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveView('my_applications')}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
              activeView === 'my_applications'
                ? 'bg-emerald-600 text-white'
                : 'bg-white text-slate-700 hover:bg-slate-200'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Mis Postulaciones ({myApplications.length})</span>
          </button>
        </div>
      </div>

      {activeView === 'my_applications' ? (
        /* Vista de Mis Postulaciones una debajo de la otra */
        <div className="space-y-3">
          {applyStatus && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                applyStatus.startsWith('Error:')
                  ? 'bg-rose-50 border-rose-200 text-rose-800'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-900'
              }`}
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{applyStatus}</span>
            </div>
          )}
          {myApplications.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-2">
              <Briefcase className="w-10 h-10 text-slate-400 mx-auto" />
              <h2 className="text-lg font-bold text-slate-900">
                Todavía no te postulaste a ninguna búsqueda
              </h2>
              <p className="text-sm text-slate-600">
                Entrá a la pestaña de Búsquedas Laborales, tocá un aviso y presioná "Postularme".
              </p>
            </div>
          ) : (
            myApplications.map((app) => {
              const badge = getCandidateApplicationBadge(app.status);
              return (
                <div
                  key={app.application_id}
                  className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${badge.className}`}>
                        {badge.label}
                      </span>
                      <span className="text-xs text-slate-500">
                        {app.locality}, {app.district}
                      </span>
                    </div>
                    <h3 className="font-bold text-base text-slate-900">{app.job_title}</h3>
                    <p className="text-xs text-slate-600">{app.trade_name}</p>
                  </div>

                  {app.status !== 'rejected' && (
                    <button
                      type="button"
                      onClick={() => handleCancelApplication(app.job_post_id)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold self-start sm:self-center"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Cancelar postulación</span>
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      ) : (
        /* Diseño 20%-25% Filtros a la izquierda / 75%-80% Tarjetas una debajo de la otra a la derecha */
        <div className="flex flex-col lg:flex-row items-start gap-6">
          {/* Botón desplegable de filtros para celular */}
          <div className="w-full lg:hidden flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setMobileFiltersOpen((prev) => !prev)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-slate-300 text-xs font-bold text-slate-800 shadow-sm"
            >
              <SlidersHorizontal className="w-4 h-4 text-brand-600" />
              <span>{mobileFiltersOpen ? 'Ocultar Filtros' : 'Mostrar Filtros de Búsqueda'}</span>
            </button>
            <button
              type="button"
              onClick={resetFilters}
              className="text-xs font-semibold text-brand-600 hover:underline"
            >
              Ver todo
            </button>
          </div>

          {/* Columna Izquierda (Filtros) */}
          <aside
            className={`w-full lg:w-[24%] shrink-0 bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-4 ${
              mobileFiltersOpen ? 'block' : 'hidden lg:block'
            }`}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">Filtros de Búsqueda</h2>
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Ver todo</span>
              </button>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar puesto o comercio..."
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
              label="Rubro / Actividad"
              options={industriesCatalog.map((i) => i.name)}
              selected={selectedIndustries}
              onChange={setSelectedIndustries}
            />

            {activeView === 'jobs' && (
              <ChipSelector
                label="Disponibilidad Horaria"
                options={AVAILABILITY_OPTIONS}
                selected={selectedAvailability}
                onChange={setSelectedAvailability}
              />
            )}
          </aside>

          {/* Columna Derecha (Tarjetas una debajo de la otra) */}
          <div className="w-full lg:w-[76%] space-y-3">
            {loading ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500">
                Cargando resultados...
              </div>
            ) : activeView === 'jobs' ? (
              filteredJobs.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-2">
                  <Briefcase className="w-10 h-10 text-brand-600 mx-auto" />
                  <h2 className="text-lg font-bold text-slate-900">
                    No hay búsquedas con estos filtros en este momento
                  </h2>
                  <p className="text-sm text-slate-600">
                    Tocá "Ver todo" en el panel izquierdo para limpiar los filtros.
                  </p>
                </div>
              ) : (
                filteredJobs.map((job) => {
                  const isApplied = appliedJobIds.has(job.id);
                  return (
                    <div
                      key={job.id}
                      onClick={() => {
                        setSelectedJob(job);
                        setApplyStatus(null);
                      }}
                      className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md hover:border-brand-400 transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="flex items-start gap-3.5">
                        <div className="w-14 h-14 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                          {job.employer_profiles?.logo_url ? (
                            <img
                              src={job.employer_profiles.logo_url}
                              alt={job.employer_profiles.trade_name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <Building2 className="w-6 h-6 text-slate-400" />
                          )}
                        </div>

                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold text-brand-700 bg-brand-50 px-2.5 py-0.5 rounded-full">
                              {job.industry}
                            </span>
                            {isApplied && (
                              <span className="text-xs font-bold text-emerald-800 bg-emerald-100 px-2.5 py-0.5 rounded-full">
                                ✓ Ya te postulaste
                              </span>
                            )}
                          </div>
                          <h3 className="text-base sm:text-lg font-bold text-slate-900">
                            {job.title}
                          </h3>
                          <p className="text-xs font-medium text-slate-600">
                            {job.employer_profiles?.trade_name || 'Comercio local'}
                          </p>
                          <p className="text-xs text-slate-500 line-clamp-2">{job.description}</p>
                        </div>
                      </div>

                      <div className="flex sm:flex-col items-start sm:items-end justify-between gap-2 shrink-0 text-xs text-slate-500">
                        <span className="inline-flex items-center gap-1 font-medium text-slate-700">
                          <MapPin className="w-3.5 h-3.5 text-brand-600" />
                          {job.locality}, {job.district}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          {(job.availability || []).slice(0, 2).join(' · ')}
                        </span>
                        <span className="px-3 py-1.5 rounded-xl bg-brand-50 text-brand-700 font-bold text-xs">
                          Ver y Postularme →
                        </span>
                      </div>
                    </div>
                  );
                })
              )
            ) : filteredEmployers.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-2">
                <Building2 className="w-10 h-10 text-slate-400 mx-auto" />
                <h2 className="text-lg font-bold text-slate-900">
                  No se encontraron comercios con estos filtros
                </h2>
              </div>
            ) : (
              filteredEmployers.map((emp) => (
                <div
                  key={emp.id}
                  onClick={() => setSelectedEmployer(emp)}
                  className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md hover:border-brand-400 transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="flex items-start gap-3.5">
                    <div className="w-14 h-14 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                      {emp.logo_url ? (
                        <img
                          src={emp.logo_url}
                          alt={emp.trade_name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Building2 className="w-6 h-6 text-slate-400" />
                      )}
                    </div>
                    <div className="space-y-1">
                      <span className="text-[11px] font-semibold text-brand-700 bg-brand-50 px-2.5 py-0.5 rounded-full">
                        {emp.industry}
                      </span>
                      <h3 className="font-bold text-slate-900 text-base sm:text-lg">
                        {emp.trade_name}
                      </h3>
                      {emp.description && (
                        <p className="text-xs text-slate-600 line-clamp-2">{emp.description}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex sm:flex-col items-start sm:items-end justify-between gap-2 shrink-0 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1 font-medium text-slate-700">
                      <MapPin className="w-3.5 h-3.5 text-brand-600" />
                      {emp.locality}, {emp.district}
                    </span>
                    <span className="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-800 font-bold text-xs">
                      Ver ficha del comercio →
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Pop-up de detalle de la búsqueda laboral */}
      {selectedJob && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-brand-50 text-brand-700">
                  {selectedJob.industry}
                </span>
                <h2 className="text-xl font-bold text-slate-900 mt-2">{selectedJob.title}</h2>
                <p className="text-sm text-slate-600">
                  {selectedJob.employer_profiles?.trade_name} — {selectedJob.locality},{' '}
                  {selectedJob.district}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedJob(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 text-sm text-slate-700 bg-slate-50 p-4 rounded-xl border border-slate-200">
              <p className="font-semibold text-slate-900">Descripción del puesto:</p>
              <p className="whitespace-pre-line">{selectedJob.description}</p>
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 font-medium">
                Formación: {selectedJob.required_education}
              </span>
              {(selectedJob.availability || []).map((av: string) => (
                <span
                  key={av}
                  className="px-2.5 py-1 rounded-lg bg-brand-50 text-brand-800 font-medium"
                >
                  {av}
                </span>
              ))}
            </div>

            {applyStatus && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{applyStatus}</span>
              </div>
            )}

            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
              <strong>Cuidado con las estafas:</strong> Nunca pagues para conseguir un empleo ni compartas datos bancarios. Este sitio no verifica a los comercios.
            </div>

            <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
              <ReportAction
                targetType="job_post"
                targetId={selectedJob.id}
                ownerId={selectedJob.employer_id}
                targetLabel={selectedJob.title}
              />

              <div className="flex items-center gap-3 ml-auto">
                <button
                  type="button"
                  onClick={() => setSelectedJob(null)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cerrar
                </button>

                {appliedJobIds.has(selectedJob.id) ? (
                  myApplications.find((a) => a.job_post_id === selectedJob.id)?.status === 'rejected' ? (
                    <span className="px-4 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold">
                      Postulación evaluada (No seleccionado)
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={applying}
                      onClick={() => handleCancelApplication(selectedJob.id)}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold shadow-sm"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>Cancelar mi postulación</span>
                    </button>
                  )
                ) : (
                  <button
                    type="button"
                    disabled={applying}
                    onClick={() => handleApply(selectedJob)}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold shadow-sm"
                  >
                    <Send className="w-4 h-4" />
                    <span>{applying ? 'Enviando...' : 'Postularme a esta búsqueda'}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pop-up de detalle del Comercio Registrado */}
      {selectedEmployer && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3.5">
                <div className="w-16 h-16 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                  {selectedEmployer.logo_url ? (
                    <img
                      src={selectedEmployer.logo_url}
                      alt={selectedEmployer.trade_name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Building2 className="w-7 h-7 text-slate-400" />
                  )}
                </div>
                <div>
                  <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-brand-50 text-brand-700">
                    {selectedEmployer.industry}
                  </span>
                  <h2 className="text-xl font-bold text-slate-900 mt-1">
                    {selectedEmployer.trade_name}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {selectedEmployer.locality}, {selectedEmployer.district} (
                    {selectedEmployer.province})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEmployer(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {selectedEmployer.description && (
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-700 whitespace-pre-line">
                {selectedEmployer.description}
              </div>
            )}

            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Búsquedas activas de este comercio
              </p>
              {jobs.filter((j) => j.employer_id === selectedEmployer.id).length === 0 ? (
                <p className="text-xs text-slate-500">
                  Actualmente no tiene búsquedas abiertas.
                </p>
              ) : (
                jobs
                  .filter((j) => j.employer_id === selectedEmployer.id)
                  .map((job) => (
                    <div
                      key={job.id}
                      onClick={() => {
                        setSelectedEmployer(null);
                        setSelectedJob(job);
                      }}
                      className="p-3 rounded-xl border border-slate-200 hover:border-brand-500 cursor-pointer flex items-center justify-between"
                    >
                      <div>
                        <p className="font-bold text-sm text-slate-900">{job.title}</p>
                        <p className="text-xs text-slate-500">{job.locality}</p>
                      </div>
                      <span className="text-xs font-bold text-brand-600">Ver búsqueda →</span>
                    </div>
                  ))
              )}
            </div>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
              <ReportAction
                targetType="employer"
                targetId={selectedEmployer.id}
                targetLabel={selectedEmployer.trade_name}
              />
              <button
                type="button"
                onClick={() => setSelectedEmployer(null)}
                className="px-4 py-1.5 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
