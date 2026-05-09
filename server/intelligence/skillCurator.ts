/**
 * Skill Curator — Auto-detect habits and turn them into permanent Jarvis skills
 *
 * Runs on the Sunday 4:30 AM schedule alongside the learning synthesiser.
 * Analyses the past week's orchestration_traces and interaction_logs for
 * recurring intent clusters (≥3 occurrences with positive signal), then
 * calls an LLM to draft candidate skills. Candidates are written to the
 * skill_candidates table for the user to review in Profile > Skills.
 */
import OpenAI from "openai";
import { getOpenAIClientConfig } from "../agent/providers/env";
import { db } from "../db";
import { skillCandidates, orchestrationTraces, interactionLog, users } from "@shared/schema";
import { eq, and, gte, desc } from "drizzle-orm";

const openai = new OpenAI(getOpenAIClientConfig());

const MIN_OCCURRENCES = 3;
const LOOKBACK_DAYS = 7;
const MAX_CANDIDATES_PER_RUN = 5;

export interface CuratorResult {
  userId: string;
  candidatesCreated: number;
  skipped: boolean;
  skipReason?: string;
}

/**
 * Propose skill candidates for a single user based on the last 7 days of
 * orchestration traces and interaction logs.
 */
export async function curateSkillsForUser(userId: string): Promise<CuratorResult> {
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const [traces, interactions] = await Promise.all([
    db
      .select({ userRequest: orchestrationTraces.userRequest, createdAt: orchestrationTraces.createdAt })
      .from(orchestrationTraces)
      .where(
        and(
          eq(orchestrationTraces.userId, userId),
          gte(orchestrationTraces.createdAt, cutoff),
        ),
      )
      .orderBy(desc(orchestrationTraces.createdAt))
      .limit(100),
    db
      .select({ content: interactionLog.content, label: interactionLog.label, createdAt: interactionLog.createdAt })
      .from(interactionLog)
      .where(
        and(
          eq(interactionLog.userId, userId),
          gte(interactionLog.createdAt, cutoff),
        ),
      )
      .orderBy(desc(interactionLog.createdAt))
      .limit(200),
  ]);

  const allRequests = traces.map((t) => t.userRequest as string | null).filter(Boolean) as string[];
  // Correction-labelled interactions are excluded — they represent negative signal
  const allInteractions = interactions
    .filter((i) => i.content && i.label !== "correction")
    .map((i) => i.content as string);

  const allMessages = [...allRequests, ...allInteractions];

  if (allMessages.length < MIN_OCCURRENCES) {
    return {
      userId,
      candidatesCreated: 0,
      skipped: true,
      skipReason: `Insufficient activity — need at least ${MIN_OCCURRENCES} recent interactions`,
    };
  }

  // ── Embedding-based intent clustering ────────────────────────────────────
  // 1. Compute text-embedding-3-small vectors for each unique message (batched).
  // 2. Cluster messages by cosine similarity (threshold 0.78) — semantically
  //    similar requests are grouped even if phrased differently.
  // 3. Only clusters with ≥ MIN_OCCURRENCES members with positive signal are
  //    forwarded to the LLM.  This ensures the LLM drafts skills backed by
  //    evidence, not isolated one-off requests.

  function cosine(a: number[], b: number[]): number {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
  }

  // Deduplicate messages for embedding to avoid redundant API calls
  const uniqueMessages = [...new Set(allMessages.map((m) => m.slice(0, 300)))];

  let embeddings: number[][] = [];
  try {
    // Batch in groups of 64 (API limit is 2048 texts, but 64 is safe and cost-friendly)
    for (let i = 0; i < uniqueMessages.length; i += 64) {
      const batch = uniqueMessages.slice(i, i + 64);
      const resp = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: batch,
        dimensions: 256, // Reduced dimension for efficiency; cosine still reliable
      });
      embeddings.push(...resp.data.map((d) => d.embedding));
    }
  } catch (err) {
    console.error("[SkillCurator] embedding call failed — aborting curation for user", userId, err);
    return {
      userId,
      candidatesCreated: 0,
      skipped: true,
      skipReason: "Embedding service unavailable; curation deferred to next run",
    };
  }

  // Greedy cluster assignment (O(n²) — acceptable for ≤300 messages)
  const SIMILARITY_THRESHOLD = 0.78;
  const clusterMap: Array<{ indices: number[]; centroid: number[]; examples: string[] }> = [];

  for (let i = 0; i < uniqueMessages.length; i++) {
    const vec = embeddings[i];
    let bestCluster = -1;
    let bestSim = SIMILARITY_THRESHOLD;

    for (let c = 0; c < clusterMap.length; c++) {
      const sim = cosine(vec, clusterMap[c].centroid);
      if (sim > bestSim) {
        bestSim = sim;
        bestCluster = c;
      }
    }

    if (bestCluster === -1) {
      // Start a new cluster
      clusterMap.push({ indices: [i], centroid: vec, examples: [uniqueMessages[i].slice(0, 180)] });
    } else {
      // Merge into existing cluster and update centroid (running average)
      const cl = clusterMap[bestCluster];
      cl.indices.push(i);
      if (cl.examples.length < 3) cl.examples.push(uniqueMessages[i].slice(0, 180));
      // Recompute centroid as mean of member vectors
      const n = cl.indices.length;
      cl.centroid = cl.centroid.map((v, j) => (v * (n - 1) + embeddings[i][j]) / n);
    }
  }

  // Count how many original messages fall in each cluster (messages can repeat)
  // by matching back through allMessages → uniqueMessages index
  const msgToUniqueIdx = new Map(uniqueMessages.map((m, i) => [m.slice(0, 300), i]));
  const uniqueIdxToCluster = new Map<number, number>();
  for (let c = 0; c < clusterMap.length; c++) {
    for (const idx of clusterMap[c].indices) uniqueIdxToCluster.set(idx, c);
  }

  const clusterCounts = new Array(clusterMap.length).fill(0);
  for (const msg of allMessages) {
    const uIdx = msgToUniqueIdx.get(msg.slice(0, 300));
    if (uIdx !== undefined) {
      const cIdx = uniqueIdxToCluster.get(uIdx);
      if (cIdx !== undefined) clusterCounts[cIdx]++;
    }
  }

  // Gate on recurrence: only keep clusters with ≥ MIN_OCCURRENCES total messages
  const qualifyingClusters = clusterMap
    .map((cl, i) => ({ cl, count: clusterCounts[i] }))
    .filter(({ count }) => count >= MIN_OCCURRENCES)
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_CANDIDATES_PER_RUN * 3);

  if (qualifyingClusters.length === 0) {
    return {
      userId,
      candidatesCreated: 0,
      skipped: true,
      skipReason: "No intent clusters reached the minimum recurrence threshold (≥3 occurrences)",
    };
  }

  const clusterSummary = qualifyingClusters.map(({ cl, count }, i) =>
    `Cluster ${i + 1} — ${count} occurrences\n  Examples:\n  ${cl.examples.map((e) => `- ${e}`).join("\n  ")}`
  ).join("\n\n");

  const prompt = `You are an AI assistant that helps improve a personal productivity assistant called Jarvis.

The following are intent clusters automatically identified from the user's interaction history (last ${LOOKBACK_DAYS} days) using semantic embedding similarity.
Each cluster represents a semantically related group of requests that the user has made ${MIN_OCCURRENCES}+ times.

Clusters (sorted by frequency):
---
${clusterSummary}
---

Instructions:
1. For each cluster, draft ONE candidate Jarvis skill that captures the user's recurring intent.
2. Skills must be specific and actionable — not generic (e.g. not "be helpful", "be concise").
3. Infer the user's underlying preference or workflow from the examples; do not just paraphrase them.
4. Return ONLY a valid JSON array (no markdown fences) with up to ${MAX_CANDIDATES_PER_RUN} objects:
[
  {
    "name": "Short skill name (3-6 words)",
    "triggerDescription": "One sentence — when should Jarvis apply this skill?",
    "instructionText": "2-4 sentences of specific instructions Jarvis must follow. Second-person imperative directed at Jarvis."
  }
]

If you cannot draft meaningful skills from the clusters, return an empty array: []`;

  let candidates: { name: string; triggerDescription: string; instructionText: string }[] = [];
  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_completion_tokens: 1200,
    });
    const raw = resp.choices[0]?.message?.content?.trim() ?? "[]";
    candidates = JSON.parse(raw);
    if (!Array.isArray(candidates)) candidates = [];
  } catch (err) {
    console.error("[SkillCurator] LLM call or parse failed:", err);
    return { userId, candidatesCreated: 0, skipped: true, skipReason: "LLM call failed" };
  }

  const valid = candidates.filter(
    (c) => c?.name && c?.triggerDescription && c?.instructionText,
  );

  if (valid.length === 0) {
    return {
      userId,
      candidatesCreated: 0,
      skipped: true,
      skipReason: "LLM found no meaningful recurring patterns",
    };
  }

  // ── Deduplication guard ───────────────────────────────────────────────────
  // Fetch existing pending candidate names for this user and skip any new
  // candidate whose normalised name matches one already pending.  This prevents
  // near-duplicate rows from accumulating across weekly runs.
  const existingPending = await db
    .select({ name: skillCandidates.name })
    .from(skillCandidates)
    .where(and(eq(skillCandidates.userId, userId), eq(skillCandidates.status, "pending")));
  const existingNormSet = new Set(existingPending.map((r) => r.name.toLowerCase().trim()));

  const toInsert = valid
    .slice(0, MAX_CANDIDATES_PER_RUN)
    .filter((c) => !existingNormSet.has(c.name.toLowerCase().trim()));

  if (toInsert.length === 0) {
    return { userId, candidatesCreated: 0, skipped: true, skipReason: "All proposed candidates are already pending" };
  }

  await db.insert(skillCandidates).values(
    toInsert.map((c) => ({
      userId,
      name: c.name.trim().slice(0, 80),
      triggerDescription: c.triggerDescription.trim().slice(0, 300),
      instructionText: c.instructionText.trim().slice(0, 2000),
      sourceType: "curator" as const,
      status: "pending" as const,
    })),
  );

  console.log(`[SkillCurator] Created ${toInsert.length} candidate(s) for user ${userId}`);
  return { userId, candidatesCreated: toInsert.length, skipped: false };
}

/**
 * Run the skill curator for all users who have enough recent activity.
 * Called on the Sunday 4:30 AM schedule.
 */
export async function curateSkillsForAllUsers(): Promise<void> {
  console.log("[SkillCurator] Starting weekly skill curation run...");
  let processed = 0;
  let total = 0;

  try {
    const allUsers = await db.select({ id: users.id }).from(users);
    total = allUsers.length;

    for (const user of allUsers) {
      try {
        const result = await curateSkillsForUser(user.id);
        if (!result.skipped) processed++;
      } catch (err) {
        console.error(`[SkillCurator] Failed for user ${user.id}:`, err);
      }
    }
  } catch (err) {
    console.error("[SkillCurator] Weekly curation run failed:", err);
  }

  console.log(`[SkillCurator] Weekly curation complete — ${processed}/${total} users received new candidates`);
}

/**
 * Emit a single skill candidate from the learning synthesiser pipeline.
 * Each bullet point from CORRECTIONS.md synthesis becomes a reviewable candidate.
 */
export async function emitSynthesiserCandidate(
  userId: string,
  bullet: string,
): Promise<void> {
  if (!bullet || !userId) return;
  const cleaned = bullet.replace(/^-\s*/, "").trim();
  if (cleaned.length < 10) return;

  const prompt = `Convert this learning bullet point into a structured Jarvis skill candidate.

Bullet: "${cleaned}"

Return ONLY a valid JSON object (no markdown fences):
{
  "name": "Short skill name (3-6 words)",
  "triggerDescription": "One sentence — when should Jarvis apply this?",
  "instructionText": "2-3 sentences. Second-person imperative directed at Jarvis."
}`;

  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_completion_tokens: 300,
    });
    const raw = resp.choices[0]?.message?.content?.trim() ?? "{}";
    const data = JSON.parse(raw) as { name?: string; triggerDescription?: string; instructionText?: string };
    if (!data.name || !data.triggerDescription || !data.instructionText) return;

    await db.insert(skillCandidates).values({
      userId,
      name: data.name.trim().slice(0, 80),
      triggerDescription: data.triggerDescription.trim().slice(0, 300),
      instructionText: data.instructionText.trim().slice(0, 2000),
      sourceType: "synthesiser",
      status: "pending",
    });
    console.log(`[SkillCurator] Emitted synthesiser candidate "${data.name}" for user ${userId}`);
  } catch (err) {
    console.error("[SkillCurator] emitSynthesiserCandidate failed (non-fatal):", err);
  }
}
