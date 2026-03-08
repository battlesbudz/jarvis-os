import React, { useCallback, useEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Colors from '@/constants/colors';
import SuggestionCard from '@/components/SuggestionCard';
import { getSuggestions, getStats, type Suggestion, type UserStats } from '@/lib/storage';

const CATEGORY_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'finance', label: 'Finance' },
  { key: 'career', label: 'Career' },
  { key: 'wellness', label: 'Wellness' },
  { key: 'activity', label: 'Activities' },
  { key: 'date_night', label: 'Date Night' },
] as const;

export default function InsightsScreen() {
  const insets = useSafeAreaInsets();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [stats, setStats] = useState<UserStats>({ streak: 0, totalCompleted: 0, bestStreak: 0 });
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    setSuggestions(getSuggestions());
    getStats().then(setStats);
  }, []);

  const filteredSuggestions = filter === 'all'
    ? suggestions
    : suggestions.filter(s => s.category === filter);

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + 16 + (Platform.OS === 'web' ? 67 : 0),
            paddingBottom: Platform.OS === 'web' ? 34 + 100 : 120,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeInDown.duration(400).delay(100)}>
          <Text style={styles.title}>Insights</Text>
          <Text style={styles.subtitle}>Smart recommendations for you</Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(400).delay(200)} style={styles.statsRow}>
          <View style={styles.statCard}>
            <View style={[styles.statIconBg, { backgroundColor: Colors.primary + '15' }]}>
              <Ionicons name="flame-outline" size={20} color={Colors.primary} />
            </View>
            <Text style={styles.statValue}>{stats.streak}</Text>
            <Text style={styles.statLabel}>Day Streak</Text>
          </View>
          <View style={styles.statCard}>
            <View style={[styles.statIconBg, { backgroundColor: Colors.success + '15' }]}>
              <Ionicons name="checkmark-done-outline" size={20} color={Colors.success} />
            </View>
            <Text style={styles.statValue}>{stats.totalCompleted}</Text>
            <Text style={styles.statLabel}>Completed</Text>
          </View>
          <View style={styles.statCard}>
            <View style={[styles.statIconBg, { backgroundColor: Colors.warning + '15' }]}>
              <Ionicons name="trophy-outline" size={20} color={Colors.warning} />
            </View>
            <Text style={styles.statValue}>{stats.bestStreak}</Text>
            <Text style={styles.statLabel}>Best Streak</Text>
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(400).delay(300)}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            {CATEGORY_FILTERS.map(({ key, label }) => (
              <View
                key={key}
                style={[
                  styles.filterChip,
                  filter === key && styles.filterChipActive,
                ]}
              >
                <Text
                  style={[
                    styles.filterText,
                    filter === key && styles.filterTextActive,
                  ]}
                  onPress={() => setFilter(key)}
                >
                  {label}
                </Text>
              </View>
            ))}
          </ScrollView>
        </Animated.View>

        <View style={styles.suggestionsSection}>
          <Text style={styles.sectionTitle}>Recommendations</Text>
          {filteredSuggestions.length === 0 ? (
            <View style={styles.emptyFilter}>
              <Ionicons name="search-outline" size={36} color={Colors.textTertiary} />
              <Text style={styles.emptyFilterText}>No suggestions in this category</Text>
            </View>
          ) : (
            filteredSuggestions.map((suggestion, index) => (
              <Animated.View key={suggestion.id} entering={FadeInDown.duration(300).delay(400 + index * 60)}>
                <SuggestionCard suggestion={suggestion} />
              </Animated.View>
            ))
          )}
        </View>

        <Animated.View entering={FadeInDown.duration(400).delay(600)} style={styles.tipCard}>
          <View style={styles.tipHeader}>
            <Ionicons name="sparkles-outline" size={18} color={Colors.secondary} />
            <Text style={styles.tipTitle}>Pro Tip</Text>
          </View>
          <Text style={styles.tipText}>
            Connect more platforms in your profile to get smarter, more personalized recommendations that align with your goals.
          </Text>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.surface,
  },
  scrollContent: {
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    marginTop: 2,
    marginBottom: 20,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statIconBg: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  statValue: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
  },
  statLabel: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: Colors.textTertiary,
    marginTop: 2,
  },
  filterRow: {
    gap: 8,
    paddingBottom: 4,
    marginBottom: 20,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  filterText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
  },
  filterTextActive: {
    color: Colors.white,
  },
  suggestionsSection: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
    marginBottom: 12,
  },
  emptyFilter: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 8,
  },
  emptyFilterText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
  },
  tipCard: {
    backgroundColor: Colors.secondary + '10',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.secondary + '20',
    marginBottom: 20,
  },
  tipHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  tipTitle: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.secondary,
  },
  tipText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    lineHeight: 20,
  },
});
