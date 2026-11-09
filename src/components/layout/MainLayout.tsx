import React, { useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Briefcase, Users, UserCircle, Building2, LogOut, Menu, X, Shield, ArrowRight } from 'lucide-react';
import { APP_NAME } from '../../lib/constants';
import { useAuth } from '../../context/AuthContext';
import { BrandLogo } from '../ui/BrandLogo';

export const MainLayout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = () => {
    logout();
    setMobileMenuOpen(false);
    navigate('/');
  };

  const closeMenu = () => setMobileMenuOpen(false);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          {/* Logo oficial (Versión Desktop y Mobile) */}
          <Link to="/" onClick={closeMenu} className="flex items-center hover:opacity-95 transition-opacity">
            <BrandLogo variant="navbar" />
          </Link>

          {/* Navegación Desktop */}
          <nav className="hidden md:flex items-center gap-2 sm:gap-3">
            {user ? (
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

                <div className="flex items-center gap-2 pl-1 border-l border-slate-200">
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
                    <span>Salir</span>
                  </button>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <Link
                  to="/ingresar?rol=candidate"
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 hover:text-brand-700 hover:bg-slate-100 transition-colors"
                >
                  Soy Postulante
                </Link>
                <Link
                  to="/ingresar?rol=employer"
                  className="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-sm transition-colors"
                >
                  Soy Comercio
                </Link>
              </div>
            )}
          </nav>

          {/* Botón Menú Hamburguesa para Mobile */}
          <div className="flex md:hidden items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              aria-label={mobileMenuOpen ? 'Cerrar menú' : 'Abrir menú'}
              className="p-2 rounded-xl text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {/* Menú desplegable Mobile */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-slate-200 bg-white px-4 py-4 space-y-3 shadow-lg animate-in slide-in-from-top-2">
            {user ? (
              <div className="space-y-2">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                  <p className="font-semibold text-slate-700">
                    {user.role === 'employer' ? '🏢 Sesión Comercio' : '👤 Sesión Postulante'}
                  </p>
                  <p className="text-slate-500 truncate">{user.email}</p>
                </div>

                {user.role === 'candidate' && (
                  <>
                    <Link
                      to="/vacantes"
                      onClick={closeMenu}
                      className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold text-slate-800 hover:bg-slate-100"
                    >
                      <Briefcase className="w-4 h-4 text-brand-600" />
                      <span>Búsquedas Laborales y Comercios</span>
                    </Link>
                    <Link
                      to="/mi-perfil"
                      onClick={closeMenu}
                      className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold text-brand-700 bg-brand-50"
                    >
                      <UserCircle className="w-4 h-4 text-brand-600" />
                      <span>Mi Perfil de Postulante</span>
                    </Link>
                  </>
                )}

                {user.role === 'employer' && (
                  <>
                    <Link
                      to="/postulantes"
                      onClick={closeMenu}
                      className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold text-slate-800 hover:bg-slate-100"
                    >
                      <Users className="w-4 h-4 text-amber-600" />
                      <span>Directorio de Postulantes</span>
                    </Link>
                    <Link
                      to="/mi-comercio"
                      onClick={closeMenu}
                      className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-bold text-slate-950 bg-amber-500 hover:bg-amber-600"
                    >
                      <Building2 className="w-4 h-4" />
                      <span>Panel de Mi Comercio</span>
                    </Link>
                  </>
                )}

                <button
                  type="button"
                  onClick={handleLogout}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Cerrar sesión</span>
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <Link
                  to="/ingresar?rol=candidate"
                  onClick={closeMenu}
                  className="flex items-center justify-between p-3 rounded-xl bg-brand-50 hover:bg-brand-100 text-brand-800 text-sm font-semibold"
                >
                  <span>Ingresar como Postulante</span>
                  <ArrowRight className="w-4 h-4" />
                </Link>

                <Link
                  to="/ingresar?rol=employer"
                  onClick={closeMenu}
                  className="flex items-center justify-between p-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold"
                >
                  <span>Ingresar como Comercio</span>
                  <ArrowRight className="w-4 h-4" />
                </Link>

                <Link
                  to="/admin"
                  onClick={closeMenu}
                  className="flex items-center gap-2 p-2.5 text-xs text-slate-500 hover:text-slate-800 font-medium"
                >
                  <Shield className="w-3.5 h-3.5" />
                  <span>Acceso Administrador</span>
                </Link>
              </div>
            )}
          </div>
        )}
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="bg-white border-t border-slate-200 py-6 mt-12">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <img src="/favicon.png" alt="Logo" className="w-5 h-5 rounded-md" />
            <p>© {new Date().getFullYear()} {APP_NAME} — Conectando trabajo y comercios locales.</p>
          </div>
          <p>Acceso exclusivo con sesión verificada para postulantes y comercios registrados.</p>
        </div>
      </footer>
    </div>
  );
};
