import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { UserRole } from '../types/database';
import { SESSION_INVALID_EVENT, supabase } from '../lib/supabase';

export interface SessionUser {
  id: string;
  email: string;
  role: UserRole;
  status: string;
}

interface AuthContextValue {
  token: string | null;
  user: SessionUser | null;
  setSession: (token: string, user: SessionUser) => void;
  logout: () => void;
}

const STORAGE_KEY = 'bolsa_empleo_tejedor_session_v1';
const REVALIDATE_COOLDOWN_MS = 60_000;

function readStoredSession(): { token: string | null; user: SessionUser | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.token && parsed?.user) {
        return { token: parsed.token, user: parsed.user };
      }
    }
  } catch {
    // ignore corrupted storage
  }
  return { token: null, user: null };
}

const AuthContext = createContext<AuthContextValue>({
  token: null,
  user: null,
  setSession: () => {},
  logout: () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const initial = readStoredSession();
  const [token, setToken] = useState<string | null>(initial.token);
  const [user, setUser] = useState<SessionUser | null>(initial.user);
  const [autoLogoutNotice, setAutoLogoutNotice] = useState<string | null>(null);
  const lastCheckAtRef = useRef<number>(0);

  const clearLocalSessionAuto = useCallback(() => {
    setToken((prevToken) => {
      if (prevToken) {
        setAutoLogoutNotice('Tu sesión finalizó. Ingresá de nuevo.');
      }
      return null;
    });
    setUser(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore storage error
    }
  }, []);

  const setSession = (newToken: string, newUser: SessionUser) => {
    setAutoLogoutNotice(null);
    setToken(newToken);
    setUser(newUser);
    lastCheckAtRef.current = Date.now();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: newToken, user: newUser }));
    } catch {
      // ignore storage error
    }
  };

  const logout = () => {
    const currentToken = token;
    setAutoLogoutNotice(null);
    setToken(null);
    setUser(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore storage error
    }
    if (currentToken) {
      supabase.rpc('logout_user_session', { p_token: currentToken }).then(() => {});
    }
  };

  const revalidateSession = useCallback(
    async (currentToken: string, force = false) => {
      if (!currentToken) return;
      const now = Date.now();
      if (!force && now - lastCheckAtRef.current < REVALIDATE_COOLDOWN_MS) {
        return;
      }
      lastCheckAtRef.current = now;

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
          clearLocalSessionAuto();
        }
      } catch {
        // Error de red o conexión offline: mantener la sesión activa
      }
    },
    [clearLocalSessionAuto]
  );

  // Validar sesión al iniciar la aplicación si hay token guardado
  useEffect(() => {
    if (token) {
      revalidateSession(token, true);
    }
  }, [token, revalidateSession]);

  // Revalidar al volver a la pestaña (visibilitychange, máximo 1 vez cada 60 s)
  useEffect(() => {
    if (!token) return;
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && token) {
        revalidateSession(token, false);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [token, revalidateSession]);

  // Manejo global si cualquier RPC responde explícitamente "Sesión inválida"
  useEffect(() => {
    const handleInvalidSessionEvent = () => {
      clearLocalSessionAuto();
    };
    window.addEventListener(SESSION_INVALID_EVENT, handleInvalidSessionEvent);
    return () => {
      window.removeEventListener(SESSION_INVALID_EVENT, handleInvalidSessionEvent);
    };
  }, [clearLocalSessionAuto]);

  useEffect(() => {
    if (!autoLogoutNotice) return;
    const timer = setTimeout(() => {
      setAutoLogoutNotice(null);
    }, 6000);
    return () => clearTimeout(timer);
  }, [autoLogoutNotice]);

  return (
    <AuthContext.Provider value={{ token, user, setSession, logout }}>
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
