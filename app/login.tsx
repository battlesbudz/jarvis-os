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
import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";
import { useAuth } from "@/lib/auth-context";
import { Ionicons } from "@expo/vector-icons";

WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { loginWithGoogle } = useAuth();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;

  const [request, response, promptAsync] = Google.useAuthRequest({
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    scopes: ["openid", "profile", "email"],
  });

  useEffect(() => {
    if (response?.type === "success") {
      const idToken = response.authentication?.idToken;
      const accessToken = response.authentication?.accessToken;
      if (idToken || accessToken) {
        handleGoogleAuth(idToken ?? null, accessToken ?? null);
      } else {
        setError("No token received from Google");
        setLoading(false);
      }
    } else if (response?.type === "error") {
      setError("Google sign-in was cancelled or failed");
      setLoading(false);
    } else if (response?.type === "dismiss") {
      setLoading(false);
    }
  }, [response]);

  async function handleGoogleAuth(idToken: string | null, accessToken: string | null) {
    setLoading(true);
    setError("");
    try {
      await loginWithGoogle(idToken, accessToken);
    } catch (e: any) {
      setError(e.message || "Sign-in failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleGooglePress() {
    setError("");
    setLoading(true);
    try {
      await promptAsync();
    } catch (e: any) {
      setError(e.message || "Could not open sign-in");
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
            style={[styles.googleButton, (loading || !request) && styles.buttonDisabled]}
            onPress={handleGooglePress}
            disabled={loading || !request}
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
