/**
 * Jarvis Knowledge Vault Writer — LLM Wiki (Karpathy-style)
 *
 * Compounding wiki where knowledge is compiled once and accumulated.
 * Three core operations:
 *  - Ingest: new source → targeted wiki page updates + new pages if needed
 *  - Query Filing: complex synthesis answers saved as query pages for reuse
 *  - Lint: weekly health check — contradictions, cross-links, archiving, index update
 *
 * Legacy 5-page generation (generateVaultPages / maybeRegenerateVault) is kept
 * for compatibility but rich sources now flow through ingestSource instead.
 */

import { db } from "../db";
import { eq, and, desc, gte, sql, count, isNull, lt } from "drizzle-orm";
import * as schema from "@shared/schema";
import { emit as diagEmit } from "../diagnostics/diagnosticsService";
import { createRoutedOpenAIChatShim } from "../agent/routedChatCompletion";
import { isRetriableProviderError } from "../agent/providers/fallback";

const openai = createRoutedOpenAIChatShim("[MemoryVault]", "balanced");

const VAULT_TTL_MS = 6 * 60 * 60 * 1000;
const VAULT_NOVELTY_THRESHOLD = 3;
const APPROVED_MEMORY_STATUS_SQL = sql`('active', 'kept', 'edited')`;
const RESTRICTED_SOURCE_SQL_PATTERN = "%(plaid|bank|banking|financial|transaction|credit_card|credit card|debit_card|debit card|tax_document|tax document|payroll|brokerage|account_balance|account balance|restricted_source|restricted summary|restricted_summary)%";

function approvedNonRestrictedMemoryClauses(userId: string) {
  return [
    eq(schema.userMemories.userId, userId),
    eq(schema.userMemories.pendingReview, false),
    sql`${schema.userMemories.reviewStatus} IN ${APPROVED_MEMORY_STATUS_SQL}`,
    sql`COALESCE(${schema.userMemories.sensitivity}, 'normal') = 'normal'`,
    sql`LOWER(COALESCE(${schema.userMemories.sourceType}, '')) NOT SIMILAR TO ${RESTRICTED_SOURCE_SQL_PATTERN}`,
    sql`LOWER(COALESCE(${schema.userMemories.sourceRef}, '')) NOT SIMILAR TO ${RESTRICTED_SOURCE_SQL_PATTERN}`,
  ];
}

// ── Page definitions ──────────────────────────────────────────────────────────

interface PageSpec {
  slug: schema.VaultSlug;
  title: string;
  buildPrompt: (userId: string) => Promise<string>;
}

export async function buildAboutYouSource(userId: string): Promise<string> {
  const [soulRows, memRows] = await Promise.all([
    db
      .select({ content: schema.jarvisSouls.content })
      .from(schema.jarvisSouls)
      .where(eq(schema.jarvisSouls.userId, userId))
      .limit(1),
    db
      .select({ content: schema.userMemories.content, category: schema.userMemories.category })
      .from(schema.userMemories)
      .where(
        and(
          ...approvedNonRestrictedMemoryClauses(userId),
          eq(schema.userMemories.tier, "long_term"),
          sql`${schema.userMemories.category} IN ('values','communication_style','preferences','fact')`,
        ),
      )
      .orderBy(desc(schema.userMemories.extractedAt))
      .limit(80),
  ]);

  const soulText = soulRows[0]?.content || "";
  const memList = memRows.map((m) => `[${m.category}] ${m.content}`).join("\n");

  return `## Soul Summary\n${soulText.slice(0, 3000)}\n\n## Identity & Preference Memories\n${memList}`;
}

export async function buildProjectsSource(userId: string): Promise<string> {
  const [memRows, goalRows] = await Promise.all([
    db
      .select({ content: schema.userMemories.content })
      .from(schema.userMemories)
      .where(
        and(
          ...approvedNonRestrictedMemoryClauses(userId),
          eq(schema.userMemories.tier, "long_term"),
          sql`${schema.userMemories.category} IN ('goals_history','accomplishments')`,
        ),
      )
      .orderBy(desc(schema.userMemories.extractedAt))
      .limit(60),
    db
      .select({ data: schema.goals.data })
      .from(schema.goals)
      .where(eq(schema.goals.userId, userId))
      .limit(1),
  ]);

  const memList = memRows.map((m) => `- ${m.content}`).join("\n");
  const goalData = goalRows[0]?.data;
  const goalText =
    Array.isArray(goalData) && goalData.length > 0
      ? (goalData as Array<{ title?: string; category?: string; current?: number; target?: number; unit?: string }>)
          .map((g) => `- ${g.title || "Untitled"} (${g.category}): ${g.current ?? 0}/${g.target ?? 0} ${g.unit ?? ""}`)
          .join("\n")
      : "No current goals set.";

  return `## Active Goals\n${goalText}\n\n## Project & Accomplishment Memories\n${memList}`;
}

export async function buildPeopleSource(userId: string): Promise<string> {
  const [peopleRows, memRows] = await Promise.all([
    db
      .select({
        name: schema.people.name,
        email: schema.people.email,
        relationship: schema.people.relationship,
        notes: schema.people.notes,
        interactionCount: schema.people.interactionCount,
        lastInteractionAt: schema.people.lastInteractionAt,
      })
      .from(schema.people)
      .where(eq(schema.people.userId, userId))
      .orderBy(desc(schema.people.interactionCount))
      .limit(50),
    db
      .select({ content: schema.userMemories.content })
      .from(schema.userMemories)
      .where(
        and(
          ...approvedNonRestrictedMemoryClauses(userId),
          eq(schema.userMemories.category, "relationships"),
        ),
      )
      .orderBy(desc(schema.userMemories.extractedAt))
      .limit(40),
  ]);

  const peopleList = peopleRows
    .map((p) => {
      const parts = [`**${p.name}**`];
      if (p.relationship) parts.push(`(${p.relationship})`);
      if (p.email) parts.push(`<${p.email}>`);
      parts.push(`— interactions: ${p.interactionCount}`);
      if (p.notes) parts.push(`— notes: ${p.notes}`);
      return parts.join(" ");
    })
    .join("\n");

  const memList = memRows.map((m) => `- ${m.content}`).join("\n");
  return `## People Directory\n${peopleList || "No people recorded yet."}\n\n## Relationship Memories\n${memList}`;
}

export async function buildPatternsSource(userId: string): Promise<string> {
  const [weeklyRows, dreamRows] = await Promise.all([
    db
      .select({ patterns: schema.weeklyInsights.patterns, summary: schema.weeklyInsights.summary, weekOf: schema.weeklyInsights.weekOf })
      .from(schema.weeklyInsights)
      .where(eq(schema.weeklyInsights.userId, userId))
      .orderBy(desc(schema.weeklyInsights.createdAt))
      .limit(6),
    db
      .select({ insightText: schema.dreamInsights.insightText, confidenceScore: schema.dreamInsights.confidenceScore })
      .from(schema.dreamInsights)
      .where(eq(schema.dreamInsights.userId, userId))
      .orderBy(desc(schema.dreamInsights.createdAt))
      .limit(20),
  ]);

  const weeklyText = weeklyRows
    .map((row) => {
      const pats = Array.isArray(row.patterns) ? (row.patterns as schema.WeeklyPattern[]) : [];
      const patLines = pats.map((p) => `  - [${p.category}] ${p.observation}`).join("\n");
      return `### Week of ${row.weekOf}\n${row.summary ? row.summary + "\n" : ""}${patLines}`;
    })
    .join("\n\n");

  const dreamText = dreamRows.map((d) => `- [c=${d.confidenceScore ?? 0}] ${d.insightText}`).join("\n");

  return `## Weekly Pattern Observations\n${weeklyText || "No weekly insights yet."}\n\n## Dream Cycle Insights\n${dreamText || "No dream insights yet."}`;
}

export async function buildDecisionsSource(userId: string): Promise<string> {
  const rows = await db
    .select({ content: schema.userMemories.content, category: schema.userMemories.category, extractedAt: schema.userMemories.extractedAt })
    .from(schema.userMemories)
    .where(
      and(
        ...approvedNonRestrictedMemoryClauses(userId),
        sql`${schema.userMemories.category} IN ('goals_history','values','blockers')`,
        eq(schema.userMemories.tier, "long_term"),
      ),
    )
    .orderBy(desc(schema.userMemories.extractedAt))
    .limit(80);

  const grouped: Record<string, string[]> = {};
  for (const r of rows) {
    if (!grouped[r.category]) grouped[r.category] = [];
    grouped[r.category].push(r.content);
  }

  const sections = Object.entries(grouped)
    .map(([cat, items]) => `### ${cat}\n${items.map((i) => `- ${i}`).join("\n")}`)
    .join("\n\n");

  return `## Decision & Goal History\n${sections || "No decision memories recorded yet."}`;
}

const PAGE_SPECS: PageSpec[] = [
  {
    slug: "about-you",
    title: "About You",
    buildPrompt: async (userId) => {
      const source = await buildAboutYouSource(userId);
      return `You are Jarvis, an AI assistant maintaining a personal wiki about this user.
Write the "About You" wiki page as a clear, insightful markdown document.
Cover: who they are, their personality & communication style, core values, and key preferences.
Write in third person from Jarvis's perspective. Be specific, not generic. Max 600 words.
Use ## headers for sections. Do not include filler or placeholder text.

Source data:
${source.slice(0, 5000)}`;
    },
  },
  {
    slug: "projects",
    title: "Projects & Goals",
    buildPrompt: async (userId) => {
      const source = await buildProjectsSource(userId);
      return `You are Jarvis maintaining a personal wiki. Write the "Projects & Goals" wiki page in markdown.
Cover: active goals with progress, ongoing projects, recent accomplishments, next milestones.
Write in third person. Be specific about what's in progress vs completed. Max 600 words.
Use ## headers for sections.

Source data:
${source.slice(0, 5000)}`;
    },
  },
  {
    slug: "people",
    title: "People in Your Life",
    buildPrompt: async (userId) => {
      const source = await buildPeopleSource(userId);
      return `You are Jarvis maintaining a personal wiki. Write the "People in Your Life" wiki page in markdown.
Cover: key people by relationship type (work, personal, family), notable context about each.
Write in third person. Be specific. Max 600 words. Use ## headers for sections.

Source data:
${source.slice(0, 5000)}`;
    },
  },
  {
    slug: "patterns",
    title: "Patterns Jarvis Has Noticed",
    buildPrompt: async (userId) => {
      const source = await buildPatternsSource(userId);
      return `You are Jarvis maintaining a personal wiki. Write the "Patterns" wiki page in markdown.
Cover: recurring behavioral patterns, energy/work rhythms, habits (good and bad), trends Jarvis has noticed over time.
Be analytical and specific. Use evidence from the data. Max 600 words. Use ## headers.

Source data:
${source.slice(0, 5000)}`;
    },
  },
  {
    slug: "decisions",
    title: "Significant Decisions & Goals",
    buildPrompt: async (userId) => {
      const source = await buildDecisionsSource(userId);
      return `You are Jarvis maintaining a personal wiki. Write the "Decisions & Goals" wiki page in markdown.
Cover: significant decisions this person has made or is considering, major goals they've stated, blockers they've named, values that guide their decisions.
Be thoughtful and specific. Max 600 words. Use ## headers.

Source data:
${source.slice(0, 5000)}`;
    },
  },
];

// ── Staleness check ───────────────────────────────────────────────────────────

export async function isVaultStale(userId: string): Promise<boolean> {
  try {
    const pages = await db
      .select({ slug: schema.knowledgeVaultPages.slug, generatedAt: schema.knowledgeVaultPages.generatedAt })
      .from(schema.knowledgeVaultPages)
      .where(
        and(
          eq(schema.knowledgeVaultPages.userId, userId),
          isNull(schema.knowledgeVaultPages.archivedAt),
        ),
      );

    // All 5 required core slugs must be present for the vault to be considered complete.
    const presentSlugs = new Set(pages.map((p) => p.slug));
    const allPresent = schema.VAULT_SLUGS.every((s) => presentSlugs.has(s));
    if (!allPresent) return true;

    const oldestGeneratedAt = pages.reduce<Date>(
      (oldest, p) => (p.generatedAt < oldest ? p.generatedAt : oldest),
      pages[0].generatedAt,
    );

    const ageMs = Date.now() - oldestGeneratedAt.getTime();
    if (ageMs > VAULT_TTL_MS) return true;

    const newMemories = await db
      .select({ count: count() })
      .from(schema.userMemories)
      .where(
        and(
          eq(schema.userMemories.userId, userId),
          gte(schema.userMemories.extractedAt, oldestGeneratedAt),
        ),
      );

    return (newMemories[0]?.count ?? 0) >= VAULT_NOVELTY_THRESHOLD;
  } catch (err) {
    console.error("[Vault] isVaultStale check failed:", err);
    return true;
  }
}

// ── Page generation (legacy core pages) ───────────────────────────────────────

async function generatePage(userId: string, spec: PageSpec, model: string): Promise<void> {
  try {
    const promptText = await spec.buildPrompt(userId);

    const response = await openai.chat.completions.create({
      model,
      user: userId,
      messages: [{ role: "user", content: promptText }],
      max_completion_tokens: 1000,
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) return;

    const now = new Date();

    await db
      .insert(schema.knowledgeVaultPages)
      .values({
        userId,
        slug: spec.slug,
        title: spec.title,
        content,
        pageType: "core",
        generatedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.knowledgeVaultPages.userId, schema.knowledgeVaultPages.slug],
        set: {
          title: spec.title,
          content,
          generatedAt: now,
          updatedAt: now,
        },
      });

    console.log(`[Vault] Generated page "${spec.slug}" for ${userId} (${content.length} chars)`);
  } catch (err) {
    console.error(`[Vault] Page generation failed for slug "${spec.slug}":`, err);
    diagEmit({
      userId,
      subsystem: "memory",
      severity: "error",
      message: `Vault page generation failed for slug "${spec.slug}": ${err instanceof Error ? err.message : String(err)}`.slice(0, 300),
      metadata: { operation: "generateVaultPage", slug: spec.slug },
    }).catch(() => {});
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate (or regenerate) all 5 vault pages for the user.
 * Pages are generated sequentially to avoid token hammering.
 */
export async function generateVaultPages(userId: string): Promise<void> {
  const { getModel } = await import("../lib/modelPrefs");
  const model = await getModel(userId, "memory");

  console.log(`[Vault] Starting generation for ${userId}…`);
  for (const spec of PAGE_SPECS) {
    await generatePage(userId, spec, model);
  }
  await generateWikiIndex(userId, model);
  console.log(`[Vault] All pages generated for ${userId}`);
}

/**
 * Trigger vault regeneration only if stale.
 * Call this after memory extraction and after the dream cycle.
 */
export async function maybeRegenerateVault(userId: string): Promise<void> {
  try {
    const stale = await isVaultStale(userId);
    if (!stale) return;
    await generateVaultPages(userId);
  } catch (err) {
    console.error("[Vault] maybeRegenerateVault failed:", err);
    diagEmit({
      userId,
      subsystem: "memory",
      severity: "error",
      message: `Vault regeneration failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300),
      metadata: { operation: "maybeRegenerateVault" },
    }).catch(() => {});
  }
}

// ── Wiki Index ────────────────────────────────────────────────────────────────

/**
 * Regenerate the master `index` page listing all wiki pages grouped by type.
 * The LLM also identifies the top 5 most-referenced pages.
 */
export async function generateWikiIndex(userId: string, model?: string): Promise<void> {
  try {
    if (!model) {
      const { getModel } = await import("../lib/modelPrefs");
      model = await getModel(userId, "memory");
    }

    const pages = await db
      .select({
        slug: schema.knowledgeVaultPages.slug,
        title: schema.knowledgeVaultPages.title,
        pageType: schema.knowledgeVaultPages.pageType,
        updatedAt: schema.knowledgeVaultPages.updatedAt,
        crossRefs: schema.knowledgeVaultPages.crossRefs,
        archivedAt: schema.knowledgeVaultPages.archivedAt,
      })
      .from(schema.knowledgeVaultPages)
      .where(
        and(
          eq(schema.knowledgeVaultPages.userId, userId),
          isNull(schema.knowledgeVaultPages.archivedAt),
        ),
      )
      .orderBy(schema.knowledgeVaultPages.pageType, schema.knowledgeVaultPages.slug);

    if (pages.length === 0) return;

    // Compute backlink counts to find most-referenced pages
    const backlinkCount: Record<string, number> = {};
    for (const page of pages) {
      const refs = Array.isArray(page.crossRefs) ? (page.crossRefs as string[]) : [];
      for (const ref of refs) {
        backlinkCount[ref] = (backlinkCount[ref] ?? 0) + 1;
      }
    }

    const pageListForLLM = pages
      .filter((p) => p.slug !== "index")
      .map((p) => {
        const date = p.updatedAt ? new Date(p.updatedAt).toISOString().slice(0, 10) : "unknown";
        return `- [${p.pageType}] [[${p.slug}]] — ${p.title} (updated: ${date})`;
      })
      .join("\n");

    const top5 = Object.entries(backlinkCount)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([slug, cnt]) => `- [[${slug}]] (${cnt} reference${cnt !== 1 ? "s" : ""})`)
      .join("\n");

    // Fetch last lint log entry if any
    const lintRows = await db
      .select({ ranAt: schema.wikiLintLog.ranAt, summary: schema.wikiLintLog.summary })
      .from(schema.wikiLintLog)
      .where(eq(schema.wikiLintLog.userId, userId))
      .orderBy(desc(schema.wikiLintLog.ranAt))
      .limit(1);

    const lintLogSection = lintRows.length > 0
      ? `\n\n## Lint Log\n_Last run: ${lintRows[0].ranAt.toISOString().slice(0, 10)}_\n${lintRows[0].summary}`
      : "";

    const prompt = `You are Jarvis maintaining a personal wiki index page.
Write the wiki index in clean markdown. Structure:
1. A "## Top Pages" section listing the most cross-referenced pages (provided below).
2. A "## All Pages" section with sub-sections by type: Core, Entity, Concept, Query.
   Each entry: "- [[slug]] — Title (updated: date)"
3. A one-line summary for each page based on its title and type.
Be concise. Do not include filler. Max 500 words.
This is the index page — Jarvis is the sole author.

Most-referenced pages:
${top5 || "(none yet)"}

All pages:
${pageListForLLM}${lintLogSection}`;

    const response = await openai.chat.completions.create({
      model,
      user: userId,
      messages: [{ role: "user", content: prompt }],
      max_completion_tokens: 800,
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) return;

    const now = new Date();
    const indexContent = content + lintLogSection;

    await db
      .insert(schema.knowledgeVaultPages)
      .values({
        userId,
        slug: "index",
        title: "Wiki Index",
        content: indexContent,
        pageType: "core",
        generatedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.knowledgeVaultPages.userId, schema.knowledgeVaultPages.slug],
        set: {
          title: "Wiki Index",
          content: indexContent,
          generatedAt: now,
          updatedAt: now,
        },
      });

    console.log(`[Vault] Wiki index regenerated for ${userId} (${pages.length} pages)`);
  } catch (err) {
    console.error("[Vault] generateWikiIndex failed:", err);
  }
}

// ── Ingest ────────────────────────────────────────────────────────────────────

/**
 * Ingest a new source (chat, email, transcript) into the wiki.
 * Identifies which pages to update, creates new entity/concept pages,
 * embeds [[wiki-link]] cross-references, and regenerates the index.
 *
 * This is a richer, targeted operation that replaces maybeRegenerateVault
 * for substantive sources.
 */
export async function ingestSource(
  userId: string,
  sourceText: string,
  sourceType: string,
): Promise<void> {
  if (!sourceText.trim() || sourceText.trim().length < 50) return;

  try {
    const { getModel } = await import("../lib/modelPrefs");
    const model = await getModel(userId, "memory");

    // Load current wiki — all non-archived pages
    const existingPages = await db
      .select({
        slug: schema.knowledgeVaultPages.slug,
        title: schema.knowledgeVaultPages.title,
        content: schema.knowledgeVaultPages.content,
        pageType: schema.knowledgeVaultPages.pageType,
        crossRefs: schema.knowledgeVaultPages.crossRefs,
      })
      .from(schema.knowledgeVaultPages)
      .where(
        and(
          eq(schema.knowledgeVaultPages.userId, userId),
          isNull(schema.knowledgeVaultPages.archivedAt),
        ),
      );

    const wikiIndex = existingPages
      .map((p) => `- [[${p.slug}]] (${p.pageType}): ${p.title}`)
      .join("\n");

    const allSlugs = existingPages.map((p) => p.slug);

    // Step 1: Ask LLM which pages are affected + what new pages to create
    const planPrompt = `You are Jarvis's wiki engine. A new source just arrived. Your job is to plan wiki updates.

Current wiki pages:
${wikiIndex || "(empty wiki — start fresh)"}

New source (${sourceType}):
${sourceText.slice(0, 4000)}

Respond with JSON only — no explanation:
{
  "pages_to_update": ["slug1", "slug2"],
  "new_pages": [
    {"slug": "slug-here", "title": "Page Title", "type": "entity|concept"}
  ]
}

Rules:
- pages_to_update: slugs from the existing list above that should be revised
- new_pages: only create a new page if the source introduces a distinct entity (named person, project, company) or concept worth its own page
- slugs must be lowercase kebab-case
- Return at most 3 pages_to_update and 2 new_pages per ingest
- Return {"pages_to_update":[],"new_pages":[]} if nothing needs updating`;

    const planResponse = await openai.chat.completions.create({
      model,
      user: userId,
      messages: [{ role: "user", content: planPrompt }],
      response_format: { type: "json_object" },
      max_completion_tokens: 300,
    });

    let plan: { pages_to_update: string[]; new_pages: Array<{ slug: string; title: string; type: string }> } = {
      pages_to_update: [],
      new_pages: [],
    };

    try {
      const parsed = JSON.parse(planResponse.choices[0]?.message?.content || "{}");
      plan.pages_to_update = Array.isArray(parsed.pages_to_update)
        ? parsed.pages_to_update.filter((s: unknown) => typeof s === "string" && allSlugs.includes(s))
        : [];
      plan.new_pages = Array.isArray(parsed.new_pages)
        ? parsed.new_pages.filter((p: unknown): p is { slug: string; title: string; type: string } => {
            if (!p || typeof p !== "object") return false;
            const obj = p as Record<string, unknown>;
            return typeof obj["slug"] === "string" && typeof obj["title"] === "string";
          })
        : [];
    } catch {
      // malformed JSON — skip
    }

    const allSlugsSet = new Set(allSlugs);

    // Step 2: Update existing pages
    for (const slug of plan.pages_to_update) {
      const existing = existingPages.find((p) => p.slug === slug);
      if (!existing) continue;

      await updateWikiPage(userId, {
        slug,
        title: existing.title,
        pageType: existing.pageType as schema.VaultPageType,
        currentContent: existing.content,
        currentCrossRefs: (existing.crossRefs as string[]) ?? [],
        sourceText,
        sourceType,
        allSlugs: Array.from(allSlugsSet),
        model,
      });
    }

    // Step 3: Create new pages
    for (const newPage of plan.new_pages.slice(0, 2)) {
      const safeSlug = newPage.slug.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 80);
      if (!safeSlug || allSlugsSet.has(safeSlug)) continue;

      const pageType: schema.VaultPageType =
        newPage.type === "concept" ? "concept" : "entity";

      await updateWikiPage(userId, {
        slug: safeSlug,
        title: newPage.title,
        pageType,
        currentContent: "",
        currentCrossRefs: [],
        sourceText,
        sourceType,
        allSlugs: Array.from(allSlugsSet),
        model,
      });

      allSlugsSet.add(safeSlug);
    }

    // Step 4: Regenerate the index
    await generateWikiIndex(userId, model);

    console.log(
      `[Vault] ingestSource(${sourceType}) done for ${userId}: updated=${plan.pages_to_update.length} new=${plan.new_pages.length}`,
    );
  } catch (err) {
    console.error("[Vault] ingestSource failed:", err);
    diagEmit({
      userId,
      subsystem: "memory",
      severity: "error",
      message: `Vault ingestSource failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300),
      metadata: { operation: "ingestSource", sourceType },
    }).catch(() => {});
  }
}

// ── Page update helper ────────────────────────────────────────────────────────

interface UpdateWikiPageOptions {
  slug: string;
  title: string;
  pageType: schema.VaultPageType;
  currentContent: string;
  currentCrossRefs: string[];
  sourceText: string;
  sourceType: string;
  allSlugs: string[];
  model: string;
}

async function updateWikiPage(userId: string, opts: UpdateWikiPageOptions): Promise<void> {
  try {
    const {
      slug, title, pageType, currentContent, currentCrossRefs,
      sourceText, sourceType, allSlugs, model,
    } = opts;

    const existingBlock = currentContent
      ? `Current page content:\n${currentContent.slice(0, 3000)}`
      : "(New page — no existing content yet)";

    const slugsBlock = allSlugs.length > 0
      ? `Other wiki pages you can cross-link using [[slug]] syntax:\n${allSlugs.map((s) => `- [[${s}]]`).join("\n")}`
      : "";

    const prompt = `You are Jarvis maintaining a wiki page. Revise or write the "${title}" wiki page.

Page type: ${pageType}
Page slug: ${slug}

${existingBlock}

New source to incorporate (${sourceType}):
${sourceText.slice(0, 3000)}

${slugsBlock}

Instructions:
- Write in third person from Jarvis's perspective
- Incorporate relevant new information from the source
- Embed [[slug]] cross-links where genuinely relevant (use the slugs list above)
- Keep existing content that is still accurate — this is a cumulative wiki, not a rewrite
- Max 500 words. Use ## headers for sections.
- Respond with the FULL revised page content only (no meta-commentary)`;

    const response = await openai.chat.completions.create({
      model,
      user: userId,
      messages: [{ role: "user", content: prompt }],
      max_completion_tokens: 900,
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) return;

    // Extract [[slug]] cross-references from the new content
    const refMatches = [...content.matchAll(/\[\[([a-z0-9-/]+)\]\]/g)];
    const crossRefs = [...new Set([
      ...currentCrossRefs,
      ...refMatches.map((m) => m[1]).filter((s) => allSlugs.includes(s)),
    ])];

    const now = new Date();

    await db
      .insert(schema.knowledgeVaultPages)
      .values({
        userId,
        slug,
        title,
        content,
        pageType,
        crossRefs,
        generatedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.knowledgeVaultPages.userId, schema.knowledgeVaultPages.slug],
        set: {
          title,
          content,
          pageType,
          crossRefs,
          updatedAt: now,
        },
      });

    console.log(`[Vault] Updated wiki page "${slug}" (${pageType}) for ${userId} — ${crossRefs.length} cross-refs`);
  } catch (err) {
    if (isRetriableProviderError(err)) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[Vault] updateWikiPage("${opts.slug}") skipped: provider backpressure (${msg.slice(0, 180)})`);
      return;
    }
    console.error(`[Vault] updateWikiPage("${opts.slug}") failed:`, err);
  }
}

// ── Query Filing ──────────────────────────────────────────────────────────────

/**
 * Optionally file a notable synthesis answer as a query wiki page.
 * The LLM decides if the answer is worth filing (novel synthesis,
 * multi-step reasoning, factual lookup with lasting value).
 * Fire-and-forget safe — never throws.
 */
export async function fileQuery(
  userId: string,
  question: string,
  answer: string,
): Promise<void> {
  if (!question.trim() || !answer.trim() || answer.length < 100) return;

  try {
    const { getModel } = await import("../lib/modelPrefs");
    const model = await getModel(userId, "memory");

    const worthFiling = await openai.chat.completions.create({
      model,
      user: userId,
      messages: [
        {
          role: "user",
          content: `Should this Q&A pair be saved as a reusable wiki page for future reference?
Respond JSON: {"file": true|false, "reason": "brief reason", "slug": "kebab-case-slug", "title": "Page Title"}

File if: novel synthesis, multi-step reasoning, lasting factual value, non-trivial analysis.
Do NOT file if: trivial, task-execution, scheduling, or purely conversational.

Q: ${question.slice(0, 400)}
A: ${answer.slice(0, 600)}`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 150,
    });

    const parsed = JSON.parse(worthFiling.choices[0]?.message?.content || "{}");
    if (!parsed.file) return;

    const rawSlug = typeof parsed.slug === "string" ? parsed.slug : "";
    const slugBody = rawSlug.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 60)
      || question.slice(0, 60).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const safeSlug = `queries/${slugBody}`;
    const title = typeof parsed.title === "string" ? parsed.title : question.slice(0, 80);

    // Load existing wiki slugs for cross-linking
    const existingPages = await db
      .select({ slug: schema.knowledgeVaultPages.slug })
      .from(schema.knowledgeVaultPages)
      .where(
        and(
          eq(schema.knowledgeVaultPages.userId, userId),
          isNull(schema.knowledgeVaultPages.archivedAt),
        ),
      );
    const allSlugs = existingPages.map((p) => p.slug);

    // Check if this query page already exists
    const existing = await db
      .select({ content: schema.knowledgeVaultPages.content, crossRefs: schema.knowledgeVaultPages.crossRefs })
      .from(schema.knowledgeVaultPages)
      .where(
        and(
          eq(schema.knowledgeVaultPages.userId, userId),
          eq(schema.knowledgeVaultPages.slug, safeSlug),
        ),
      )
      .limit(1);

    const slugsBlock = allSlugs.length > 0
      ? `Other wiki pages you can cross-link:\n${allSlugs.map((s) => `- [[${s}]]`).join("\n")}`
      : "";

    const pagePrompt = `You are Jarvis writing a wiki query page that captures a synthesis answer for future reuse.

Question: ${question.slice(0, 400)}
Answer: ${answer.slice(0, 2000)}

${existing.length > 0 ? `Existing page content:\n${existing[0].content.slice(0, 1500)}\n\nMerge new info with existing content.` : ""}

${slugsBlock}

Write a clean wiki page (markdown) that:
- Summarises the question and answer clearly
- Adds [[slug]] cross-references where relevant
- Is self-contained and useful for future retrieval
- Max 400 words. Use ## headers.`;

    const response = await openai.chat.completions.create({
      model,
      user: userId,
      messages: [{ role: "user", content: pagePrompt }],
      max_completion_tokens: 700,
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) return;

    const refMatches = [...content.matchAll(/\[\[([a-z0-9-/]+)\]\]/g)];
    const existingRefs = existing.length > 0 && Array.isArray(existing[0].crossRefs)
      ? (existing[0].crossRefs as string[])
      : [];
    const crossRefs = [...new Set([
      ...existingRefs,
      ...refMatches.map((m) => m[1]).filter((s) => allSlugs.includes(s)),
    ])];

    const now = new Date();
    await db
      .insert(schema.knowledgeVaultPages)
      .values({
        userId,
        slug: safeSlug,
        title,
        content,
        pageType: "query",
        crossRefs,
        generatedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.knowledgeVaultPages.userId, schema.knowledgeVaultPages.slug],
        set: {
          title,
          content,
          pageType: "query",
          crossRefs,
          updatedAt: now,
        },
      });

    console.log(`[Vault] Filed query page "${safeSlug}" for ${userId}`);

    // Regenerate index asynchronously
    generateWikiIndex(userId, model).catch((err) =>
      console.error("[Vault] index regen after fileQuery failed:", err),
    );
  } catch (err) {
    console.error("[Vault] fileQuery failed:", err);
  }
}

// ── Lint ──────────────────────────────────────────────────────────────────────

/**
 * Weekly wiki health check.
 * - Detects contradictions and resolves them
 * - Adds missing cross-links
 * - Archives pages inactive for 30+ days
 * - Writes a ## Lint Log entry to the index page
 */
export async function lintWiki(userId: string): Promise<void> {
  console.log(`[Vault] Starting wiki lint for ${userId}…`);
  const stats = {
    pagesScanned: 0,
    pagesUpdated: 0,
    pagesArchived: 0,
    contradictionsFixed: 0,
    crossLinksAdded: 0,
  };

  try {
    const { getModel } = await import("../lib/modelPrefs");
    const model = await getModel(userId, "memory");

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const pages = await db
      .select()
      .from(schema.knowledgeVaultPages)
      .where(
        and(
          eq(schema.knowledgeVaultPages.userId, userId),
          isNull(schema.knowledgeVaultPages.archivedAt),
        ),
      );

    stats.pagesScanned = pages.length;
    if (pages.length === 0) {
      console.log(`[Vault] Lint: no pages to scan for ${userId}`);
      return;
    }

    const allSlugs = pages.map((p) => p.slug);

    // Archive inactive pages (not accessed or updated in 30+ days, non-core type)
    for (const page of pages) {
      if (page.pageType === "core") continue; // never archive core pages
      const lastActivity = new Date(
        page.lastAccessedAt ?? page.updatedAt,
      );
      if (lastActivity < thirtyDaysAgo) {
        await db
          .update(schema.knowledgeVaultPages)
          .set({ archivedAt: new Date() })
          .where(
            and(
              eq(schema.knowledgeVaultPages.userId, userId),
              eq(schema.knowledgeVaultPages.slug, page.slug),
            ),
          );
        stats.pagesArchived++;
        console.log(`[Vault] Lint: archived inactive page "${page.slug}" for ${userId}`);
      }
    }

    // Process active pages in batches of 5 for contradiction + cross-link checks
    const activePages = pages.filter((p) => {
      if (p.pageType === "core") return true;
      const lastActivity = new Date(p.lastAccessedAt ?? p.updatedAt);
      return lastActivity >= thirtyDaysAgo;
    });

    const BATCH_SIZE = 5;
    for (let i = 0; i < activePages.length; i += BATCH_SIZE) {
      const batch = activePages.slice(i, i + BATCH_SIZE);

      // Build a summary of the batch for contradiction detection
      const batchSummary = batch
        .map((p) => `### [[${p.slug}]] — ${p.title}\n${p.content.slice(0, 800)}`)
        .join("\n\n---\n\n");

      const lintPrompt = `You are Jarvis's wiki linter. Review these wiki pages and:
1. Identify any factual contradictions between pages
2. Identify any missing [[slug]] cross-links (where one page mentions content that exists in another page but doesn't link it)

Available slugs: ${allSlugs.join(", ")}

Pages to review:
${batchSummary}

Respond with JSON only:
{
  "corrections": [
    {
      "slug": "page-slug",
      "issue": "brief description of contradiction or missing cross-link",
      "revised_content": "full revised page content with fix applied"
    }
  ]
}

Return {"corrections": []} if no issues found. Only include entries where revision is genuinely needed.`;

      const lintResponse = await openai.chat.completions.create({
        model,
        user: userId,
        messages: [{ role: "user", content: lintPrompt }],
        response_format: { type: "json_object" },
        max_completion_tokens: 2000,
      });

      let corrections: Array<{ slug: string; issue: string; revised_content: string }> = [];
      try {
        const parsed = JSON.parse(lintResponse.choices[0]?.message?.content || "{}");
        corrections = Array.isArray(parsed.corrections) ? parsed.corrections : [];
      } catch {
        // skip malformed
      }

      for (const correction of corrections) {
        if (typeof correction.slug !== "string" || !allSlugs.includes(correction.slug)) continue;
        if (typeof correction.revised_content !== "string" || !correction.revised_content.trim()) continue;

        const content = correction.revised_content.trim();

        // Extract cross-refs from the revised content
        const refMatches = [...content.matchAll(/\[\[([a-z0-9-/]+)\]\]/g)];
        const page = pages.find((p) => p.slug === correction.slug);
        const existingRefs = page && Array.isArray(page.crossRefs) ? (page.crossRefs as string[]) : [];
        const newRefs = refMatches.map((m) => m[1]).filter((s) => allSlugs.includes(s));
        const crossRefs = [...new Set([...existingRefs, ...newRefs])];

        const addedCrossLinks = newRefs.filter((r) => !existingRefs.includes(r)).length;
        stats.crossLinksAdded += addedCrossLinks;

        const isContradiction = correction.issue.toLowerCase().includes("contradiction");
        if (isContradiction) stats.contradictionsFixed++;

        await db
          .update(schema.knowledgeVaultPages)
          .set({
            content,
            crossRefs,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.knowledgeVaultPages.userId, userId),
              eq(schema.knowledgeVaultPages.slug, correction.slug),
            ),
          );

        stats.pagesUpdated++;
        console.log(`[Vault] Lint: fixed "${correction.slug}" for ${userId} — ${correction.issue}`);
      }
    }

    // Write lint log record
    const lintSummary = `Scanned ${stats.pagesScanned} pages. Fixed ${stats.contradictionsFixed} contradiction(s), added ${stats.crossLinksAdded} cross-link(s), archived ${stats.pagesArchived} inactive page(s), updated ${stats.pagesUpdated} page(s) total.`;

    await db.insert(schema.wikiLintLog).values({
      userId,
      pagesScanned: stats.pagesScanned,
      pagesUpdated: stats.pagesUpdated,
      pagesArchived: stats.pagesArchived,
      contradictionsFixed: stats.contradictionsFixed,
      crossLinksAdded: stats.crossLinksAdded,
      summary: lintSummary,
    });

    // Regenerate index with updated lint log
    await generateWikiIndex(userId, model);

    console.log(`[Vault] Lint complete for ${userId}: ${lintSummary}`);
  } catch (err) {
    console.error("[Vault] lintWiki failed:", err);
    diagEmit({
      userId,
      subsystem: "memory",
      severity: "error",
      message: `Vault lint failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300),
      metadata: { operation: "lintWiki" },
    }).catch(() => {});
  }
}

/**
 * Run weekly wiki lint for all users.
 */
export async function lintWikiForAllUsers(): Promise<number> {
  try {
    const users = await db
      .select({ userId: schema.knowledgeVaultPages.userId })
      .from(schema.knowledgeVaultPages)
      .groupBy(schema.knowledgeVaultPages.userId);

    let count = 0;
    for (const { userId } of users) {
      try {
        await lintWiki(userId);
        count++;
      } catch (err) {
        console.error(`[Vault] lintWiki failed for user ${userId}:`, err);
      }
    }
    return count;
  } catch (err) {
    console.error("[Vault] lintWikiForAllUsers failed:", err);
    return 0;
  }
}
