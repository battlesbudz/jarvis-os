import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { NativeTabs, Icon, Label } from "expo-router/unstable-native-tabs";
import { BlurView } from "expo-blur";
import { Platform, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import Colors from "@/constants/colors";
import { useQuery } from "@tanstack/react-query";

function usePendingMemoryBadge(): number {
  const { data: memoryData } = useQuery<{ memories: { id: string }[] }>({
    queryKey: ["/api/memory/pending-review"],
    refetchInterval: 60000,
  });
  const { data: livingData } = useQuery<{ updates: { id: string }[] }>({
    queryKey: ["/api/living-context/pending-review"],
    refetchInterval: 60000,
  });
  return (memoryData?.memories?.length ?? 0) + (livingData?.updates?.length ?? 0);
}

function NativeTabLayout() {
  const pendingMemoryCount = usePendingMemoryBadge();
  const profileLabel = pendingMemoryCount > 0 ? `Profile (${pendingMemoryCount})` : "Profile";
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: "square.grid.2x2", selected: "square.grid.2x2.fill" }} />
        <Label>Mission Control</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="insights">
        <Icon sf={{ default: "sparkles", selected: "sparkles" }} />
        <Label>Jarvis</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="agents">
        <Icon sf={{ default: "person.2", selected: "person.2.fill" }} />
        <Label>Agents</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <Icon sf={{ default: "gearshape", selected: "gearshape.fill" }} />
        <Label>Settings</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <Icon sf={{ default: "person.circle", selected: "person.circle.fill" }} />
        <Label>{profileLabel}</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const isWeb = Platform.OS === "web";
  const isIOS = Platform.OS === "ios";
  const pendingMemoryCount = usePendingMemoryBadge();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textTertiary,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: Colors.surface,
          borderTopWidth: 1,
          borderTopColor: Colors.border,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={80}
              tint="dark"
              style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(7,8,15,0.85)' }]}
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: Colors.surface }]} />
          ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Mission Control",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? "grid" : "grid-outline"}
              size={24}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen name="inbox" options={{ href: null }} />
      <Tabs.Screen
        name="insights"
        options={{
          title: "Jarvis",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? "sparkles" : "sparkles-outline"}
              size={24}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen name="scheduled" options={{ href: null }} />
      <Tabs.Screen name="projects" options={{ href: null }} />
      <Tabs.Screen
        name="agents"
        options={{
          title: "Agents",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? "people" : "people-outline"}
              size={24}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? "settings" : "settings-outline"}
              size={24}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen name="goals" options={{ href: null }} />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarBadge: pendingMemoryCount > 0 ? pendingMemoryCount : undefined,
          tabBarBadgeStyle: { backgroundColor: Colors.primary, color: '#fff', fontSize: 10 },
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? "person-circle" : "person-circle-outline"}
              size={24}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}
