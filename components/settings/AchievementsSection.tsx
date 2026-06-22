import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import {
  ALL_BADGES,
  getAvailableRewards,
  getLevel,
  getLevelName,
  getLifetimeXp,
  getXpForNextLevel,
  TIER_COLORS,
  type Reward,
  type UserStats,
} from '@/lib/storage';
import { SectionHeader } from './SettingsSectionChrome';

type AchievementsSectionProps = {
  stats: UserStats;
  onRewardPress: (reward: Reward) => void;
};

export function AchievementsSection({ stats, onRewardPress }: AchievementsSectionProps) {
  const lifetimeXp = getLifetimeXp(stats);
  const level = getLevel(lifetimeXp);
  const levelName = getLevelName(lifetimeXp);
  const xpInfo = getXpForNextLevel(lifetimeXp);
  const xpProgress = xpInfo.progress;
  const availableRewards = getAvailableRewards(lifetimeXp);
  const earnedBadges = (stats.badges ?? []).map(id => ALL_BADGES.find(b => b.id === id)).filter(Boolean);

  return (
    <>
      <SectionHeader label="ACHIEVEMENTS" accent={Colors.cyan} />
      <View style={s.card}>
        <View style={s.xpBlock}>
          <View style={s.xpTopRow}>
            <View>
              <Text style={s.xpLevelLabel}>LEVEL {level}</Text>
              <Text style={s.xpLevelName}>{levelName}</Text>
            </View>
            <View style={s.xpRight}>
              <Text style={s.xpValue}>{lifetimeXp} XP</Text>
              <Text style={s.xpNext}>Next: {xpInfo.needed} XP</Text>
            </View>
          </View>
          <View style={s.xpBarTrack}>
            <View style={[s.xpBarFill, { width: `${Math.min(100, Math.round(xpProgress * 100))}%` }]} />
          </View>
          <View style={s.xpStats}>
            <View style={s.xpStat}><Text style={s.xpStatValue}>{stats.streak}</Text><Text style={s.xpStatLabel}>Streak</Text></View>
            <View style={s.xpStat}><Text style={s.xpStatValue}>{stats.totalCompleted}</Text><Text style={s.xpStatLabel}>Completed</Text></View>
            <View style={s.xpStat}><Text style={s.xpStatValue}>{stats.bestStreak}</Text><Text style={s.xpStatLabel}>Best</Text></View>
          </View>
        </View>

        {earnedBadges.length > 0 && (
          <View style={[s.badgeBlock, s.prefRowBorder]}>
            <Text style={s.badgeSectionTitle}>BADGES</Text>
            <View style={s.badgeRow}>
              {earnedBadges.slice(0, 8).map(badge => badge && (
                <View key={badge.id} style={s.badge}>
                  <Ionicons name={badge.icon as any} size={20} color={Colors.violet} />
                  <Text style={s.badgeLabel} numberOfLines={1}>{badge.label}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {availableRewards.length > 0 && (
          <View style={s.prefRowBorder}>
            <Text style={[s.badgeSectionTitle, { marginTop: 12, marginBottom: 8 }]}>REWARDS TO CLAIM</Text>
            {availableRewards.slice(0, 3).map(reward => (
              <Pressable
                key={reward.id}
                style={[s.rewardRow, { borderColor: TIER_COLORS[reward.tier] + '40', backgroundColor: TIER_COLORS[reward.tier] + '12' }]}
                onPress={() => onRewardPress(reward)}
              >
                <Ionicons name={reward.icon as any} size={18} color={TIER_COLORS[reward.tier]} />
                <View style={s.rewardInfo}>
                  <Text style={[s.rewardName, { color: TIER_COLORS[reward.tier] }]}>{reward.title}</Text>
                  <Text style={s.rewardDesc} numberOfLines={1}>{reward.description}</Text>
                </View>
                <Text style={[s.rewardClaim, { color: TIER_COLORS[reward.tier] }]}>Claim →</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </>
  );
}

const s = StyleSheet.create({
  card: { marginHorizontal: 16, backgroundColor: Colors.surface, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  prefRowBorder: { borderTopWidth: 1, borderTopColor: Colors.border },
  xpBlock: { padding: 16, gap: 10 },
  xpTopRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  xpLevelLabel: { fontSize: 10, fontFamily: 'Inter_700Bold', color: Colors.cyan, letterSpacing: 1.5 },
  xpLevelName: { fontSize: 18, fontFamily: 'Inter_700Bold', color: Colors.text, marginTop: 2 },
  xpRight: { alignItems: 'flex-end', gap: 2 },
  xpValue: { fontSize: 16, fontFamily: 'Inter_700Bold', color: Colors.cyan },
  xpNext: { fontSize: 11, fontFamily: 'Inter_400Regular', color: Colors.textSecondary },
  xpBarTrack: { height: 4, backgroundColor: Colors.border, borderRadius: 2, overflow: 'hidden' },
  xpBarFill: { height: '100%', backgroundColor: Colors.cyan, borderRadius: 2 },
  xpStats: { flexDirection: 'row', gap: 20, paddingTop: 4 },
  xpStat: { alignItems: 'center', gap: 2 },
  xpStatValue: { fontSize: 18, fontFamily: 'Inter_700Bold', color: Colors.text },
  xpStatLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, letterSpacing: 0.5 },
  badgeBlock: { padding: 14, gap: 8 },
  badgeSectionTitle: { fontSize: 9, fontFamily: 'Inter_700Bold', color: Colors.textTertiary, letterSpacing: 1.5 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  badge: { alignItems: 'center', width: 52, gap: 4 },
  badgeLabel: { fontSize: 9, fontFamily: 'Inter_500Medium', color: Colors.textSecondary, textAlign: 'center' },
  rewardRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 8 },
  rewardInfo: { flex: 1, gap: 2 },
  rewardName: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  rewardDesc: { fontSize: 11, fontFamily: 'Inter_400Regular', color: Colors.textSecondary },
  rewardClaim: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
});
