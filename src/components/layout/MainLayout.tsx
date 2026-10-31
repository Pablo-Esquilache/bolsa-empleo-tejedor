import React from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Briefcase, Users, UserCircle, Building2, LogOut } from 'lucide-react';
import { APP_NAME } from '../../lib/constants';
import { useAuth } from '../../context/AuthContext';

export const MainLayout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-brand-600 flex items-center justify-center text-white font-bold text-lg shadow-sm shrink-0">
              BT
            </div>
            <span className="font-bold text-slate-900 text-base sm:text-lg leading-tight">
              {APP_NAME}
            </span>
          </Link>

          <nav className="flex items-center gap-2 sm:gap-3">
            {user && (
              <>
                {user.role === 'candidate' && (
                  <Link
                    to="/vacantes"
                    className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
                      location.pathname.startsWith('/vacantes')
                        ? 'bg-brand-50 text-brand-700'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    <Briefcase className="w-4 h-4" />
                    <span>Búsquedas y Comercios</span>
                  </Link>
                )}

                {user.role === 'employer' && (
                  <Link
                    to="/postulantes"
                    className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
                      location.pathname.startsWith('/postulantes')
                        ? 'bg-brand-50 text-brand-700'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    <Users className="w-4 h-4" />
                    <span>Ver Postulantes</span>
                  </Link>
                )}

                <div className="flex items-center gap-2">
                  {user.role === 'employer' ? (
                    <Link
                      to="/mi-comercio"
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs sm:text-sm font-bold shadow-sm transition-colors"
                    >
                      <Building2 className="w-4 h-4" />
                      <span>Mi Comercio</span>
                    </Link>
                  ) : (
                    <Link
                      to="/mi-perfil"
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs sm:text-sm font-semibold shadow-sm transition-colors"
                    >
                      <UserCircle className="w-4 h-4" />
                      <span>Mi Perfil</span>
                    </Link>
                  )}

                  <button
                    type="button"
                    onClick={handleLogout}
                    title="Cerrar sesión"
                    className="inline-flex items-center gap-1 px-2.5 py-2 rounded-lg text-xs font-medium text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    <span className="hidden sm:inline">Salir</span>
                  </button>
                </div>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="bg-white border-t border-slate-200 py-6 mt-12">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <p>© {new Date().getFullYear()} {APP_NAME} — Conectando trabajo y comercios locales.</p>
          <p>Acceso exclusivo con sesión verificada para postulantes y comercios registrados.</p>
        </div>
      </footer>
    </div>
  );
};
