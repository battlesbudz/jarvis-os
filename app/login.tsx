import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as AuthSession from "expo-auth-session";
import { useAuth } from "@/lib/auth-context";
import { Ionicons } from "@expo/vector-icons";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
            auto_select?: boolean;
          }) => void;
          prompt: (notification?: (n: { isNotDisplayed: () => boolean; isSkippedMoment: () => boolean }) => void) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

const GOOGLE_DISCOVERY = {
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
};

function loadGisScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("Not in browser"));
    if (window.google?.accounts?.id) return resolve();

    const existing = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener("load", () => resolve());
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Identity Services"));
    document.head.appendChild(script);
  });
}

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { loginWithGoogle, sessionExpired, clearSessionExpired } = useAuth();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [gisReady, setGisReady] = useState(false);
  const gisInitialized = useRef(false);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;

  const handleGisCredential = useCallback(
    async (response: { credential: string }) => {
      setLoading(true);
      setError("");
      try {
        await loginWithGoogle(response.credential, null);
      } catch (e: any) {
        setError(e.message || "Google sign-in failed");
      } finally {
        setLoading(false);
      }
    },
    [loginWithGoogle]
  );

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;

    const clientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    if (!clientId) return;

    loadGisScript()
      .then(() => {
        if (gisInitialized.current) return;
        gisInitialized.current = true;

        window.google!.accounts.id.initialize({
          client_id: clientId,
          callback: handleGisCredential,
        });
        setGisReady(true);
      })
      .catch((err) => {
        console.error("GIS load error:", err);
      });
  }, [handleGisCredential]);

  async function handleNativeGoogleSignIn() {
    const clientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    if (!clientId) {
      setError("Google client ID not configured");
      setLoading(false);
      return;
    }

    const redirectUri = AuthSession.makeRedirectUri({ scheme: "gameplan" });

    const request = new AuthSession.AuthRequest({
      clientId,
      redirectUri,
      scopes: ["openid", "profile", "email"],
      responseType: AuthSession.ResponseType.Code,
      usePKCE: true,
    });

    const result = await request.promptAsync(GOOGLE_DISCOVERY);

    if (result.type === "success" && result.params?.code) {
      try {
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code: result.params.code,
            client_id: clientId,
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
            code_verifier: request.codeVerifier || "",
          }).toString(),
        });

        if (!tokenRes.ok) {
          const errData = await tokenRes.json();
          throw new Error(errData.error_description || "Token exchange failed");
        }

        const tokenData = await tokenRes.json();

        if (tokenData.id_token) {
          await loginWithGoogle(tokenData.id_token, null);
        } else if (tokenData.access_token) {
          await loginWithGoogle(null, tokenData.access_token);
        } else {
          throw new Error("No token received from Google");
        }
      } catch (e: any) {
        setError(e.message || "Google sign-in failed");
      }
    } else if (result.type === "cancel" || result.type === "dismiss") {
      setError("Sign-in was cancelled");
    } else {
      setError("Sign-in failed. Please try again.");
    }
    setLoading(false);
  }

  async function handleGooglePress() {
    setError("");
    if (sessionExpired) clearSessionExpired();
    setLoading(true);

    try {
      if (Platform.OS === "web") {
        if (!gisReady || !window.google?.accounts?.id) {
          setError("Google sign-in is not ready yet. Please try again.");
          setLoading(false);
          return;
        }

        setLoading(false);
        window.google.accounts.id.prompt((notification) => {
          if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
            setError("Google sign-in popup was blocked or dismissed. Make sure popups are allowed and third-party cookies are enabled.");
          }
        });
      } else {
        await handleNativeGoogleSignIn();
      }
    } catch (e: any) {
      setError(e.message || "Could not start sign-in");
      setLoading(false);
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
});
