import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Download,
  Mail,
  Trash2,
  ShieldCheck,
  AlertTriangle,
  X,
  Copy,
  Check,
  ExternalLink,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useLegalModal } from './LegalModal';
import { CONTACT_EMAIL } from '../../lib/siteConfig';

interface PrivacyAndAccountSectionProps {
  role: 'candidate' | 'employer';
}

function formatUserDataAsText(d: any): string {
  const lines: string[] = [];
  const add = (text: string = '') => lines.push(text);
  const sep = (title: string) => {
    add('');
    add('======================================================================');
    add(title);
    add('======================================================================');
  };

  add('======================================================================');
  add('BOLSA DE EMPLEO TEJEDOR — COPIA DE MIS DATOS PERSONALES');
  add('Ley 25.326 de Protección de Datos Personales (República Argentina)');
  add(`Fecha de descarga: ${new Date().toLocaleString('es-AR')}`);
  add('======================================================================');

  // 1. Cuenta
  sep('1. DATOS DE LA CUENTA');
  if (d.account) {
    add(`- Identificador de usuario: ${d.account.id || '-'}`);
    add(`- Correo electrónico registrado: ${d.account.email || '-'}`);
    add(
      `- Rol en el sitio: ${
        d.account.role === 'employer' ? 'Comercio / Empresa' : 'Postulante'
      }`
    );
    add(`- Estado de la cuenta: ${d.account.status || 'active'}`);
    add(
      `- Fecha de creación: ${
        d.account.created_at
          ? new Date(d.account.created_at).toLocaleString('es-AR')
          : '-'
      }`
    );
  }

  // 2. Postulante (si aplica)
  if (d.candidate_profile || d.candidate_private) {
    sep('2. PERFIL DE POSTULANTE');
    if (d.candidate_profile) {
      add(
        `- Nombre y Apellido: ${d.candidate_profile.first_name || ''} ${
          d.candidate_profile.last_name || ''
        }`
      );
      add(
        `- Localidad: ${d.candidate_profile.locality || '-'}, ${
          d.candidate_profile.district || '-'
        } (${d.candidate_profile.province || '-'})`
      );
      add(
        `- Situación laboral: ${
          d.candidate_profile.work_situation === 'Employed_seeking_change'
            ? 'Con empleo, buscando cambiar o sumar horas'
            : 'En búsqueda activa de empleo'
        }`
      );
      add(`- Nivel educativo: ${d.candidate_profile.education_level || '-'}`);
      add(
        `- Disponibilidad horaria: ${
          (d.candidate_profile.availability || []).join(', ') || '-'
        }`
      );
      add(
        `- Rubros de interés: ${
          (d.candidate_profile.industries || []).join(', ') || '-'
        }`
      );
      add(
        `- Puestos de interés: ${
          (d.candidate_profile.positions || []).join(', ') || '-'
        }`
      );
      if (d.candidate_profile.custom_other_text) {
        add(`- Otro oficio indicado: ${d.candidate_profile.custom_other_text}`);
      }
      add(`- Presentación breve: ${d.candidate_profile.bio_short || '-'}`);
      add(
        `- Estado de visibilidad: ${
          d.candidate_profile.is_searching
            ? 'Perfil Activo (Visible para comercios)'
            : 'Perfil Pausado'
        }`
      );
    }
    if (d.candidate_private) {
      add('');
      add('DATOS PRIVADOS DE CONTACTO:');
      add(`- Teléfono celular / WhatsApp: ${d.candidate_private.phone || '-'}`);
      add(`- Fecha de nacimiento: ${d.candidate_private.birth_date || '-'}`);
      if (d.candidate_private.guardian_name || d.candidate_private.guardian_phone) {
        add(`- Adulto responsable (16-17 años): ${d.candidate_private.guardian_name || '-'}`);
        add(`- Teléfono responsable: ${d.candidate_private.guardian_phone || '-'}`);
        if (d.candidate_private.guardian_email) {
          add(`- Email responsable: ${d.candidate_private.guardian_email}`);
        }
      }
    }
    if (d.cv_metadata) {
      add('');
      add('CURRÍCULUM VITAE (METADATOS DEL ARCHIVO CARGADO):');
      add(`- Nombre de archivo: ${d.cv_metadata.filename || '-'}`);
      add(
        `- Tamaño del archivo: ${
          d.cv_metadata.size_bytes
            ? Math.round(d.cv_metadata.size_bytes / 1024) + ' KB'
            : '-'
        }`
      );
      add(
        `- Última actualización: ${
          d.cv_metadata.updated_at
            ? new Date(d.cv_metadata.updated_at).toLocaleString('es-AR')
            : '-'
        }`
      );
    }
  }

  // 3. Postulaciones
  if (Array.isArray(d.applications) && d.applications.length > 0) {
    sep('3. POSTULACIONES REALIZADAS A BÚSQUEDAS');
    d.applications.forEach((a: any, idx: number) => {
      add(`[Postulación ${idx + 1}]`);
      add(`  - Búsqueda laboral: ${a.job_title || '-'}`);
      add(`  - Comercio empleador: ${a.employer_trade_name || '-'}`);
      add(`  - Estado de postulación: ${a.status || '-'}`);
      if (a.message) add(`  - Mensaje enviado: ${a.message}`);
      add(
        `  - Fecha: ${
          a.created_at ? new Date(a.created_at).toLocaleString('es-AR') : '-'
        }`
      );
    });
  }

  // 4. Comercio (si aplica)
  if (d.employer_profile || d.employer_private) {
    sep('4. PERFIL DE COMERCIO / EMPRESA');
    if (d.employer_profile) {
      add(`- Nombre Comercial: ${d.employer_profile.trade_name || '-'}`);
      add(`- Razón Social: ${d.employer_profile.legal_name || '-'}`);
      add(`- CUIT: ${d.employer_profile.cuit || '-'}`);
      add(`- Rubro principal: ${d.employer_profile.industry || '-'}`);
      if (d.employer_profile.activity_start_date) {
        add(`- Fecha de inicio de actividades: ${d.employer_profile.activity_start_date}`);
      }
      add(
        `- Localidad: ${d.employer_profile.locality || '-'}, ${
          d.employer_profile.district || '-'
        } (${d.employer_profile.province || '-'})`
      );
      add(`- Descripción: ${d.employer_profile.description || '-'}`);
    }
    if (d.employer_private) {
      add('');
      add('DATOS PRIVADOS DE CONTACTO DEL COMERCIO:');
      add(
        `- Persona de contacto responsable: ${
          d.employer_private.contact_person_name || '-'
        }`
      );
      add(`- Teléfono / WhatsApp: ${d.employer_private.phone || '-'}`);
    }
  }

  // 5. Búsquedas publicadas
  if (Array.isArray(d.job_posts) && d.job_posts.length > 0) {
    sep('5. BÚSQUEDAS LABORALES PUBLICADAS');
    d.job_posts.forEach((j: any, idx: number) => {
      add(`[Búsqueda ${idx + 1}]`);
      add(`  - Título: ${j.title || '-'}`);
      add(
        `  - Rubro / Puesto: ${j.industry || '-'} / ${j.position_tag || '-'}`
      );
      add(`  - Localidad: ${j.locality || '-'}`);
      add(
        `  - Disponibilidad requerida: ${
          (j.availability || []).join(', ') || '-'
        }`
      );
      add(`  - Formación requerida: ${j.required_education || '-'}`);
      add(`  - Estado: ${j.status || '-'}`);
      add(
        `  - Fecha de publicación: ${
          j.created_at ? new Date(j.created_at).toLocaleString('es-AR') : '-'
        }`
      );
      add(
        `  - Fecha de vencimiento: ${
          j.expires_at ? new Date(j.expires_at).toLocaleString('es-AR') : '-'
        }`
      );
    });
  }

  // 6. Contactos pedidos
  if (Array.isArray(d.contact_requests) && d.contact_requests.length > 0) {
    sep('6. CONTACTOS SOLICITADOS A POSTULANTES');
    d.contact_requests.forEach((c: any, idx: number) => {
      add(
        `[Contacto ${idx + 1}] ID Postulante: ${c.candidate_id} · Fecha: ${
          c.created_at ? new Date(c.created_at).toLocaleString('es-AR') : '-'
        } · Estado: ${c.status || '-'}`
      );
    });
  }

  // 7. Consultas al admin
  if (Array.isArray(d.tickets) && d.tickets.length > 0) {
    sep('7. CONSULTAS AL ADMINISTRADOR');
    d.tickets.forEach((tk: any, idx: number) => {
      add(
        `[Consulta ${idx + 1}] Motivo: ${tk.category || 'General'} · Estado: ${
          tk.status === 'resolved' ? 'Resuelta' : 'Pendiente'
        }`
      );
      add(`  - Mensaje inicial: ${tk.message || '-'}`);
      if (Array.isArray(tk.messages)) {
        add(`  - Total de mensajes en hilo: ${tk.messages.length}`);
      }
    });
  }

  // 8. Constancias de aceptación legal
  if (Array.isArray(d.terms_acceptances) && d.terms_acceptances.length > 0) {
    sep('8. CONSTANCIAS DE ACEPTACIÓN LEGAL');
    d.terms_acceptances.forEach((t: any, idx: number) => {
      add(
        `[Aceptación ${idx + 1}] Versión: ${t.version} · Rol: ${t.role} · Fecha: ${
          t.accepted_at ? new Date(t.accepted_at).toLocaleString('es-AR') : '-'
        }`
      );
    });
  }

  // 9. Historial de consultas y accesos a mis datos (Ley 25.326 Art. 14)
  if (Array.isArray(d.access_history) && d.access_history.length > 0) {
    sep('9. HISTORIAL DE CONSULTAS Y ACCESOS A MIS DATOS');
    d.access_history.forEach((h: any, idx: number) => {
      add(
        `[Acceso ${idx + 1}] Acción: ${
          h.action === 'view_cv'
            ? 'Visualización de CV en PDF'
            : h.action === 'request_contact'
            ? 'Solicitud de contacto por WhatsApp'
            : h.action
        } · Comercio: ${h.actor_employer || 'Comercio registrado'} · Fecha: ${
          h.created_at ? new Date(h.created_at).toLocaleString('es-AR') : '-'
        }`
      );
    });
  }

  add('');
  add('======================================================================');
  add('FIN DEL REPORTE — Bolsa de Empleo Tejedor');
  add('Para solicitar rectificaciones o ejercer tus derechos escribinos a:');
  add(CONTACT_EMAIL);
  add('======================================================================');

  return lines.join('\r\n');
}

export const PrivacyAndAccountSection: React.FC<PrivacyAndAccountSectionProps> = ({
  role,
}) => {
  const { token, logout } = useAuth();
  const { openLegalModal } = useLegalModal();
  const navigate = useNavigate();

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Modal para corrección de datos / contacto
  const [correctionModalOpen, setCorrectionModalOpen] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState(false);

  // Modal para eliminación definitiva
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const confirmInputRef = useRef<HTMLInputElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  const openDeleteModal = () => {
    lastFocusedRef.current = document.activeElement as HTMLElement | null;
    setConfirmText('');
    setDeleteError(null);
    setDeleteModalOpen(true);
  };

  const closeDeleteModal = () => {
    if (deleting) return;
    setDeleteModalOpen(false);
    setTimeout(() => {
      lastFocusedRef.current?.focus?.();
    }, 0);
  };

  const openCorrectionModal = () => {
    setCopiedEmail(false);
    setCorrectionModalOpen(true);
  };

  const closeCorrectionModal = () => {
    setCorrectionModalOpen(false);
  };

  useEffect(() => {
    if (!deleteModalOpen) return;
    confirmInputRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !deleting) {
        e.preventDefault();
        closeDeleteModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteModalOpen, deleting]);

  useEffect(() => {
    if (!correctionModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeCorrectionModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [correctionModalOpen]);

  const handleExportData = async () => {
    if (!token) return;
    setExporting(true);
    setExportError(null);

    try {
      const { data, error } = await supabase.rpc('export_my_data', {
        p_token: token,
      });

      if (error) {
        throw new Error(error.message);
      }

      // Generar archivo de texto legible (.txt) para Bloc de notas o Word
      const textContent = formatUserDataAsText(data || {});
      const blob = new Blob([textContent], {
        type: 'text/plain;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'mis-datos-bolsa-tejedor.txt';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setExportError(
        err.message || 'No pudimos descargar tus datos en este momento.'
      );
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || confirmText !== 'ELIMINAR') return;

    setDeleting(true);
    setDeleteError(null);

    try {
      const { data, error } = await supabase.rpc('delete_my_account', {
        p_token: token,
        p_confirm: confirmText,
      });

      if (error) {
        throw new Error(error.message);
      }

      if (!data?.ok) {
        throw new Error('No se pudo eliminar la cuenta.');
      }

      setDeleteModalOpen(false);
      logout();
      navigate('/', {
        replace: true,
        state: {
          accountDeletedNotice: 'Tu cuenta y tus datos fueron eliminados.',
        },
      });
    } catch (err: any) {
      setDeleteError(err.message || 'No pudimos eliminar tu cuenta.');
    } finally {
      setDeleting(false);
    }
  };

  const rawSubject =
    'Pedido de corrección o consulta sobre mis datos — Bolsa de Empleo Tejedor';
  const encodedSubject = encodeURIComponent(rawSubject);
  const gmailComposeUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(
    CONTACT_EMAIL
  )}&su=${encodedSubject}`;
  const defaultMailtoUrl = `mailto:${CONTACT_EMAIL}?subject=${encodedSubject}`;

  const handleCopyEmail = async () => {
    try {
      await navigator.clipboard.writeText(CONTACT_EMAIL);
      setCopiedEmail(true);
      setTimeout(() => setCopiedEmail(false), 3000);
    } catch {
      // fallback
    }
  };

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4 mt-8">
      <div className="flex items-start gap-2.5">
        <ShieldCheck className="w-5 h-5 text-brand-700 shrink-0 mt-0.5" />
        <div>
          <h2 className="text-base font-bold text-slate-900">
            Privacidad y cuenta
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Podés consultar las condiciones vigentes, descargar una copia de tus
            datos en formato de texto o dar de baja definitiva tu cuenta.
          </p>
        </div>
      </div>

      {exportError && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">
          {exportError}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2.5 pt-1">
        <button
          type="button"
          onClick={handleExportData}
          disabled={exporting}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-800 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand-600"
        >
          <Download className="w-3.5 h-3.5 text-brand-700" />
          <span>
            {exporting
              ? 'Generando archivo de texto...'
              : 'Descargar mis datos (.txt)'}
          </span>
        </button>

        <button
          type="button"
          onClick={openCorrectionModal}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand-600"
        >
          <Mail className="w-3.5 h-3.5 text-slate-600" />
          <span>Pedir una corrección</span>
        </button>

        <button
          type="button"
          onClick={openDeleteModal}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-xs font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-rose-600 sm:ml-auto"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Eliminar mi cuenta y mis datos</span>
        </button>
      </div>

      <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <button
          type="button"
          onClick={() => openLegalModal({ tab: 'terms', role })}
          className="text-brand-700 hover:underline font-medium focus:outline-none focus:ring-2 focus:ring-brand-600 rounded"
        >
          Términos y Condiciones
        </button>
        <span>·</span>
        <button
          type="button"
          onClick={() => openLegalModal({ tab: 'privacy', role })}
          className="text-brand-700 hover:underline font-medium focus:outline-none focus:ring-2 focus:ring-brand-600 rounded"
        >
          Política de Privacidad
        </button>
      </div>

      {/* Modal para elegir cómo enviar el correo de corrección */}
      {correctionModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4"
          onClick={closeCorrectionModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="correction-modal-title"
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl border border-slate-200 max-w-md w-full p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-brand-50 text-brand-700 flex items-center justify-center shrink-0">
                  <Mail className="w-5 h-5" />
                </div>
                <div>
                  <h3
                    id="correction-modal-title"
                    className="text-base font-bold text-slate-900"
                  >
                    Pedir corrección o consultar datos
                  </h3>
                  <p className="text-xs text-slate-600">
                    Elegí cómo preferís enviar tu mensaje
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeCorrectionModal}
                aria-label="Cerrar ventana"
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs sm:text-sm text-slate-700 leading-relaxed">
              Podés escribirnos para rectificar información, solicitar la
              actualización de tus datos o ejercer tus derechos bajo la Ley
              25.326.
            </p>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5 text-xs text-slate-700">
              <div>
                <span className="font-semibold text-slate-900">Destinatario:</span>{' '}
                <span className="font-mono text-brand-700">{CONTACT_EMAIL}</span>
              </div>
              <div>
                <span className="font-semibold text-slate-900">Asunto prellenado:</span>{' '}
                <span className="text-slate-600">{rawSubject}</span>
              </div>
            </div>

            <div className="space-y-2 pt-1">
              {/* Opción 1: Abrir directamente en Gmail Web */}
              <a
                href={gmailComposeUrl}
                target="_blank"
                rel="noreferrer"
                onClick={closeCorrectionModal}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-semibold text-xs sm:text-sm shadow-sm transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                <span>Abrir directamente en Gmail</span>
              </a>

              {/* Opción 2: Abrir con app de correo predeterminada (Outlook, Apple Mail, etc.) */}
              <a
                href={defaultMailtoUrl}
                onClick={closeCorrectionModal}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-800 font-semibold text-xs sm:text-sm transition-colors"
              >
                <Mail className="w-4 h-4 text-slate-600" />
                <span>Abrir con mi app de correo</span>
              </a>

              {/* Opción 3: Copiar correo al portapapeles */}
              <button
                type="button"
                onClick={handleCopyEmail}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs sm:text-sm transition-colors"
              >
                {copiedEmail ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-600" />
                    <span className="text-emerald-700">
                      ¡Correo copiado al portapapeles!
                    </span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 text-slate-600" />
                    <span>Copiar dirección de correo</span>
                  </>
                )}
              </button>
            </div>

            <p className="text-[11px] text-slate-500 pt-1">
              Plazo legal de respuesta: hasta 10 días corridos para pedidos de
              acceso y 5 días hábiles para rectificación o supresión.
            </p>
          </div>
        </div>
      )}

      {/* Modal para confirmación de eliminación definitiva */}
      {deleteModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4"
          onClick={closeDeleteModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-account-title"
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl border border-slate-200 max-w-md w-full p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 text-rose-700">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <h3
                  id="delete-account-title"
                  className="text-base font-bold text-slate-900"
                >
                  Eliminar cuenta definitivamente
                </h3>
              </div>
              <button
                type="button"
                onClick={closeDeleteModal}
                disabled={deleting}
                aria-label="Cerrar confirmación"
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs sm:text-sm text-slate-700 leading-relaxed">
              Esta acción no se puede deshacer. Se borrarán de forma permanente
              tu perfil, tus datos de contacto, tu CV, tus postulaciones y los
              avisos o consultas que hayas publicado.
            </p>

            {deleteError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">
                {deleteError}
              </div>
            )}

            <form onSubmit={handleDeleteAccount} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-800 mb-1.5">
                  Escribí <strong className="text-rose-700">ELIMINAR</strong> en
                  mayúsculas para confirmar:
                </label>
                <input
                  ref={confirmInputRef}
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="ELIMINAR"
                  autoComplete="off"
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-semibold focus:border-rose-600 focus:outline-none focus:ring-2 focus:ring-rose-200"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeDeleteModal}
                  disabled={deleting}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={deleting || confirmText !== 'ELIMINAR'}
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold shadow-sm transition-colors"
                >
                  {deleting ? 'Eliminando...' : 'Confirmar eliminación'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
};
