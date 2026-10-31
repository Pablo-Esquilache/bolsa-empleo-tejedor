import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2,
  PlusCircle,
  Camera,
  Save,
  CheckCircle2,
  AlertCircle,
  Briefcase,
  PauseCircle,
  PlayCircle,
  Trash2,
  Users,
  FileText,
  MessageCircle,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import {
  AVAILABILITY_OPTIONS,
  EDUCATION_LEVELS,
  INITIAL_INDUSTRIES,
} from '../lib/constants';
import { ChipSelector } from '../components/ui/ChipSelector';
import { LocationSelector, LocationValue } from '../components/ui/LocationSelector';
import { compressImageToWebP } from '../lib/imageCompression';
import { IndustryItem } from '../types/database';

export const EmployerDashboardPage: React.FC = () => {
  const { token, user } = useAuth();
  const navigate = useNavigate();

  const [tab, setTab] = useState<'profile' | 'new_job' | 'my_jobs'>('profile');
  const [industriesCatalog, setIndustriesCatalog] = useState<IndustryItem[]>(INITIAL_INDUSTRIES);

  // Datos del Comercio
  const [tradeName, setTradeName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [cuit, setCuit] = useState('');
  const [contactPersonName, setContactPersonName] = useState('');
  const [phone, setPhone] = useState('');
  const [industry, setIndustry] = useState<string>(INITIAL_INDUSTRIES[0].name);
  const [location, setLocation] = useState<LocationValue>({
    province: 'Buenos Aires',
    district: 'Carlos Tejedor',
    locality: 'Carlos Tejedor',
  });
  const [description, setDescription] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  // Nueva búsqueda laboral
  const [jobTitle, setJobTitle] = useState('');
  const [jobIndustry, setJobIndustry] = useState<string>(INITIAL_INDUSTRIES[0].name);
  const [jobPositionTag, setJobPositionTag] = useState('');
  const [jobOtherText, setJobOtherText] = useState('');
  const [jobLocation, setJobLocation] = useState<LocationValue>({
    province: 'Buenos Aires',
    district: 'Carlos Tejedor',
    locality: 'Carlos Tejedor',
  });
  const [jobAvailability, setJobAvailability] = useState<string[]>([]);
  const [jobEducation, setJobEducation] = useState<string>('Primario');
  const [jobDescription, setJobDescription] = useState('');

  // Mis búsquedas + Postulantes recibidos
  const [myJobs, setMyJobs] = useState<any[]>([]);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadMyJobs = async (currentToken: string) => {
    const { data } = await supabase.rpc('employer_get_my_jobs_with_applicants', {
      p_token: currentToken,
    });
    if (Array.isArray(data)) {
      setMyJobs(data);
    }
  };

  useEffect(() => {
    if (!user || !token) {
      navigate('/ingresar?rol=employer');
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

    supabase.rpc('get_my_employer_data', { p_token: token }).then(({ data }) => {
      if (data?.profile) {
        const p = data.profile;
        setTradeName(p.trade_name || '');
        setLegalName(p.legal_name || '');
        setCuit(p.cuit || '');
        setIndustry(p.industry || INITIAL_INDUSTRIES[0].name);
        setLocation({
          province: p.province || 'Buenos Aires',
          district: p.district || 'Carlos Tejedor',
          locality: p.locality || 'Carlos Tejedor',
        });
        setJobLocation({
          province: p.province || 'Buenos Aires',
          district: p.district || 'Carlos Tejedor',
          locality: p.locality || 'Carlos Tejedor',
        });
        setDescription(p.description || '');
        setLogoUrl(p.logo_url || null);
      }
      if (data?.private) {
        setContactPersonName(data.private.contact_person_name || '');
        setPhone(data.private.phone || '');
      }
    });

    loadMyJobs(token);
  }, [user, token, navigate]);

  const suggestedPositionsForJob =
    industriesCatalog.find((i) => i.name === jobIndustry)?.suggested_positions || [];

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploadingLogo(true);
    setMessage(null);

    try {
      const compressed = await compressImageToWebP(file, 512, 0.82);
      const filePath = `${user.id}/logo-${Date.now()}.webp`;

      const { error } = await supabase.storage
        .from('avatars_and_logos')
        .upload(filePath, compressed, { upsert: true, contentType: 'image/webp' });

      if (error) throw new Error(error.message);

      const { data: pub } = supabase.storage.from('avatars_and_logos').getPublicUrl(filePath);
      setLogoUrl(pub.publicUrl);
    } catch (err: any) {
      setMessage({ type: 'err', text: err.message || 'Error al subir el logo.' });
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleSaveEmployer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    if (!tradeName.trim() || !contactPersonName.trim() || !phone.trim() || !location.locality) {
      setMessage({
        type: 'err',
        text: 'Completá nombre comercial, persona responsable, teléfono y localidad.',
      });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const { error } = await supabase.rpc('save_employer_profile', {
        p_token: token,
        p_trade_name: tradeName,
        p_legal_name: legalName,
        p_cuit: cuit,
        p_contact_person_name: contactPersonName,
        p_phone: phone,
        p_industry: industry,
        p_province: location.province,
        p_district: location.district,
        p_locality: location.locality,
        p_description: description,
        p_logo_url: logoUrl,
      });

      if (error) throw new Error(error.message);

      // Al guardar los datos del comercio, lo redirige directo a Ver Postulantes
      navigate('/postulantes');
    } catch (err: any) {
      setMessage({ type: 'err', text: err.message || 'Error al guardar el comercio.' });
    } finally {
      setSaving(false);
    }
  };

  const handlePublishJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !user) return;

    if (!jobTitle.trim() || !jobLocation.locality || jobAvailability.length === 0) {
      setMessage({
        type: 'err',
        text: 'Completá el título del puesto, la localidad y al menos una disponibilidad horaria.',
      });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const { error } = await supabase.rpc('create_job_post', {
        p_token: token,
        p_title: jobTitle,
        p_industry: jobIndustry,
        p_position_tag: jobPositionTag || jobTitle,
        p_custom_other_text: jobOtherText,
        p_province: jobLocation.province,
        p_district: jobLocation.district,
        p_locality: jobLocation.locality,
        p_availability: jobAvailability,
        p_required_education: jobEducation,
        p_description: jobDescription,
      });

      if (error) throw new Error(error.message);

      // Al publicar la búsqueda laboral, redirige directo a Ver Postulantes
      navigate('/postulantes');
    } catch (err: any) {
      setMessage({ type: 'err', text: err.message || 'Error al publicar la búsqueda.' });
    } finally {
      setSaving(false);
    }
  };

  const handleJobAction = async (jobId: string, action: 'pause' | 'activate' | 'delete') => {
    if (!token) return;
    if (
      action === 'delete' &&
      !window.confirm('¿Seguro que querés cerrar y eliminar esta búsqueda laboral?')
    ) {
      return;
    }

    const { error } = await supabase.rpc('employer_manage_job_post', {
      p_token: token,
      p_job_id: jobId,
      p_action: action,
    });

    if (error) {
      setMessage({ type: 'err', text: error.message });
      return;
    }

    await loadMyJobs(token);
  };

  const handleApplicationDecision = async (
    applicationId: string,
    nextStatus: 'shortlisted' | 'rejected'
  ) => {
    if (!token) return;
    const { error } = await supabase.rpc('employer_update_application_status', {
      p_token: token,
      p_application_id: applicationId,
      p_next_status: nextStatus,
    });

    if (error) {
      setMessage({ type: 'err', text: error.message });
      return;
    }

    await loadMyJobs(token);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Panel de Mi Comercio</h1>
        <p className="text-sm text-slate-600">
          Gestioná los datos de tu comercio, tus búsquedas laborales y los postulantes anotados.
        </p>
      </div>

      {/* Pestañas */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        <button
          type="button"
          onClick={() => setTab('profile')}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
            tab === 'profile'
              ? 'bg-slate-900 text-white'
              : 'bg-white text-slate-700 hover:bg-slate-200'
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>Datos del Comercio</span>
        </button>

        <button
          type="button"
          onClick={() => setTab('new_job')}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
            tab === 'new_job'
              ? 'bg-brand-600 text-white'
              : 'bg-white text-slate-700 hover:bg-slate-200'
          }`}
        >
          <PlusCircle className="w-4 h-4" />
          <span>Publicar Búsqueda Laboral</span>
        </button>

        <button
          type="button"
          onClick={() => setTab('my_jobs')}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
            tab === 'my_jobs'
              ? 'bg-slate-900 text-white'
              : 'bg-white text-slate-700 hover:bg-slate-200'
          }`}
        >
          <Briefcase className="w-4 h-4" />
          <span>Mis Búsquedas ({myJobs.length})</span>
        </button>
      </div>

      {message && (
        <div
          className={`p-4 rounded-xl border text-sm flex items-center gap-2.5 ${
            message.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          {message.type === 'ok' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {tab === 'profile' && (
        <form
          onSubmit={handleSaveEmployer}
          className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6"
        >
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <div className="w-20 h-20 rounded-2xl bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
              {logoUrl ? (
                <img src={logoUrl} alt="Logo" className="w-full h-full object-cover" />
              ) : (
                <Building2 className="w-7 h-7 text-slate-400" />
              )}
            </div>

            <div>
              <label className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs sm:text-sm font-semibold cursor-pointer transition-colors">
                <Camera className="w-4 h-4" />
                <span>{uploadingLogo ? 'Subiendo logo...' : 'Subir Logo del Comercio'}</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleLogoUpload}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1">
                Nombre del Comercio / Empresa *
              </label>
              <input
                type="text"
                required
                value={tradeName}
                onChange={(e) => setTradeName(e.target.value)}
                placeholder="Ej.: Panadería San José"
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-brand-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1">
                Persona Responsable * (Privado)
              </label>
              <input
                type="text"
                required
                value={contactPersonName}
                onChange={(e) => setContactPersonName(e.target.value)}
                placeholder="Nombre y apellido de contacto"
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-brand-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1">
                Teléfono / WhatsApp del Responsable * (Privado)
              </label>
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                placeholder="Ej.: 2355445566"
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-brand-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1">
                CUIT (Opcional)
              </label>
              <input
                type="text"
                value={cuit}
                onChange={(e) => setCuit(e.target.value)}
                placeholder="Ej.: 20-12345678-9"
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-brand-600 focus:outline-none"
              />
            </div>
          </div>

          <LocationSelector value={location} onChange={setLocation} />

          <ChipSelector
            label="Rubro Principal del Comercio *"
            options={industriesCatalog.map((i) => i.name)}
            selected={[industry]}
            multiple={false}
            onChange={(next) => {
              if (next[0]) setIndustry(next[0]);
            }}
          />

          <div>
            <label className="block text-sm font-semibold text-slate-800 mb-1">
              Descripción breve del comercio
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Contá brevemente a qué se dedica el comercio o empresa..."
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-brand-600 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm shadow-sm transition-colors"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? 'Guardando...' : 'Guardar Comercio e Ir a Ver Postulantes'}</span>
          </button>
        </form>
      )}

      {tab === 'new_job' && (
        <form
          onSubmit={handlePublishJob}
          className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6"
        >
          <h2 className="text-lg font-bold text-slate-900">
            Nueva Búsqueda Laboral (Se publica de inmediato)
          </h2>

          <div>
            <label className="block text-sm font-semibold text-slate-800 mb-1">
              Título de la búsqueda *
            </label>
            <input
              type="text"
              required
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="Ej.: Buscamos Vendedor/a de mostrador o Tractorista con experiencia"
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-brand-600 focus:outline-none"
            />
          </div>

          <LocationSelector value={jobLocation} onChange={setJobLocation} />

          <ChipSelector
            label="Rubro de la Búsqueda *"
            options={industriesCatalog.map((i) => i.name)}
            selected={[jobIndustry]}
            multiple={false}
            onChange={(next) => {
              if (next[0]) {
                setJobIndustry(next[0]);
                setJobPositionTag('');
              }
            }}
          />

          {suggestedPositionsForJob.length > 0 && (
            <ChipSelector
              label="Puesto / Oficio Buscado"
              options={suggestedPositionsForJob}
              selected={jobPositionTag ? [jobPositionTag] : []}
              multiple={false}
              allowOther={true}
              otherValue={jobOtherText}
              onOtherChange={setJobOtherText}
              onChange={(next) => setJobPositionTag(next[0] || '')}
            />
          )}

          <ChipSelector
            label="Disponibilidad Horaria Requerida *"
            options={AVAILABILITY_OPTIONS}
            selected={jobAvailability}
            onChange={setJobAvailability}
          />

          <ChipSelector
            label="Nivel de Formación Mínimo"
            options={EDUCATION_LEVELS}
            selected={[jobEducation]}
            multiple={false}
            onChange={(next) => {
              if (next[0]) setJobEducation(next[0]);
            }}
          />

          <div>
            <label className="block text-sm font-semibold text-slate-800 mb-1">
              Detalle de tareas, horarios y requisitos *
            </label>
            <textarea
              rows={4}
              required
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              placeholder="Describí las tareas del puesto, días/horarios y qué valoran..."
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-brand-600 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm shadow-sm transition-colors"
          >
            <PlusCircle className="w-4 h-4" />
            <span>{saving ? 'Publicando...' : 'Publicar Búsqueda e Ir a Ver Postulantes'}</span>
          </button>
        </form>
      )}

      {tab === 'my_jobs' && (
        <div className="space-y-4">
          {myJobs.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-2">
              <Briefcase className="w-8 h-8 text-slate-400 mx-auto" />
              <p className="text-sm font-semibold text-slate-800">
                Todavía no publicaste búsquedas laborales.
              </p>
            </div>
          ) : (
            myJobs.map((job) => {
              const applicants: any[] = job.applicants || [];
              const isExpanded = expandedJobId === job.id;

              return (
                <div
                  key={job.id}
                  className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                            job.status === 'active'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {job.status === 'active' ? 'Activa' : 'Pausada'}
                        </span>
                        <span className="text-xs text-slate-500">
                          {job.locality}, {job.district} · {job.industry}
                        </span>
                      </div>
                      <h3 className="text-lg font-bold text-slate-900">{job.title}</h3>
                      <p className="text-xs text-slate-600">{job.description}</p>
                    </div>

                    {/* Botones de gestión de la búsqueda */}
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setExpandedJobId(isExpanded ? null : job.id)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand-50 hover:bg-brand-100 text-brand-800 border border-brand-200 text-xs font-bold"
                      >
                        <Users className="w-4 h-4" />
                        <span>Postulantes anotados ({applicants.length})</span>
                      </button>

                      {job.status === 'active' ? (
                        <button
                          type="button"
                          onClick={() => handleJobAction(job.id, 'pause')}
                          className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-900 text-xs font-bold"
                        >
                          <PauseCircle className="w-4 h-4" />
                          <span>Pausar</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleJobAction(job.id, 'activate')}
                          className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-emerald-100 hover:bg-emerald-200 text-emerald-900 text-xs font-bold"
                        >
                          <PlayCircle className="w-4 h-4" />
                          <span>Reactivar</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => handleJobAction(job.id, 'delete')}
                        className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-rose-100 hover:bg-rose-200 text-rose-800 text-xs font-bold"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span>Eliminar</span>
                      </button>
                    </div>
                  </div>

                  {/* Listado desplegable de postulantes anotados en este aviso */}
                  {isExpanded && (
                    <div className="pt-3 border-t border-slate-200 space-y-3">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                        Postulantes anotados en "{job.title}"
                      </h4>

                      {applicants.length === 0 ? (
                        <p className="text-xs text-slate-500 py-2">
                          Aún no se postularon vecinos a este aviso.
                        </p>
                      ) : (
                        <div className="space-y-2.5">
                          {applicants.map((app) => (
                            <div
                              key={app.application_id}
                              className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                            >
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-sm text-slate-900">
                                    {app.first_name} {app.last_name}
                                  </span>
                                  <span
                                    className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                                      app.application_status === 'shortlisted'
                                        ? 'bg-emerald-100 text-emerald-800'
                                        : app.application_status === 'rejected'
                                        ? 'bg-rose-100 text-rose-800'
                                        : 'bg-blue-100 text-blue-800'
                                    }`}
                                  >
                                    {app.application_status === 'shortlisted'
                                      ? 'Confirmado / Preseleccionado'
                                      : app.application_status === 'rejected'
                                      ? 'Descartado'
                                      : 'Recibido'}
                                  </span>
                                </div>
                                <p className="text-xs text-slate-600">
                                  {app.locality} · {app.education_level} ·{' '}
                                  {(app.availability || []).join(', ')}
                                </p>
                                {app.bio_short && (
                                  <p className="text-xs text-slate-500">{app.bio_short}</p>
                                )}
                              </div>

                              <div className="flex flex-wrap items-center gap-2 shrink-0">
                                {app.cv_path && (
                                  <a
                                    href={app.cv_path}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                                  >
                                    <FileText className="w-3.5 h-3.5 text-brand-600" />
                                    <span>Ver CV</span>
                                  </a>
                                )}

                                {app.phone && (
                                  <a
                                    href={`https://wa.me/549${app.phone}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={() =>
                                      handleApplicationDecision(app.application_id, 'shortlisted')
                                    }
                                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
                                  >
                                    <MessageCircle className="w-3.5 h-3.5" />
                                    <span>Confirmar y WhatsApp</span>
                                  </a>
                                )}

                                {app.application_status !== 'rejected' && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleApplicationDecision(app.application_id, 'rejected')
                                    }
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold"
                                  >
                                    <XCircle className="w-3.5 h-3.5" />
                                    <span>Descartar</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
