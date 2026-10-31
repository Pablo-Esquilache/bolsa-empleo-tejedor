import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MainLayout } from './components/layout/MainLayout';
import { AdminLayout } from './components/layout/AdminLayout';

const HomePage = lazy(() =>
  import('./pages/HomePage').then((m) => ({ default: m.HomePage }))
);
const LoginPage = lazy(() =>
  import('./pages/LoginPage').then((m) => ({ default: m.LoginPage }))
);
const JobsDirectoryPage = lazy(() =>
  import('./pages/JobsDirectoryPage').then((m) => ({ default: m.JobsDirectoryPage }))
);
const CandidatesDirectoryPage = lazy(() =>
  import('./pages/CandidatesDirectoryPage').then((m) => ({
    default: m.CandidatesDirectoryPage,
  }))
);
const AdminDashboardPage = lazy(() =>
  import('./pages/AdminDashboardPage').then((m) => ({
    default: m.AdminDashboardPage,
  }))
);

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Suspense
        fallback={
          <div className="min-h-screen flex items-center justify-center text-sm text-slate-500">
            Cargando Bolsa de Empleo Tejedor...
          </div>
        }
      >
        <Routes>
          {/* Sitio Público */}
          <Route element={<MainLayout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/ingresar" element={<LoginPage />} />
            <Route path="/vacantes" element={<JobsDirectoryPage />} />
            <Route path="/postulantes" element={<CandidatesDirectoryPage />} />
          </Route>

          {/* Panel del Administrador (/admin) */}
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminDashboardPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
};

export default App;
