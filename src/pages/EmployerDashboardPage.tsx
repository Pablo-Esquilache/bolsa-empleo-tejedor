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
  HelpCircle,
  Send,
  Filter,
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
import { compressImageToDataUrl } from '../lib/imageCompression';
import { buildWhatsAppUrl, notifyServerEvent } from '../lib/emailService';
import { IndustryItem } from '../types/database';

type AppTrackingStatus = 'received' | 'in_review' | 'shortlisted' | 'hired' | 'rejected';

const TRACKING_STATUS_OPTIONS: {
  id: AppTrackingStatus;
  label: string;
  badgeClass: string;
  activeBtnClass: string;
}[] = [
  {
    id: 'received',
    label: 'Recibida',
    badgeClass: 'bg-blue-100 text-blue-800',
    activeBtnClass: 'bg-blue-600 text-white border-blue-600',
  },
  {
    id: 'in_review',
    label: 'En revisión',
    badgeClass: 'bg-amber-100 text-amber-900',
    activeBtnClass: 'bg-amber-500 text-slate-950 border-amber-500',
  },
  {
    id: 'shortlisted',
    label: 'Preseleccionado',
    badgeClass: 'bg-purple-100 text-purple-800',
    activeBtnClass: 'bg-purple-600 text-white border-purple-600',
  },
  {
    id: 'hired',
    label: 'Confirmado / Contratado',
    badgeClass: 'bg-emerald-100 text-emerald-800',
    activeBtnClass: 'bg-emerald-600 text-white border-emerald-600',
  },
  {
    id: 'rejected',
    label: 'Descartado',
    badgeClass: 'bg-rose-100 text-rose-800',
    activeBtnClass: 'bg-rose-600 text-white border-rose-600',
  },
];

const TICKET_CATEGORIES = [
  'Pedir que agreguen un Rubro o Puesto',
  'Consulta sobre mi cuenta o una búsqueda',
  'Otra consulta / sugerencia',
];

export const EmployerDashboardPage: React.FC = () => {
  const { token, user } = useAuth();
  const navigate = useNavigate();

  const [tab, setTab] = useState<'my_jobs' | 'new_job' | 'profile' | 'admin_support'>('my_jobs');
  const [industriesCatalog, setIndustriesCatalog] = useState<IndustryItem[]>(INITIAL_INDUSTRIES);
  const [myJobs, setMyJobs] = useState<any[]>([]);

  // Filtros en Mis Búsquedas y Seguimiento
  const [selectedJobFilter, setSelectedJobFilter] = useState<string>('ALL');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('ALL');

  // Consultas al Administrador
  const [myTickets, setMyTickets] = useState<any[]>([]);
  const [ticketsPage, setTicketsPage] = useState(1);
  const [seenReplies, setSeenReplies] = useState<Record<string, string>>({});
  const [ticketCategory, setTicketCategory] = useState<string>(TICKET_CATEGORIES[0]);
  const [ticketMessage, setTicketMessage] = useState<string>('');
  const [sendingTicket, setSendingTicket] = useState(false);
  const [replyByTicket, setReplyByTicket] = useState<Record<string, string>>({});
  const [replyingTicketId, setReplyingTicketId] = useState<string | null>(null);

  // Datos del Comercio
  const [tradeName, setTradeName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [cuit, setCuit] = useState('');
  const [contactPersonName, setContactPersonName] = useState('');
  const [phone, setPhone] = useState('');
  const [industry, setIndustry] = useState('Comercio y Ventas');
  const [location, setLocation] = useState<LocationValue>({
    province: 'Buenos Aires',
    district: 'Carlos Tejedor',
    locality: 'Carlos Tejedor',
  });
  const [description, setDescription] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  // Nueva búsqueda laboral
  const [jobTitle, setJobTitle] = useState('');
  const [jobIndustry, setJobIndustry] = useState('Comercio y Ventas');
  const [jobPositionTag, setJobPositionTag] = useState('');
  const [jobOtherText, setJobOtherText] = useState('');
  const [jobLocation, setJobLocation] = useState<LocationValue>({
    province: 'Buenos Aires',
    district: 'Carlos Tejedor',
    locality: 'Carlos Tejedor',
  });
  const [jobAvailability, setJobAvailability] = useState<string[]>(['Tiempo completo']);
  const [jobEducation, setJobEducation] = useState<string>('Sin requisito excluyente');
  const [jobDescription, setJobDescription] = useState('');

  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadMyJobs = async (sessionToken: string) => {
    const { data } = await supabase.rpc('employer_get_my_jobs_with_applicants', {
      p_token: sessionToken,
    });
    if (Array.isArray(data)) {
      setMyJobs(data);
    }
  };

  const loadMyTickets = async (sessionToken: string) => {
    const { data } = await supabase.rpc('employer_get_my_tickets', {
      p_token: sessionToken,
    });
    if (Array.isArray(data)) {
      setMyTickets(data);
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
        const ep = data.profile;
        setTradeName(ep.trade_name || '');
        setLegalName(ep.legal_name || '');
        setCuit(ep.cuit || '');
        setIndustry(ep.industry || 'Comercio y Ventas');
        setLocation({
          province: ep.province || 'Buenos Aires',
          district: ep.district || 'Carlos Tejedor',
          locality: ep.locality || 'Carlos Tejedor',
        });
        setDescription(ep.description || '');
        setLogoUrl(ep.logo_url || null);
      } else {
        setTab('profile');
      }
      if (data?.private) {
        setContactPersonName(data.private.contact_person_name || '');
        setPhone(data.private.phone || '');
      }
    });

    loadMyJobs(token);
    loadMyTickets(token);
  }, [user, token, navigate]);

  // Cargar respuestas ya leídas por este comercio desde localStorage
  useEffect(() => {
    if (!user?.id) return;
    try {
      const raw = localStorage.getItem(`bolsa_empleo_seen_ticket_replies_${user.id}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          setSeenReplies(parsed);
        }
      }
    } catch {
      // ignore storage errors
    }
  }, [user?.id]);

  // Cuando el comercio abre la pestaña "Consultas al Administrador", marcar las respuestas actuales como leídas
  useEffect(() => {
    if (tab !== 'admin_support' || !user?.id || myTickets.length === 0) return;

    setSeenReplies((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const tk of myTickets) {
        if (tk.admin_reply) {
          const sig = `${tk.replied_at || ''}_${tk.admin_reply}`;
          if (next[tk.id] !== sig) {
            next[tk.id] = sig;
            changed = true;
          }
        }
      }
      if (changed) {
        try {
          localStorage.setItem(
            `bolsa_empleo_seen_ticket_replies_${user.id}`,
            JSON.stringify(next)
          );
        } catch {
          // ignore storage errors
        }
        return next;
      }
      return prev;
    });
  }, [tab, myTickets, user?.id]);

  // Actualizar automáticamente sin necesidad de apretar F5 al cambiar de pestaña, volver a la ventana o cada 12s
  useEffect(() => {
    if (!token) return;

    if (tab === 'admin_support') {
      loadMyTickets(token);
    } else if (tab === 'my_jobs') {
      loadMyJobs(token);
    }

    const refreshCurrentData = () => {
      if (document.visibilityState === 'visible') {
        loadMyTickets(token);
        loadMyJobs(token);
      }
    };

    window.addEventListener('focus', refreshCurrentData);
    document.addEventListener('visibilitychange', refreshCurrentData);

    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadMyTickets(token);
        if (tab === 'my_jobs') {
          loadMyJobs(token);
        }
      }
    }, 12_000);

    return () => {
      window.removeEventListener('focus', refreshCurrentData);
      document.removeEventListener('visibilitychange', refreshCurrentData);
      clearInterval(interval);
    };
  }, [token, tab]);

  const suggestedPositionsForJob =
    industriesCatalog.find((ind) => ind.name === jobIndustry)?.suggested_positions || [];

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploadingLogo(true);
    setMessage(null);

    try {
      const dataUrl = await compressImageToDataUrl(file, 384, 0.8);
      setLogoUrl(dataUrl);
      setMessage({ type: 'ok', text: 'Logo procesado. Guardá los datos del comercio para confirmar.' });
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
        text: 'Completá nombre comercial, persona de contacto, teléfono y elegí la localidad.',
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

      navigate('/postulantes');
    } catch (err: any) {
      setMessage({ type: 'err', text: err.message || 'Error al guardar el comercio.' });
    } finally {
      setSaving(false);
    }
  };

  const handlePublishJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    if (!jobTitle.trim() || !jobDescription.trim() || !jobLocation.locality) {
      setMessage({
        type: 'err',
        text: 'Completá el título de la búsqueda, la localidad y la descripción del puesto.',
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
    nextStatus: AppTrackingStatus
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

    notifyServerEvent({
      token,
      eventType: 'application_status_changed',
      targetId: applicationId,
    });

    await loadMyJobs(token);
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !ticketMessage.trim()) return;
    setSendingTicket(true);
    setMessage(null);

    try {
      const { data, error } = await supabase.rpc('employer_create_admin_ticket', {
        p_token: token,
        p_category: ticketCategory,
        p_message: ticketMessage.trim(),
      });

      if (error) throw new Error(error.message);

      if (data?.ticket_id) {
        notifyServerEvent({
          token,
          eventType: 'admin_ticket_created',
          targetId: data.ticket_id,
        });
      }

      setTicketMessage('');
      setMessage({
        type: 'ok',
        text: 'Tu consulta fue enviada al Administrador. Verás su respuesta aquí mismo.',
      });
      await loadMyTickets(token);
    } catch (err: any) {
      setMessage({ type: 'err', text: err.message || 'No se pudo enviar la consulta.' });
    } finally {
      setSendingTicket(false);
    }
  };

  const handleReplyTicket = async (ticketId: string) => {
    const replyText = (replyByTicket[ticketId] || '').trim();
    if (!token || !replyText) return;
    setReplyingTicketId(ticketId);
    setMessage(null);

    try {
      const { error } = await supabase.rpc('employer_reply_admin_ticket', {
        p_token: token,
        p_ticket_id: ticketId,
        p_message: replyText,
      });

      if (error) throw new Error(error.message);

      notifyServerEvent({
        token,
        eventType: 'admin_ticket_created',
        targetId: ticketId,
      });

      setReplyByTicket((prev) => ({ ...prev, [ticketId]: '' }));
      await loadMyTickets(token);
    } catch (err: any) {
      setMessage({ type: 'err', text: err.message || 'No se pudo enviar tu respuesta.' });
    } finally {
      setReplyingTicketId(null);
    }
  };

  const visibleJobs = myJobs.filter((job) =>
    selectedJobFilter === 'ALL' ? true : job.id === selectedJobFilter
  );

  const answeredTicketsCount = myTickets.filter(
    (t) => Boolean(t.admin_reply) && seenReplies[t.id] !== `${t.replied_at || ''}_${t.admin_reply}`
  ).length;
  const TICKETS_PER_PAGE = 5;
  const totalTicketPages = Math.max(1, Math.ceil(myTickets.length / TICKETS_PER_PAGE));
  const safeTicketsPage = Math.min(ticketsPage, totalTicketPages);
  const paginatedMyTickets = myTickets.slice(
    (safeTicketsPage - 1) * TICKETS_PER_PAGE,
    safeTicketsPage * TICKETS_PER_PAGE
  );

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Panel de Mi Comercio</h1>
        <p className="text-sm text-slate-600">
          Seguimiento de tus búsquedas laborales, postulantes recibidos y comunicación con el Administrador.
        </p>
      </div>

      {/* Pestañas */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
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
          <span>Mis Búsquedas y Seguimiento ({myJobs.length})</span>
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
          <span>Publicar Nueva Búsqueda</span>
        </button>

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
          onClick={() => setTab('admin_support')}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
            tab === 'admin_support'
              ? 'bg-slate-900 text-white'
              : 'bg-white text-slate-700 hover:bg-slate-200'
          }`}
        >
          <HelpCircle className="w-4 h-4" />
          <span>Consultas al Administrador</span>
          {answeredTicketsCount > 0 && (
            <span className="ml-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500 text-white">
              {answeredTicketsCount}
            </span>
          )}
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

      {tab === 'my_jobs' && (
        <div className="space-y-5">
          {myJobs.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-2.5 flex-1">
                <Filter className="w-4 h-4 text-brand-600 shrink-0" />
                <label className="text-xs font-bold uppercase text-slate-600 shrink-0">
                  Filtrar por búsqueda:
                </label>
                <select
                  value={selectedJobFilter}
                  onChange={(e) => setSelectedJobFilter(e.target.value)}
                  className="w-full sm:max-w-xs rounded-xl border border-slate-300 px-3 py-2 text-xs sm:text-sm font-semibold text-slate-800 bg-white focus:border-brand-600 focus:outline-none"
                >
                  <option value="ALL">Todas mis búsquedas ({myJobs.length})</option>
                  {myJobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.title} ({(j.applicants || []).length} postulantes)
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <label className="text-xs font-bold uppercase text-slate-600 shrink-0">
                  Estado de postulante:
                </label>
                <select
                  value={selectedStatusFilter}
                  onChange={(e) => setSelectedStatusFilter(e.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-xs sm:text-sm font-semibold text-slate-800 bg-white focus:border-brand-600 focus:outline-none"
                >
                  <option value="ALL">Todos los estados</option>
                  {TRACKING_STATUS_OPTIONS.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {myJobs.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-3">
              <Briefcase className="w-9 h-9 text-slate-400 mx-auto" />
              <p className="text-sm font-semibold text-slate-800">
                Todavía no publicaste búsquedas laborales.
              </p>
              <button
                type="button"
                onClick={() => setTab('new_job')}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-600 text-white text-xs font-bold"
              >
                <PlusCircle className="w-4 h-4" />
                <span>Publicar mi primera búsqueda</span>
              </button>
            </div>
          ) : (
            visibleJobs.map((job) => {
              const allApplicants: any[] = job.applicants || [];
              const applicants =
                selectedStatusFilter === 'ALL'
                  ? allApplicants
                  : allApplicants.filter(
                      (a) => (a.application_status || 'received') === selectedStatusFilter
                    );

              return (
                <div
                  key={job.id}
                  className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-5"
                >
                  {/* Encabezado del aviso con botones Pausar / Reactivar / Eliminar */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                            job.status === 'active'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {job.status === 'active' ? 'Búsqueda Activa' : 'Búsqueda Pausada'}
                        </span>
                        <span className="text-xs text-slate-500">
                          {job.locality}, {job.district} · {job.industry}
                        </span>
                      </div>
                      <h3 className="text-xl font-bold text-slate-900">{job.title}</h3>
                      <p className="text-xs text-slate-600">{job.description}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {job.status === 'active' ? (
                        <button
                          type="button"
                          onClick={() => handleJobAction(job.id, 'pause')}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-900 text-xs font-bold"
                        >
                          <PauseCircle className="w-4 h-4" />
                          <span>Pausar aviso</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleJobAction(job.id, 'activate')}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-100 hover:bg-emerald-200 text-emerald-900 text-xs font-bold"
                        >
                          <PlayCircle className="w-4 h-4" />
                          <span>Reactivar aviso</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => handleJobAction(job.id, 'delete')}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-100 hover:bg-rose-200 text-rose-800 text-xs font-bold"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span>Eliminar aviso</span>
                      </button>
                    </div>
                  </div>

                  {/* Seguimiento directo de postulantes con Scroll interno (2 a 3 tarjetas visibles) */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                        <Users className="w-4 h-4 text-brand-600" />
                        <span>
                          Postulantes en esta búsqueda ({applicants.length}
                          {selectedStatusFilter !== 'ALL' ? ` de ${allApplicants.length}` : ''})
                        </span>
                      </h4>
                      {applicants.length > 2 && (
                        <span className="text-[11px] font-medium text-slate-500">
                          Deslizá dentro del recuadro para ver más ↓
                        </span>
                      )}
                    </div>

                    {applicants.length === 0 ? (
                      <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-500">
                        {allApplicants.length === 0
                          ? 'Todavía no se postularon candidatos a este aviso. Cuando alguien se anote, aparecerá acá mismo para que le hagas el seguimiento.'
                          : 'No hay postulantes en este aviso con el estado filtrado.'}
                      </div>
                    ) : (
                      <div className="max-h-[430px] overflow-y-auto pr-1.5 space-y-3">
                        {applicants.map((app) => {
                          const currentStatus: AppTrackingStatus =
                            app.application_status || 'received';
                          const statusMeta =
                            TRACKING_STATUS_OPTIONS.find((s) => s.id === currentStatus) ||
                            TRACKING_STATUS_OPTIONS[0];

                          return (
                            <div
                              key={app.application_id}
                              className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3"
                            >
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-base text-slate-900">
                                      {app.first_name} {app.last_name}
                                    </span>
                                    <span
                                      className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${statusMeta.badgeClass}`}
                                    >
                                      Estado: {statusMeta.label}
                                    </span>
                                  </div>
                                  <p className="text-xs text-slate-600 mt-0.5">
                                    {app.locality}, {app.district} · {app.education_level} ·{' '}
                                    {(app.availability || []).join(', ')}
                                  </p>
                                  {app.bio_short && (
                                    <p className="text-xs text-slate-500 mt-1">{app.bio_short}</p>
                                  )}
                                </div>

                                {/* Botones de CV y WhatsApp directo */}
                                <div className="flex flex-wrap items-center gap-2 shrink-0">
                                  {app.cv_path && (
                                    <a
                                      href={app.cv_path}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-xs font-semibold text-slate-800 hover:bg-slate-100"
                                    >
                                      <FileText className="w-3.5 h-3.5 text-brand-600" />
                                      <span>Ver CV PDF</span>
                                    </a>
                                  )}

                                  {app.phone && (
                                    <a
                                      href={buildWhatsAppUrl(app.phone)}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
                                    >
                                      <MessageCircle className="w-3.5 h-3.5" />
                                      <span>WhatsApp ({app.phone})</span>
                                    </a>
                                  )}
                                </div>
                              </div>

                              {/* Botonera de los 5 estados de seguimiento */}
                              <div className="pt-2 border-t border-slate-200/80 flex flex-wrap items-center gap-1.5">
                                <span className="text-[11px] font-bold uppercase text-slate-500 mr-1">
                                  Cambiar seguimiento:
                                </span>
                                {TRACKING_STATUS_OPTIONS.map((opt) => {
                                  const isSelected = currentStatus === opt.id;
                                  return (
                                    <button
                                      key={opt.id}
                                      type="button"
                                      onClick={() =>
                                        handleApplicationDecision(app.application_id, opt.id)
                                      }
                                      className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-all ${
                                        isSelected
                                          ? opt.activeBtnClass
                                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                                      }`}
                                    >
                                      {opt.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
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
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Ej.: 2355 445566"
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

      {tab === 'admin_support' && (
        <div className="space-y-6">
          <form
            onSubmit={handleCreateTicket}
            className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4"
          >
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Enviar consulta o pedido al Administrador
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Escribinos si necesitás que sumemos un rubro, oficio o puesto nuevo al catálogo, o por cualquier consulta sobre tus búsquedas.
              </p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                Motivo de la consulta
              </label>
              <select
                value={ticketCategory}
                onChange={(e) => setTicketCategory(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm bg-white focus:border-brand-600 focus:outline-none"
              >
                {TICKET_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                Tu mensaje para el Administrador *
              </label>
              <textarea
                rows={4}
                required
                value={ticketMessage}
                onChange={(e) => setTicketMessage(e.target.value)}
                placeholder="Ej.: Hola, ¿podrían agregar el puesto de Chapista / Pintor dentro del rubro Automotor?"
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-brand-600 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={sendingTicket || !ticketMessage.trim()}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-bold shadow-sm transition-colors"
            >
              <Send className="w-4 h-4" />
              <span>{sendingTicket ? 'Enviando...' : 'Enviar consulta al Administrador'}</span>
            </button>
          </form>

          {/* Historial de consultas del comercio */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
            <h3 className="text-base font-bold text-slate-900">
              Mis consultas enviadas ({myTickets.length})
            </h3>

            {myTickets.length === 0 ? (
              <p className="text-xs text-slate-500">
                Todavía no enviaste consultas al Administrador.
              </p>
            ) : (
              <div className="space-y-3">
                {paginatedMyTickets.map((tk) => (
                  <div
                    key={tk.id}
                    className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-800">{tk.category}</span>
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                          tk.status === 'resolved'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {tk.status === 'resolved' ? 'Respondida / Resuelta' : 'Pendiente de revisión'}
                      </span>
                    </div>

                    {/* Hilo de mensajes entre el Comercio y el Administrador */}
                    <div className="space-y-2">
                      {Array.isArray(tk.messages) && tk.messages.length > 0 ? (
                        tk.messages.map((msg: any, idx: number) =>
                          msg.sender === 'admin' ? (
                            <div
                              key={idx}
                              className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-950 space-y-1"
                            >
                              <p className="font-bold text-emerald-800">Respuesta del Administrador:</p>
                              <p className="whitespace-pre-line text-sm">{msg.text}</p>
                            </div>
                          ) : (
                            <div
                              key={idx}
                              className="p-3 rounded-xl bg-white border border-slate-200 text-xs text-slate-800 space-y-1"
                            >
                              <p className="font-bold text-slate-600">Tu mensaje:</p>
                              <p className="whitespace-pre-line text-sm">{msg.text}</p>
                            </div>
                          )
                        )
                      ) : (
                        <>
                          <p className="text-sm text-slate-800 whitespace-pre-line">{tk.message}</p>
                          {tk.admin_reply && (
                            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-950 space-y-1">
                              <p className="font-bold text-emerald-800">Respuesta del Administrador:</p>
                              <p className="whitespace-pre-line text-sm">{tk.admin_reply}</p>
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {tk.status !== 'resolved' && (
                      <div className="flex flex-col sm:flex-row gap-2 pt-1">
                        <input
                          type="text"
                          value={replyByTicket[tk.id] || ''}
                          onChange={(e) =>
                            setReplyByTicket((prev) => ({ ...prev, [tk.id]: e.target.value }))
                          }
                          placeholder="Responder o agregar detalle para el Administrador..."
                          className="flex-1 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs sm:text-sm focus:border-brand-600 focus:outline-none"
                        />
                        <button
                          type="button"
                          disabled={
                            replyingTicketId === tk.id || !(replyByTicket[tk.id] || '').trim()
                          }
                          onClick={() => handleReplyTicket(tk.id)}
                          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-xs font-bold shrink-0"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>
                            {replyingTicketId === tk.id ? 'Enviando...' : 'Responder'}
                          </span>
                        </button>
                      </div>
                    )}
                  </div>
                ))}

                {totalTicketPages > 1 && (
                  <div className="pt-2 flex items-center justify-between gap-3">
                    <button
                      type="button"
                      disabled={safeTicketsPage <= 1}
                      onClick={() => setTicketsPage((p) => Math.max(1, p - 1))}
                      className="px-3.5 py-1.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                    >
                      ← Anterior
                    </button>
                    <span className="text-xs font-semibold text-slate-600">
                      Página {safeTicketsPage} de {totalTicketPages} ({myTickets.length} consultas)
                    </span>
                    <button
                      type="button"
                      disabled={safeTicketsPage >= totalTicketPages}
                      onClick={() => setTicketsPage((p) => Math.min(totalTicketPages, p + 1))}
                      className="px-3.5 py-1.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                    >
                      Siguiente →
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
