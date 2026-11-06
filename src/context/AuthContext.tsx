import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { UserRole } from '../types/database';
import { SESSION_INVALID_EVENT, supabase } from '../lib/supabase';

export interface SessionUser {
  id: string;
  email: string;
  role: UserRole;
  status: string;
}

export interface StoredRoleSession {
  token: string;
  user: SessionUser;
}

type SessionsByRole = Partial<Record<UserRole, StoredRoleSession>>;

interface AuthContextValue {
  token: string | null;
  user: SessionUser | null;
  setSession: (token: string, user: SessionUser) => void;
  logout: () => void;
  getSessionByRole: (role: UserRole) => { token: string | null; user: SessionUser | null };
}

const LEGACY_STORAGE_KEY = 'bolsa_empleo_tejedor_session_v1';
const STORAGE_KEY_V2 = 'bolsa_empleo_tejedor_sessions_v2';
const LAST_PUBLIC_ROLE_KEY = 'bolsa_empleo_tejedor_last_role_v2';
const REVALIDATE_COOLDOWN_MS = 60_000;

function readStoredSessions(): SessionsByRole {
  const result: SessionsByRole = {};
  try {
    const rawV2 = localStorage.getItem(STORAGE_KEY_V2);
    if (rawV2) {
      const parsed = JSON.parse(rawV2);
      if (parsed && typeof parsed === 'object') {
        (['candidate', 'employer', 'admin'] as UserRole[]).forEach((role) => {
          const entry = parsed[role];
          if (entry?.token && entry?.user?.id) {
            result[role] = { token: entry.token, user: entry.user };
          }
        });
      }
    }

    // Migrar sesión previa v1 si existiera para no cerrar la sesión actual del usuario
    const rawLegacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (rawLegacy) {
      const legacy = JSON.parse(rawLegacy);
      const role = legacy?.user?.role as UserRole | undefined;
      if (legacy?.token && legacy?.user?.id && role && !result[role]) {
        result[role] = { token: legacy.token, user: legacy.user };
      }
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(result));
    }
  } catch {
    // ignore storage errors
  }
  return result;
}

function readPreferredPublicRole(): 'candidate' | 'employer' {
  try {
    const val = localStorage.getItem(LAST_PUBLIC_ROLE_KEY);
    if (val === 'employer' || val === 'candidate') {
      return val;
    }
  } catch {
    // ignore
  }
  return 'candidate';
}

function resolveRoleForLocation(
  pathname: string,
  search: string,
  sessions: SessionsByRole,
  preferredPublicRole: 'candidate' | 'employer'
): UserRole {
  if (pathname.startsWith('/admin')) {
    return 'admin';
  }
  if (pathname.startsWith('/mi-comercio') || pathname.startsWith('/postulantes')) {
    return 'employer';
  }
  if (pathname.startsWith('/mi-perfil') || pathname.startsWith('/vacantes')) {
    return 'candidate';
  }
  if (pathname.startsWith('/ingresar')) {
    const params = new URLSearchParams(search);
    const rol = params.get('rol');
    if (rol === 'employer') return 'employer';
    if (rol === 'candidate') return 'candidate';
  }
  if (pathname.startsWith('/ver-cv/')) {
    const candidateId = pathname.replace('/ver-cv/', '').split('/')[0];
    if (sessions.candidate?.user.id === candidateId) {
      return 'candidate';
    }
    if (sessions[preferredPublicRole]) {
      return preferredPublicRole;
    }
    if (sessions.employer) return 'employer';
    if (sessions.admin) return 'admin';
    if (sessions.candidate) return 'candidate';
  }
  if (sessions[preferredPublicRole]) {
    return preferredPublicRole;
  }
  if (sessions.employer) return 'employer';
  if (sessions.candidate) return 'candidate';
  return preferredPublicRole;
}

const AuthContext = createContext<AuthContextValue>({
  token: null,
  user: null,
  setSession: () => {},
  logout: () => {},
  getSessionByRole: () => ({ token: null, user: null }),
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const [sessions, setSessions] = useState<SessionsByRole>(() => readStoredSessions());
  const [preferredPublicRole, setPreferredPublicRole] = useState<'candidate' | 'employer'>(() =>
    readPreferredPublicRole()
  );
  const [autoLogoutNotice, setAutoLogoutNotice] = useState<string | null>(null);
  const lastCheckByRoleRef = useRef<Partial<Record<UserRole, number>>>({});

  const activeRole = resolveRoleForLocation(
    location.pathname,
    location.search,
    sessions,
    preferredPublicRole
  );

  const activeEntry = sessions[activeRole] || null;
  const token = activeEntry?.token || null;
  const user = activeEntry?.user || null;

  // Recordar cuál fue el último rol público usado al navegar por rutas de candidato o comercio
  useEffect(() => {
    if (
      location.pathname.startsWith('/mi-comercio') ||
      location.pathname.startsWith('/postulantes')
    ) {
      setPreferredPublicRole('employer');
      try {
        localStorage.setItem(LAST_PUBLIC_ROLE_KEY, 'employer');
      } catch {
        // ignore
      }
    } else if (
      location.pathname.startsWith('/mi-perfil') ||
      location.pathname.startsWith('/vacantes')
    ) {
      setPreferredPublicRole('candidate');
      try {
        localStorage.setItem(LAST_PUBLIC_ROLE_KEY, 'candidate');
      } catch {
        // ignore
      }
    }
  }, [location.pathname]);

  // Sincronizar sesiones entre pestañas del mismo navegador
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY_V2) {
        setSessions(readStoredSessions());
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const clearRoleSessionAuto = useCallback((roleToClear: UserRole) => {
    setSessions((prev) => {
      if (!prev[roleToClear]) return prev;
      const next: SessionsByRole = { ...prev };
      delete next[roleToClear];
      try {
        localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(next));
      } catch {
        // ignore
      }
      setAutoLogoutNotice('Tu sesión finalizó. Ingresá de nuevo.');
      return next;
    });
  }, []);

  const setSession = (newToken: string, newUser: SessionUser) => {
    const targetRole: UserRole = newUser.role;
    setAutoLogoutNotice(null);
    lastCheckByRoleRef.current[targetRole] = Date.now();

    if (targetRole === 'candidate' || targetRole === 'employer') {
      setPreferredPublicRole(targetRole);
      try {
        localStorage.setItem(LAST_PUBLIC_ROLE_KEY, targetRole);
      } catch {
        // ignore
      }
    }

    setSessions((prev) => {
      const next: SessionsByRole = {
        ...prev,
        [targetRole]: { token: newToken, user: newUser },
      };
      try {
        localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const logout = () => {
    const roleToLogout = activeRole;
    const currentToken = sessions[roleToLogout]?.token;
    setAutoLogoutNotice(null);

    setSessions((prev) => {
      const next: SessionsByRole = { ...prev };
      delete next[roleToLogout];
      try {
        localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });

    if (currentToken) {
      supabase.rpc('logout_user_session', { p_token: currentToken }).then(() => {});
    }
  };

  const getSessionByRole = useCallback(
    (role: UserRole) => {
      const entry = sessions[role];
      return {
        token: entry?.token || null,
        user: entry?.user || null,
      };
    },
    [sessions]
  );

  const revalidateRoleSession = useCallback(
    async (roleToCheck: UserRole, currentToken: string, force = false) => {
      if (!currentToken) return;
      const now = Date.now();
      const lastCheck = lastCheckByRoleRef.current[roleToCheck] || 0;
      if (!force && now - lastCheck < REVALIDATE_COOLDOWN_MS) {
        return;
      }
      lastCheckByRoleRef.current[roleToCheck] = now;

      try {
        const { data, error } = await supabase.rpc('get_session_profile', {
          p_token: currentToken,
        });

        // Ante error de red, timeout o 5xx NO cerrar sesión
        if (error) {
          return;
        }

        // get_session_profile devuelve un registro profiles; si es inválida viene con id == null
        if (!data || data.id == null) {
          clearRoleSessionAuto(roleToCheck);
        }
      } catch {
        // Error de red o conexión offline: mantener la sesión activa
      }
    },
    [clearRoleSessionAuto]
  );

  // Validar la sesión activa al iniciar o cambiar de rol/ruta
  useEffect(() => {
    if (token) {
      revalidateRoleSession(activeRole, token, false);
    }
  }, [activeRole, token, revalidateRoleSession]);

  // Revalidar al volver a la pestaña (visibilitychange, máximo 1 vez cada 60 s)
  useEffect(() => {
    if (!token) return;
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && token) {
        revalidateRoleSession(activeRole, token, false);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [activeRole, token, revalidateRoleSession]);

  // Manejo global si cualquier RPC responde explícitamente "Sesión inválida"
  useEffect(() => {
    const handleInvalidSessionEvent = () => {
      clearRoleSessionAuto(activeRole);
    };
    window.addEventListener(SESSION_INVALID_EVENT, handleInvalidSessionEvent);
    return () => {
      window.removeEventListener(SESSION_INVALID_EVENT, handleInvalidSessionEvent);
    };
  }, [activeRole, clearRoleSessionAuto]);

  useEffect(() => {
    if (!autoLogoutNotice) return;
    const timer = setTimeout(() => {
      setAutoLogoutNotice(null);
    }, 6000);
    return () => clearTimeout(timer);
  }, [autoLogoutNotice]);

  return (
    <AuthContext.Provider value={{ token, user, setSession, logout, getSessionByRole }}>
      {autoLogoutNotice && (
        <div className="fixed top-4 right-4 z-50 max-w-sm bg-slate-900 text-white px-4 py-3 rounded-xl shadow-lg border border-slate-700 flex items-center justify-between gap-3 text-xs sm:text-sm">
          <span>{autoLogoutNotice}</span>
          <button
            type="button"
            onClick={() => setAutoLogoutNotice(null)}
            className="text-slate-400 hover:text-white font-bold"
          >
            ✕
          </button>
        </div>
      )}
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
