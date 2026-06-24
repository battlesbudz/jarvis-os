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
  pageType: 'core' | 'entity' | 'concept' | 'query' | string;
  tags: string[];
  crossRefs: string[];
  generatedAt: string | null;
  updatedAt: string | null;
  backlinks?: string[];
}

const PAGE_ICONS: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  'about-you': { icon: 'person-circle-outline', color: Colors.cyan },
  'projects': { icon: 'briefcase-outline', color: Colors.violet },
  'people': { icon: 'people-outline', color: '#F59E0B' },
  'patterns': { icon: 'pulse-outline', color: '#10B981' },
  'decisions': { icon: 'git-branch-outline', color: '#F472B6' },
  'index': { icon: 'library-outline', color: Colors.cyan },
};

const PAGE_TYPE_COLORS: Record<string, string> = {
  core: Colors.cyan,
  entity: '#F59E0B',
  concept: '#10B981',
  query: Colors.violet,
};

const PAGE_TYPE_LABELS: Record<string, string> = {
  core: 'Core',
  entity: 'Entity',
  concept: 'Concept',
  query: 'Query',
};

function PageTypeBadge({ type }: { type: string }) {
  const color = PAGE_TYPE_COLORS[type] || Colors.textTertiary;
  const label = PAGE_TYPE_LABELS[type] || type;
  return (
    <View style={[styles.badge, { backgroundColor: `${color}20`, borderColor: `${color}40` }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

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
  type: 'h1' | 'h2' | 'h3' | 'bullet' | 'paragraph' | 'blank' | 'wikilink';
  text: string;
  slug?: string;
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

function renderInlineText(
  text: string,
  baseStyle: object,
  key: string,
  onWikiLink?: (slug: string) => void,
) {
  // Split on both bold markers and wiki-links
  const parts = text.split(/(\*\*[^*]+\*\*|\[\[[^\]]+\]\])/g);
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
        if (/^\[\[[^\]]+\]\]$/.test(part)) {
          const slug = part.slice(2, -2);
          return (
            <Text
              key={i}
              style={[baseStyle, styles.wikiLink]}
              onPress={() => onWikiLink?.(slug)}
            >
              {slug}
            </Text>
          );
        }
        return part;
      })}
    </Text>
  );
}

function MarkdownBody({
  content,
  onWikiLink,
}: {
  content: string;
  onWikiLink?: (slug: string) => void;
}) {
  const tokens = parseMarkdown(content);

  return (
    <View style={styles.markdownBody}>
      {tokens.map((token, i) => {
        switch (token.type) {
          case 'h1':
            return renderInlineText(token.text, styles.mdH1, `md-${i}`, onWikiLink);
          case 'h2':
            return renderInlineText(token.text, styles.mdH2, `md-${i}`, onWikiLink);
          case 'h3':
            return renderInlineText(token.text, styles.mdH3, `md-${i}`, onWikiLink);
          case 'bullet':
            return (
              <View key={`md-${i}`} style={styles.mdBulletRow}>
                <Text style={styles.mdBulletDot}>•</Text>
                {renderInlineText(token.text, styles.mdBulletText, `md-t-${i}`, onWikiLink)}
              </View>
            );
          case 'blank':
            return <View key={`md-${i}`} style={styles.mdBlank} />;
          default:
            return renderInlineText(token.text, styles.mdParagraph, `md-${i}`, onWikiLink);
        }
      })}
    </View>
  );
}

function ReferencesPanel({
  page,
  allPages,
  onNavigate,
}: {
  page: VaultPage;
  allPages: VaultPage[];
  onNavigate: (slug: string) => void;
}) {
  const crossRefs = Array.isArray(page.crossRefs) ? page.crossRefs : [];

  const linkedPages = crossRefs
    .map(slug => allPages.find(p => p.slug === slug))
    .filter(Boolean) as VaultPage[];

  const backlinkPages = allPages.filter(
    p => p.slug !== page.slug && Array.isArray(p.crossRefs) && p.crossRefs.includes(page.slug),
  );

  if (linkedPages.length === 0 && backlinkPages.length === 0) return null;

  return (
    <View style={styles.refsPanel}>
      <Text style={styles.refsPanelTitle}>References</Text>

      {linkedPages.length > 0 && (
        <>
          <Text style={styles.refsSubtitle}>Links to</Text>
          {linkedPages.map(p => (
            <Pressable
              key={p.slug}
              style={({ pressed }) => [styles.refRow, pressed && { opacity: 0.6 }]}
              onPress={() => onNavigate(p.slug)}
            >
              <Ionicons name="arrow-forward-circle-outline" size={14} color={Colors.textTertiary} />
              <Text style={styles.refSlug}>[[{p.slug}]]</Text>
              <PageTypeBadge type={p.pageType} />
            </Pressable>
          ))}
        </>
      )}

      {backlinkPages.length > 0 && (
        <>
          <Text style={[styles.refsSubtitle, { marginTop: 8 }]}>Linked from</Text>
          {backlinkPages.map(p => (
            <Pressable
              key={p.slug}
              style={({ pressed }) => [styles.refRow, pressed && { opacity: 0.6 }]}
              onPress={() => onNavigate(p.slug)}
            >
              <Ionicons name="arrow-back-circle-outline" size={14} color={Colors.textTertiary} />
              <Text style={styles.refSlug}>[[{p.slug}]]</Text>
              <PageTypeBadge type={p.pageType} />
            </Pressable>
          ))}
        </>
      )}
    </View>
  );
}

function DetailView({
  page,
  allPages,
  onBack,
  onRegenerate,
  onNavigate,
  regenerating,
}: {
  page: VaultPage;
  allPages: VaultPage[];
  onBack: () => void;
  onRegenerate: () => void;
  onNavigate: (slug: string) => void;
  regenerating: boolean;
}) {
  const meta = PAGE_ICONS[page.slug] ?? { icon: 'document-outline' as const, color: PAGE_TYPE_COLORS[page.pageType] ?? Colors.cyan };

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

        <View style={styles.detailMetaRow}>
          <PageTypeBadge type={page.pageType} />
          <View style={styles.detailMetaTime}>
            <Ionicons name="time-outline" size={13} color={Colors.textTertiary} />
            <Text style={styles.detailMetaText}>
              Updated {formatRelative(page.updatedAt ?? page.generatedAt)}
            </Text>
          </View>
        </View>

        {page.content ? (
          <MarkdownBody content={page.content} onWikiLink={onNavigate} />
        ) : (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>
              Jarvis hasn&apos;t written this page yet. Tap the refresh button to generate it now.
            </Text>
          </View>
        )}

        <ReferencesPanel page={page} allPages={allPages} onNavigate={onNavigate} />
      </ScrollView>
    </>
  );
}

const TYPE_ORDER = ['core', 'entity', 'concept', 'query'];

function groupPagesByType(pages: VaultPage[]): { type: string; pages: VaultPage[] }[] {
  const groups: Record<string, VaultPage[]> = {};
  for (const page of pages) {
    if (page.slug === 'index') continue;
    const type = page.pageType ?? 'core';
    if (!groups[type]) groups[type] = [];
    groups[type].push(page);
  }
  return TYPE_ORDER
    .filter(t => groups[t]?.length)
    .map(t => ({ type: t, pages: groups[t] }));
}

export default function VaultScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const isWeb = Platform.OS === 'web';

  const [selectedPage, setSelectedPage] = useState<VaultPage | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [showIndex, setShowIndex] = useState(true);

  const paddingTop = isWeb ? 67 : insets.top;
  const paddingBottom = isWeb ? 34 : insets.bottom + 16;

  const { data: pages, isLoading, isError } = useQuery<VaultPage[]>({
    queryKey: ['/api/vault/pages'],
    refetchOnMount: true,
  });

  const indexPage = pages?.find(p => p.slug === 'index') ?? null;
  const browsablePages = pages?.filter(p => p.slug !== 'index') ?? [];

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

  const touchPageAccess = useCallback((slug: string) => {
    apiRequest('GET', `/api/vault/page?slug=${encodeURIComponent(slug)}`).catch(() => {});
  }, []);

  const handleSelectPage = useCallback((page: VaultPage) => {
    Haptics.selectionAsync();
    setSelectedPage(page);
    setShowIndex(false);
    touchPageAccess(page.slug);
  }, [touchPageAccess]);

  const handleNavigate = useCallback((slug: string) => {
    const target = pages?.find(p => p.slug === slug);
    if (target) {
      Haptics.selectionAsync();
      setSelectedPage(target);
      setShowIndex(false);
      touchPageAccess(slug);
    }
  }, [pages, touchPageAccess]);

  const handleBack = useCallback(() => {
    setSelectedPage(null);
  }, []);

  if (selectedPage) {
    return (
      <View style={[styles.container, { paddingTop }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <DetailView
          page={selectedPage}
          allPages={pages ?? []}
          onBack={handleBack}
          onRegenerate={handleRegenerate}
          onNavigate={handleNavigate}
          regenerating={regenerating}
        />
      </View>
    );
  }

  const groups = groupPagesByType(browsablePages);

  return (
    <View style={[styles.container, { paddingTop }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={Colors.text} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>Knowledge Vault</Text>
          <Text style={styles.headerSub}>Jarvis&apos;s compounding wiki about you</Text>
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

      {/* Index / Browse toggle */}
      <View style={styles.tabRow}>
        <Pressable
          style={[styles.tab, showIndex && styles.tabActive]}
          onPress={() => setShowIndex(true)}
        >
          <Text style={[styles.tabText, showIndex && styles.tabTextActive]}>Index</Text>
        </Pressable>
        <Pressable
          style={[styles.tab, !showIndex && styles.tabActive]}
          onPress={() => setShowIndex(false)}
        >
          <Text style={[styles.tabText, !showIndex && styles.tabTextActive]}>Browse All</Text>
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
              Jarvis is still building your wiki. Keep chatting and it will fill in automatically.
            </Text>
          </View>
        )}

        {/* Index view — show the master index page */}
        {!isLoading && !isError && pages && pages.length > 0 && showIndex && (
          <>
            {indexPage ? (
              <>
                <Text style={styles.listHint}>
                  Master index — all wiki pages at a glance.
                </Text>
                <Pressable
                  style={({ pressed }) => [styles.indexCard, pressed && { opacity: 0.8 }]}
                  onPress={() => handleSelectPage(indexPage)}
                >
                  <View style={styles.indexCardHeader}>
                    <Ionicons name="library-outline" size={18} color={Colors.cyan} />
                    <Text style={styles.indexCardTitle}>Wiki Index</Text>
                    <PageTypeBadge type="core" />
                  </View>
                  <Text style={styles.indexCardPreview} numberOfLines={4}>
                    {getIntroLine(indexPage.content)}
                  </Text>
                  <Text style={styles.indexCardMeta}>
                    {(pages.length - 1)} page{pages.length !== 2 ? 's' : ''} • Updated {formatRelative(indexPage.updatedAt)}
                  </Text>
                </Pressable>

                <Text style={styles.sectionTitle}>Browse by Type</Text>
                {groups.map(({ type, pages: typePages }) => (
                  <Pressable
                    key={type}
                    style={({ pressed }) => [styles.typeRow, pressed && { opacity: 0.7 }]}
                    onPress={() => setShowIndex(false)}
                  >
                    <View style={[styles.typeDot, { backgroundColor: PAGE_TYPE_COLORS[type] ?? Colors.textTertiary }]} />
                    <Text style={styles.typeLabel}>{PAGE_TYPE_LABELS[type] ?? type}</Text>
                    <Text style={styles.typeCount}>{typePages.length}</Text>
                    <Ionicons name="chevron-forward" size={14} color={Colors.textTertiary} />
                  </Pressable>
                ))}
              </>
            ) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyDesc}>
                  Index page not generated yet. Chat with Jarvis to build your wiki.
                </Text>
              </View>
            )}
          </>
        )}

        {/* Browse all view — grouped by type */}
        {!isLoading && !isError && pages && pages.length > 0 && !showIndex && (
          <>
            <Text style={styles.listHint}>
              Tap any page to read. [[links]] navigate between pages.
            </Text>
            {groups.map(({ type, pages: typePages }) => (
              <View key={type}>
                <View style={styles.groupHeader}>
                  <View style={[styles.groupDot, { backgroundColor: PAGE_TYPE_COLORS[type] ?? Colors.textTertiary }]} />
                  <Text style={styles.groupTitle}>{PAGE_TYPE_LABELS[type] ?? type} Pages</Text>
                  <Text style={styles.groupCount}>{typePages.length}</Text>
                </View>
                {typePages.map(page => {
                  const meta = PAGE_ICONS[page.slug] ?? {
                    icon: 'document-outline' as const,
                    color: PAGE_TYPE_COLORS[page.pageType] ?? Colors.cyan,
                  };
                  const intro = getIntroLine(page.content);
                  const hasContent = !!page.content;
                  const refs = Array.isArray(page.crossRefs) ? page.crossRefs : [];

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
                        <View style={styles.cardTitleRow}>
                          <Text style={styles.cardTitle} numberOfLines={1}>{page.title}</Text>
                          <PageTypeBadge type={page.pageType} />
                        </View>
                        {hasContent ? (
                          <>
                            <Text style={styles.cardIntro} numberOfLines={2}>{intro}</Text>
                            <View style={styles.cardMeta}>
                              <Ionicons name="time-outline" size={11} color={Colors.textTertiary} />
                              <Text style={styles.cardMetaText}>
                                {formatRelative(page.updatedAt ?? page.generatedAt)}
                              </Text>
                              {refs.length > 0 && (
                                <>
                                  <View style={styles.cardMetaDot} />
                                  <Ionicons name="link-outline" size={11} color={Colors.textTertiary} />
                                  <Text style={styles.cardMetaText}>{refs.length}</Text>
                                </>
                              )}
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
              </View>
            ))}
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
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: Colors.surface,
  },
  tabActive: {
    backgroundColor: Colors.cyan,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  tabTextActive: {
    color: '#fff',
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
    marginBottom: 4,
    lineHeight: 17,
  },
  badge: {
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  indexCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
  },
  indexCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  indexCardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
    flex: 1,
  },
  indexCardPreview: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
  indexCardMeta: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textSecondary,
    marginTop: 16,
    marginBottom: 4,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10,
  },
  typeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  typeLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
    flex: 1,
  },
  typeCount: {
    fontSize: 13,
    color: Colors.textTertiary,
    fontWeight: '500',
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    marginBottom: 6,
  },
  groupDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  groupTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textSecondary,
    flex: 1,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  groupCount: {
    fontSize: 12,
    color: Colors.textTertiary,
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
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
    letterSpacing: -0.2,
    flex: 1,
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
  cardMetaDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: Colors.textTertiary,
    marginHorizontal: 2,
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
  detailMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 24,
  },
  detailMetaTime: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
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
  wikiLink: {
    color: Colors.cyan,
    textDecorationLine: 'underline',
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

  refsPanel: {
    marginTop: 24,
    padding: 16,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 6,
  },
  refsPanelTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 4,
    letterSpacing: 0.2,
  },
  refsSubtitle: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  refRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  refSlug: {
    fontSize: 13,
    color: Colors.cyan,
    flex: 1,
  },
});
