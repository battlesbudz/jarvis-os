import React from 'react';
import Svg, { Rect, Polygon, Circle } from 'react-native-svg';

interface Props {
  size?: number;
}

export default function VisionSprite({ size = 40 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      {/* Cape left — red */}
      <Polygon points="0,30 14,40 0,40" fill="#dc2626" opacity={0.9} />
      {/* Cape right — green */}
      <Polygon points="40,30 26,40 40,40" fill="#22c55e" opacity={0.9} />

      {/* Face body — deep purple */}
      <Rect x={8} y={6} width={24} height={26} rx={3} fill="#3b0764" />
      {/* Face highlight top */}
      <Rect x={10} y={6} width={20} height={8} rx={2} fill="#4c1d95" />

      {/* Mind Stone forehead — green diamond */}
      <Polygon points="20,6 24,11 20,16 16,11" fill="#22c55e" />
      {/* Mind Stone inner glow */}
      <Polygon points="20,8 23,11 20,14 17,11" fill="#4ade80" opacity={0.6} />

      {/* Left eye */}
      <Rect x={11} y={19} width={6} height={4} rx={1} fill="#fbbf24" />
      {/* Right eye */}
      <Rect x={23} y={19} width={6} height={4} rx={1} fill="#fbbf24" />
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
  );
}
