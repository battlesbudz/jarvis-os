/**
 * capabilityGapAnalyzer.ts — Step 2 of the weekly self-improvement cycle.
 *
 * Loads capability gaps accumulated during the past 7 days, clusters them
 * with an LLM, and for low-risk buildable gaps autonomously queues build_feature
 * jobs via the job queue. Higher-risk gaps are queued as inbox deliverables.
 *
 * Build jobs are submitted to the job queue (not executed inline) so they run
 * AFTER the self-improvement cycle completes, preventing the build job's
 * process restart from interrupting the cycle or the Telegram summary.
 *
 * Safety constraints (all enforced in code):
 *   - Max 2 auto-build job submissions per weekly cycle (MAX_AUTO_BUILDS)
 *   - Only "low" risk clusters trigger auto-build
 *   - Only the source gap rows for a successfully queued cluster are marked addressed
 *   - Analyzer failure is fully isolated — never affects the rest of the cycle
 */

import { db } from '../db';
import { eq, and, gte, or, sql } from 'drizzle-orm';
import * as schema from '@shared/schema';
import { anthropic } from '../lib/anthropicClient';
import { submitAgentJob } from './jobClient';

const ANALYZER_LLM_MODEL = 'claude-3-5-haiku-20241022';
const MAX_GAP_CLUSTERS = 5;
const MAX_AUTO_BUILDS = 2;

// ── Types ──────────────────────────────────────────────────────────────────────

interface ToolProposal {
  name: string;
  description: string;
  implementation: string;
}

interface GapCluster {
  theme: string;
  frequency: number;
  buildable: boolean;
  riskLevel: 'low' | 'medium' | 'high';
  /**
   * Zero-based indices into the rawGaps array indicating which source gaps
   * contributed to this cluster. Used to precisely mark only those gap rows
   * as addressed after a successful build.
   */
  memberIndices: number[];
  toolProposal?: ToolProposal;
}

interface ClusteringResult {
  clusters: GapCluster[];
}

/** A row from the aggregated gap query. */
interface RawGapRow {
  userMessage: string;
  agentReplySnippet: string | null;
  detectedReason: string;
  count: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Create a deliverable inbox item for a gap cluster that cannot be auto-built. */
async function createGapInboxItem(userId: string, cluster: GapCluster): Promise<void> {
  try {
    const proposal = cluster.toolProposal;
    const body = [
      `## Capability Gap: ${cluster.theme}`,
      '',
      `**Frequency this week:** ${cluster.frequency} occurrence${cluster.frequency !== 1 ? 's' : ''}`,
      `**Risk level:** ${cluster.riskLevel}`,
      '',
      '## Proposed Tool',
      proposal?.name ? `**Tool name:** \`${proposal.name}\`` : '',
      proposal?.description ? `**Description:** ${proposal.description}` : '',
      '',
      '## Implementation Spec',
      proposal?.implementation ?? '(see theme description above)',
    ].filter((l) => l !== undefined).join('\n');

    await db.insert(schema.deliverables).values({
      userId,
      agentType: 'planning',
      type: 'plan',
      title: `Capability gap proposal: ${cluster.theme}`,
      body,
      summary: `Jarvis couldn't handle "${cluster.theme}" ${cluster.frequency} time${cluster.frequency !== 1 ? 's' : ''} this week. A new tool has been proposed.`,
      meta: {
        source: 'capability_gap_analysis',
        riskLevel: cluster.riskLevel,
        frequency: cluster.frequency,
        toolName: proposal?.name ?? null,
      },
    });
  } catch (err) {
    console.error(`[CapabilityGap] Failed to create inbox item for "${cluster.theme}":`, err);
  }
}

/**
 * Mark capability gap rows as addressed by (userMessage, detectedReason) pairs.
 *
 * Exported so the job queue completion handler can call this when a build_feature
 * job succeeds — gaps are only marked addressed on actual build success, not on
 * job submission. The pairs were stored in the job's input at submission time.
 *
 * Fire-and-forget via setImmediate — never blocks the calling path.
 */
export function markCapabilityGapEntriesAddressed(
  userId: string,
  entries: Array<{ userMessage: string; detectedReason: string }>,
): void {
  if (entries.length === 0) return;
  setImmediate(() => {
    // Build an OR condition: (userMessage=m1 AND detectedReason=r1) OR (m2 AND r2) ...
    const pairConditions = entries.map((e) =>
      and(
        eq(schema.capabilityGaps.userMessage, e.userMessage),
        eq(schema.capabilityGaps.detectedReason, e.detectedReason),
      ),
    );
    const pairFilter = pairConditions.length === 1
      ? pairConditions[0]
      : or(...pairConditions);

    db
      .update(schema.capabilityGaps)
      .set({ addressed: true })
      .where(
        and(
          eq(schema.capabilityGaps.userId, userId),
          eq(schema.capabilityGaps.addressed, false),
          pairFilter,
        ),
      )
      .catch((err: unknown) => {
        console.error(`[CapabilityGap] Failed to mark gap entries as addressed:`, err);
      });
  });
}


// ── Main exported function ─────────────────────────────────────────────────────

/**
 * Run the weekly capability gap analysis for a single user.
 *
 * Steps:
 *   A. Load this week's unaddressed gaps from the DB
 *   B. Cluster with an LLM and decide what's buildable; LLM reports memberIndices
 *      so we know exactly which source rows belong to each cluster
 *   C. Auto-build low-risk tools (cap: MAX_AUTO_BUILDS) and queue the rest;
 *      only mark the cluster's own source rows as addressed after a build
 *   D. Return { submitted, queued }
 *
 * Never throws — all errors are caught and logged. A failure here must not
 * affect the rest of the self-improvement cycle.
 */
export async function runCapabilityGapAnalysis(
  userId: string,
): Promise<{ submitted: number; queued: number; failed?: boolean }> {
  try {
    return await _runAnalysisInner(userId);
  } catch (err) {
    console.error(`[CapabilityGap] Analysis failed for user=${userId} (non-blocking):`, err);
    return { submitted: 0, queued: 0, failed: true };
  }
}

async function _runAnalysisInner(userId: string): Promise<{ submitted: number; queued: number; failed?: boolean }> {
  // ── Step A: Load this week's gaps ─────────────────────────────────────────
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const rawGaps: RawGapRow[] = await db
    .select({
      userMessage: schema.capabilityGaps.userMessage,
      agentReplySnippet: schema.capabilityGaps.agentReplySnippet,
      detectedReason: schema.capabilityGaps.detectedReason,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(schema.capabilityGaps)
    .where(
      and(
        eq(schema.capabilityGaps.userId, userId),
        gte(schema.capabilityGaps.createdAt, sevenDaysAgo),
        eq(schema.capabilityGaps.addressed, false),
      ),
    )
    .groupBy(
      schema.capabilityGaps.userMessage,
      schema.capabilityGaps.agentReplySnippet,
      schema.capabilityGaps.detectedReason,
    )
    .orderBy(sql`COUNT(*) DESC`)
    .limit(20);

  if (rawGaps.length === 0) {
    console.log(`[CapabilityGap] No unaddressed gaps for user=${userId} this week — skipping`);
    return { submitted: 0, queued: 0 };
  }

  console.log(`[CapabilityGap] Loaded ${rawGaps.length} distinct gap pattern(s) for user=${userId}`);

  // ── Step B: LLM clustering + build decision ────────────────────────────────
  // Number the gaps so the LLM can attribute them to clusters via memberIndices.
  const gapSummary = rawGaps
    .map((g, i) => {
      const isJobGap = g.detectedReason === 'job_failure';
      const prefix = isJobGap
        ? `[${i}] [job_failure] (×${g.count}) Background job: "${g.userMessage.slice(0, 200)}"`
        : `[${i}] [${g.detectedReason}] (×${g.count}) User said: "${g.userMessage.slice(0, 200)}"`;
      const suffix = g.agentReplySnippet
        ? (isJobGap
            ? `\n   Error: "${g.agentReplySnippet.slice(0, 150)}"`
            : `\n   Jarvis said: "${g.agentReplySnippet.slice(0, 150)}"`)
        : '';
      return prefix + suffix;
    })
    .join('\n\n');

  let clustering: ClusteringResult;

  try {
    const response = await anthropic.messages.create({
      model: ANALYZER_LLM_MODEL,
      max_tokens: 2048,
      system: `You are Jarvis's capability expansion engine. You receive a numbered list of capability gaps from this week. Gaps may come from two sources:
- Chat interactions where Jarvis deflected or apologised (labelled deflection, apology_only, no_tool_for_request)
- Background job failures where a scheduled or queued job crashed with a logic/format error (labelled job_failure)

Note: job_failure gaps have already been filtered — transient auth, network, and rate-limit errors are excluded. These represent genuine missing capabilities (e.g. an ICS parsing failure, an API response format change, a missing tool for a job type).

Your job is to:
1. Cluster them into distinct capability gaps (merge duplicates and near-duplicates, merge chat and job gaps on the same theme). Cap at ${MAX_GAP_CLUSTERS} clusters.
2. For each cluster, report which numbered gaps (0-based indices) belong to it in memberIndices.
3. For each cluster, decide: is this buildable as a new Jarvis tool or fix?
   BUILDABLE: new API integrations with simple REST calls, data lookups, formatting helpers, notification types, content fetchers, parsing fixes
   NOT BUILDABLE: things requiring hardware, private credentials Jarvis doesn't have, UI changes, database schema changes, core infrastructure changes
4. Estimate risk:
   - low: new isolated tool with no dependencies on existing tool files
   - medium: touches existing tool files or agent logic
   - high: touches routing, channels, job queue, scheduler, schema

Output ONLY valid JSON matching this schema exactly:
{
  "clusters": [
    {
      "theme": "short description of the gap",
      "frequency": 3,
      "memberIndices": [0, 2, 5],
      "buildable": true,
      "riskLevel": "low",
      "toolProposal": {
        "name": "snake_case_tool_name",
        "description": "What this tool does",
        "implementation": "Plain-language spec of what it should do and what API it should call"
      }
    }
  ]
}

memberIndices are required for every cluster. toolProposal is only required when buildable is true. riskLevel must be "low", "medium", or "high".`,
      messages: [
        {
          role: 'user',
          content: `Here are the numbered capability gaps Jarvis encountered this week:\n\n${gapSummary}\n\nCluster and decide. Output JSON only.`,
        },
      ],
    });

    const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON object in LLM response');
    clustering = JSON.parse(jsonMatch[0]) as ClusteringResult;
    if (!Array.isArray(clustering.clusters)) clustering.clusters = [];
  } catch (err) {
    console.error(`[CapabilityGap] LLM clustering failed for user=${userId}:`, err);
    return { submitted: 0, queued: 0, failed: true };
  }

  const clusters = clustering.clusters.slice(0, MAX_GAP_CLUSTERS);
  console.log(`[CapabilityGap] Clustered into ${clusters.length} gap(s) for user=${userId}`);

  // ── Step C: Act on clusters ────────────────────────────────────────────────
  // `submitted` = build_feature jobs enqueued (gaps NOT yet marked addressed —
  // that happens in the job completion handler only on actual build success).
  // `queued`    = inbox items created for user review.
  let submitted = 0;
  let queued = 0;

  for (const cluster of clusters) {
    if (!cluster.buildable) {
      console.log(`[CapabilityGap] Skipping non-buildable gap: "${cluster.theme}"`);
      continue;
    }

    if (cluster.riskLevel === 'low' && submitted < MAX_AUTO_BUILDS) {
      // Auto-build: submit a build_feature job to the job queue.
      // Using the job queue (rather than calling buildFeatureTool inline) ensures
      // that the build job's process restart happens AFTER the self-improvement
      // cycle completes — never mid-cycle — so the Telegram summary is not lost.
      const proposal = cluster.toolProposal;
      if (!proposal?.name || !proposal?.description) {
        console.warn(`[CapabilityGap] Low-risk cluster "${cluster.theme}" missing toolProposal — queueing instead`);
        await createGapInboxItem(userId, cluster);
        queued++;
        continue;
      }

      // Compute (userMessage, detectedReason) pairs for the source gap rows so
      // the job completion handler can mark them addressed on build success.
      const memberIndices: number[] = Array.isArray(cluster.memberIndices)
        ? cluster.memberIndices.filter((i) => typeof i === 'number' && i >= 0 && i < rawGaps.length)
        : [];
      const capabilityGapEntries = memberIndices.map((i) => ({
        userMessage: rawGaps[i].userMessage,
        detectedReason: rawGaps[i].detectedReason,
      }));

      const featureDescription = [
        `Tool name: ${proposal.name}`,
        `Description: ${proposal.description}`,
        proposal.implementation ? `Implementation spec: ${proposal.implementation}` : '',
        `(Auto-requested by capability gap analysis — cluster theme: "${cluster.theme}")`,
      ].filter(Boolean).join('\n');

      try {
        const jobResult = await submitAgentJob({
          userId,
          agentType: 'build_feature',
          title: `Auto-build: ${proposal.name}`,
          prompt: featureDescription,
          input: {
            feature_description: featureDescription,
            // Stored so the completion handler can mark these gaps addressed on success.
            capabilityGapEntries,
          },
        });

        if (jobResult.isDuplicate) {
          console.log(`[CapabilityGap] build_feature job already queued for "${proposal.name}" (duplicate) — counted as submitted`);
        } else {
          console.log(`[CapabilityGap] Submitted build_feature job ${jobResult.id} for "${proposal.name}" user=${userId}`);
        }

        submitted++;
        // Note: gaps are NOT marked addressed here. The job queue completion
        // handler calls markCapabilityGapEntriesAddressed() only when allPassed=true.
      } catch (err) {
        console.error(`[CapabilityGap] submitAgentJob failed for "${proposal.name}":`, err);
        await createGapInboxItem(userId, cluster);
        queued++;
      }
    } else {
      // medium/high risk — or auto-build cap reached — queue for user review
      if (submitted >= MAX_AUTO_BUILDS && cluster.riskLevel === 'low') {
        console.log(`[CapabilityGap] Auto-build cap reached — queueing low-risk gap: "${cluster.theme}"`);
      }
      await createGapInboxItem(userId, cluster);
      queued++;
    }
  }

  console.log(`[CapabilityGap] Analysis done for user=${userId} — submitted=${submitted} queued=${queued}`);
  return { submitted, queued };
}
