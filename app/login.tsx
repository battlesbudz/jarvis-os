import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";
import { useAuth, clearAuthStorage } from "@/lib/auth-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiUrl } from "@/lib/query-client";
import { Ionicons } from "@expo/vector-icons";

function createOauthNonce(length = 48): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const cryptoSource = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;

  if (cryptoSource?.getRandomValues) {
    const values = new Uint8Array(length);
    cryptoSource.getRandomValues(values);
    return Array.from(values, (value) => alphabet[value % alphabet.length]).join("");
  }

  let nonce = "";
  while (nonce.length < length) {
    nonce += Math.random().toString(36).slice(2);
  }
  return nonce.slice(0, length);
}

function buildMobileAuthUrls(baseUrl: string) {
  const sessionId = createOauthNonce(32);
  const pollSecret = createOauthNonce(48);

  const startUrl = new URL("/api/auth/mobile/start", baseUrl);
  startUrl.searchParams.set("session_id", sessionId);
  startUrl.searchParams.set("poll_secret", pollSecret);

  const pollUrl = new URL("/api/auth/mobile/poll", baseUrl);
  pollUrl.searchParams.set("session_id", sessionId);
  pollUrl.searchParams.set("poll_secret", pollSecret);

  return {
    sessionId,
    startUrl: startUrl.toString(),
    pollUrl: pollUrl.toString(),
  };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { loginWithToken, isAuthenticated, sessionExpired, clearSessionExpired } = useAuth();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasPreviousAccount, setHasPreviousAccount] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const isAuthenticatedRef = useRef(isAuthenticated);
  useEffect(() => { isAuthenticatedRef.current = isAuthenticated; }, [isAuthenticated]);

  // Detect whether a previous account was signed in (token or email exists in storage)
  useEffect(() => {
    AsyncStorage.multiGet(["@gameplan_auth_token", "@gameplan_auth_user_email"]).then(pairs => {
      const hasToken = !!(pairs[0][1] || pairs[1][1]);
      setHasPreviousAccount(hasToken || sessionExpired);
    });
  }, [sessionExpired]);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;

    const readTokenFromHash = () => {
      const hash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash;
      const params = new URLSearchParams(hash);
      return params.get("auth_token");
    };

    const token = readTokenFromHash();
    if (!token) return;

    setLoading(true);
    window.history.replaceState(null, document.title, window.location.pathname + window.location.search);
    loginWithToken(token)
      .catch((e: any) => {
        setError(e.message || "Failed to complete Google sign-in");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [loginWithToken]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;

    const handleAuthMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const token = event.data?.type === "gameplan-auth-token" ? event.data.token : null;
      if (typeof token !== "string" || !token) return;

      setLoading(true);
      setError("");
      try {
        await loginWithToken(token);
      } catch (e: any) {
        setError(e.message || "Failed to complete Google sign-in");
      } finally {
        setLoading(false);
      }
    };

    window.addEventListener("message", handleAuthMessage);
    return () => window.removeEventListener("message", handleAuthMessage);
  }, [loginWithToken]);

  async function handleNativeGoogleSignIn() {
    // Always clear any stale token before starting a new OAuth flow so the
    // wrong-account session can never silently survive into the new session.
    await clearAuthStorage();

    const baseUrl = getApiUrl();
    const { sessionId, startUrl, pollUrl } = buildMobileAuthUrls(baseUrl);

    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let succeeded = false;
    let attemptNum = 0;

    const cleanup = () => {
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    };

    const doPoll = async (): Promise<boolean> => {
      attemptNum++;
      try {
        console.log(`[GoogleAuth] Poll #${attemptNum} → ${pollUrl}`);
        const res = await fetch(pollUrl, { credentials: "include" });
        console.log(`[GoogleAuth] Poll #${attemptNum} status: ${res.status}`);
        if (res.ok) {
          const data = await res.json();
          if (data.ready && data.token) {
            console.log(`[GoogleAuth] Poll #${attemptNum}: token received!`);
            succeeded = true;
            cleanup();
            try {
              await loginWithToken(data.token);
            } catch (tokenErr: any) {
              setError(tokenErr.message || "Failed to complete sign-in");
            }
            WebBrowser.dismissBrowser();
            setLoading(false);
            return true;
          }
        }
        console.log(`[GoogleAuth] Poll #${attemptNum}: not ready yet`);
      } catch (err) {
        console.log(`[GoogleAuth] Poll #${attemptNum} error:`, err);
      }
      return false;
    };

    try {
      console.log(`[GoogleAuth] Starting sign-in flow, session: ${sessionId}`);
      console.log(`[GoogleAuth] API base: ${baseUrl}`);

      pollInterval = setInterval(() => { doPoll(); }, 2000);

      await WebBrowser.openBrowserAsync(startUrl, {
        showTitle: false,
        toolbarColor: "#0F0F0F",
        secondaryToolbarColor: "#0F0F0F",
      });

      console.log(`[GoogleAuth] Browser closed. succeeded=${succeeded}, isAuth=${isAuthenticatedRef.current}`);
      cleanup();

      if (succeeded || isAuthenticatedRef.current) {
        setLoading(false);
        return;
      }

      for (let i = 0; i < 3; i++) {
        if (isAuthenticatedRef.current) {
          setLoading(false);
          return;
        }
        const found = await doPoll();
        if (found) return;
        await delay(300);
      }

      if (!isAuthenticatedRef.current) {
        setError("Sign-in timed out, please try again.");
      }
    } catch (e: any) {
      cleanup();
      setError(e.message || "Could not open sign-in browser");
    } finally {
      cleanup();
      setLoading(false);
    }
  }

  async function handleWebGooglePopupSignIn() {
    if (typeof window === "undefined") {
      throw new Error("Google sign-in is only available in a browser.");
    }

    await clearAuthStorage();

    const { startUrl, pollUrl } = buildMobileAuthUrls(getApiUrl());
    const popup = window.open(
      startUrl,
      "gameplan-google-signin",
      "popup=yes,width=520,height=720,menubar=no,toolbar=no,location=yes,status=no",
    );

    if (!popup) {
      window.location.assign(startUrl);
      return;
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < 2 * 60 * 1000) {
      if (isAuthenticatedRef.current) {
        popup.close();
        return;
      }

      try {
        const res = await fetch(pollUrl, { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          if (data.ready && data.token) {
            popup.close();
            await loginWithToken(data.token);
            return;
          }
        } else if (res.status >= 500) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || "Google sign-in failed on the server.");
        }
      } catch (err) {
        if (err instanceof Error && err.message !== "Failed to fetch") {
          throw err;
        }
      }

      if (popup.closed && Date.now() - startedAt > 3000) {
        throw new Error("Google sign-in window was closed before sign-in finished.");
      }

      await delay(1500);
    }

    popup.close();
    throw new Error("Google sign-in timed out. Please try again.");
  }

  async function handleGooglePress() {
    setError("");
    if (sessionExpired) clearSessionExpired();

    if (Platform.OS === "web") {
      setLoading(true);
      try {
        await handleWebGooglePopupSignIn();
      } catch (e: any) {
        setError(e.message || "Could not start Google sign-in");
      } finally {
        setLoading(false);
      }
      return;
    }

    setLoading(true);
    try {
      await handleNativeGoogleSignIn();
    } catch (e: any) {
      setError(e.message || "Could not start sign-in");
      setLoading(false);
    }
  }

  async function handlePasswordLogin() {
    setError("");
    if (!username.trim() || !password.trim()) {
      setError("Please enter your username and password.");
      return;
    }
    setPwLoading(true);
    try {
      const base = getApiUrl();
      const res = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Invalid username or password.");
      } else {
        await loginWithToken(data.token);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed. Please try again.");
    } finally {
      setPwLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={[styles.inner, { paddingTop: topPadding + 40, paddingBottom: Platform.OS === "web" ? 34 : insets.bottom + 20 }]}>
        <View style={styles.header}>
          <View style={styles.iconCircle}>
            <Ionicons name="game-controller" size={48} color="#6366F1" />
          </View>
          <Text style={styles.appName}>GamePlan</Text>
          <Text style={styles.tagline}>Your personal productivity coach</Text>
        </View>

        <View style={styles.card}>
          {sessionExpired ? (
            <View style={styles.sessionExpiredBanner}>
              <Ionicons name="alert-circle" size={20} color="#F59E0B" />
              <Text style={styles.sessionExpiredText}>Your session expired. Please sign in again — your data is safe.</Text>
            </View>
          ) : (
            <Text style={styles.welcomeText}>Sign in to sync your tasks, goals, and progress across all your devices.</Text>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TextInput
            style={styles.textInput}
            placeholder="Username"
            placeholderTextColor="#666"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            testID="username-input"
          />
          <TextInput
            style={styles.textInput}
            placeholder="Password"
            placeholderTextColor="#666"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            testID="password-input"
          />
          <TouchableOpacity
            style={[styles.passwordButton, pwLoading && styles.buttonDisabled]}
            onPress={handlePasswordLogin}
            disabled={pwLoading || loading}
            testID="password-login-button"
          >
            {pwLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.passwordButtonText}>Sign in</Text>
            )}
          </TouchableOpacity>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity
            style={[styles.googleButton, loading && styles.buttonDisabled]}
            onPress={handleGooglePress}
            disabled={loading}
            testID="google-sign-in-button"
          >
            {loading ? (
              <ActivityIndicator color="#000" />
            ) : (
              <>
                <Image
                  source={{ uri: "https://developers.google.com/identity/images/g-logo.png" }}
                  style={styles.googleIcon}
                />
                <Text style={styles.googleButtonText}>Sign in with Google</Text>
              </>
            )}
          </TouchableOpacity>

          {Platform.OS !== "web" && hasPreviousAccount && (
            <TouchableOpacity
              style={styles.switchAccountButton}
              onPress={async () => {
                setError("");
                if (sessionExpired) clearSessionExpired();
                setLoading(true);
                try {
                  await handleNativeGoogleSignIn();
                } catch (e: any) {
                  setError(e.message || "Could not start sign-in");
                  setLoading(false);
                }
              }}
              disabled={loading}
            >
              <Text style={styles.switchAccountText}>Sign in as a different account</Text>
            </TouchableOpacity>
          )}

          {__DEV__ && (
            <TouchableOpacity
              style={styles.devLoginButton}
              testID="dev-login-button"
              onPress={async () => {
                setError("");
                setLoading(true);
                try {
                  const base =
                    typeof window !== "undefined" && window.location.hostname === "localhost"
                      ? "http://localhost:5000"
                      : getApiUrl();
                  const res = await fetch(`${base}/api/dev-token`);
                  const { token } = await res.json();
                  await loginWithToken(token);
                } catch (e: any) {
                  setError(e.message || "Dev login failed");
                  setLoading(false);
                }
              }}
              disabled={loading}
            >
              <Text style={styles.devLoginText}>⚡ Dev Login (test only)</Text>
            </TouchableOpacity>
          )}
        </View>

        <Text style={styles.footer}>
          By signing in, you agree to let GamePlan store your productivity data.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0F0F0F",
  },
  inner: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  header: {
    alignItems: "center",
    marginBottom: 40,
  },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: "rgba(99, 102, 241, 0.15)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  appName: {
    fontSize: 36,
    fontFamily: "Inter_700Bold",
    color: "#fff",
    letterSpacing: -1,
  },
  tagline: {
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    color: "#888",
    marginTop: 8,
  },
  card: {
    backgroundColor: "#1A1A1A",
    borderRadius: 16,
    padding: 24,
    gap: 20,
  },
  welcomeText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: "#999",
    textAlign: "center",
    lineHeight: 22,
  },
  sessionExpiredBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(245, 158, 11, 0.1)",
    borderRadius: 10,
    padding: 14,
    gap: 10,
  },
  sessionExpiredText: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: "#F59E0B",
    lineHeight: 20,
  },
  error: {
    color: "#FF6B6B",
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  googleButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingVertical: 16,
    gap: 12,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  googleIcon: {
    width: 20,
    height: 20,
  },
  googleButtonText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: "#333",
  },
  footer: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#555",
    textAlign: "center",
    marginTop: 24,
    paddingHorizontal: 20,
  },
  switchAccountButton: {
    alignItems: "center",
    paddingVertical: 8,
  },
  switchAccountText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#555",
    textDecorationLine: "underline",
  },
  devLoginButton: {
    alignItems: "center",
    paddingVertical: 10,
    marginTop: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#333",
    borderStyle: "dashed",
  },
  devLoginText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#666",
  },
  textInput: {
    backgroundColor: "#111",
    borderWidth: 1,
    borderColor: "#2a2a2a",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: "#fff",
  },
  passwordButton: {
    backgroundColor: "#6366F1",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  passwordButtonText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#2a2a2a",
  },
  dividerText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#444",
  },
});
