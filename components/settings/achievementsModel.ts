import {
  ALL_BADGES,
  getAvailableRewards,
  getLevel,
  getLevelName,
  getLifetimeXp,
  getXpForNextLevel,
  type UserStats,
} from '@/lib/storage';

export function buildAchievementsSectionModel(stats: UserStats) {
  const lifetimeXp = getLifetimeXp(stats);
  const xpInfo = getXpForNextLevel(lifetimeXp);
  return {
    lifetimeXp,
    level: getLevel(lifetimeXp),
    levelName: getLevelName(lifetimeXp),
    xpInfo,
    xpProgress: xpInfo.progress,
    availableRewards: getAvailableRewards(lifetimeXp),
    earnedBadges: (stats.badges ?? []).map(id => ALL_BADGES.find(b => b.id === id)).filter(Boolean),
  };
}
