import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Mail, KeyRound, UserCheck, Building2, ArrowRight } from 'lucide-react';
import { UserRole } from '../types/database';
import { APP_NAME } from '../lib/constants';

export const LoginPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const initialRole = (searchParams.get('rol') as UserRole) || 'candidate';

  const [selectedRole, setSelectedRole] = useState<'candidate' | 'employer'>(
    initialRole === 'employer' ? 'employer' : 'candidate'
  );
  const [email, setEmail] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');

  const handleSendOtp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setOtpSent(true);
  };

  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-slate-900">Ingresar o Registrarse</h1>
          <p className="text-sm text-slate-600">
            Sin contraseñas que recordar: ingresás con tu correo electrónico y un código de 6 dígitos enviado por <strong>{APP_NAME}</strong>.
          </p>
        </div>

        {/* Selección de Rol (1 email = 1 rol) */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
            ¿Cómo querés usar la plataforma con este email?
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setSelectedRole('candidate')}
              className={`flex flex-col items-center gap-1.5 p-3.5 rounded-xl border text-sm font-semibold transition-all ${
                selectedRole === 'candidate'
                  ? 'border-brand-600 bg-brand-50 text-brand-800 shadow-sm'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <UserCheck className="w-5 h-5" />
              <span>Soy Postulante</span>
            </button>

            <button
              type="button"
              onClick={() => setSelectedRole('employer')}
              className={`flex flex-col items-center gap-1.5 p-3.5 rounded-xl border text-sm font-semibold transition-all ${
                selectedRole === 'employer'
                  ? 'border-brand-600 bg-brand-50 text-brand-800 shadow-sm'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Building2 className="w-5 h-5" />
              <span>Soy Comercio</span>
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Nota: Cada correo electrónico queda asociado a un único rol.
          </p>
        </div>

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
            </div>

            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-semibold text-sm shadow-sm transition-colors"
            >
              <span>Recibir código de 6 dígitos</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
              Enviamos un código de 6 dígitos a <strong>{email}</strong>. Ingresalo abajo para continuar.
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Código de 6 dígitos
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 text-lg tracking-widest font-bold focus:border-brand-600 focus:outline-none"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => setOtpSent(false)}
              className="text-xs text-brand-700 hover:underline font-medium"
            >
              ← Cambiar correo electrónico
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
