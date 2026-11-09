import React from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { ArrowLeft, LogOut } from 'lucide-react';
import { APP_NAME } from '../../lib/constants';
import { useAuth } from '../../context/AuthContext';

export const AdminLayout: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleAdminLogout = () => {
    logout();
    navigate('/admin');
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-100">
      <header className="bg-slate-900 text-white border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/favicon-64.png"
              alt="Logo"
              className="w-9 h-9 rounded-xl shadow-sm object-cover shrink-0 ring-1 ring-white/10"
            />
            <div className="h-7 w-px bg-slate-700 hidden sm:block" />
            <div>
              <h1 className="font-bold text-base sm:text-lg leading-tight">
                Panel de Administración — {APP_NAME}
              </h1>
              <p className="text-xs text-slate-400 hidden sm:block">
                Moderación de postulantes, comercios, búsquedas y catálogo de rubros
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Ver sitio público</span>
            </Link>

            {user && (
              <button
                type="button"
                onClick={handleAdminLogout}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-xs font-semibold text-white transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Cerrar sesión</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
};
