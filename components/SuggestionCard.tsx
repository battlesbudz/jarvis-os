import React from 'react';
import { StyleSheet, View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { Suggestion } from '@/lib/storage';
import { getCategoryColor } from '@/lib/helpers';

interface SuggestionCardProps {
  suggestion: Suggestion;
  onPress?: () => void;
}

const ICON_MAP: Record<string, keyof typeof Ionicons.glyphMap> = {
  restaurant: 'restaurant-outline',
  'trending-up': 'trending-up-outline',
  leaf: 'leaf-outline',
  briefcase: 'briefcase-outline',
  compass: 'compass-outline',
  film: 'film-outline',
};

export default function SuggestionCard({ suggestion, onPress }: SuggestionCardProps) {
  const color = getCategoryColor(suggestion.category);
  const iconName = ICON_MAP[suggestion.icon] || 'bulb-outline';

  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.container,
        pressed && { transform: [{ scale: 0.98 }] },
      ]}
      testID={`suggestion-${suggestion.id}`}
    >
      <View style={[styles.iconContainer, { backgroundColor: color + '15' }]}>
        <Ionicons name={iconName} size={22} color={color} />
      </View>
      <View style={styles.content}>
        <Text style={styles.title} numberOfLines={1}>{suggestion.title}</Text>
        <Text style={styles.description} numberOfLines={2}>{suggestion.description}</Text>
      </View>
      <View style={[styles.actionButton, { backgroundColor: color + '15' }]}>
        <Ionicons name="arrow-forward" size={16} color={color} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  content: {
    flex: 1,
    marginRight: 12,
  },
  title: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    marginBottom: 3,
  },
  description: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  actionButton: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
