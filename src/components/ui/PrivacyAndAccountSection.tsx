import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Mail, Trash2, ShieldCheck, AlertTriangle, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useLegalModal } from './LegalModal';
import { CONTACT_EMAIL } from '../../lib/siteConfig';

interface PrivacyAndAccountSectionProps {
  role: 'candidate' | 'employer';
}

export const PrivacyAndAccountSection: React.FC<PrivacyAndAccountSectionProps> = ({ role }) => {
  const { token, logout } = useAuth();
  const { openLegalModal } = useLegalModal();
  const navigate = useNavigate();

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

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

      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'mis-datos-bolsa-tejedor.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setExportError(err.message || 'No pudimos descargar tus datos en este momento.');
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

  const correctionSubject = encodeURIComponent(
    'Pedido de corrección o consulta sobre mis datos — Bolsa de Empleo Tejedor'
  );

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4 mt-8">
      <div className="flex items-start gap-2.5">
        <ShieldCheck className="w-5 h-5 text-brand-700 shrink-0 mt-0.5" />
        <div>
          <h2 className="text-base font-bold text-slate-900">Privacidad y cuenta</h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Podés consultar las condiciones vigentes, descargar una copia de tus datos o dar de baja definitiva tu cuenta.
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
          <span>{exporting ? 'Preparando archivo...' : 'Descargar mis datos'}</span>
        </button>

        <a
          href={`mailto:${CONTACT_EMAIL}?subject=${correctionSubject}`}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-brand-600"
        >
          <Mail className="w-3.5 h-3.5 text-slate-600" />
          <span>Pedir una corrección</span>
        </a>

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
                <h3 id="delete-account-title" className="text-base font-bold text-slate-900">
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
              Esta acción no se puede deshacer. Se borrarán de forma permanente tu perfil, tus datos de contacto, tu CV, tus postulaciones y los avisos o consultas que hayas publicado.
            </p>

            {deleteError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">
                {deleteError}
              </div>
            )}

            <form onSubmit={handleDeleteAccount} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-800 mb-1.5">
                  Escribí <strong className="text-rose-700">ELIMINAR</strong> en mayúsculas para confirmar:
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
