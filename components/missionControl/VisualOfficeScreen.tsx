import React, { useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Animated,
  Platform,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/colors';
import VisionSprite from '@/components/VisionSprite';

interface Agent {
  id: string;
  name: string;
  role: string;
  isActive: number;
  loopEnabled: number;
  loopIntervalMinutes: number | null;
  loopPrompt: string | null;
  lastLoopRun: string | null;
  createdAt: string;
}

type AgentStatus = 'ACTIVE' | 'STANDBY' | 'ON-DEMAND';

function getRoleColor(role: string): string {
  const r = role.toUpperCase();
  if (r === 'PRIME' || r === 'ATLAS') return '#10B981';
  if (r === 'ORACLE' || r === 'ECHO') return '#9B59FF';
  if (r === 'HERALD') return '#F59E0B';
  if (r === 'FORGE') return '#EF4444';
  if (r === 'SCOUT') return '#3B82F6';
  return '#00C8FF';
}

function getAgentStatus(agent: Agent): AgentStatus {
  if (agent.isActive !== 1) return 'ON-DEMAND';
  if (!agent.lastLoopRun) return 'STANDBY';
  const minsAgo = (Date.now() - new Date(agent.lastLoopRun).getTime()) / 60000;
  return minsAgo <= 5 ? 'ACTIVE' : 'STANDBY';
}

function formatTimeAgo(dt: string | null): string {
  if (!dt) return 'never';
  const diff = Date.now() - new Date(dt).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatNextRun(agent: Agent): string {
  if (agent.isActive !== 1) return 'on demand';
  if (!agent.loopEnabled) return 'disabled';
  if (!agent.lastLoopRun || !agent.loopIntervalMinutes) return 'soon';
  const nextMs = new Date(agent.lastLoopRun).getTime() + agent.loopIntervalMinutes * 60000;
  const diffMins = Math.round((nextMs - Date.now()) / 60000);
  if (diffMins <= 0) return 'overdue';
  if (diffMins < 60) return `in ${diffMins}m`;
  return `in ${Math.round(diffMins / 60)}h`;
}

function getFirstLineOfPrompt(loopPrompt: string | null): string {
  if (!loopPrompt) return '';
  const line = loopPrompt.split('\n')[0].trim();
  return line.length > 50 ? line.slice(0, 50) + '…' : line;
}

const STATUS_BADGE_CONFIG = {
  ACTIVE: { color: Colors.success, bg: Colors.success + '20' },
  STANDBY: { color: Colors.textSecondary, bg: Colors.surfaceAlt },
  'ON-DEMAND': { color: Colors.violet, bg: Colors.violet + '20' },
};

function AgentRoomCard({ agent }: { agent: Agent }) {
  const color = getRoleColor(agent.role);
  const status = getAgentStatus(agent);
  const isActive = status === 'ACTIVE';
  const badge = STATUS_BADGE_CONFIG[status];
  const assignment = getFirstLineOfPrompt(agent.loopPrompt);

  return (
    <View style={[styles.roomCard, { borderColor: color + '50' }]}>
      <View style={[styles.roomGlow, { backgroundColor: color + '08' }]} />
      <Text style={[styles.roomName, { color: color + 'BB', fontFamily: 'Inter_700Bold' }]} numberOfLines={1}>
        {agent.name.toUpperCase()} ROOM
      </Text>

      <View style={styles.spriteWrap}>
        <VisionSprite size={52} tint={color} active={isActive} />
      </View>

      <View style={styles.agentInfo}>
        <Text style={styles.agentName} numberOfLines={1}>{agent.name}</Text>
        <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
          <View style={[styles.statusDot, { backgroundColor: badge.color }]} />
          <Text style={[styles.statusText, { color: badge.color }]}>{status}</Text>
        </View>
      </View>

      {assignment ? (
        <Text style={styles.assignmentText} numberOfLines={1}>» {assignment}</Text>
      ) : null}

      <View style={styles.timingRow}>
        <Text style={styles.timingText}>last: {formatTimeAgo(agent.lastLoopRun)}</Text>
        <Text style={styles.timingDot}>·</Text>
        <Text style={styles.timingText}>next: {formatNextRun(agent)}</Text>
      </View>
    </View>
  );
}

function AgentListCard({ agent }: { agent: Agent }) {
  const color = getRoleColor(agent.role);
  const status = getAgentStatus(agent);
  const badge = STATUS_BADGE_CONFIG[status];
  const assignment = getFirstLineOfPrompt(agent.loopPrompt);

  return (
    <View style={styles.agentListCard}>
      <View style={[styles.agentListAccent, { backgroundColor: color }]} />
      <VisionSprite size={36} tint={color} active={status === 'ACTIVE'} />
      <View style={styles.agentListContent}>
        <View style={styles.agentListTop}>
          <Text style={styles.agentListName}>{agent.name}</Text>
          <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
            <View style={[styles.statusDot, { backgroundColor: badge.color }]} />
            <Text style={[styles.statusText, { color: badge.color }]}>{status}</Text>
          </View>
        </View>
        <Text style={styles.agentListMeta}>
          last: {formatTimeAgo(agent.lastLoopRun)} · next: {formatNextRun(agent)}
        </Text>
        {assignment ? <Text style={styles.agentListAssignment} numberOfLines={1}>» {assignment}</Text> : null}
      </View>
    </View>
  );
}

function StatusTicker({ agents }: { agents: Agent[] }) {
  const scrollX = useRef(new Animated.Value(0)).current;
  const containerWidth = useRef(0);
  const textWidth = useRef(0);
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  const tickerText = useMemo(() => {
    if (!agents.length) return '• JARVIS ONLINE';
    return agents.map(a => {
      const status = getAgentStatus(a);
      const timeStr = a.lastLoopRun ? formatTimeAgo(a.lastLoopRun) : 'never';
      return `• ${a.name.toUpperCase()}: ${status} (${timeStr})`;
    }).join('  ');
  }, [agents]);

  const startScroll = () => {
    if (!textWidth.current || !containerWidth.current) return;
    const totalDist = textWidth.current + containerWidth.current;
    const duration = totalDist * 20;

    scrollX.setValue(containerWidth.current);
    animRef.current = Animated.loop(
      Animated.timing(scrollX, {
        toValue: -textWidth.current,
        duration,
        useNativeDriver: true,
      })
    );
    animRef.current.start();
  };

  useEffect(() => {
    return () => { animRef.current?.stop(); };
  }, []);

  return (
    <View
      style={styles.tickerWrap}
      onLayout={e => {
        containerWidth.current = e.nativeEvent.layout.width;
        startScroll();
      }}
    >
      <View style={[styles.tickerLabelWrap]}>
        <Ionicons name="radio-outline" size={10} color={Colors.cyan} />
        <Text style={styles.tickerLabel}>LIVE</Text>
      </View>
      <View style={styles.tickerScroll}>
        <Animated.Text
          style={[styles.tickerText, { transform: [{ translateX: scrollX }] }]}
          onLayout={e => {
            textWidth.current = e.nativeEvent.layout.width;
            startScroll();
          }}
          numberOfLines={1}
        >
          {tickerText}{'    '}{tickerText}
        </Animated.Text>
      </View>
    </View>
  );
}

export default function VisualOfficeScreen() {
  const insets = useSafeAreaInsets();
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const { data, isLoading, isError } = useQuery<{ agents: Agent[] }>({
    queryKey: ['/api/agents'],
    refetchInterval: 30_000,
  });

  const agents = data?.agents ?? [];

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.cyan} />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.centered}>
        <Ionicons name="warning-outline" size={28} color={Colors.error} />
        <Text style={styles.emptyText}>Failed to load agents</Text>
      </View>
    );
  }

  if (!agents.length) {
    return (
      <View style={styles.centered}>
        <Ionicons name="hardware-chip-outline" size={36} color={Colors.cyan} style={{ opacity: 0.5 }} />
        <Text style={styles.emptyTitle}>No agents deployed</Text>
        <Text style={styles.emptyText}>Set up Discord to deploy your first agent</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad + 90 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Room Grid */}
      <View style={styles.sectionLabel}>
        <Ionicons name="grid-outline" size={12} color={Colors.cyan} />
        <Text style={styles.sectionLabelText}>AGENT ROOMS</Text>
      </View>

      <View style={styles.roomGrid}>
        {agents.map(a => (
          <View key={a.id} style={styles.roomCardWrap}>
            <AgentRoomCard agent={a} />
          </View>
        ))}
      </View>

      {/* Status Ticker — below the grid */}
      <StatusTicker agents={agents} />

      {/* Agent List */}
      <View style={[styles.sectionLabel, { marginTop: 6 }]}>
        <Ionicons name="list-outline" size={12} color={Colors.cyan} />
        <Text style={styles.sectionLabelText}>AGENT STATUS</Text>
      </View>

      <View style={styles.agentList}>
        {agents.map(a => (
          <AgentListCard key={a.id} agent={a} />
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    letterSpacing: 0.3,
  },
  emptyText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 14,
    paddingTop: 8,
    gap: 10,
  },
  tickerWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.cyan + '30',
    paddingVertical: 7,
    overflow: 'hidden',
    gap: 0,
  },
  tickerLabelWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    borderRightWidth: 1,
    borderRightColor: Colors.cyan + '30',
    paddingVertical: 2,
  },
  tickerLabel: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    color: Colors.cyan,
    letterSpacing: 1.5,
  },
  tickerScroll: {
    flex: 1,
    overflow: 'hidden',
    paddingHorizontal: 8,
  },
  tickerText: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
    letterSpacing: 0.3,
  },
  sectionLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  sectionLabelText: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    color: Colors.cyan,
    letterSpacing: 1.5,
  },
  roomGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  roomCardWrap: {
    width: '48%',
  },
  roomCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1.5,
    padding: 12,
    gap: 6,
    minHeight: 160,
    overflow: 'hidden',
    position: 'relative',
  },
  roomGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 12,
  },
  roomName: {
    fontSize: 9,
    letterSpacing: 1,
  },
  spriteWrap: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  agentInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  agentName: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    flex: 1,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  statusText: {
    fontSize: 8,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.8,
  },
  assignmentText: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
    fontStyle: 'italic',
  },
  timingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  timingText: {
    fontSize: 9,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
    flex: 1,
  },
  timingDot: {
    fontSize: 9,
    color: Colors.textTertiary,
  },
  agentList: {
    gap: 8,
  },
  agentListCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    gap: 12,
    overflow: 'hidden',
  },
  agentListAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
  },
  agentListContent: {
    flex: 1,
    gap: 3,
  },
  agentListTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  agentListName: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    flex: 1,
  },
  agentListMeta: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
  },
  agentListAssignment: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    fontStyle: 'italic',
  },
});
