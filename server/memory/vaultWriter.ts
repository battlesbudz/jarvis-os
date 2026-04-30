/**
 * Jarvis Knowledge Vault Writer
 *
 * Generates and maintains structured wiki pages about the user.
 * Pages are organized by slug: about-you, projects, people, patterns, decisions.
 * Jarvis is the sole author — users never write these pages directly.
 *
 * Staleness rules (same cadence as Soul):
 *  - Fresh if generated within the last 6 hours AND fewer than 3 new memories since last gen.
 *  - Stale if no pages exist, or either condition above fails.
 */

import { db } from "../db";
import { eq, and, desc, gte, sql, count } from "drizzle-orm";
import * as schema from "@shared/schema";
import OpenAI from "openai";
import { emit as diagEmit } from "../diagnostics/diagnosticsService";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const VAULT_TTL_MS = 6 * 60 * 60 * 1000;
const VAULT_NOVELTY_THRESHOLD = 3;

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
          eq(schema.userMemories.userId, userId),
          eq(schema.userMemories.tier, "long_term"),
          sql`${schema.userMemories.category} IN ('values','communication_style','preferences','fact')`,
          eq(schema.userMemories.reviewStatus, "active"),
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
          eq(schema.userMemories.userId, userId),
          eq(schema.userMemories.tier, "long_term"),
          sql`${schema.userMemories.category} IN ('goals_history','accomplishments')`,
          eq(schema.userMemories.reviewStatus, "active"),
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
          eq(schema.userMemories.userId, userId),
          eq(schema.userMemories.category, "relationships"),
          eq(schema.userMemories.reviewStatus, "active"),
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
        eq(schema.userMemories.userId, userId),
        sql`${schema.userMemories.category} IN ('goals_history','values','blockers')`,
        eq(schema.userMemories.tier, "long_term"),
        eq(schema.userMemories.reviewStatus, "active"),
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
      .where(eq(schema.knowledgeVaultPages.userId, userId));

    // All 5 required slugs must be present for the vault to be considered complete.
    const presentSlugs = new Set(pages.map((p) => p.slug));
    const allPresent = schema.VAULT_SLUGS.every((s) => presentSlugs.has(s));
    if (!allPresent) return true;

    // Use the oldest generatedAt across all pages — regenerate if any page is stale.
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

// ── Page generation ───────────────────────────────────────────────────────────

async function generatePage(userId: string, spec: PageSpec, model: string): Promise<void> {
  try {
    const promptText = await spec.buildPrompt(userId);

    const response = await openai.chat.completions.create({
      model,
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
