import React, { useEffect, useState } from 'react';
import {
  Users,
  Building2,
  Briefcase,
  PauseCircle,
  Tags,
  Plus,
  Search,
  MapPin,
  FileText,
  MessageCircle,
  Trash2,
  PlayCircle,
  X,
  KeyRound,
  Mail,
  RotateCcw,
  HelpCircle,
  Send,
  CheckCircle2,
  SlidersHorizontal,
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
import {
  buildWhatsAppUrl,
  normalizeSearchText,
  notifyServerEvent,
  requestServerOtp,
} from '../lib/emailService';
import { IndustryItem } from '../types/database';

export const AdminDashboardPage: React.FC = () => {
  const { token, user, setSession } = useAuth();

  // Estado de login de Administrador si no está logueado
  const [adminEmail, setAdminEmail] = useState('pabloesquilache@gmail.com');
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Datos del tablero
  const [activeTab, setActiveTab] = useState<
    'candidates' | 'employers' | 'jobs' | 'industries' | 'tickets'
  >('candidates');
  const [candidates, setCandidates] = useState<any[]>([]);
  const [employers, setEmployers] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [tickets, setTickets] = useState<any[]>([]);
  const [replyByTicket, setReplyByTicket] = useState<Record<string, string>>({});
  const [replyingTicketId, setReplyingTicketId] = useState<string | null>(null);
  const [industriesCatalog, setIndustriesCatalog] = useState<IndustryItem[]>(INITIAL_INDUSTRIES);
  const [loadingData, setLoadingData] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  // Filtros compartidos del Administrador
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

  // Pop-up de detalle
  const [detailModal, setDetailModal] = useState<{
    type: 'candidate' | 'employer' | 'job';
    item: any;
  } | null>(null);

  // Nuevo rubro / puestos y suma rápida de puesto en cada tarjeta
  const [newIndustryName, setNewIndustryName] = useState('');
  const [newIndustryPositions, setNewIndustryPositions] = useState('');
  const [quickPosByInd, setQuickPosByInd] = useState<Record<string, string>>({});

  const isAdmin =
    Boolean(token && user) &&
    (user?.role === 'admin' || user?.email.toLowerCase() === 'pabloesquilache@gmail.com');

  const fetchAdminData = async (currentToken: string) => {
    setLoadingData(true);
    try {
      const { data: indData } = await supabase
        .from('industries')
        .select('*')
        .order('sort_order', { ascending: true });
      if (indData && indData.length > 0) setIndustriesCatalog(indData as IndustryItem[]);

      const { data, error } = await supabase.rpc('admin_get_full_dashboard', {
        p_token: currentToken,
      });

      if (!error && data) {
        setCandidates(data.candidates || []);
        setEmployers(data.employers || []);
        setJobs(data.jobs || []);
        setTickets(data.tickets || []);
      }
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    if (isAdmin && token) {
      fetchAdminData(token);
    }
  }, [isAdmin, token]);

  const resetFilters = () => {
    setSearchQuery('');
    setLocationFilter({ province: '', district: '', locality: '' });
    setSelectedSituations([]);
    setSelectedIndustries([]);
    setSelectedAvailability([]);
    setSelectedEducation([]);
  };

  const handleAdminSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);

    try {
      const res = await requestServerOtp(adminEmail.trim().toLowerCase(), 'admin');
      if (!res.ok) {
        throw new Error(res.error || 'No se pudo enviar el código.');
      }
      setOtpSent(true);
    } catch (err: any) {
      setAuthError(err.message || 'Error al generar código.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleAdminVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);

    try {
      const { data, error } = await supabase.rpc('verify_otp_code', {
        p_email: adminEmail.trim().toLowerCase(),
        p_code: otpCode.trim(),
        p_role: 'admin',
      });
      if (error) throw new Error(error.message);
      setSession(data.token, data.user);
    } catch (err: any) {
      setAuthError(err.message || 'Código inválido.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleModerate = async (
    targetType: 'profile' | 'job',
    targetId: string,
    action: 'pause' | 'activate' | 'delete'
  ) => {
    if (!token) return;
    if (action === 'delete' && !window.confirm('¿Seguro que querés eliminar este registro?')) {
      return;
    }

    const { error } = await supabase.rpc('admin_moderate_item', {
      p_token: token,
      p_target_type: targetType,
      p_target_id: targetId,
      p_action: action,
    });

    if (error) {
      alert(error.message);
      return;
    }

    setDetailModal(null);
    await fetchAdminData(token);
  };

  const handleReplyTicket = async (
    ticketId: string,
    replyText: string,
    nextStatus: 'pending' | 'resolved'
  ) => {
    if (!token) return;
    setReplyingTicketId(ticketId);
    try {
      const { error } = await supabase.rpc('admin_reply_ticket', {
        p_token: token,
        p_ticket_id: ticketId,
        p_reply: replyText,
        p_status: nextStatus,
      });
      if (error) throw new Error(error.message);

      if (replyText.trim()) {
        notifyServerEvent({
          token,
          eventType: 'admin_ticket_replied',
          targetId: ticketId,
        });
      }

      setReplyByTicket((prev) => ({ ...prev, [ticketId]: '' }));
      await fetchAdminData(token);
    } catch (err: any) {
      alert(err.message || 'No se pudo guardar la respuesta.');
    } finally {
      setReplyingTicketId(null);
    }
  };

  const handleSaveIndustry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !newIndustryName.trim()) return;

    const positionsArray = newIndustryPositions
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const { error } = await supabase.rpc('admin_upsert_industry', {
      p_token: token,
      p_name: newIndustryName.trim(),
      p_positions: positionsArray,
    });

    if (error) {
      alert(error.message);
      return;
    }

    setNewIndustryName('');
    setNewIndustryPositions('');
    await fetchAdminData(token);
  };

  const handleAddPositionToIndustry = async (ind: IndustryItem) => {
    const newPos = (quickPosByInd[ind.id] || '').trim();
    if (!token || !newPos) return;

    const updatedPositions = Array.from(new Set([...(ind.suggested_positions || []), newPos]));
    const { error } = await supabase.rpc('admin_upsert_industry', {
      p_token: token,
      p_name: ind.name,
      p_positions: updatedPositions,
    });

    if (error) {
      alert(error.message);
      return;
    }

    setQuickPosByInd((prev) => ({ ...prev, [ind.id]: '' }));
    await fetchAdminData(token);
  };

  const handleRemovePositionFromIndustry = async (ind: IndustryItem, posToRemove: string) => {
    if (!token) return;
    const updatedPositions = (ind.suggested_positions || []).filter((p) => p !== posToRemove);
    const { error } = await supabase.rpc('admin_upsert_industry', {
      p_token: token,
      p_name: ind.name,
      p_positions: updatedPositions,
    });
    if (!error) {
      await fetchAdminData(token);
    }
  };

  const handleDeleteIndustry = async (indId: string) => {
    if (!token || !window.confirm('¿Seguro que querés eliminar este rubro?')) return;
    const { error } = await supabase.rpc('admin_delete_industry', {
      p_token: token,
      p_industry_id: indId,
    });
    if (!error) {
      await fetchAdminData(token);
    }
  };

  if (!isAdmin) {
    return (
      <div className="max-w-md mx-auto py-12">
        <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-5">
          <div className="text-center space-y-1">
            <h2 className="text-xl font-bold text-slate-900">Acceso Administrador</h2>
            <p className="text-xs text-slate-500">
              Ingresá con tu correo de administrador y el código de 6 dígitos enviado a tu email.
            </p>
          </div>

          {authError && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">
              {authError}
            </div>
          )}

          {!otpSent ? (
            <form onSubmit={handleAdminSendOtp} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Email de Administrador
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                  <input
                    type="email"
                    required
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 text-sm"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={authLoading}
                className="w-full py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold"
              >
                {authLoading ? 'Enviando código...' : 'Enviar código de 6 dígitos'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleAdminVerifyOtp} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Código de 6 dígitos
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    required
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 text-lg font-bold tracking-widest"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={authLoading || otpCode.length !== 6}
                className="w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-sm font-bold"
              >
                {authLoading ? 'Verificando...' : 'Entrar al Panel /admin'}
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  // Filtrado de Postulantes en /admin
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
      const text = normalizeSearchText(
        `${cand.first_name} ${cand.last_name} ${cand.email} ${cand.phone} ${(
          cand.positions || []
        ).join(' ')}`
      );
      if (!text.includes(q)) return false;
    }
    return true;
  });

  // Filtrado de Comercios en /admin
  const filteredEmployers = employers.filter((emp) => {
    if (locationFilter.province && emp.province !== locationFilter.province) return false;
    if (locationFilter.district && emp.district !== locationFilter.district) return false;
    if (locationFilter.locality && emp.locality !== locationFilter.locality) return false;
    if (selectedIndustries.length > 0 && !selectedIndustries.includes(emp.industry)) return false;

    if (searchQuery.trim()) {
      const q = normalizeSearchText(searchQuery);
      const text = normalizeSearchText(
        `${emp.trade_name} ${emp.legal_name || ''} ${emp.contact_person_name || ''} ${
          emp.email || ''
        }`
      );
      if (!text.includes(q)) return false;
    }
    return true;
  });

  // Filtrado de Búsquedas en /admin
  const filteredJobs = jobs.filter((job) => {
    if (locationFilter.province && job.province !== locationFilter.province) return false;
    if (locationFilter.district && job.district !== locationFilter.district) return false;
    if (locationFilter.locality && job.locality !== locationFilter.locality) return false;
    if (selectedIndustries.length > 0 && !selectedIndustries.includes(job.industry)) return false;

    if (searchQuery.trim()) {
      const q = normalizeSearchText(searchQuery);
      const text = normalizeSearchText(`${job.title} ${job.trade_name} ${job.description}`);
      if (!text.includes(q)) return false;
    }
    return true;
  });

  const pausedCount =
    candidates.filter((c) => c.account_status === 'paused').length +
    employers.filter((e) => e.account_status === 'paused').length +
    jobs.filter((j) => j.status === 'paused').length;

  const pendingTicketsCount = tickets.filter((tk) => tk.status === 'pending').length;

  const customOtherSuggestions = Array.from(
    new Set(
      [
        ...candidates.map((c) => c.custom_other_text),
        ...jobs.map((j) => j.custom_other_text),
      ]
        .map((s) => (s || '').trim())
        .filter(Boolean)
    )
  );

  return (
    <div className="space-y-6">
      {/* 1. Tarjetas de Resumen Superior */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">Postulantes Inscritos</p>
            <p className="text-2xl font-extrabold text-slate-900 mt-1">{candidates.length}</p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-brand-100 text-brand-700 flex items-center justify-center">
            <Users className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">Comercios Inscritos</p>
            <p className="text-2xl font-extrabold text-slate-900 mt-1">{employers.length}</p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
            <Building2 className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">Búsquedas Activas</p>
            <p className="text-2xl font-extrabold text-emerald-700 mt-1">
              {jobs.filter((j) => j.status === 'active').length}
            </p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
            <Briefcase className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">Pausados / Moderados</p>
            <p className="text-2xl font-extrabold text-rose-700 mt-1">{pausedCount}</p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center">
            <PauseCircle className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* 2. Pestañas del Administrador */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        <button
          type="button"
          onClick={() => setActiveTab('candidates')}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
            activeTab === 'candidates'
              ? 'bg-slate-900 text-white'
              : 'bg-white text-slate-700 hover:bg-slate-200'
          }`}
        >
          Postulantes Inscritos ({filteredCandidates.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('employers')}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
            activeTab === 'employers'
              ? 'bg-slate-900 text-white'
              : 'bg-white text-slate-700 hover:bg-slate-200'
          }`}
        >
          Comercios Inscritos ({filteredEmployers.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('jobs')}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
            activeTab === 'jobs'
              ? 'bg-slate-900 text-white'
              : 'bg-white text-slate-700 hover:bg-slate-200'
          }`}
        >
          Búsquedas Laborales ({filteredJobs.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('industries')}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
            activeTab === 'industries'
              ? 'bg-amber-500 text-slate-950'
              : 'bg-white text-slate-700 hover:bg-slate-200'
          }`}
        >
          <Tags className="w-4 h-4" />
          <span>Rubros y Actividades ({industriesCatalog.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('tickets')}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
            activeTab === 'tickets'
              ? 'bg-brand-600 text-white'
              : 'bg-white text-slate-700 hover:bg-slate-200'
          }`}
        >
          <HelpCircle className="w-4 h-4" />
          <span>Consultas de Comercios ({tickets.length})</span>
          {pendingTicketsCount > 0 && (
            <span className="ml-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-600 text-white">
              {pendingTicketsCount}
            </span>
          )}
        </button>
      </div>

      {activeTab === 'tickets' ? (
        /* Pestaña de Consultas y Pedidos enviados por los Comercios */
        <div className="space-y-4">
          {tickets.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500">
              Todavía no hay consultas ni pedidos de rubros/puestos enviados por los comercios.
            </div>
          ) : (
            tickets.map((tk) => (
              <div
                key={tk.id}
                className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                          tk.status === 'resolved'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-900'
                        }`}
                      >
                        {tk.status === 'resolved' ? 'Resuelta' : 'Pendiente de respuesta'}
                      </span>
                      <span className="text-xs font-bold text-brand-700">{tk.category}</span>
                    </div>
                    <h3 className="text-base font-bold text-slate-900 mt-1">
                      {tk.trade_name}{' '}
                      {tk.contact_person_name ? `· (${tk.contact_person_name})` : ''}
                    </h3>
                    <p className="text-xs text-slate-500">
                      {tk.locality ? `${tk.locality}, ${tk.district} · ` : ''}
                      {tk.employer_email}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {tk.employer_phone && (
                      <a
                        href={buildWhatsAppUrl(tk.employer_phone)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
                      >
                        <MessageCircle className="w-4 h-4" />
                        <span>Responder por WhatsApp</span>
                      </a>
                    )}

                    <button
                      type="button"
                      onClick={() =>
                        handleReplyTicket(
                          tk.id,
                          tk.admin_reply || '',
                          tk.status === 'resolved' ? 'pending' : 'resolved'
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>
                        {tk.status === 'resolved' ? 'Reabrir como Pendiente' : 'Marcar Resuelta'}
                      </span>
                    </button>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-800 whitespace-pre-line">
                  {tk.message}
                </div>

                {tk.admin_reply && (
                  <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-950 space-y-1">
                    <p className="font-bold text-emerald-800">Tu respuesta enviada:</p>
                    <p className="text-sm whitespace-pre-line">{tk.admin_reply}</p>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-2 pt-1">
                  <input
                    type="text"
                    value={replyByTicket[tk.id] || ''}
                    onChange={(e) =>
                      setReplyByTicket((prev) => ({ ...prev, [tk.id]: e.target.value }))
                    }
                    placeholder="Escribir respuesta para que el comercio la vea en su panel y por correo..."
                    className="flex-1 rounded-xl border border-slate-300 px-3.5 py-2 text-xs sm:text-sm focus:border-brand-600 focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={
                      replyingTicketId === tk.id || !(replyByTicket[tk.id] || '').trim()
                    }
                    onClick={() =>
                      handleReplyTicket(tk.id, replyByTicket[tk.id] || '', 'resolved')
                    }
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-xs font-bold shrink-0"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>
                      {replyingTicketId === tk.id ? 'Enviando...' : 'Responder al Comercio'}
                    </span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      ) : activeTab === 'industries' ? (
        /* Pestaña Gestor de Rubros y Actividades */
        <div className="space-y-6">
          {customOtherSuggestions.length > 0 && (
            <div className="bg-amber-50 rounded-2xl border border-amber-200 p-4 space-y-2">
              <p className="text-xs font-bold uppercase tracking-wider text-amber-900">
                Sugerencias escritas por usuarios en el botón "Otro":
              </p>
              <div className="flex flex-wrap gap-2">
                {customOtherSuggestions.map((sug) => (
                  <span
                    key={sug}
                    className="px-3 py-1 rounded-full bg-white border border-amber-300 text-xs font-semibold text-amber-950"
                  >
                    {sug}
                  </span>
                ))}
              </div>
            </div>
          )}

          <form
            onSubmit={handleSaveIndustry}
            className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4"
          >
            <h2 className="text-lg font-bold text-slate-900">
              Crear Nuevo Rubro con Puestos Sugeridos
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nombre del Rubro *
                </label>
                <input
                  type="text"
                  required
                  value={newIndustryName}
                  onChange={(e) => setNewIndustryName(e.target.value)}
                  placeholder="Ej.: Metalúrgica y Talleres"
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Puestos sugeridos (separados por coma)
                </label>
                <input
                  type="text"
                  value={newIndustryPositions}
                  onChange={(e) => setNewIndustryPositions(e.target.value)}
                  placeholder="Ej.: Tornero, Soldador, Ayudante de taller"
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm"
                />
              </div>
            </div>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold"
            >
              <Plus className="w-4 h-4" />
              <span>Guardar Nuevo Rubro</span>
            </button>
          </form>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {industriesCatalog.map((ind) => (
              <div
                key={ind.id}
                className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3 flex flex-col justify-between"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-bold text-slate-900 text-sm">{ind.name}</h3>
                    <button
                      type="button"
                      onClick={() => handleDeleteIndustry(ind.id)}
                      className="text-xs text-rose-600 hover:underline font-semibold"
                    >
                      Eliminar rubro
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {(ind.suggested_positions || []).map((pos) => (
                      <span
                        key={pos}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 text-xs text-slate-700"
                      >
                        <span>{pos}</span>
                        <button
                          type="button"
                          onClick={() => handleRemovePositionFromIndustry(ind, pos)}
                          className="text-slate-400 hover:text-rose-600 font-bold ml-1"
                          title="Quitar puesto"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100 flex items-center gap-2">
                  <input
                    type="text"
                    value={quickPosByInd[ind.id] || ''}
                    onChange={(e) =>
                      setQuickPosByInd((prev) => ({ ...prev, [ind.id]: e.target.value }))
                    }
                    placeholder="Agregar oficio/puesto a este rubro..."
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:border-brand-600 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleAddPositionToIndustry(ind)}
                    className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shrink-0"
                  >
                    + Sumar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* Diseño 20%-25% Filtros a la izquierda / 75%-80% Tarjetas una debajo de la otra a la derecha */
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

          {/* Columna Izquierda (Filtros del Administrador) */}
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
                placeholder="Buscar nombre, teléfono, mail..."
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
              label="Rubro"
              options={industriesCatalog.map((i) => i.name)}
              selected={selectedIndustries}
              onChange={setSelectedIndustries}
            />

            {activeTab === 'candidates' && (
              <>
                <ChipSelector
                  label="Situación Laboral"
                  options={WORK_SITUATIONS.map((w) => w.label)}
                  selected={selectedSituations}
                  onChange={setSelectedSituations}
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
              </>
            )}
          </aside>

          {/* Columna Derecha (Tarjetas una debajo de la otra) */}
          <div className="w-full lg:w-[76%] space-y-3">
            {loadingData ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500">
                Cargando base de datos...
              </div>
            ) : activeTab === 'candidates' ? (
              filteredCandidates.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500">
                  No se encontraron postulantes con estos filtros.
                </div>
              ) : (
                filteredCandidates.map((cand) => (
                  <div
                    key={cand.id}
                    onClick={() => setDetailModal({ type: 'candidate', item: cand })}
                    className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:border-brand-500 cursor-pointer transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                            cand.account_status === 'active'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {cand.account_status === 'active' ? 'Activo' : 'Pausado'}
                        </span>
                        <h3 className="font-bold text-base text-slate-900">
                          {cand.first_name} {cand.last_name}
                        </h3>
                        <span className="text-xs text-slate-500">({cand.email})</span>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {(cand.industries || []).map((ind: string) => (
                          <span
                            key={ind}
                            className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-xs"
                          >
                            {ind}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="flex sm:flex-col items-start sm:items-end justify-between gap-2 shrink-0 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1 font-medium text-slate-700">
                        <MapPin className="w-3.5 h-3.5 text-brand-600" />
                        {cand.locality}, {cand.district}
                      </span>
                      <div className="flex items-center gap-2">
                        {(cand.safe_cv_path || cand.cv_path) && (
                          <span className="text-xs font-semibold text-brand-700 inline-flex items-center gap-1">
                            <FileText className="w-3.5 h-3.5" /> Con CV
                          </span>
                        )}
                        <span className="px-3 py-1 rounded-xl bg-slate-100 text-slate-900 font-bold">
                          Abrir ficha →
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              )
            ) : activeTab === 'employers' ? (
              filteredEmployers.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500">
                  No se encontraron comercios con estos filtros.
                </div>
              ) : (
                filteredEmployers.map((emp) => (
                  <div
                    key={emp.id}
                    onClick={() => setDetailModal({ type: 'employer', item: emp })}
                    className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:border-brand-500 cursor-pointer transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                            emp.account_status === 'active'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {emp.account_status === 'active' ? 'Activo' : 'Pausado'}
                        </span>
                        <h3 className="font-bold text-base text-slate-900">{emp.trade_name}</h3>
                      </div>
                      <p className="text-xs text-slate-600">
                        {emp.industry} · Responsable: {emp.contact_person_name || 'S/D'}
                      </p>
                    </div>

                    <div className="flex sm:flex-col items-start sm:items-end justify-between gap-2 shrink-0 text-xs text-slate-500">
                      <span>
                        {emp.locality}, {emp.district}
                      </span>
                      <span className="px-3 py-1 rounded-xl bg-slate-100 text-slate-900 font-bold">
                        {emp.jobs_count || 0} búsquedas · Ver →
                      </span>
                    </div>
                  </div>
                ))
              )
            ) : filteredJobs.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500">
                No se encontraron búsquedas con estos filtros.
              </div>
            ) : (
              filteredJobs.map((job) => (
                <div
                  key={job.id}
                  onClick={() => setDetailModal({ type: 'job', item: job })}
                  className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:border-brand-500 cursor-pointer transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                          job.status === 'active'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {job.status === 'active' ? 'Activa' : 'Pausada'}
                      </span>
                      <span className="text-xs font-semibold text-slate-600">{job.trade_name}</span>
                    </div>
                    <h3 className="font-bold text-base text-slate-900">{job.title}</h3>
                    <p className="text-xs text-slate-500">{job.industry}</p>
                  </div>

                  <div className="flex sm:flex-col items-start sm:items-end justify-between gap-2 shrink-0 text-xs text-slate-500">
                    <span>
                      {job.locality}, {job.district}
                    </span>
                    <span className="px-3 py-1 rounded-xl bg-slate-100 text-slate-900 font-bold">
                      Moderar aviso →
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 5. Pop-up (Modal) de Detalle y Moderación para Postulante, Comercio o Búsqueda */}
      {detailModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-xl font-bold text-slate-900">
                {detailModal.type === 'candidate'
                  ? `${detailModal.item.first_name} ${detailModal.item.last_name}`
                  : detailModal.type === 'employer'
                  ? detailModal.item.trade_name
                  : detailModal.item.title}
              </h2>
              <button
                type="button"
                onClick={() => setDetailModal(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 text-sm text-slate-700 bg-slate-50 p-4 rounded-xl border border-slate-200">
              <p>
                <strong>Ubicación:</strong> {detailModal.item.locality},{' '}
                {detailModal.item.district} ({detailModal.item.province})
              </p>
              {detailModal.item.email && (
                <p>
                  <strong>Email:</strong> {detailModal.item.email}
                </p>
              )}
              {(detailModal.item.phone || detailModal.item.employer_phone) && (
                <p>
                  <strong>Teléfono:</strong>{' '}
                  {detailModal.item.phone || detailModal.item.employer_phone}
                </p>
              )}
              {detailModal.item.contact_person_name && (
                <p>
                  <strong>Responsable:</strong> {detailModal.item.contact_person_name}
                </p>
              )}
              {detailModal.item.education_level && (
                <p>
                  <strong>Formación:</strong> {detailModal.item.education_level}
                </p>
              )}
              {detailModal.item.custom_other_text && (
                <p className="text-amber-800 font-semibold">
                  <strong>Opción "Otro" escrita:</strong> {detailModal.item.custom_other_text}
                </p>
              )}
              {(detailModal.item.bio_short || detailModal.item.description) && (
                <p className="pt-2 whitespace-pre-line">
                  {detailModal.item.bio_short || detailModal.item.description}
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {(detailModal.item.safe_cv_path || detailModal.item.cv_path) && (
                <a
                  href={detailModal.item.safe_cv_path || detailModal.item.cv_path}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-50 text-brand-800 font-semibold text-xs border border-brand-200"
                >
                  <FileText className="w-4 h-4" />
                  <span>Abrir CV en PDF</span>
                </a>
              )}

              {(detailModal.item.phone || detailModal.item.employer_phone) && (
                <a
                  href={buildWhatsAppUrl(
                    detailModal.item.phone || detailModal.item.employer_phone
                  )}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white font-semibold text-xs"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span>Contactar por WhatsApp</span>
                </a>
              )}
            </div>

            <div className="pt-3 border-t border-slate-200 flex items-center justify-between gap-2">
              {detailModal.type === 'job' ? (
                <>
                  {detailModal.item.status === 'active' ? (
                    <button
                      type="button"
                      onClick={() => handleModerate('job', detailModal.item.id, 'pause')}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-900 text-xs font-bold"
                    >
                      <PauseCircle className="w-4 h-4" />
                      <span>Pausar Búsqueda</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleModerate('job', detailModal.item.id, 'activate')}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-100 hover:bg-emerald-200 text-emerald-900 text-xs font-bold"
                    >
                      <PlayCircle className="w-4 h-4" />
                      <span>Reactivar Búsqueda</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleModerate('job', detailModal.item.id, 'delete')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Eliminar Búsqueda</span>
                  </button>
                </>
              ) : (
                <>
                  {detailModal.item.account_status === 'active' ? (
                    <button
                      type="button"
                      onClick={() => handleModerate('profile', detailModal.item.id, 'pause')}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-900 text-xs font-bold"
                    >
                      <PauseCircle className="w-4 h-4" />
                      <span>Pausar Cuenta</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleModerate('profile', detailModal.item.id, 'activate')}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-100 hover:bg-emerald-200 text-emerald-900 text-xs font-bold"
                    >
                      <PlayCircle className="w-4 h-4" />
                      <span>Reactivar Cuenta</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleModerate('profile', detailModal.item.id, 'delete')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Eliminar Cuenta</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
