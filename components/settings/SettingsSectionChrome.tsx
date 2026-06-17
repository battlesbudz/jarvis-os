import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';

export function SectionHeader({ label, accent }: { label: string; accent: string }) {
  return (
    <View style={[sectionStyles.header, { borderLeftColor: accent }]}>
      <Text style={[sectionStyles.label, { color: accent }]}>{label}</Text>
    </View>
  );
}

export function SectionErrorRow({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <View style={sectionStyles.errorRow}>
      <Ionicons name="alert-circle-outline" size={15} color={Colors.textTertiary} />
      <Text style={sectionStyles.errorText}>{message ?? "Couldn't load"}</Text>
      <Pressable onPress={onRetry} style={sectionStyles.retryBtn}>
        <Text style={sectionStyles.retryText}>Retry</Text>
      </Pressable>
    </View>
  );
}

type HealthStatus = 'healthy' | 'expiring_soon' | 'broken' | 'unconfigured' | string;

export function StatusDot({ status }: { status: HealthStatus }) {
  if (!status || status === 'unconfigured') return null;
  const color =
    status === 'healthy' ? Colors.success :
    status === 'expiring_soon' ? '#F59E0B' :
    status === 'broken' ? Colors.error : Colors.textTertiary;
  return <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, marginLeft: 6, alignSelf: 'center' }} />;
}

export function SettingsFallback({ error, resetError }: { error: Error; resetError: () => void }) {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
      <Ionicons name="warning-outline" size={36} color={Colors.error} style={{ marginBottom: 12 }} />
      <Text style={{ color: Colors.text, fontSize: 15, textAlign: 'center', marginBottom: 8, fontFamily: 'Inter_600SemiBold' }}>
        Settings failed to load
      </Text>
      <Text style={{ color: Colors.textSecondary, fontSize: 13, textAlign: 'center', marginBottom: 20, fontFamily: 'Inter_400Regular' }}>
        {error?.message || 'An unexpected error occurred.'}
      </Text>
      <Pressable onPress={resetError} style={{ backgroundColor: Colors.accent, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 }}>
        <Text style={{ color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>Retry</Text>
      </Pressable>
    </View>
  );
}

export function SectionFallback({ error, resetError }: { error: Error; resetError: () => void }) {
  return (
    <View style={sectionFallbackStyles.card}>
      <Ionicons name="alert-circle-outline" size={16} color={Colors.textTertiary} />
      <Text style={sectionFallbackStyles.message} numberOfLines={1}>
        {error?.message || "This section couldn't load"}
      </Text>
      <Pressable onPress={resetError} style={sectionFallbackStyles.retryBtn}>
        <Text style={sectionFallbackStyles.retryText}>Retry</Text>
      </Pressable>
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  header: { borderLeftWidth: 2, paddingLeft: 10, marginHorizontal: 16, marginTop: 24, marginBottom: 10 },
  label: { fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 2 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 16 },
  errorText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.textTertiary },
  retryBtn: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: Colors.border },
  retryText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: Colors.text },
});

const sectionFallbackStyles = StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 4, marginBottom: 2, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1, borderColor: Colors.border },
  message: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.textTertiary },
  retryBtn: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: Colors.border },
  retryText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: Colors.text },
});
