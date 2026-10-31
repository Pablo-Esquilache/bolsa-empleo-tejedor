import React, { createContext, useContext, useEffect, useState } from 'react';
import { UserRole } from '../types/database';

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

const AuthContext = createContext<AuthContextValue>({
  token: null,
  user: null,
  setSession: () => {},
  logout: () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.token && parsed?.user) {
          setToken(parsed.token);
          setUser(parsed.user);
        }
      }
    } catch {
      // ignore corrupted storage
    }
  }, []);

  const setSession = (newToken: string, newUser: SessionUser) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: newToken, user: newUser }));
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem(STORAGE_KEY);
  };

  return (
    <AuthContext.Provider value={{ token, user, setSession, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
