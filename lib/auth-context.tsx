import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiUrl, setOnUnauthorized, queryClient } from "@/lib/query-client";

interface AuthState {
  token: string | null;
  userId: string | null;
  username: string | null;
  userEmail: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  sessionExpired: boolean;
}

interface AuthContextType extends AuthState {
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  loginWithGoogle: (idToken: string | null, accessToken: string | null) => Promise<void>;
  loginWithToken: (token: string) => Promise<void>;
  logout: () => Promise<void>;
  clearSessionExpired: () => void;
  consumeReturnRoute: () => Promise<string | null>;
}

const AUTH_TOKEN_KEY = "@gameplan_auth_token";
const AUTH_USER_ID_KEY = "@gameplan_auth_user_id";
const AUTH_USERNAME_KEY = "@gameplan_auth_username";
const AUTH_USER_EMAIL_KEY = "@gameplan_auth_user_email";
const AUTH_RETURN_ROUTE_KEY = "@gameplan_return_route";

const AuthContext = createContext<AuthContextType | null>(null);

async function setAuthStorage(token: string, userId: string, username: string, email?: string | null) {
  const pairs: [string, string][] = [
    [AUTH_TOKEN_KEY, token],
    [AUTH_USER_ID_KEY, userId],
    [AUTH_USERNAME_KEY, username],
  ];
  if (email) {
    pairs.push([AUTH_USER_EMAIL_KEY, email]);
    await AsyncStorage.multiSet(pairs);
  } else {
    await AsyncStorage.multiSet(pairs);
    await AsyncStorage.removeItem(AUTH_USER_EMAIL_KEY);
  }
}

export async function clearAuthStorage() {
  await AsyncStorage.multiRemove([AUTH_TOKEN_KEY, AUTH_USER_ID_KEY, AUTH_USERNAME_KEY, AUTH_USER_EMAIL_KEY]);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    token: null,
    userId: null,
    username: null,
    userEmail: null,
    isLoading: true,
    isAuthenticated: false,
    sessionExpired: false,
  });

  const logoutCalledRef = useRef(false);

  const forceLogout = useCallback(async (returnRoute?: string) => {
    if (logoutCalledRef.current) return;
    logoutCalledRef.current = true;

    if (returnRoute) {
      await AsyncStorage.setItem(AUTH_RETURN_ROUTE_KEY, returnRoute);
    }
    await clearAuthStorage();
    queryClient.clear();
    setState({
      token: null,
      userId: null,
      username: null,
      userEmail: null,
      isLoading: false,
      isAuthenticated: false,
      sessionExpired: true,
    });

    setTimeout(() => { logoutCalledRef.current = false; }, 2000);
  }, []);

  useEffect(() => {
    setOnUnauthorized(() => { forceLogout(); });
    return () => { setOnUnauthorized(null); };
  }, [forceLogout]);

  useEffect(() => {
    checkStoredToken();
  }, []);

  async function checkStoredToken() {
    try {
      const token = await AsyncStorage.getItem(AUTH_TOKEN_KEY);
      if (!token) {
        setState(s => ({ ...s, isLoading: false }));
        return;
      }

      const baseUrl = getApiUrl();
      const res = await fetch(new URL("/api/auth/me", baseUrl).toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data = await res.json();
        if (data.email) await AsyncStorage.setItem(AUTH_USER_EMAIL_KEY, data.email);
        setState({
          token,
          userId: data.userId,
          username: data.username,
          userEmail: data.email || (await AsyncStorage.getItem(AUTH_USER_EMAIL_KEY)),
          isLoading: false,
          isAuthenticated: true,
          sessionExpired: false,
        });
      } else {
        await clearAuthStorage();
        const expired = res.status === 401;
        setState(s => ({ ...s, isLoading: false, sessionExpired: expired }));
      }
    } catch {
      setState(s => ({ ...s, isLoading: false }));
    }
  }

  const login = useCallback(async (username: string, password: string) => {
    const baseUrl = getApiUrl();
    const res = await fetch(new URL("/api/auth/login", baseUrl).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Login failed");
    }

    const data = await res.json();
    await setAuthStorage(data.token, data.userId, data.username, data.email);

    setState({
      token: data.token,
      userId: data.userId,
      username: data.username,
      userEmail: data.email || null,
      isLoading: false,
      isAuthenticated: true,
      sessionExpired: false,
    });
  }, []);

  const register = useCallback(async (username: string, password: string) => {
    const baseUrl = getApiUrl();
    const res = await fetch(new URL("/api/auth/register", baseUrl).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Registration failed");
    }

    const data = await res.json();
    await setAuthStorage(data.token, data.userId, data.username);

    setState({
      token: data.token,
      userId: data.userId,
      username: data.username,
      userEmail: null,
      isLoading: false,
      isAuthenticated: true,
      sessionExpired: false,
    });
  }, []);

  const loginWithGoogle = useCallback(async (idToken: string | null, accessToken: string | null) => {
    const baseUrl = getApiUrl();
    const res = await fetch(new URL("/api/auth/google", baseUrl).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, accessToken }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Google sign-in failed");
    }

    const data = await res.json();
    await setAuthStorage(data.token, data.userId, data.username, data.email);

    setState({
      token: data.token,
      userId: data.userId,
      username: data.username,
      userEmail: data.email || null,
      isLoading: false,
      isAuthenticated: true,
      sessionExpired: false,
    });
  }, []);

  const loginWithToken = useCallback(async (token: string) => {
    const baseUrl = getApiUrl();
    const res = await fetch(new URL("/api/auth/me", baseUrl).toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("Invalid token");
    const data = await res.json();
    await setAuthStorage(token, data.userId, data.username, data.email);
    setState({
      token,
      userId: data.userId,
      username: data.username,
      userEmail: data.email || null,
      isLoading: false,
      isAuthenticated: true,
      sessionExpired: false,
    });
  }, []);

  const logout = useCallback(async () => {
    await clearAuthStorage();
    queryClient.clear();
    setState({
      token: null,
      userId: null,
      username: null,
      userEmail: null,
      isLoading: false,
      isAuthenticated: false,
      sessionExpired: false,
    });
  }, []);

  const clearSessionExpired = useCallback(() => {
    setState(s => ({ ...s, sessionExpired: false }));
  }, []);

  const consumeReturnRoute = useCallback(async (): Promise<string | null> => {
    const route = await AsyncStorage.getItem(AUTH_RETURN_ROUTE_KEY);
    if (route) await AsyncStorage.removeItem(AUTH_RETURN_ROUTE_KEY);
    return route;
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, register, loginWithGoogle, loginWithToken, logout, clearSessionExpired, consumeReturnRoute }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

export async function getAuthToken(): Promise<string | null> {
  return AsyncStorage.getItem(AUTH_TOKEN_KEY);
}

export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = await getAuthToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return fetch(url, { ...options, headers });
}
