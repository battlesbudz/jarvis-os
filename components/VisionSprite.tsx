import React, { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import Svg, { Rect, Polygon, Circle } from 'react-native-svg';

interface Props {
  size?: number;
  tint?: string;
  active?: boolean;
}

export default function VisionSprite({ size = 40, tint, active = false }: Props) {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (active) {
      const anim = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.08, duration: 700, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0.94, duration: 700, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 350, useNativeDriver: true }),
        ])
      );
      anim.start();
      return () => anim.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [active, pulseAnim]);

  const eyeColor = tint ?? '#fbbf24';
  const stoneColor = tint ?? '#22c55e';
  const stoneGlow = tint ? tint + 'BB' : '#4ade80';

  return (
    <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
      <Svg width={size} height={size} viewBox="0 0 40 40">
        {/* Cape left — red */}
        <Polygon points="0,30 14,40 0,40" fill="#dc2626" opacity={0.9} />
        {/* Cape right — green */}
        <Polygon points="40,30 26,40 40,40" fill="#22c55e" opacity={0.9} />

        {/* Face body — deep purple */}
        <Rect x={8} y={6} width={24} height={26} rx={3} fill="#3b0764" />
        {/* Face highlight top */}
        <Rect x={10} y={6} width={20} height={8} rx={2} fill="#4c1d95" />

        {/* Mind Stone forehead */}
        <Polygon points="20,6 24,11 20,16 16,11" fill={stoneColor} />
        {/* Mind Stone inner glow */}
        <Polygon points="20,8 23,11 20,14 17,11" fill={stoneGlow} opacity={0.7} />

        {/* Left eye */}
        <Rect x={11} y={19} width={6} height={4} rx={1} fill={eyeColor} />
        {/* Right eye */}
        <Rect x={23} y={19} width={6} height={4} rx={1} fill={eyeColor} />
        {/* Eye shine */}
        <Rect x={12} y={19} width={2} height={2} rx={0.5} fill="#fff" opacity={0.5} />
        <Rect x={24} y={19} width={2} height={2} rx={0.5} fill="#fff" opacity={0.5} />

        {/* Mouth line */}
        <Rect x={15} y={26} width={10} height={2} rx={1} fill="#6d28d9" />

        {/* Chin */}
        <Rect x={11} y={29} width={18} height={3} rx={2} fill="#4c1d95" />

        {/* Neck */}
        <Rect x={16} y={32} width={8} height={3} rx={1} fill="#3b0764" />
      </Svg>
    </Animated.View>
  );
}
