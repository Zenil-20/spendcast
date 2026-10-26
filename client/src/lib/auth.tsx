import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, tokenStore, UNAUTHORIZED_EVENT } from "./api";
import type { User } from "./types";

interface AuthContextValue {
  user: User | null;
  status: "loading" | "signed-in" | "signed-out";
  login: (email: string, password: string) => Promise<void>;
  register: (input: { name: string; email: string; password: string; timezone: string; currency: string }) => Promise<void>;
  logout: () => void;
  setUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthContextValue["status"]>(tokenStore.get() ? "loading" : "signed-out");

  const logout = useCallback(() => {
    tokenStore.clear();
    queryClient.clear();
    setUser(null);
    setStatus("signed-out");
  }, [queryClient]);

  // Restore the session on load.
  useEffect(() => {
    if (!tokenStore.get()) {
      return;
    }

    api.me()
      .then(result => {
        setUser(result.user);
        setStatus("signed-in");
      })
      .catch(() => logout());
  }, [logout]);

  // Any request that comes back 401 signs the user out.
  useEffect(() => {
    window.addEventListener(UNAUTHORIZED_EVENT, logout);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, logout);
  }, [logout]);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    status,
    async login(email, password) {
      const result = await api.login({ email, password });
      tokenStore.set(result.token);
      queryClient.clear();
      setUser(result.user);
      setStatus("signed-in");
    },
    async register(input) {
      const result = await api.register(input);
      tokenStore.set(result.token);
      queryClient.clear();
      setUser(result.user);
      setStatus("signed-in");
    },
    logout,
    setUser
  }), [user, status, logout, queryClient]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return context;
}

// The signed-in user's settings currently in effect.
export function useSettings() {
  const { user } = useAuth();

  return user ? user.settings : { timezone: "UTC", currency: "USD" };
}
