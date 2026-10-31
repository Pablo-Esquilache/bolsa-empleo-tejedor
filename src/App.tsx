import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MainLayout } from './components/layout/MainLayout';
import { AdminLayout } from './components/layout/AdminLayout';
import { AuthProvider } from './context/AuthContext';

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
const CandidateProfilePage = lazy(() =>
  import('./pages/CandidateProfilePage').then((m) => ({
    default: m.CandidateProfilePage,
  }))
);
const EmployerDashboardPage = lazy(() =>
  import('./pages/EmployerDashboardPage').then((m) => ({
    default: m.EmployerDashboardPage,
  }))
);
const AdminDashboardPage = lazy(() =>
  import('./pages/AdminDashboardPage').then((m) => ({
    default: m.AdminDashboardPage,
  }))
);
const ViewCvPage = lazy(() =>
  import('./pages/ViewCvPage').then((m) => ({
    default: m.ViewCvPage,
  }))
);

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense
          fallback={
            <div className="min-h-screen flex items-center justify-center text-sm text-slate-500">
              Cargando Bolsa de Empleo Tejedor...
            </div>
          }
        >
          <Routes>
            {/* Sitio Público y Paneles de Usuario */}
            <Route element={<MainLayout />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/ingresar" element={<LoginPage />} />
              <Route path="/vacantes" element={<JobsDirectoryPage />} />
              <Route path="/postulantes" element={<CandidatesDirectoryPage />} />
              <Route path="/mi-perfil" element={<CandidateProfilePage />} />
              <Route path="/mi-comercio" element={<EmployerDashboardPage />} />
              <Route path="/ver-cv/:candidateId" element={<ViewCvPage />} />
            </Route>

            {/* Panel del Administrador (/admin) */}
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<AdminDashboardPage />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
};

export default App;
