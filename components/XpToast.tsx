import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withDelay,
  runOnJS,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface XpToastProps {
  visible: boolean;
  xp: number;
  onHide: () => void;
  label?: string;
}

export default function XpToast({ visible, xp, onHide, label }: XpToastProps) {
  const insets = useSafeAreaInsets();
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(20);

  useEffect(() => {
    if (visible) {
      translateY.value = 20;
      opacity.value = withSequence(
        withTiming(1, { duration: 250 }),
        withDelay(1400, withTiming(0, { duration: 350 }, (finished) => {
          if (finished) runOnJS(onHide)();
        }))
      );
      translateY.value = withSequence(
        withTiming(0, { duration: 250 }),
        withDelay(1400, withTiming(-10, { duration: 350 }))
      );
    }
  }, [visible]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  if (!visible) return null;

  const isBadge = !!label;
  const bgColor = isBadge ? '#8B5CF6' : '#F59E0B';
  const iconName = isBadge ? 'ribbon' : 'star';
  const displayText = isBadge ? label : `+${xp} XP`;

  return (
    <Animated.View
      style={[
        styles.container,
        { bottom: insets.bottom + 100 },
        animStyle,
      ]}
      pointerEvents="none"
    >
      <View style={[styles.pill, { backgroundColor: bgColor, shadowColor: bgColor }]}>
        <Ionicons name={iconName as any} size={14} color="#fff" />
        <Text style={styles.text}>{displayText}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 999,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 99,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  text: {
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    color: '#fff',
  },
});
