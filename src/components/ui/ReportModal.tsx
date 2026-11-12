import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Flag, X, CheckCircle2, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { REPORT_REASONS } from '../../lib/legalTexts';

interface ReportActionProps {
  targetType: 'candidate' | 'employer' | 'job_post';
  targetId: string;
  targetLabel?: string;
  ownerId?: string;
}

export const ReportAction: React.FC<ReportActionProps> = ({
  targetType,
  targetId,
  targetLabel,
  ownerId,
}) => {
  const { token, user } = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>(REPORT_REASONS[0]);
  const [detail, setDetail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const selectRef = useRef<HTMLSelectElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // No mostrar el enlace para denunciar el perfil o aviso propio
  const isOwnItem = Boolean(
    user?.id && (user.id === targetId || (ownerId && user.id === ownerId))
  );
  if (isOwnItem) {
    return null;
  }

  const handleOpen = () => {
    setReason(REPORT_REASONS[0]);
    setDetail('');
    setErrorMsg(null);
    setSubmitted(false);
    setOpen(true);
  };

  const handleClose = () => {
    if (submitting) return;
    setOpen(false);
    setTimeout(() => {
      triggerRef.current?.focus?.();
    }, 0);
  };

  useEffect(() => {
    if (!open) return;
    selectRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        e.preventDefault();
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, submitting]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setSubmitting(true);
    setErrorMsg(null);

    try {
      const { data, error } = await supabase.rpc('create_report', {
        p_token: token,
        p_target_type: targetType,
        p_target_id: targetId,
        p_reason: reason,
        p_detail: detail.trim() || null,
      });

      if (error) {
        throw new Error(error.message);
      }

      if (!data?.ok) {
        throw new Error('No pudimos registrar la denuncia.');
      }

      setSubmitted(true);
    } catch (err: any) {
      setErrorMsg(err.message || 'No se pudo enviar la denuncia.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!token || !user) {
    return (
      <Link
        to="/ingresar"
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-rose-700 hover:underline"
      >
        <Flag className="w-3.5 h-3.5" />
        <span>Ingresá para denunciar</span>
      </Link>
    );
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleOpen}
        className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-rose-700 hover:underline focus:outline-none focus:ring-2 focus:ring-brand-600 rounded px-1 py-0.5"
      >
        <Flag className="w-3.5 h-3.5" />
        <span>Denunciar</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[60] bg-slate-900/60 flex items-center justify-center p-4"
          onClick={handleClose}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-modal-title"
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl border border-slate-200 max-w-md w-full p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="report-modal-title" className="text-base font-bold text-slate-900">
                  Enviar denuncia
                </h3>
                {targetLabel && (
                  <p className="text-xs text-slate-600 mt-0.5 truncate max-w-[280px]">
                    {targetLabel}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={handleClose}
                disabled={submitting}
                aria-label="Cerrar ventana"
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {submitted ? (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-start gap-2.5 text-sm text-emerald-900">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold">Recibimos tu denuncia.</p>
                    <p className="text-xs text-emerald-800 mt-1">
                      El administrador revisará el caso a la brevedad.
                    </p>
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleClose}
                    className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
                  >
                    Cerrar
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {errorMsg && (
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-2 text-xs text-rose-800">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    Motivo *
                  </label>
                  <select
                    ref={selectRef}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm bg-white focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-200"
                  >
                    {REPORT_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    Detalle opcional (máx. 300 caracteres)
                  </label>
                  <textarea
                    rows={3}
                    maxLength={300}
                    value={detail}
                    onChange={(e) => setDetail(e.target.value)}
                    placeholder="Contanos brevemente qué pasó para ayudar a revisarlo..."
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-200"
                  />
                  <p className="text-[11px] text-slate-500 text-right mt-0.5">
                    {detail.length}/300
                  </p>
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleClose}
                    disabled={submitting}
                    className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold shadow-sm transition-colors"
                  >
                    {submitting ? 'Enviando...' : 'Enviar denuncia'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
};
