import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Mail,
  KeyRound,
  UserCheck,
  Building2,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
} from 'lucide-react';
import { UserRole } from '../types/database';
import { APP_NAME } from '../lib/constants';
import { supabase } from '../lib/supabase';
import { buildOtpEmailHtml, sendTransactionalEmail } from '../lib/emailService';
import { useAuth } from '../context/AuthContext';

export const LoginPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setSession } = useAuth();

  const roleParam = searchParams.get('rol') as UserRole | null;
  const selectedRole: 'candidate' | 'employer' =
    roleParam === 'employer' ? 'employer' : 'candidate';

  const [email, setEmail] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [devFallbackCode, setDevFallbackCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isEmployer = selectedRole === 'employer';

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setErrorMsg(null);
    setDevFallbackCode(null);

    try {
      const { data, error } = await supabase.rpc('create_otp_challenge', {
        p_email: email.trim(),
        p_role: selectedRole,
      });

      if (error) {
        throw new Error(error.message);
      }

      const generatedCode = data?.code;
      const roleLabel = isEmployer ? 'Comercio / Empleador' : 'Postulante';

      const emailSent = await sendTransactionalEmail({
        toEmail: email.trim(),
        subject: `Tu código de ingreso: ${generatedCode} — ${APP_NAME}`,
        htmlContent: buildOtpEmailHtml(generatedCode, roleLabel),
      });

      if (!emailSent) {
        setDevFallbackCode(generatedCode);
      }

      setOtpSent(true);
    } catch (err: any) {
      setErrorMsg(err.message || 'No se pudo generar el código de acceso.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otpCode.length !== 6) return;
    setLoading(true);
    setErrorMsg(null);

    try {
      const { data, error } = await supabase.rpc('verify_otp_code', {
        p_email: email.trim(),
        p_code: otpCode.trim(),
        p_role: selectedRole,
      });

      if (error) {
        throw new Error(error.message);
      }

      setSession(data.token, data.user);

      if (data.user.role === 'employer') {
        navigate('/mi-comercio');
      } else {
        navigate('/mi-perfil');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Código inválido o vencido.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-12 space-y-4">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Volver al inicio</span>
      </Link>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
        <div className="text-center space-y-2">
          <div
            className={`w-12 h-12 rounded-2xl mx-auto flex items-center justify-center ${
              isEmployer
                ? 'bg-amber-100 text-amber-700'
                : 'bg-brand-100 text-brand-700'
            }`}
          >
            {isEmployer ? (
              <Building2 className="w-6 h-6" />
            ) : (
              <UserCheck className="w-6 h-6" />
            )}
          </div>

          <h1 className="text-2xl font-bold text-slate-900">
            {isEmployer
              ? 'Acceso para Comercios y Empresas'
              : 'Acceso para Postulantes'}
          </h1>
          <p className="text-sm text-slate-600">
            Escribí tu correo electrónico y te enviaremos un código de 6 dígitos para entrar o crear tu cuenta.
          </p>
        </div>

        {errorMsg && (
          <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
            <span>{errorMsg}</span>
          </div>
        )}

        {!otpSent ? (
          <form onSubmit={handleSendOtp} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Tu correo electrónico
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ejemplo@correo.com"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:border-brand-600 focus:outline-none"
                />
              </div>
              <p className="text-xs text-slate-500 mt-1.5">
                Recordá: cada correo queda vinculado únicamente a tu cuenta de{' '}
                <strong>{isEmployer ? 'Comercio' : 'Postulante'}</strong>.
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className={`w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-semibold text-sm shadow-sm transition-colors ${
                isEmployer
                  ? 'bg-slate-900 hover:bg-slate-800 text-white'
                  : 'bg-brand-600 hover:bg-brand-700 text-white'
              } disabled:opacity-50`}
            >
              <span>{loading ? 'Enviando código...' : 'Recibir código de 6 dígitos'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 space-y-1">
              <div className="flex items-center gap-1.5 font-semibold">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Código enviado a {email}</span>
              </div>
              <p>Revisá tu bandeja de entrada e ingresá los 6 números.</p>
              {devFallbackCode && (
                <p className="mt-1 font-mono bg-white/80 px-2 py-1 rounded border border-emerald-300 text-emerald-950">
                  Modo prueba local — Tu código es: <strong>{devFallbackCode}</strong>
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Código de 6 dígitos
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 text-lg tracking-widest font-bold focus:border-brand-600 focus:outline-none"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || otpCode.length !== 6}
              className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-semibold text-sm shadow-sm transition-colors"
            >
              <span>{loading ? 'Verificando...' : 'Confirmar e Ingresar'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => {
                setOtpSent(false);
                setOtpCode('');
                setErrorMsg(null);
              }}
              className="text-xs text-brand-700 hover:underline font-medium block mx-auto"
            >
              ← Cambiar correo electrónico
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
