import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Colors from '@/constants/colors';
import { apiRequest } from '@/lib/query-client';
import * as Haptics from 'expo-haptics';

interface VaultPage {
  id: string;
  slug: string;
  title: string;
  content: string;
  generatedAt: string | null;
  updatedAt: string | null;
}

const PAGE_ICONS: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  'about-you': { icon: 'person-circle-outline', color: Colors.cyan },
  'projects': { icon: 'briefcase-outline', color: Colors.violet },
  'people': { icon: 'people-outline', color: '#F59E0B' },
  'patterns': { icon: 'pulse-outline', color: '#10B981' },
  'decisions': { icon: 'git-branch-outline', color: '#F472B6' },
};

function formatRelative(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getIntroLine(content: string): string {
  const clean = content.replace(/^#+\s+.+$/m, '').replace(/\*\*/g, '').trim();
  const sentence = clean.split(/\n+/).find(line => line.trim().length > 0) ?? '';
  return sentence.replace(/^[-*]\s+/, '').slice(0, 120) || 'No content yet.';
}

function SkeletonCard() {
  return (
    <View style={styles.skeletonCard}>
      <View style={styles.skeletonIcon} />
      <View style={styles.skeletonBody}>
        <View style={styles.skeletonTitle} />
        <View style={styles.skeletonLine} />
        <View style={[styles.skeletonLine, { width: '60%' }]} />
      </View>
    </View>
  );
}

interface MarkdownToken {
  type: 'h1' | 'h2' | 'h3' | 'bullet' | 'paragraph' | 'blank';
  text: string;
  bold?: boolean;
}

function parseMarkdown(text: string): MarkdownToken[] {
  const lines = text.split('\n');
  const tokens: MarkdownToken[] = [];

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.trim() === '') {
      if (tokens.length > 0 && tokens[tokens.length - 1].type !== 'blank') {
        tokens.push({ type: 'blank', text: '' });
      }
      continue;
    }

    if (/^###\s+/.test(line)) {
      tokens.push({ type: 'h3', text: line.replace(/^###\s+/, '') });
    } else if (/^##\s+/.test(line)) {
      tokens.push({ type: 'h2', text: line.replace(/^##\s+/, '') });
    } else if (/^#\s+/.test(line)) {
      tokens.push({ type: 'h1', text: line.replace(/^#\s+/, '') });
    } else if (/^[-*]\s+/.test(line)) {
      tokens.push({ type: 'bullet', text: line.replace(/^[-*]\s+/, '') });
    } else {
      tokens.push({ type: 'paragraph', text: line });
    }
  }

  return tokens;
}

function renderInlineText(text: string, baseStyle: object, key: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  if (parts.length === 1) {
    return <Text key={key} style={baseStyle}>{text}</Text>;
  }
  return (
    <Text key={key} style={baseStyle}>
      {parts.map((part, i) => {
        if (/^\*\*[^*]+\*\*$/.test(part)) {
          return (
            <Text key={i} style={[baseStyle, { fontWeight: '700' as const }]}>
              {part.slice(2, -2)}
            </Text>
          );
        }
        return part;
      })}
    </Text>
  );
}

function MarkdownBody({ content }: { content: string }) {
  const tokens = parseMarkdown(content);

  return (
    <View style={styles.markdownBody}>
      {tokens.map((token, i) => {
        switch (token.type) {
          case 'h1':
            return renderInlineText(token.text, styles.mdH1, `md-${i}`);
          case 'h2':
            return renderInlineText(token.text, styles.mdH2, `md-${i}`);
          case 'h3':
            return renderInlineText(token.text, styles.mdH3, `md-${i}`);
          case 'bullet':
            return (
              <View key={`md-${i}`} style={styles.mdBulletRow}>
                <Text style={styles.mdBulletDot}>•</Text>
                {renderInlineText(token.text, styles.mdBulletText, `md-t-${i}`)}
              </View>
            );
          case 'blank':
            return <View key={`md-${i}`} style={styles.mdBlank} />;
          default:
            return renderInlineText(token.text, styles.mdParagraph, `md-${i}`);
        }
      })}
    </View>
  );
}

function DetailView({
  page,
  onBack,
  onRegenerate,
  regenerating,
}: {
  page: VaultPage;
  onBack: () => void;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  const meta = PAGE_ICONS[page.slug] ?? { icon: 'document-outline' as const, color: Colors.cyan };

  return (
    <>
      <View style={styles.detailHeader}>
        <Pressable style={styles.backBtn} onPress={onBack} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={Colors.text} />
        </Pressable>
        <Text style={styles.detailTitle} numberOfLines={1}>{page.title}</Text>
        <Pressable
          style={[styles.regenerateBtn, regenerating && { opacity: 0.5 }]}
          onPress={onRegenerate}
          disabled={regenerating}
          hitSlop={8}
        >
          {regenerating ? (
            <ActivityIndicator size="small" color={Colors.textSecondary} />
          ) : (
            <Ionicons name="refresh" size={18} color={Colors.textSecondary} />
          )}
        </Pressable>
      </View>

      <ScrollView
        style={styles.detailScroll}
        contentContainerStyle={styles.detailContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.detailPageIcon, { backgroundColor: `${meta.color}18` }]}>
          <Ionicons name={meta.icon} size={32} color={meta.color} />
        </View>

        <View style={styles.detailMeta}>
          <Ionicons name="time-outline" size={13} color={Colors.textTertiary} />
          <Text style={styles.detailMetaText}>
            Updated {formatRelative(page.updatedAt ?? page.generatedAt)}
          </Text>
        </View>

        {page.content ? (
          <MarkdownBody content={page.content} />
        ) : (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>
              Jarvis hasn't written this page yet. Tap the refresh button to generate it now.
            </Text>
          </View>
        )}
      </ScrollView>
    </>
  );
}

export default function VaultScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const isWeb = Platform.OS === 'web';

  const [selectedPage, setSelectedPage] = useState<VaultPage | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  const paddingTop = isWeb ? 67 : insets.top;
  const paddingBottom = isWeb ? 34 : insets.bottom + 16;

  const { data: pages, isLoading, isError } = useQuery<VaultPage[]>({
    queryKey: ['/api/vault/pages'],
    refetchOnMount: true,
  });

  const handleRegenerate = useCallback(async () => {
    setRegenerating(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await apiRequest('POST', '/api/vault/regenerate');
      await new Promise(res => setTimeout(res, 2500));
      await qc.invalidateQueries({ queryKey: ['/api/vault/pages'] });
      const fresh = qc.getQueryData<VaultPage[]>(['/api/vault/pages']);
      if (selectedPage && fresh) {
        const updated = fresh.find(p => p.slug === selectedPage.slug);
        if (updated) setSelectedPage(updated);
      }
    } finally {
      setRegenerating(false);
    }
  }, [qc, selectedPage]);

  const handleSelectPage = useCallback((page: VaultPage) => {
    Haptics.selectionAsync();
    setSelectedPage(page);
  }, []);

  if (selectedPage) {
    return (
      <View style={[styles.container, { paddingTop }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <DetailView
          page={selectedPage}
          onBack={() => setSelectedPage(null)}
          onRegenerate={handleRegenerate}
          regenerating={regenerating}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={Colors.text} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>Knowledge Vault</Text>
          <Text style={styles.headerSub}>What Jarvis knows about you</Text>
        </View>
        <Pressable
          style={[styles.refreshIconBtn, regenerating && { opacity: 0.5 }]}
          onPress={handleRegenerate}
          disabled={regenerating}
          hitSlop={8}
        >
          {regenerating ? (
            <ActivityIndicator size="small" color={Colors.textSecondary} />
          ) : (
            <Ionicons name="refresh-outline" size={20} color={Colors.textSecondary} />
          )}
        </Pressable>
      </View>

      <ScrollView
        style={styles.list}
        contentContainerStyle={[styles.listContent, { paddingBottom }]}
        showsVerticalScrollIndicator={false}
      >
        {isLoading && (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        )}

        {isError && !isLoading && (
          <View style={styles.center}>
            <Ionicons name="warning-outline" size={32} color={Colors.error} />
            <Text style={styles.errorText}>Could not load your Knowledge Vault.</Text>
            <Text style={styles.errorSub}>Check your connection and try again.</Text>
          </View>
        )}

        {!isLoading && !isError && (!pages || pages.length === 0) && (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="library-outline" size={36} color={Colors.textTertiary} />
            </View>
            <Text style={styles.emptyTitle}>Still getting to know you</Text>
            <Text style={styles.emptyDesc}>
              Jarvis is still getting to know you. Keep chatting and your Knowledge Vault will fill in automatically.
            </Text>
          </View>
        )}

        {!isLoading && !isError && pages && pages.length > 0 && (
          <>
            <Text style={styles.listHint}>
              Jarvis writes these pages automatically from your conversations. Tap any to read.
            </Text>
            {pages.map(page => {
              const meta = PAGE_ICONS[page.slug] ?? { icon: 'document-outline' as const, color: Colors.cyan };
              const intro = getIntroLine(page.content);
              const hasContent = !!page.content;

              return (
                <Pressable
                  key={page.id}
                  style={({ pressed }) => [styles.card, pressed && { opacity: 0.75 }]}
                  onPress={() => handleSelectPage(page)}
                >
                  <View style={[styles.cardIcon, { backgroundColor: `${meta.color}18` }]}>
                    <Ionicons name={meta.icon} size={22} color={meta.color} />
                  </View>
                  <View style={styles.cardBody}>
                    <Text style={styles.cardTitle}>{page.title}</Text>
                    {hasContent ? (
                      <>
                        <Text style={styles.cardIntro} numberOfLines={2}>{intro}</Text>
                        <View style={styles.cardMeta}>
                          <Ionicons name="time-outline" size={11} color={Colors.textTertiary} />
                          <Text style={styles.cardMetaText}>
                            Updated {formatRelative(page.updatedAt ?? page.generatedAt)}
                          </Text>
                        </View>
                      </>
                    ) : (
                      <Text style={styles.cardEmpty}>Not written yet</Text>
                    )}
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
                </Pressable>
              );
            })}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12,
  },
  headerText: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    letterSpacing: -0.3,
  },
  headerSub: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: 16,
    gap: 10,
  },
  listHint: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginBottom: 6,
    lineHeight: 17,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12,
    shadowColor: Colors.cardShadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
  },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  cardBody: {
    flex: 1,
    gap: 4,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
    letterSpacing: -0.2,
  },
  cardIntro: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  cardEmpty: {
    fontSize: 12,
    color: Colors.textTertiary,
    fontStyle: 'italic',
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  cardMetaText: {
    fontSize: 11,
    color: Colors.textTertiary,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 10,
  },
  errorText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.error,
    textAlign: 'center',
  },
  errorSub: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 24,
    gap: 12,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 24,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.text,
    textAlign: 'center',
  },
  emptyDesc: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },

  skeletonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12,
  },
  skeletonIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.surfaceAlt,
    flexShrink: 0,
  },
  skeletonBody: {
    flex: 1,
    gap: 8,
  },
  skeletonTitle: {
    height: 14,
    borderRadius: 6,
    backgroundColor: Colors.surfaceAlt,
    width: '55%',
  },
  skeletonLine: {
    height: 11,
    borderRadius: 5,
    backgroundColor: Colors.surfaceAlt,
    width: '80%',
  },

  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12,
  },
  detailTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: Colors.text,
    letterSpacing: -0.3,
  },
  regenerateBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailScroll: {
    flex: 1,
  },
  detailContent: {
    padding: 20,
    paddingBottom: 40,
  },
  detailPageIcon: {
    width: 60,
    height: 60,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 12,
  },
  detailMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    justifyContent: 'center',
    marginBottom: 24,
  },
  detailMetaText: {
    fontSize: 12,
    color: Colors.textTertiary,
  },

  markdownBody: {
    gap: 2,
  },
  mdH1: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 4,
    marginTop: 8,
    letterSpacing: -0.3,
  },
  mdH2: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 3,
    marginTop: 16,
    letterSpacing: -0.2,
  },
  mdH3: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginBottom: 3,
    marginTop: 12,
    letterSpacing: -0.1,
  },
  mdParagraph: {
    fontSize: 15,
    color: Colors.text,
    lineHeight: 22,
  },
  mdBulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingLeft: 4,
    marginVertical: 1,
  },
  mdBulletDot: {
    fontSize: 15,
    color: Colors.textTertiary,
    lineHeight: 22,
    marginTop: 0,
  },
  mdBulletText: {
    flex: 1,
    fontSize: 15,
    color: Colors.text,
    lineHeight: 22,
  },
  mdBlank: {
    height: 8,
  },

  emptyBox: {
    padding: 20,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
});
