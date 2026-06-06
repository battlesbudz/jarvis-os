import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Platform,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Colors from '@/constants/colors';
import VisionSprite from '@/components/VisionSprite';
import TasksScreen from '@/components/missionControl/TasksScreen';
import CalendarScreen from '@/components/missionControl/CalendarScreen';
import MemoryScreen from '@/components/missionControl/MemoryScreen';
import ProjectsScreen from '@/components/missionControl/ProjectsScreen';
import UsageScreen from '@/components/missionControl/UsageScreen';
import VisualOfficeScreen from '@/components/missionControl/VisualOfficeScreen';
import { apiRequest } from '@/lib/query-client';

const TABS = ['Tasks', 'Calendar', 'Projects', 'Memory', 'Usage', 'Visual'] as const;
type TabName = typeof TABS[number];

function usePrimeStatus(): boolean | null {
  const [online, setOnline] = useState<boolean | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const check = async () => {
      try {
        const res = await apiRequest('GET', '/api/agents');
        setOnline(res.ok);
      } catch {
        setOnline(false);
      }
    };
    check();
    timerRef.current = setInterval(check, 30_000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  return online;
}

function StatusDot({ online }: { online: boolean | null }) {
  const color =
    online === null ? Colors.textTertiary :
    online ? Colors.green : Colors.error;
  return <View style={[styles.statusDot, { backgroundColor: color }]} />;
}

function SegmentControl({ active, onChange }: { active: number; onChange: (i: number) => void }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.segmentScroll}
      contentContainerStyle={styles.segmentContent}
    >
      {TABS.map((tab, i) => {
        const isActive = i === active;
        return (
          <Pressable
            key={tab}
            testID={`mission-control-tab-${tab.toLowerCase()}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            onPress={() => onChange(i)}
            style={[styles.segmentBtn, isActive && styles.segmentBtnActive]}
          >
            <Text style={[styles.segmentText, isActive && styles.segmentTextActive]}>
              {tab}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function TabContent({ tab }: { tab: TabName }) {
  switch (tab) {
    case 'Tasks':
      return <TasksScreen />;
    case 'Calendar':
      return <CalendarScreen />;
    case 'Projects':
      return <ProjectsScreen />;
    case 'Memory':
      return <MemoryScreen />;
    case 'Usage':
      return <UsageScreen />;
    case 'Visual':
      return <VisualOfficeScreen />;
  }
}

export default function MissionControlScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const primeOnline = usePrimeStatus();
  const [activeTab, setActiveTab] = useState<number>(0);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : 0;

  const statusLabel =
    primeOnline === null ? 'CHECKING' :
    primeOnline ? 'PRIME ONLINE' : 'PRIME OFFLINE';

  const statusColor =
    primeOnline === null ? Colors.textTertiary :
    primeOnline ? Colors.green : Colors.error;

  const handleTabChange = (index: number) => {
    if (TABS[index] === 'Projects') {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.location.assign('/projects');
        return;
      }
      router.navigate('/projects');
      return;
    }
    setActiveTab(index);
  };

  return (
    <View style={[styles.root, { paddingTop: topPad, paddingBottom: bottomPad }]}>
      {/* ── Header ─────────────────────────────────────── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <VisionSprite size={44} />
        </View>

        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>JARVIS COMMAND</Text>
          <Text style={styles.headerSub}>Mission Control</Text>
        </View>

        <View style={styles.headerRight}>
          <View style={styles.statusPill}>
            <StatusDot online={primeOnline} />
            <Text style={[styles.statusLabel, { color: statusColor }]}>
              {statusLabel}
            </Text>
          </View>
        </View>
      </View>

      {/* ── Separator ──────────────────────────────────── */}
      <View style={styles.headerSep} />

      {/* ── Segment Control ────────────────────────────── */}
      <SegmentControl active={activeTab} onChange={handleTabChange} />

      {/* ── Content ────────────────────────────────────── */}
      <View style={styles.content}>
        <TabContent tab={TABS[activeTab]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },

  /* Header */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  headerLeft: {
    flexShrink: 0,
  },
  headerCenter: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: Colors.text,
    letterSpacing: 2,
  },
  headerSub: {
    fontSize: 11,
    color: Colors.textTertiary,
    letterSpacing: 0.5,
    marginTop: 1,
  },
  headerRight: {
    flexShrink: 0,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.surface,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
  },

  headerSep: {
    height: 1,
    backgroundColor: Colors.border,
    marginHorizontal: 0,
  },

  /* Segment */
  segmentScroll: {
    maxHeight: 46,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  segmentContent: {
    paddingHorizontal: 12,
    gap: 4,
    alignItems: 'center',
    height: 46,
  },
  segmentBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  segmentBtnActive: {
    backgroundColor: Colors.greenDim,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.textSecondary,
  },
  segmentTextActive: {
    color: Colors.green,
    fontWeight: '700',
  },

  /* Content */
  content: {
    flex: 1,
  },
});
