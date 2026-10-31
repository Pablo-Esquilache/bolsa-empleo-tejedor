import React from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { ShieldCheck, ArrowLeft, LogOut } from 'lucide-react';
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
            <div className="w-9 h-9 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center font-bold">
              <ShieldCheck className="w-5 h-5" />
            </div>
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

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
};
