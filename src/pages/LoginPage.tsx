import React, { useEffect, useState } from 'react';
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
  RefreshCw,
} from 'lucide-react';
import { UserRole } from '../types/database';
import { supabase } from '../lib/supabase';
import { requestServerOtp } from '../lib/emailService';
import { useAuth } from '../context/AuthContext';
import { TurnstileWidget } from '../components/ui/TurnstileWidget';

export const LoginPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setSession, getSessionByRole } = useAuth();

  const roleParam = searchParams.get('rol') as UserRole | null;
  const hasExplicitRole = roleParam === 'employer' || roleParam === 'candidate';
  const selectedRole: 'candidate' | 'employer' =
    roleParam === 'employer' ? 'employer' : 'candidate';

  const existingRoleSession = getSessionByRole(selectedRole);

  useEffect(() => {
    if (existingRoleSession.token && existingRoleSession.user && !searchParams.get('cambiar')) {
      navigate(selectedRole === 'employer' ? '/postulantes' : '/vacantes', { replace: true });
    }
  }, [existingRoleSession.token, existingRoleSession.user, selectedRole, searchParams, navigate]);

  const [email, setEmail] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileReset, setTurnstileReset] = useState(0);

  const isEmployer = selectedRole === 'employer';

  const formatCooldown = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
  };

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const handleSendOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) return;
    if (!turnstileToken) {
      setErrorMsg('Completá la verificación anti-bots antes de solicitar el código.');
      return;
    }
    setLoading(true);
    setErrorMsg(null);

    try {
      const result = await requestServerOtp(cleanEmail, selectedRole, turnstileToken);
      if (!result.ok) {
        throw new Error(result.error || 'No se pudo enviar el código de acceso.');
      }

      setOtpSent(true);
      setResendCooldown(120);
    } catch (err: any) {
      setErrorMsg(err.message || 'No se pudo generar el código de acceso.');
    } finally {
      setTurnstileReset((prev) => prev + 1);
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
        p_email: email.trim().toLowerCase(),
        p_code: otpCode.trim(),
        p_role: selectedRole,
      });

      if (error) {
        throw new Error(error.message);
      }

      if (!data || data.ok === false) {
        throw new Error(data?.error || 'Código incorrecto o vencido.');
      }

      setSession(data.token, data.user);

      if (data.user.role === 'employer') {
        if (data.has_completed_profile) {
          navigate('/postulantes');
        } else {
          navigate('/mi-comercio');
        }
      } else {
        if (data.has_completed_profile) {
          navigate('/vacantes');
        } else {
          navigate('/mi-perfil');
        }
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
        {!hasExplicitRole && !otpSent && (
          <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-100">
            <button
              type="button"
              onClick={() => setSearchParams({ rol: 'candidate' })}
              className={`py-2 px-3 rounded-lg text-xs font-bold transition-colors ${
                !isEmployer
                  ? 'bg-white text-brand-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Soy Postulante
            </button>
            <button
              type="button"
              onClick={() => setSearchParams({ rol: 'employer' })}
              className={`py-2 px-3 rounded-lg text-xs font-bold transition-colors ${
                isEmployer
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Soy Comercio
            </button>
          </div>
        )}

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
                  autoComplete="email"
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
              disabled={loading || !turnstileToken}
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
                <span>Código enviado a {email.trim().toLowerCase()}</span>
              </div>
              <p>Revisá tu bandeja de entrada (o Spam) e ingresá los 6 números. Vence en 10 minutos.</p>
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
                  autoComplete="one-time-code"
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

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => {
                  setOtpSent(false);
                  setOtpCode('');
                  setErrorMsg(null);
                  setResendCooldown(0);
                  setTurnstileReset((prev) => prev + 1);
                }}
                className="text-xs text-slate-600 hover:text-slate-900 font-medium"
              >
                ← Cambiar correo
              </button>

              <button
                type="button"
                disabled={loading || resendCooldown > 0 || !turnstileToken}
                onClick={() => handleSendOtp()}
                className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline font-semibold disabled:opacity-50"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>
                  {resendCooldown > 0
                    ? `Reenviar en ${formatCooldown(resendCooldown)}`
                    : 'Reenviar código'}
                </span>
              </button>
            </div>
          </form>
        )}

        <TurnstileWidget
          onTokenChange={setTurnstileToken}
          resetSignal={turnstileReset}
        />
      </div>
    </div>
  );
};
