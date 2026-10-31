import React from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Briefcase, Users, LogIn } from 'lucide-react';
import { APP_NAME } from '../../lib/constants';

export const MainLayout: React.FC = () => {
  const location = useLocation();

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-brand-600 flex items-center justify-center text-white font-bold text-lg shadow-sm">
              BT
            </div>
            <div>
              <span className="font-bold text-slate-900 text-base sm:text-lg leading-tight block">
                {APP_NAME}
              </span>
              <span className="text-xs text-slate-500 hidden sm:block">
                Carlos Tejedor y la región
              </span>
            </div>
          </Link>

          <nav className="flex items-center gap-2 sm:gap-4">
            <Link
              to="/vacantes"
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                location.pathname.startsWith('/vacantes')
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <Briefcase className="w-4 h-4" />
              <span>Búsquedas</span>
            </Link>

            <Link
              to="/postulantes"
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                location.pathname.startsWith('/postulantes')
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>Postulantes</span>
            </Link>

            <Link
              to="/ingresar"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold shadow-sm transition-colors"
            >
              <LogIn className="w-4 h-4" />
              <span>Ingresar</span>
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="bg-white border-t border-slate-200 py-6 mt-12">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <p>© {new Date().getFullYear()} {APP_NAME} — Conectando trabajo y comercios locales.</p>
          <p>Tus datos privados y teléfono están protegidos y solo se comparten con tu permiso.</p>
        </div>
      </footer>
    </div>
  );
};
