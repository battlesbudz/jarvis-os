import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiUrl } from "@/lib/query-client";

interface AuthState {
  token: string | null;
  userId: string | null;
  username: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

interface AuthContextType extends AuthState {
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  loginWithGoogle: (accessToken: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AUTH_TOKEN_KEY = "@gameplan_auth_token";
const AUTH_USER_ID_KEY = "@gameplan_auth_user_id";
const AUTH_USERNAME_KEY = "@gameplan_auth_username";

const AuthContext = createContext<AuthContextType | null>(null);

async function setAuthStorage(token: string, userId: string, username: string) {
  await AsyncStorage.multiSet([
    [AUTH_TOKEN_KEY, token],
    [AUTH_USER_ID_KEY, userId],
    [AUTH_USERNAME_KEY, username],
  ]);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    token: null,
    userId: null,
    username: null,
    isLoading: true,
    isAuthenticated: false,
  });

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
        setState({
          token,
          userId: data.userId,
          username: data.username,
          isLoading: false,
          isAuthenticated: true,
        });
      } else {
        await AsyncStorage.multiRemove([AUTH_TOKEN_KEY, AUTH_USER_ID_KEY, AUTH_USERNAME_KEY]);
        setState(s => ({ ...s, isLoading: false }));
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
    await setAuthStorage(data.token, data.userId, data.username);

    setState({
      token: data.token,
      userId: data.userId,
      username: data.username,
      isLoading: false,
      isAuthenticated: true,
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
      isLoading: false,
      isAuthenticated: true,
    });
  }, []);

  const loginWithGoogle = useCallback(async (accessToken: string) => {
    const baseUrl = getApiUrl();
    const res = await fetch(new URL("/api/auth/google", baseUrl).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Google sign-in failed");
    }

    const data = await res.json();
    await setAuthStorage(data.token, data.userId, data.username);

    setState({
      token: data.token,
      userId: data.userId,
      username: data.username,
      isLoading: false,
      isAuthenticated: true,
    });
  }, []);

  const logout = useCallback(async () => {
    await AsyncStorage.multiRemove([AUTH_TOKEN_KEY, AUTH_USER_ID_KEY, AUTH_USERNAME_KEY]);
    setState({
      token: null,
      userId: null,
      username: null,
      isLoading: false,
      isAuthenticated: false,
    });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, register, loginWithGoogle, logout }}>
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
