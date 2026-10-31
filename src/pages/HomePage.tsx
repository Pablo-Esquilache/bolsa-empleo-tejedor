import React from 'react';
import { Link } from 'react-router-dom';
import { UserPlus, Building2, Search, Shield, CheckCircle2, ArrowRight } from 'lucide-react';
import { APP_NAME, INITIAL_INDUSTRIES, INITIAL_LOCALITIES } from '../lib/constants';

export const HomePage: React.FC = () => {
  return (
    <div className="space-y-12 pb-12">
      {/* Hero Principal con los dos botones de acción */}
      <section className="bg-gradient-to-b from-brand-900 via-brand-800 to-brand-700 text-white py-14 sm:py-20 px-4">
        <div className="max-w-4xl mx-auto text-center space-y-6">
          <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 text-brand-100 text-xs sm:text-sm font-medium border border-white/15">
            📍 Carlos Tejedor, Tres Algarrobos, Colonia Seré, Timote, Curarú y la región
          </span>

          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight leading-tight">
            {APP_NAME}
          </h1>

          <p className="text-base sm:text-xl text-brand-100 max-w-2xl mx-auto">
            La plataforma simple y directa para conectar vecinos que buscan empleo (o quieren cambiar de trabajo) con comercios, empresas y productores locales.
          </p>

          {/* Dos grandes tarjetas / botones de elección de rol */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-4 text-left max-w-3xl mx-auto">
            <Link
              to="/ingresar?rol=candidate"
              className="group bg-white text-slate-900 rounded-2xl p-6 shadow-xl hover:shadow-2xl transition-all border-2 border-transparent hover:border-brand-300 flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="w-12 h-12 rounded-xl bg-brand-100 text-brand-700 flex items-center justify-center">
                  <UserPlus className="w-6 h-6" />
                </div>
                <h2 className="text-xl font-bold text-slate-900 group-hover:text-brand-700 transition-colors">
                  Busco Trabajo o Quiero Cambiar
                </h2>
                <p className="text-sm text-slate-600">
                  Armá tu perfil eligiendo tus rubros, horarios y estudios con un clic. Subí tu foto y tu CV en PDF.
                </p>
              </div>
              <div className="mt-6 inline-flex items-center gap-2 text-brand-700 font-semibold text-sm">
                <span>Cargar mi perfil de postulante</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </div>
            </Link>

            <Link
              to="/ingresar?rol=employer"
              className="group bg-slate-900 text-white rounded-2xl p-6 shadow-xl hover:shadow-2xl transition-all border-2 border-slate-700 hover:border-amber-400 flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="w-12 h-12 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
                  <Building2 className="w-6 h-6" />
                </div>
                <h2 className="text-xl font-bold text-white group-hover:text-amber-300 transition-colors">
                  Soy Comercio / Busco Personal
                </h2>
                <p className="text-sm text-slate-300">
                  Publicá búsquedas laborales al instante, filtrá postulantes por oficio o localidad y contactalos por WhatsApp.
                </p>
              </div>
              <div className="mt-6 inline-flex items-center gap-2 text-amber-400 font-semibold text-sm">
                <span>Registrar mi comercio o publicar aviso</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </div>
            </Link>
          </div>
        </div>
      </section>

      {/* Accesos rápidos a los directorios */}
      <section className="max-w-6xl mx-auto px-4 space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-2">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-slate-900">Opciones 100% Cliqueables</h3>
            <p className="text-sm text-slate-600">
              Sin formularios eternos: elegís tu disponibilidad horaria, estudios, situación laboral y rubros tocando botones.
            </p>
          </div>

          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-2">
            <div className="w-10 h-10 rounded-xl bg-brand-100 text-brand-700 flex items-center justify-center">
              <Search className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-slate-900">Filtros Precisos</h3>
            <p className="text-sm text-slate-600">
              Encontrá rápido por localidad ({INITIAL_LOCALITIES.slice(0, 4).map((l) => l.name).join(', ')} y más) y entre {INITIAL_INDUSTRIES.length} rubros precargados.
            </p>
          </div>

          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-2">
            <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
              <Shield className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-slate-900">Privacidad Cuidada</h3>
            <p className="text-sm text-slate-600">
              Tu teléfono y tu CV nunca quedan expuestos en público. Solo se habilitan cuando te postulás o aceptás una solicitud.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};
