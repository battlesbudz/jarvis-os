import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Colors from '@/constants/colors';
import VisionSprite from '@/components/VisionSprite';

interface Props {
  label?: string;
}

export default function PlaceholderScreen({ label = 'Section' }: Props) {
  return (
    <View style={styles.container}>
      <VisionSprite size={64} />
      <Text style={styles.comingSoon}>Coming soon</Text>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.sub}>This section is being built</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingBottom: 60,
  },
  comingSoon: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.purple,
    letterSpacing: 0.5,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textSecondary,
    letterSpacing: 0.4,
  },
  sub: {
    fontSize: 13,
    color: Colors.textTertiary,
  },
});
