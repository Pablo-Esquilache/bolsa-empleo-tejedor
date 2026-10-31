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
import { sendTransactionalEmail } from '../lib/emailService';

export const JobsDirectoryPage: React.FC = () => {
  const { token, user } = useAuth();
  const navigate = useNavigate();

  const [industriesCatalog, setIndustriesCatalog] = useState<IndustryItem[]>(INITIAL_INDUSTRIES);
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState('');
  const [locationFilter, setLocationFilter] = useState<LocationValue>({
    province: 'Buenos Aires',
    district: 'Carlos Tejedor',
    locality: '',
  });
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>([]);
  const [selectedAvailability, setSelectedAvailability] = useState<string[]>([]);

  const [selectedJob, setSelectedJob] = useState<any | null>(null);
  const [applyStatus, setApplyStatus] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

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
      .from('job_posts')
      .select('*, employer_profiles(trade_name, logo_url)')
      .eq('status', 'active')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) setJobs(data);
        setLoading(false);
      });
  }, []);

  const filteredJobs = jobs.filter((job) => {
    if (locationFilter.province && job.province !== locationFilter.province) return false;
    if (locationFilter.district && job.district !== locationFilter.district) return false;
    if (locationFilter.locality && job.locality !== locationFilter.locality) return false;

    if (
      selectedIndustries.length > 0 &&
      !selectedIndustries.includes(job.industry)
    ) {
      return false;
    }

    if (selectedAvailability.length > 0) {
      const jobAv: string[] = job.availability || [];
      if (!selectedAvailability.some((a) => jobAv.includes(a))) return false;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = (job.title || '').toLowerCase().includes(q);
      const matchPos = (job.position_tag || '').toLowerCase().includes(q);
      const matchDesc = (job.description || '').toLowerCase().includes(q);
      const matchEmp = (job.employer_profiles?.trade_name || '').toLowerCase().includes(q);
      if (!matchTitle && !matchPos && !matchDesc && !matchEmp) return false;
    }

    return true;
  });

  const handleApply = async (job: any) => {
    if (!user || !token) {
      navigate('/ingresar?rol=candidate');
      return;
    }

    setApplying(true);
    setApplyStatus(null);
    try {
      const { data, error } = await supabase.rpc('apply_to_job_post', {
        p_token: token,
        p_job_post_id: job.id,
        p_message: 'Me interesa esta búsqueda laboral.',
      });

      if (error) throw new Error(error.message);

      if (data?.employer_email) {
        await sendTransactionalEmail({
          toEmail: data.employer_email,
          subject: `Nueva postulación para "${data.job_title}"`,
          htmlContent: `<p>Hola, <strong>${data.candidate_name}</strong> se postuló a tu búsqueda <strong>${data.job_title}</strong> en Bolsa de Empleo Tejedor.</p>`,
        });
      }

      setApplyStatus('¡Te postulaste con éxito! El comercio ya puede ver tu perfil y CV.');
    } catch (err: any) {
      setApplyStatus(`Error: ${err.message}`);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">
          Búsquedas Laborales Activas
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Filtrá por Provincia, Partido y Ciudad/Localidad, o tocando los botones de rubro y horario.
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
            placeholder="Buscar por puesto, oficio o nombre del comercio..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:border-brand-600 focus:outline-none"
          />
        </div>

        <LocationSelector
          value={locationFilter}
          onChange={setLocationFilter}
          allowAllOption={true}
        />

        <ChipSelector
          label="Rubro / Actividad"
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
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500">
          Cargando búsquedas laborales...
        </div>
      ) : filteredJobs.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-2">
          <Briefcase className="w-10 h-10 text-brand-600 mx-auto" />
          <h2 className="text-lg font-bold text-slate-900">
            No hay búsquedas con estos filtros en este momento
          </h2>
          <p className="text-sm text-slate-600 max-w-md mx-auto">
            Probá quitando algún filtro o cambiando la localidad seleccionada.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredJobs.map((job) => (
            <div
              key={job.id}
              onClick={() => {
                setSelectedJob(job);
                setApplyStatus(null);
              }}
              className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md hover:border-brand-400 transition-all cursor-pointer flex flex-col justify-between gap-4"
            >
              <div className="space-y-2.5">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                    {job.employer_profiles?.logo_url ? (
                      <img
                        src={job.employer_profiles.logo_url}
                        alt={job.employer_profiles.trade_name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Building2 className="w-5 h-5 text-slate-400" />
                    )}
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-brand-700 bg-brand-50 px-2.5 py-0.5 rounded-full">
                      {job.industry}
                    </span>
                    <h3 className="text-base font-bold text-slate-900 mt-1">{job.title}</h3>
                    <p className="text-xs text-slate-500">
                      {job.employer_profiles?.trade_name || 'Comercio local'}
                    </p>
                  </div>
                </div>

                <p className="text-xs text-slate-600 line-clamp-2">{job.description}</p>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-brand-600" />
                  {job.locality}, {job.district}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  {(job.availability || []).slice(0, 2).join(' · ')}
                </span>
              </div>
            </div>
          ))}
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

            <div className="pt-2 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setSelectedJob(null)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cerrar
              </button>
              <button
                type="button"
                disabled={applying}
                onClick={() => handleApply(selectedJob)}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold shadow-sm"
              >
                <Send className="w-4 h-4" />
                <span>{applying ? 'Enviando...' : 'Postularme a esta búsqueda'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
