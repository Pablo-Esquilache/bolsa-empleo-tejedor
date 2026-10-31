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

  // Mis búsquedas
  const [myJobs, setMyJobs] = useState<any[]>([]);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadMyJobs = async (uid: string) => {
    const { data } = await supabase
      .from('job_posts')
      .select('*')
      .eq('employer_id', uid)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (data) setMyJobs(data);
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

    supabase
      .from('employer_profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setTradeName(data.trade_name || '');
          setLegalName(data.legal_name || '');
          setCuit(data.cuit || '');
          setIndustry(data.industry || INITIAL_INDUSTRIES[0].name);
          setLocation({
            province: data.province || 'Buenos Aires',
            district: data.district || 'Carlos Tejedor',
            locality: data.locality || 'Carlos Tejedor',
          });
          setJobLocation({
            province: data.province || 'Buenos Aires',
            district: data.district || 'Carlos Tejedor',
            locality: data.locality || 'Carlos Tejedor',
          });
          setDescription(data.description || '');
          setLogoUrl(data.logo_url || null);
        }
      });

    loadMyJobs(user.id);
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
      setMessage({
        type: 'ok',
        text: `Logo comprimido a WebP (${Math.round(compressed.size / 1024)} KB) y subido con éxito.`,
      });
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

      setMessage({
        type: 'ok',
        text: '¡Ficha de tu comercio guardada! Ya podés publicar búsquedas laborales o contactar postulantes.',
      });
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

      setJobTitle('');
      setJobDescription('');
      await loadMyJobs(user.id);
      setTab('my_jobs');
      setMessage({
        type: 'ok',
        text: '¡Búsqueda laboral publicada y activa en el directorio!',
      });
    } catch (err: any) {
      setMessage({ type: 'err', text: err.message || 'Error al publicar la búsqueda.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Panel de Mi Comercio</h1>
        <p className="text-sm text-slate-600">
          Gestioná los datos de tu comercio y publicá búsquedas laborales al instante.
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

            <div className="space-y-1.5">
              <label className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs sm:text-sm font-semibold cursor-pointer transition-colors">
                <Camera className="w-4 h-4" />
                <span>{uploadingLogo ? 'Comprimiendo...' : 'Subir Logo del Comercio'}</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleLogoUpload}
                  className="hidden"
                />
              </label>
              <p className="text-xs text-slate-500">
                Se comprime automáticamente a WebP liviano antes de subir.
              </p>
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
            <span>{saving ? 'Guardando...' : 'Guardar Ficha del Comercio'}</span>
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
            <span>{saving ? 'Publicando...' : 'Publicar Búsqueda Ahora'}</span>
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
            myJobs.map((job) => (
              <div
                key={job.id}
                className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                      {job.status === 'active' ? 'Activa' : 'Pausada'}
                    </span>
                    <span className="text-xs text-slate-500">
                      {job.locality}, {job.district}
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-slate-900">{job.title}</h3>
                  <p className="text-xs text-slate-600 line-clamp-2">{job.description}</p>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
