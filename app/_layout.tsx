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
import React, { useCallback, useEffect, useRef } from "react";
import { ActivityIndicator, Platform, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { queryClient } from "@/lib/query-client";
import { runMigrations, isOnboardingComplete } from "@/lib/storage";
import { AuthProvider, useAuth } from "@/lib/auth-context";

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
      if (parsed.path === 'auth/complete' && parsed.queryParams?.token) {
        handledRef.current = true;
        await loginWithToken(parsed.queryParams.token as string);
      }
    } catch {}
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

function AppNavigator() {
  const { isLoading } = useProtectedRoute();
  useDeepLinkAuth();

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const subscription = Notifications.addNotificationResponseReceivedListener(response => {
      const screen = response.notification.request.content.data?.screen;
      if (screen === 'goals') router.push('/(tabs)/goals' as any);
      else if (screen === 'today') router.push('/(tabs)' as any);
      else if (screen === 'coach') router.push('/(tabs)/insights' as any);
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
          <GestureHandlerRootView>
            <KeyboardProvider>
              <AppNavigator />
            </KeyboardProvider>
          </GestureHandlerRootView>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
