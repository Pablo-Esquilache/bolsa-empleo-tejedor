import React, { useState } from 'react';
import { Users, Building2, Briefcase, PauseCircle, Tags, Plus } from 'lucide-react';
import { INITIAL_INDUSTRIES } from '../lib/constants';

export const AdminDashboardPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'candidates' | 'employers' | 'jobs' | 'industries'>('candidates');

  return (
    <div className="space-y-6">
      {/* Tarjetas de resumen superior */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">Postulantes Inscritos</p>
            <p className="text-2xl font-extrabold text-slate-900 mt-1">0</p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-brand-100 text-brand-700 flex items-center justify-center">
            <Users className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">Comercios Inscritos</p>
            <p className="text-2xl font-extrabold text-slate-900 mt-1">0</p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
            <Building2 className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">Búsquedas Activas</p>
            <p className="text-2xl font-extrabold text-emerald-700 mt-1">0</p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
            <Briefcase className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">Pausados / Moderados</p>
            <p className="text-2xl font-extrabold text-rose-700 mt-1">0</p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center">
            <PauseCircle className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Pestañas de navegación del Administrador */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        <button
          type="button"
          onClick={() => setActiveTab('candidates')}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
            activeTab === 'candidates'
              ? 'bg-slate-900 text-white'
              : 'bg-white text-slate-700 hover:bg-slate-200'
          }`}
        >
          Postulantes Inscritos
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('employers')}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
            activeTab === 'employers'
              ? 'bg-slate-900 text-white'
              : 'bg-white text-slate-700 hover:bg-slate-200'
          }`}
        >
          Comercios y Empresas
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('jobs')}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
            activeTab === 'jobs'
              ? 'bg-slate-900 text-white'
              : 'bg-white text-slate-700 hover:bg-slate-200'
          }`}
        >
          Búsquedas Laborales
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('industries')}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
            activeTab === 'industries'
              ? 'bg-amber-500 text-slate-950'
              : 'bg-white text-slate-700 hover:bg-slate-200'
          }`}
        >
          <Tags className="w-4 h-4" />
          <span>Rubros y Puestos ({INITIAL_INDUSTRIES.length})</span>
        </button>
      </div>

      {/* Vista del catálogo de rubros precargados */}
      {activeTab === 'industries' ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Rubros y Puestos Sugeridos</h2>
              <p className="text-xs text-slate-500">
                Podés agregar nuevos rubros u oficios para que aparezcan como botones cliqueables.
              </p>
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand-600 text-white text-xs font-semibold hover:bg-brand-700"
            >
              <Plus className="w-4 h-4" />
              <span>Nuevo Rubro</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {INITIAL_INDUSTRIES.map((industry) => (
              <div
                key={industry.id}
                className="rounded-xl border border-slate-200 p-4 space-y-2 bg-slate-50/50"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-900 text-sm">{industry.name}</h3>
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800">
                    Activo
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {industry.suggested_positions.map((pos) => (
                    <span
                      key={pos}
                      className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs text-slate-700"
                    >
                      {pos}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-2">
          <h2 className="text-lg font-bold text-slate-900">
            Panel de {activeTab === 'candidates' ? 'Postulantes' : activeTab === 'employers' ? 'Comercios' : 'Búsquedas'}
          </h2>
          <p className="text-sm text-slate-600 max-w-lg mx-auto">
            Acá vas a ver las tarjetas con buscador y los mismos filtros cliqueables. Al tocar una tarjeta se abrirá el Pop-up con toda la ficha, el CV en PDF y los botones de Pausar o Eliminar.
          </p>
        </div>
      )}
    </div>
  );
};
