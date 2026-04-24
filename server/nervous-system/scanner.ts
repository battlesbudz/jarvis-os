/**
 * Jarvis Nervous System — Ambient Signal Scanner
 *
 * Runs every 30 minutes via the heartbeat loop. For each active user with
 * watch topics, runs web searches, scores relevance via LLM, deduplicates
 * by content hash, stores qualifying signals, and delivers them through the
 * channel registry + in-app inbox.
 */
import crypto from "crypto";
import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import * as schema from "@shared/schema";
import { tavilySearch } from "../integrations/search";
import { notifyUser } from "../channels/registry";
import { logInteraction } from "../interactionLog";
import { logAction, isActionSuppressed } from "../intelligence/actionLog";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const RELEVANCE_THRESHOLD = 0.55;
const SCAN_INTERVAL_MS = 30 * 60 * 1000;

const lastScanAt: Record<string, number | undefined> = {};

function contentHash(userId: string, headline: string, url: string): string {
  return crypto
    .createHash("sha256")
    .update(`${userId}::${headline.toLowerCase().trim()}::${url.toLowerCase().trim()}`)
    .digest("hex")
    .slice(0, 64);
}

interface ScoredResult {
  headline: string;
  url: string;
  snippet: string;
  relevanceScore: number;
  relevanceExplanation: string;
}

async function scoreResults(
  watchLabel: string,
  category: string,
  results: { title: string; url: string; content: string }[],
): Promise<ScoredResult[]> {
  if (results.length === 0) return [];

  const items = results
    .slice(0, 6)
    .map((r, i) => `[${i}] "${r.title}" — ${r.content.slice(0, 300)}`)
    .join("\n\n");

  const prompt = `You are a relevance filter for a personal assistant. The user is monitoring: "${watchLabel}" (category: ${category}).

Evaluate each search result below and decide whether it is genuinely relevant to this topic. Score from 0.0 to 1.0 where:
- 0.0–0.4: not relevant or only tangentially related
- 0.5–0.7: relevant but generic / widely known
- 0.8–1.0: directly relevant, new, specific, worth surfacing

Also write a one-sentence relevance_explanation (max 20 words) for results scoring ≥ 0.5.

Return JSON array, one object per result (same order):
[{ "index": 0, "score": 0.85, "explanation": "Directly mentions Acme Corp acquisition." }, ...]

Results:
${items}`;

  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_completion_tokens: 600,
    });
    const raw = resp.choices[0]?.message?.content || "{}";
    const parsed: unknown = JSON.parse(raw);

    // Normalise: LLM may return `[...]` (wrapped in a JSON object key) or
    // a top-level array-like structure. We extract the first array-typed
    // value we can find without resorting to `any`.
    let arr: unknown[] = [];
    if (Array.isArray(parsed)) {
      arr = parsed;
    } else if (parsed !== null && typeof parsed === "object") {
      for (const val of Object.values(parsed as Record<string, unknown>)) {
        if (Array.isArray(val)) { arr = val; break; }
      }
    }

    type RawItem = { index: number; score: number; explanation?: string };
    const isRawItem = (v: unknown): v is RawItem =>
      v !== null &&
      typeof v === "object" &&
      typeof (v as Record<string, unknown>).index === "number" &&
      typeof (v as Record<string, unknown>).score === "number";

    return arr
      .filter(isRawItem)
      .map((item) => {
        const r = results[item.index];
        if (!r) return null;
        return {
          headline: r.title,
          url: r.url,
          snippet: r.content.slice(0, 500),
          relevanceScore: Math.round(Math.min(1, Math.max(0, item.score)) * 100),
          relevanceExplanation: item.explanation || `Relevant to "${watchLabel}".`,
        };
      })
      .filter((x): x is ScoredResult => x !== null);
  } catch (err) {
    console.error("[NervousSystem] LLM scoring failed:", err);
    return [];
  }
}

async function scanWatchTopic(
  userId: string,
  watch: typeof schema.nervousSystemWatches.$inferSelect,
): Promise<number> {
  // Always stamp lastCheckedAt so the UI reflects recency even on no-hit scans.
  const stampLastChecked = () =>
    db
      .update(schema.nervousSystemWatches)
      .set({ lastCheckedAt: new Date() })
      .where(eq(schema.nervousSystemWatches.id, watch.id))
      .catch((err) => console.error("[NervousSystem] lastCheckedAt update failed:", err));

  let searchResults: { title: string; url: string; content: string }[] = [];
  try {
    const query = `${watch.label} news latest`;
    const tavilyResp = await tavilySearch(query, 6);
    searchResults = tavilyResp.results || [];
  } catch (err) {
    console.error(`[NervousSystem] search failed for "${watch.label}":`, err);
    await stampLastChecked();
    return 0;
  }

  if (searchResults.length === 0) {
    await stampLastChecked();
    return 0;
  }

  const scored = await scoreResults(watch.label, watch.category, searchResults);
  const qualifying = scored.filter((s) => s.relevanceScore >= RELEVANCE_THRESHOLD * 100);
  if (qualifying.length === 0) {
    await stampLastChecked();
    return 0;
  }

  let stored = 0;

  for (const hit of qualifying) {
    const hash = contentHash(userId, hit.headline, hit.url);

    try {
      await db.insert(schema.nervousSystemSignals).values({
        userId,
        watchId: watch.id,
        watchLabel: watch.label,
        headline: hit.headline,
        url: hit.url,
        snippet: hit.snippet,
        relevanceExplanation: hit.relevanceExplanation,
        relevanceScore: hit.relevanceScore,
        contentHash: hash,
      });
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === "23505") continue;
      console.error("[NervousSystem] signal insert failed:", err);
      continue;
    }

    const msgText = `🔎 Signal for "${watch.label}"\n\n${hit.headline}\n${hit.relevanceExplanation}${hit.url ? `\n\n${hit.url}` : ""}`;

    // Self-correction: skip surfacing if proactive_message is suppressed.
    const suppressed = await isActionSuppressed(userId, "proactive_message").catch(() => false);
    if (suppressed) {
      console.log(`[NervousSystem] proactive_message suppressed for user ${userId} (self-correction) — skipping inbox surface`);
      continue;
    }

    // Surface in inbox regardless of channel delivery outcome.
    // suggestedActions follow the { label, actionType } contract; the signal
    // URL is visible in the snippet and channel delivery message.
    const inboxSourceId = `nervous_system:${hash}`;
    let inboxInserted = false;
    try {
      await db.insert(schema.inboxItems).values({
        userId,
        sourceType: "nervous_system",
        sourceId: inboxSourceId,
        subject: hit.headline,
        sender: `Nervous System — ${watch.label}`,
        snippet: hit.relevanceExplanation || hit.snippet?.slice(0, 200),
        jarvisReason: hit.relevanceExplanation,
        suggestedActions: [{ label: "Dismiss", actionType: "dismiss" }],
        status: "pending",
      });
      inboxInserted = true;
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code !== "23505") console.error("[NervousSystem] inbox insert failed:", err);
      // 23505 = duplicate — inbox item already exists, treat as already-surfaced
    }

    // Log the proactive_message action only when the inbox item was actually
    // inserted (new surface event). Skips duplicates and failed inserts so
    // Ego engagement metrics stay accurate.
    if (inboxInserted) {
      logAction(userId, "proactive_message", { type: "nervous_system_signal", sourceId: inboxSourceId, hash }).catch(() => {});
    }

    // Attempt channel delivery; only mark deliveredAt when at least one
    // *external* channel succeeded. The in_app channel no-ops for nervous_system
    // (scanner wrote the inbox item directly), so its ok:true is excluded here.
    try {
      const deliveryResults = await notifyUser(userId, "nervous_system", msgText);
      const anyDelivered = deliveryResults.some((r) => r.result.ok && r.channel !== "in_app");
      if (anyDelivered) {
        await db
          .update(schema.nervousSystemSignals)
          .set({ deliveredAt: new Date() })
          .where(and(eq(schema.nervousSystemSignals.userId, userId), eq(schema.nervousSystemSignals.contentHash, hash)));
        logInteraction(userId, "notification", "outbound", msgText, "nervous_system").catch(() => {});
      }
    } catch (err) {
      console.error("[NervousSystem] channel delivery failed:", err);
    }

    stored++;
  }

  await stampLastChecked();
  return stored;
}

export async function runNervousSystemScan(): Promise<void> {
  const now = Date.now();

  let watches: typeof schema.nervousSystemWatches.$inferSelect[] = [];
  try {
    watches = await db
      .select()
      .from(schema.nervousSystemWatches)
      .where(eq(schema.nervousSystemWatches.active, true));
  } catch (err) {
    console.error("[NervousSystem] failed to load watches:", err);
    return;
  }

  if (watches.length === 0) return;

  const byUser: Record<string, typeof watches> = {};
  for (const w of watches) {
    if (!byUser[w.userId]) byUser[w.userId] = [];
    byUser[w.userId].push(w);
  }

  for (const [userId, userWatches] of Object.entries(byUser)) {
    // Seed throttle from DB on first encounter (e.g. after server restart) so
    // we don't immediately re-scan watches that were checked within the interval.
    if (lastScanAt[userId] === undefined) {
      const maxDbChecked = userWatches
        .map((w) => (w.lastCheckedAt ? new Date(w.lastCheckedAt).getTime() : 0))
        .reduce((a, b) => Math.max(a, b), 0);
      lastScanAt[userId] = maxDbChecked;
    }
    const lastScan = lastScanAt[userId];
    if (now - lastScan < SCAN_INTERVAL_MS) continue;
    lastScanAt[userId] = now;

    let totalSignals = 0;
    for (const watch of userWatches) {
      try {
        const fired = await scanWatchTopic(userId, watch);
        totalSignals += fired;
      } catch (err) {
        console.error(`[NervousSystem] scan failed for watch "${watch.label}" user ${userId}:`, err);
      }
    }

    if (totalSignals > 0) {
      console.log(`[NervousSystem] ${totalSignals} signal(s) delivered for user ${userId}`);
    }
  }
}
