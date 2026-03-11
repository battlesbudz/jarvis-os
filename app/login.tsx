import React, { useState, useEffect } from "react";
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
import * as WebBrowser from "expo-web-browser";
import { useAuth } from "@/lib/auth-context";
import { Ionicons } from "@expo/vector-icons";
import { getApiUrl } from "@/lib/query-client";

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { loginWithToken } = useAuth();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const googleToken = params.get("googleToken");
    const googleError = params.get("googleError");

    if (googleToken) {
      window.history.replaceState({}, "", window.location.pathname);
      setLoading(true);
      loginWithToken(googleToken)
        .catch((e: any) => setError(e.message || "Sign-in failed"))
        .finally(() => setLoading(false));
    } else if (googleError) {
      window.history.replaceState({}, "", window.location.pathname);
      if (googleError === "cancelled") {
        setError("Sign-in was cancelled");
      } else {
        setError(`Sign-in failed (${googleError})`);
      }
    }
  }, []);

  async function handleGooglePress() {
    setError("");
    setLoading(true);
    try {
      const baseUrl = getApiUrl();
      const startUrl = new URL("/api/auth/google/start", baseUrl).toString();

      if (Platform.OS === "web") {
        window.location.href = startUrl;
      } else {
        const result = await WebBrowser.openAuthSessionAsync(
          startUrl,
          "gameplan://"
        );
        if (result.type === "success" && result.url) {
          const url = new URL(result.url);
          const token = url.searchParams.get("googleToken");
          const err = url.searchParams.get("googleError");
          if (token) {
            await loginWithToken(token);
          } else if (err) {
            setError(err === "cancelled" ? "Sign-in cancelled" : `Sign-in failed (${err})`);
          }
        } else if (result.type === "cancel" || result.type === "dismiss") {
          setError("Sign-in was cancelled");
        }
        setLoading(false);
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
          <Text style={styles.welcomeText}>Sign in to sync your tasks, goals, and progress across all your devices.</Text>

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
