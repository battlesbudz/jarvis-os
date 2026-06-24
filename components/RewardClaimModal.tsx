import React, { useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  Modal,
  Platform,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
  withDelay,
  withRepeat,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/colors';
import { TIER_COLORS, type Reward } from '@/lib/storage';

interface RewardClaimModalProps {
  visible: boolean;
  reward: Reward | null;
  onClose: () => void;
  onClaim: () => void;
  claimCount: number;
  lastClaimedAt?: string;
  canClaim: boolean;
  budgetRemaining: number;
  dailyXpRequired: number;
  claimedToday: boolean;
}

const TIER_LABELS: Record<number, string> = {
  1: 'TIER 1 REWARD',
  2: 'TIER 2 REWARD',
  3: 'TIER 3 REWARD',
  4: 'TIER 4 REWARD',
  5: 'TIER 5 REWARD',
};

function Sparkle({ x, y, delay, color }: { x: number; y: number; delay: number; color: string }) {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.3);
  const ty = useSharedValue(0);

  useEffect(() => {
    opacity.value = withDelay(delay, withRepeat(
      withSequence(withTiming(1, { duration: 600 }), withTiming(0, { duration: 600 })),
      -1, true
    ));
    scale.value = withDelay(delay, withRepeat(
      withSequence(withSpring(1.2), withSpring(0.6)),
      -1, true
    ));
    ty.value = withDelay(delay, withRepeat(
      withSequence(withTiming(-12, { duration: 900 }), withTiming(0, { duration: 900 })),
      -1, true
    ));
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }, { translateY: ty.value }],
  }));

  return (
    <Animated.View style={[{ position: 'absolute', left: x, top: y }, style]}>
      <Ionicons name="star" size={10} color={color} />
    </Animated.View>
  );
}

export default function RewardClaimModal({
  visible,
  reward,
  onClose,
  onClaim,
  claimCount,
  lastClaimedAt,
  canClaim,
  budgetRemaining,
  dailyXpRequired,
  claimedToday,
}: RewardClaimModalProps) {
  const insets = useSafeAreaInsets();
  const iconScale = useSharedValue(0.5);
  const cardY = useSharedValue(60);
  const cardOpacity = useSharedValue(0);
  const checkScale = useSharedValue(0);
  const [claimed, setClaimed] = React.useState(false);

  useEffect(() => {
    if (visible) {
      iconScale.value = withSpring(1, { damping: 10, stiffness: 100 });
      cardY.value = withSpring(0, { damping: 16, stiffness: 120 });
      cardOpacity.value = withTiming(1, { duration: 250 });
    } else {
      iconScale.value = 0.5;
      cardY.value = 60;
      cardOpacity.value = 0;
      setClaimed(false);
      checkScale.value = 0;
    }
  }, [visible]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: iconScale.value }],
  }));

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: cardY.value }],
    opacity: cardOpacity.value,
  }));

  const checkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkScale.value }],
  }));

  const handleClaim = () => {
    setClaimed(true);
    checkScale.value = withSpring(1, { damping: 8, stiffness: 120 });
    onClaim();
  };

  if (!reward) return null;

  const tierColor = TIER_COLORS[reward.tier] || Colors.primary;
  const formattedDate = lastClaimedAt
    ? new Date(lastClaimedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  const sparklePositions = [
    { x: 20, y: 20, delay: 0 },
    { x: 260, y: 10, delay: 300 },
    { x: 40, y: 120, delay: 600 },
    { x: 240, y: 100, delay: 150 },
    { x: 130, y: 5, delay: 450 },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={claimed ? undefined : onClose}>
        <Animated.View style={[styles.card, cardStyle]} onStartShouldSetResponder={() => true}>

          {claimed ? (
            /* ── Success view ── */
            <View style={styles.successContainer}>
              <Animated.View style={[styles.successCheck, checkStyle]}>
                <Ionicons name="checkmark-circle" size={80} color="#10B981" />
              </Animated.View>
              <Text style={styles.successTitle}>Reward Claimed!</Text>
              <Text style={[styles.successRewardName, { color: tierColor }]}>{reward.title}</Text>
              <Text style={styles.successMessage}>You&apos;ve earned it — go enjoy it!</Text>
              <View style={styles.successXpRow}>
                <Ionicons name="flash" size={14} color="#DC2626" />
                <Text style={styles.successXpText}>−{dailyXpRequired} XP spent</Text>
              </View>
              <Pressable
                style={({ pressed }) => [styles.claimBtn, { backgroundColor: tierColor, marginTop: 24 }, pressed && { opacity: 0.85 }]}
                onPress={onClose}
              >
                <Text style={styles.claimBtnText}>Enjoy! 🎉</Text>
              </Pressable>
            </View>
          ) : (
            <>
              {/* Sparkles */}
              {sparklePositions.map((s, i) => (
                <Sparkle key={i} x={s.x} y={s.y} delay={s.delay} color={tierColor} />
              ))}

              {/* Tier badge */}
              <View style={[styles.tierBadge, { backgroundColor: tierColor + '20', borderColor: tierColor + '40' }]}>
                <Text style={[styles.tierBadgeText, { color: tierColor }]}>
                  {TIER_LABELS[reward.tier]}
                </Text>
              </View>

              {/* Icon */}
              <Animated.View style={[styles.iconCircle, { backgroundColor: tierColor + '18' }, iconStyle]}>
                <Ionicons name={reward.icon as any} size={44} color={tierColor} />
              </Animated.View>

              {/* Content */}
              <Text style={styles.title}>{reward.title}</Text>
              <Text style={styles.description}>{reward.description}</Text>
              <Text style={[styles.tip, { color: tierColor }]}>&quot;{reward.tip}&quot;</Text>

              {/* XP cost badge */}
              <View style={[styles.xpCostBadge, { backgroundColor: tierColor + '15', borderColor: tierColor + '30' }]}>
                <Ionicons name="flash" size={13} color={tierColor} />
                <Text style={[styles.xpCostText, { color: tierColor }]}>Costs {dailyXpRequired} XP</Text>
              </View>

              {/* Prior claim history */}
              {claimCount > 0 && !claimedToday && (
                <View style={styles.claimedRow}>
                  <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
                  <Text style={styles.claimedText}>
                    Redeemed ×{claimCount}{formattedDate ? ` — last ${formattedDate}` : ''}
                  </Text>
                </View>
              )}

              {/* Action */}
              {claimedToday ? (
                <View style={styles.actionBlock}>
                  <View style={styles.todayRow}>
                    <Ionicons name="moon-outline" size={16} color="#D97706" />
                    <Text style={styles.todayText}>You&apos;ve claimed this today — come back tomorrow!</Text>
                  </View>
                  <Pressable style={[styles.claimBtn, styles.claimBtnDisabled]} disabled>
                    <Ionicons name="checkmark-outline" size={18} color="#fff" />
                    <Text style={styles.claimBtnText}>Claimed Today</Text>
                  </Pressable>
                  <Pressable onPress={onClose} style={({ pressed }) => [styles.maybeLater, pressed && { opacity: 0.7 }]}>
                    <Text style={styles.maybeLaterText}>Close</Text>
                  </Pressable>
                </View>
              ) : !canClaim ? (
                <View style={styles.actionBlock}>
                  <View style={styles.xpProgressContainer}>
                    <View style={styles.xpProgressBg}>
                      <View style={[styles.xpProgressFill, {
                        width: `${Math.min(100, Math.round((budgetRemaining / dailyXpRequired) * 100))}%` as any,
                        backgroundColor: tierColor,
                      }]} />
                    </View>
                    {budgetRemaining === 0 ? (
                      <Text style={styles.xpProgressText}>
                        Daily budget spent — complete more tasks to earn budget
                      </Text>
                    ) : (
                      <Text style={styles.xpProgressText}>
                        Costs {dailyXpRequired} XP — {dailyXpRequired - budgetRemaining} more budget needed ({budgetRemaining} remaining)
                      </Text>
                    )}
                  </View>
                  <Pressable style={[styles.claimBtn, styles.claimBtnDisabled]} disabled>
                    <Ionicons name="lock-closed-outline" size={18} color="#fff" />
                    <Text style={styles.claimBtnText}>
                      {budgetRemaining === 0 ? 'No Budget Left' : 'Not Enough Budget'}
                    </Text>
                  </Pressable>
                  <Pressable onPress={onClose} style={({ pressed }) => [styles.maybeLater, pressed && { opacity: 0.7 }]}>
                    <Text style={styles.maybeLaterText}>Maybe later</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={[styles.actionBlock, claimCount > 0 && { marginTop: 16 }]}>
                  <Pressable
                    style={({ pressed }) => [styles.claimBtn, { backgroundColor: tierColor }, pressed && { opacity: 0.85 }]}
                    onPress={handleClaim}
                  >
                    <Ionicons name="gift-outline" size={18} color="#fff" />
                    <Text style={styles.claimBtnText}>{claimCount > 0 ? 'Claim Again!' : 'Claim It!'}</Text>
                  </Pressable>
                  <Pressable onPress={onClose} style={({ pressed }) => [styles.maybeLater, pressed && { opacity: 0.7 }]}>
                    <Text style={styles.maybeLaterText}>Maybe later</Text>
                  </Pressable>
                </View>
              )}
            </>
          )}
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: Colors.white,
    borderRadius: 28,
    padding: 28,
    alignItems: 'center',
    overflow: 'hidden',
    ...(Platform.OS === 'web' ? { boxShadow: '0 24px 60px rgba(0,0,0,0.18)' } : {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.18,
      shadowRadius: 24,
      elevation: 20,
    }),
  },
  tierBadge: {
    borderRadius: 99,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginBottom: 18,
  },
  tierBadgeText: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 1.2,
  },
  iconCircle: {
    width: 90,
    height: 90,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 10,
  },
  description: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 14,
    paddingHorizontal: 4,
  },
  tip: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    textAlign: 'center',
    fontStyle: 'italic',
    marginBottom: 26,
    paddingHorizontal: 8,
    lineHeight: 19,
  },
  claimedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  claimedText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: Colors.success,
  },
  todayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF3C7',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  todayText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: '#92400E',
    lineHeight: 18,
  },
  xpProgressContainer: {
    marginBottom: 14,
    width: '100%',
  },
  xpProgressBg: {
    height: 6,
    backgroundColor: '#E2E8F0',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 6,
  },
  xpProgressFill: {
    height: 6,
    borderRadius: 3,
  },
  xpProgressText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  claimBtnDisabled: {
    backgroundColor: '#CBD5E1',
  },
  actionBlock: {
    width: '100%',
    gap: 10,
  },
  claimBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
    borderRadius: 16,
  },
  claimBtnText: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: '#fff',
  },
  maybeLater: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  maybeLaterText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textTertiary,
  },
  xpCostBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 18,
  },
  xpCostText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  successContainer: {
    alignItems: 'center',
    paddingVertical: 12,
    width: '100%',
  },
  successCheck: {
    marginBottom: 18,
  },
  successTitle: {
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
    marginBottom: 6,
    textAlign: 'center',
  },
  successRewardName: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 10,
    textAlign: 'center',
  },
  successMessage: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: 14,
    lineHeight: 20,
  },
  successXpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
  },
  successXpText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: '#DC2626',
  },
});
