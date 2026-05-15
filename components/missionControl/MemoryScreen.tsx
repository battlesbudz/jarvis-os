import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';

interface Memory {
  id: string;
  content: string;
  category: string;
  extractedAt: string;
  relevanceScore?: number;
  lastReferencedAt?: string | null;
}

interface MemoriesResponse {
  memories: Memory[];
}

function formatRelevanceScore(score: number | undefined): string | null {
  if (score === undefined || !Number.isFinite(score)) return null;
  const pct = score <= 1 ? score * 100 : score;
  return `${Math.max(0, Math.min(100, Math.round(pct)))}%`;
}

const CATEGORIES = ['all', 'fact', 'goal', 'preference', 'pattern', 'personality', 'values', 'work_style', 'accomplishment', 'achievement', 'relationship'];

const CATEGORY_COLORS: Record<string, string> = {
  fact: Colors.cyan,
  goal: Colors.green,
  preference: Colors.purple,
  pattern: '#F59E0B',
  personality: '#ec4899',
  values: '#06B6D4',
  work_style: '#8B5CF6',
  accomplishment: Colors.green,
  achievement: Colors.green,
  relationship: '#F97316',
};

function getCatColor(cat: string): string {
  return CATEGORY_COLORS[cat?.toLowerCase()] ?? Colors.textSecondary;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatDateKey(iso: string): string {
  return iso.slice(0, 10);
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export default function MemoryScreen() {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [selectedCat, setSelectedCat] = useState('all');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data, isLoading, error } = useQuery<MemoriesResponse>({
    queryKey: ['/api/memories'],
  });

  const memories = data?.memories ?? [];

  const filtered = useMemo(() => {
    let result = memories;
    if (selectedCat !== 'all') {
      result = result.filter(m => m.category?.toLowerCase() === selectedCat);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(m => m.content.toLowerCase().includes(q));
    }
    return result;
  }, [memories, selectedCat, search]);

  const dateGroups = useMemo(() => {
    const map = new Map<string, Memory[]>();
    for (const m of filtered) {
      const key = formatDateKey(m.extractedAt);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  const activeDate = selectedDate ?? (dateGroups[0]?.[0] ?? null);
  const activeDateEntries = activeDate
    ? dateGroups.find(([key]) => key === activeDate)?.[1] ?? []
    : [];

  const presentCategories = useMemo(() => {
    const cats = new Set(memories.map(m => m.category?.toLowerCase()));
    return CATEGORIES.filter(c => c === 'all' || cats.has(c));
  }, [memories]);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.green} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Ionicons name="warning-outline" size={24} color={Colors.error} />
        <Text style={styles.errorText}>Failed to load memories</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Search */}
      <View style={styles.searchRow}>
        <Ionicons name="search" size={14} color={Colors.textTertiary} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search memories..."
          placeholderTextColor={Colors.textTertiary}
          value={searchInput}
          onChangeText={setSearchInput}
        />
        {searchInput.length > 0 && (
          <Pressable onPress={() => { setSearchInput(''); setSearch(''); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={14} color={Colors.textTertiary} />
          </Pressable>
        )}
      </View>

      {/* Category filter */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.catScroll}
        contentContainerStyle={styles.catContent}
      >
        {presentCategories.map(cat => {
          const active = selectedCat === cat;
          const color = cat === 'all' ? Colors.green : getCatColor(cat);
          return (
            <Pressable
              key={cat}
              onPress={() => setSelectedCat(cat)}
              style={[
                styles.catChip,
                active && { backgroundColor: color + '25', borderColor: color },
              ]}
            >
              <Text style={[styles.catChipText, active && { color }]}>
                {cat === 'all' ? 'All' : cat.replace('_', ' ')}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Date list */}
      {dateGroups.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="book-outline" size={32} color={Colors.textTertiary} />
          <Text style={styles.emptyText}>
            {searchInput || selectedCat !== 'all' ? 'No matches found' : 'No memories yet'}
          </Text>
        </View>
      ) : (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.dateScroll}
            contentContainerStyle={styles.dateContent}
          >
            {dateGroups.map(([key, entries]) => {
              const isActive = key === activeDate;
              const wordCount = entries.reduce((sum, m) => sum + countWords(m.content), 0);
              return (
                <Pressable
                  key={key}
                  onPress={() => setSelectedDate(key)}
                  style={[styles.dateChip, isActive && styles.dateChipActive]}
                >
                  <Text style={[styles.dateChipDate, isActive && styles.dateChipDateActive]}>
                    {formatDate(entries[0].extractedAt)}
                  </Text>
                  <Text style={[styles.dateChipSub, isActive && styles.dateChipSubActive]}>
                    {entries.length} · {wordCount}w
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Entries for selected date */}
          <ScrollView
            style={styles.entriesScroll}
            contentContainerStyle={styles.entriesContent}
            showsVerticalScrollIndicator={false}
          >
            {activeDateEntries.map(m => {
              const catColor = getCatColor(m.category);
              const relevanceLabel = formatRelevanceScore(m.relevanceScore);
              return (
                <View key={m.id} style={styles.memoryCard}>
                  <View style={styles.memoryCardTop}>
                    <View style={[styles.catDot, { backgroundColor: catColor }]} />
                    <Text style={[styles.catLabel, { color: catColor }]}>
                      {m.category?.replace('_', ' ') ?? 'fact'}
                    </Text>
                    {relevanceLabel && (
                      <Text style={styles.scoreText}>{relevanceLabel}</Text>
                    )}
                  </View>
                  <Text style={styles.memoryContent}>{m.content}</Text>
                </View>
              );
            })}
          </ScrollView>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  errorText: {
    color: Colors.textSecondary,
    fontSize: 14,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 10,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
  },
  searchIcon: {
    flexShrink: 0,
  },
  searchInput: {
    flex: 1,
    color: Colors.text,
    fontSize: 14,
    padding: 0,
  },
  catScroll: {
    maxHeight: 44,
    marginTop: 10,
  },
  catContent: {
    paddingHorizontal: 16,
    gap: 6,
    alignItems: 'center',
  },
  catChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  catChipText: {
    fontSize: 12,
    color: Colors.textSecondary,
    textTransform: 'capitalize',
  },
  dateScroll: {
    maxHeight: 70,
    marginTop: 12,
  },
  dateContent: {
    paddingHorizontal: 16,
    gap: 8,
    alignItems: 'center',
  },
  dateChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    minWidth: 90,
  },
  dateChipActive: {
    backgroundColor: Colors.purpleDim,
    borderColor: Colors.purple,
  },
  dateChipDate: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  dateChipDateActive: {
    color: Colors.purple,
  },
  dateChipSub: {
    fontSize: 10,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  dateChipSubActive: {
    color: Colors.purple,
    opacity: 0.7,
  },
  entriesScroll: {
    flex: 1,
  },
  entriesContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 40,
    gap: 8,
  },
  memoryCard: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
  },
  memoryCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  catDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  catLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'capitalize',
    letterSpacing: 0.4,
    flex: 1,
  },
  scoreText: {
    fontSize: 10,
    color: Colors.textTertiary,
  },
  memoryContent: {
    fontSize: 14,
    color: Colors.text,
    lineHeight: 20,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 48,
  },
  emptyText: {
    color: Colors.textTertiary,
    fontSize: 14,
  },
});
