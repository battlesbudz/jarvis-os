import React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { SectionHeader } from './SettingsSectionChrome';

type BuildLogEntry = { id: string; featureName: string; description: string; outputCode: string; success: boolean; smokeTestPassed: boolean | null; smokeTestArgs: Record<string, unknown> | null; createdAt: string };
type BuildHistorySectionProps = { builds: BuildLogEntry[]; expanded: boolean; expandedBuildId: string | null; onToggleExpanded: () => void; onToggleBuild: (buildId: string) => void };

const stableJson = (obj: Record<string, unknown> | null): string => obj ? JSON.stringify(obj, Object.keys(obj).sort()) : '';

export function BuildHistorySection({ builds, expanded, expandedBuildId, onToggleExpanded, onToggleBuild }: BuildHistorySectionProps) {
  if (builds.length === 0) return null;

  return (
    <>
      <SectionHeader label="BUILD HISTORY" accent="#8B5CF6" />
      <View style={s.card}>
        <Pressable style={s.header} onPress={onToggleExpanded}>
          <View style={s.row}>
            <Ionicons name="code-slash-outline" size={14} color="#8B5CF6" />
            <Text style={s.title}>Build History</Text>
            <View style={s.badge}><Text style={s.badgeText}>{builds.length}</Text></View>
          </View>
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={Colors.textTertiary} />
        </Pressable>
        {expanded && (
          <View style={s.list}>
            {builds.map((build, idx) => {
              const argsJson = build.smokeTestArgs ? JSON.stringify(build.smokeTestArgs, null, 2) : null;
              const reusedArgs = !!build.smokeTestArgs && builds.slice(idx + 1).some(
                older => older.smokeTestPassed && older.smokeTestArgs &&
                  stableJson(older.smokeTestArgs) === stableJson(build.smokeTestArgs),
              );
              const isExpanded = expandedBuildId === build.id;
              const statusColor = !build.success ? Colors.error : build.smokeTestPassed ? '#10B981' : '#F59E0B';
              return (
                <View key={build.id} style={s.buildCard}>
                  <Pressable style={s.buildHeader} onPress={() => onToggleBuild(build.id)}>
                    <View style={s.buildInfo}>
                      <View style={s.wrapRow}>
                        <Ionicons name={!build.success ? 'close-circle' : build.smokeTestPassed ? 'checkmark-circle' : 'alert-circle'} size={12} color={statusColor} />
                        <Text style={s.title}>{build.featureName}</Text>
                        {reusedArgs && (
                          <View style={s.reused}>
                            <Ionicons name="refresh-outline" size={9} color="#8B5CF6" />
                            <Text style={s.reusedText}>reused args</Text>
                          </View>
                        )}
                      </View>
                      <Text style={[s.status, { color: statusColor }]}>
                        {!build.success ? 'Build failed' : build.smokeTestPassed ? 'Built and verified' : 'Built'}
                      </Text>
                      <Text style={s.description} numberOfLines={2}>{build.description}</Text>
                      <Text style={s.date}>
                        {new Date(build.createdAt ?? '').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </Text>
                    </View>
                    <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={12} color={Colors.textTertiary} />
                  </Pressable>
                  {isExpanded && (
                    <>
                      {argsJson && (
                        <View style={{ marginTop: 8 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                            <Ionicons name="flask-outline" size={10} color="#8B5CF6" />
                            <Text style={s.argsTitle}>{reusedArgs ? 'Test Args (reused from prior build)' : 'Test Args'}</Text>
                          </View>
                          <ScrollView style={s.codeBlock} nestedScrollEnabled><Text style={s.codeText} selectable>{argsJson}</Text></ScrollView>
                        </View>
                      )}
                      <ScrollView style={[s.codeBlock, { marginTop: argsJson ? 6 : 8 }]} nestedScrollEnabled>
                        <Text style={s.codeText} selectable>{build.outputCode || '(no code recorded)'}</Text>
                      </ScrollView>
                    </>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </View>
    </>
  );
}

const s = StyleSheet.create({
  argsTitle: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: '#8B5CF6' },
  badge: { backgroundColor: '#8B5CF620', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1 },
  badgeText: { fontSize: 11, color: '#8B5CF6', fontFamily: 'Inter_600SemiBold' },
  buildCard: { backgroundColor: Colors.surfaceAlt, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: Colors.border, gap: 4 },
  buildHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  buildInfo: { flex: 1, gap: 2 },
  card: { backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1, borderColor: Colors.border },
  codeBlock: { marginTop: 8, backgroundColor: Colors.surface, borderRadius: 6, padding: 10, maxHeight: 300 },
  codeText: { fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', color: Colors.textSecondary, lineHeight: 16 },
  date: { fontSize: 10, color: Colors.textTertiary, fontFamily: 'Inter_400Regular', marginTop: 2 },
  description: { fontSize: 11, color: Colors.textTertiary, fontFamily: 'Inter_400Regular' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14 },
  list: { paddingHorizontal: 14, paddingBottom: 14, gap: 8 },
  reused: { backgroundColor: '#8B5CF620', borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1, flexDirection: 'row', alignItems: 'center', gap: 3 },
  reusedText: { fontSize: 9, color: '#8B5CF6', fontFamily: 'Inter_600SemiBold' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  status: { fontSize: 10, fontFamily: 'Inter_500Medium', marginBottom: 2 },
  title: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: Colors.text },
  wrapRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
});
