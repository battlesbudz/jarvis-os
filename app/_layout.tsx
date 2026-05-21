import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, router, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import * as Linking from "expo-linking";
import Constants from "expo-constants";
import React, { useCallback, useEffect, useRef } from "react";
import { ActivityIndicator, Platform, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { queryClient, apiRequest } from "@/lib/query-client";
import { runMigrations, isOnboardingComplete } from "@/lib/storage";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { WakeWordProvider } from "@/lib/wake-word-context";
import { useAndroidApkUpdateCheck } from "@/lib/app-update";

SplashScreen.preventAutoHideAsync();

function useProtectedRoute() {
  const { isAuthenticated, isLoading, consumeReturnRoute } = useAuth();
  const segments = useSegments();
  const hasNavigated = useRef(false);
  const lastRouteRef = useRef<string>("/");

  useEffect(() => {
    if (isLoading) return;

    const onLoginPage = segments[0] === "login";
    const currentRoute = "/" + segments.join("/");

    if (!isAuthenticated && !onLoginPage) {
      lastRouteRef.current = currentRoute !== "/" ? currentRoute : "/";
      router.replace("/login");
    } else if (isAuthenticated && onLoginPage) {
      hasNavigated.current = false;
      consumeReturnRoute().then((savedRoute) => {
        const target = savedRoute || lastRouteRef.current || "/";
        lastRouteRef.current = "/";
        router.replace(target as any);
      });
    }
  }, [isAuthenticated, isLoading, segments]);

  useEffect(() => {
    if (isLoading || !isAuthenticated || hasNavigated.current) return;

    async function checkOnboarding() {
      const done = await isOnboardingComplete();
      if (!done) {
        hasNavigated.current = true;
        router.replace('/onboarding');
      }
    }

    checkOnboarding();
  }, [isLoading, isAuthenticated]);

  return { isLoading };
}

function useDeepLinkAuth() {
  const { loginWithToken } = useAuth();
  const handledRef = useRef(false);

  const handleAuthUrl = useCallback(async (url: string) => {
    if (handledRef.current) return;
    try {
      const parsed = Linking.parse(url);
      const fullPath = [parsed.hostname, parsed.path].filter(Boolean).join('/');
      if (fullPath === 'auth/complete' && parsed.queryParams?.token) {
        handledRef.current = true;
        try {
          await loginWithToken(parsed.queryParams.token as string);
        } finally {
          handledRef.current = false;
        }
      }
    } catch {
      handledRef.current = false;
    }
  }, [loginWithToken]);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    Linking.getInitialURL().then((url) => {
      if (url) handleAuthUrl(url);
    });

    const sub = Linking.addEventListener('url', (event) => {
      handleAuthUrl(event.url);
    });
    return () => sub.remove();
  }, [handleAuthUrl]);
}

/**
 * Handles deep link navigation (non-auth). Routes jarvis://voice-realtime to
 * the voice-realtime screen so that Telegram's "🎙 Voice call" button opens
 * the app directly to the voice session.
 */
function useDeepLinkNavigation() {
  const { isAuthenticated } = useAuth();

  const handleNavUrl = useCallback((url: string) => {
    try {
      const parsed = Linking.parse(url);
      const host = parsed.hostname ?? '';
      const path = typeof parsed.path === 'string' ? parsed.path.replace(/^\/+/, '') : '';
      if (host === 'voice-realtime' || path === 'voice-realtime') {
        router.push('/voice-realtime');
      }
    } catch {
      // ignore malformed URLs
    }
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web' || !isAuthenticated) return;

    Linking.getInitialURL().then((url) => {
      if (url) handleNavUrl(url);
    });

    const sub = Linking.addEventListener('url', (event) => {
      handleNavUrl(event.url);
    });
    return () => sub.remove();
  }, [handleNavUrl, isAuthenticated]);
}

async function registerExpoPushToken(): Promise<string | undefined> {
  if (Platform.OS === 'web') return undefined;
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return undefined;

    const easExtra = Constants.expoConfig?.extra?.eas;
    const extraEasProjectId: string | undefined =
      easExtra && typeof easExtra.projectId === 'string' ? easExtra.projectId : undefined;
    const projectId: string | undefined =
      extraEasProjectId ?? Constants.easConfig?.projectId ?? undefined;

    const tokenData = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();
    return tokenData.data;
  } catch (err) {
    console.warn('[pushToken] Could not get Expo push token:', err);
    return undefined;
  }
}

function useExpoPushTokenRegistration() {
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated || Platform.OS === 'web') return;
    let cancelled = false;

    registerExpoPushToken().then((token) => {
      if (!token || cancelled) return;
      apiRequest('PATCH', '/api/preferences', { expoPushToken: token }).catch((err: unknown) => {
        console.warn('[pushToken] Failed to save push token:', err);
      });
    });

    return () => { cancelled = true; };
  }, [isAuthenticated]);
}

function AppNavigator() {
  const { isLoading } = useProtectedRoute();
  useDeepLinkAuth();
  useDeepLinkNavigation();
  useExpoPushTokenRegistration();
  useAndroidApkUpdateCheck();

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const subscription = Notifications.addNotificationResponseReceivedListener(response => {
      const screen = response.notification.request.content.data?.screen;
      if (screen === 'goals') router.push('/(tabs)/goals' as any);
      else if (screen === 'today') router.push('/(tabs)' as any);
      else if (screen === 'coach') router.push('/(tabs)/insights' as any);
      else if (screen === 'inbox') router.push('/(tabs)/inbox' as any);
    });
    return () => subscription.remove();
  }, []);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0F0F0F" }}>
        <ActivityIndicator size="large" color="#4F8EF7" />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerBackTitle: "Back" }}>
      <Stack.Screen name="login" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="focus-timer" options={{ presentation: 'modal', headerShown: false }} />
      <Stack.Screen name="jarvis-report" options={{ headerShown: false }} />
      <Stack.Screen name="capability-gaps" options={{ headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    runMigrations();
  }, []);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <WakeWordProvider>
            <GestureHandlerRootView>
              <KeyboardProvider>
                <AppNavigator />
              </KeyboardProvider>
            </GestureHandlerRootView>
          </WakeWordProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
