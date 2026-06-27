/**
 * selfImprovementLoop.ts — Weekly autonomous self-improvement cycle.
 *
 * Triggered every Sunday at 02:00 AM server-local time by scheduler.ts
 * (which uses a lastSelfImprovementRunKey guard identical to lastWeeklyRunKey).
 * Inside, each user is additionally filtered by their local timezone so the
 * cycle only fires when their local clock reads Sunday 02:xx.
 *
 * Steps:
 *   1. Atomic claim — INSERT INTO proactive_schedule_log ON CONFLICT DO NOTHING
 *                     at the very start; if conflict, skip immediately (idempotency)
 *   2. Evidence     — audit entries, quality-flagged interactions, server errors
 *   3. Assess       — Codex OAuth structured JSON: cycleAssessment + improvements
 *   4. Act          — auto-apply low-risk (allowlist + blocklist); queue medium/high
 *   5. Notify       — one Telegram summary if Telegram is active for the user
 *   6. Done         — log result (claim already logged in Step 1)
 *
 * Safety constraints (all enforced in code):
 *   1. Atomic weekly rate limit — claimAndMark at step 1 (INSERT ON CONFLICT DO NOTHING)
 *   2. Per-cycle candidate cap  — max 5 improvements (sorted lowest-risk first)
 *   3. Per-cycle auto-apply cap — max 3; remainder converted to inbox items
 *   4. Auto-apply allowlist     — precise scope in isAllowedForAutoApply()
 *   5. Blocklist override       — SELF_IMPROVE_BLOCKED_FILES always beats the allowlist
 *   6. 10-minute hard timeout   — AbortController propagated through every step
 *   7. Owner gate               — only integration-owner users run the cycle
 */

import { db } from '../db';
import { eq, and, gte, desc } from 'drizzle-orm';
import * as schema from '@shared/schema';
import { readAuditEntries } from './selfHealAudit';
import { getRecentInteractions } from '../interactionLog';
import { checkResponseQuality } from './responseQuality';
import { getChannel } from '../channels/registry';
import { isIntegrationOwner } from '../integrationOwner';
import { claimAndMark } from '../lib/proactiveDedup';
import { runCapabilityGapAnalysis } from './capabilityGapAnalyzer';
import { routeModelTurn } from './modelRouter';
import fs from 'fs/promises';
import path from 'path';

// ── Constants ─────────────────────────────────────────────────────────────────

const CYCLE_TIMEOUT_MS = 10 * 60 * 1000; // 10-minute hard deadline
const LLM_CALL_TIMEOUT_MS = 8 * 60 * 1000; // LLM call must not exceed 8 min of the 10
const MAX_IMPROVEMENTS = 5;
const MAX_AUTO_APPLY = 3;

/**
 * STRICT ALLOWLIST — low-risk improvements may only be auto-applied to files
 * that match one of these precise scopes. Checked in isAllowedForAutoApply()
 * AFTER path traversal normalization and AFTER the blocklist. This list is
 * intentionally narrow to limit blast radius of autonomous edits.
 *
 *   agents/PRIME.md            — exact file (behavioral rules)
 *   agents/crew/*.md           — .md files directly in crew/ (no subdirs)
 *   agents/crew/tools.json     — exact file (tool manifest)
 *   server/agent/tools/*.ts/js — direct files only (no sub-directories)
 *
 * The LLM system prompt echoes the same scope so proposals are already biased
 * to these targets. Anything outside this list is promoted to an inbox item
 * regardless of the LLM-assigned riskLevel.
 */

/**
 * BLOCKLIST — files that can NEVER be auto-applied even if they pass the allowlist.
 * Protects core infrastructure from autonomous modification.
 */
export const SELF_IMPROVE_BLOCKED_FILES: string[] = [
  'server/jobQueue.ts',
  'server/scheduler.ts',
  'server/routes.ts',
  'shared/schema.ts',
  'server/harness.ts',
  'server/db.ts',
  'server/channels/',
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface Improvement {
  title: string;
  rationale: string;
  riskLevel: 'low' | 'medium' | 'high';
  targetFiles: string[];
  proposedChange: string;
}

interface AssessmentResult {
  cycleAssessment: string;
  improvements: Improvement[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns the ISO week key, e.g. "2025-W22", used for dedup. */
function getISOWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * Returns the local day-of-week (0=Sun) and hour for the given IANA timezone.
 * Falls back to UTC on any error.
 */
function localDowAndHour(now: Date, tz: string): { dow: number; hour: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      hour: 'numeric',
      hour12: false,
    }).formatToParts(now);

    const weekdayPart = parts.find((p) => p.type === 'weekday')?.value ?? '';
    const hourPart = parts.find((p) => p.type === 'hour')?.value ?? '';

    const WEEKDAY_MAP: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    const dow = WEEKDAY_MAP[weekdayPart] ?? now.getUTCDay();
    const hour = parseInt(hourPart, 10);
    return { dow, hour: isNaN(hour) ? now.getUTCHours() : hour };
  } catch {
    return { dow: now.getUTCDay(), hour: now.getUTCHours() };
  }
}

/**
 * Returns true if the file path is eligible for auto-apply.
 *
 * Path is canonicalized via path.posix.normalize BEFORE any comparison so that
 * traversal sequences (e.g. agents/crew/../../server/jobQueue.ts) collapse to
 * their real destination before blocklist/allowlist checks run.
 *
 * Decision order:
 *   1. Reject absolute paths and paths that still start with '../' after normalization.
 *   2. Reject if path matches any SELF_IMPROVE_BLOCKED_FILES entry (blocklist wins).
 *   3. Allow only the precise scopes listed below (narrow allowlist):
 *       a. agents/PRIME.md                — exact file
 *       b. agents/crew/<name>.md          — .md files directly in crew/ only (no subdirs)
 *       c. agents/crew/tools.json         — exact file
 *       d. server/agent/tools/<name>.*    — direct child files of that directory only
 */
function isAllowedForAutoApply(filePath: string): boolean {
  // Step 1: Canonicalize to collapse any traversal segments
  const n = path.posix.normalize(filePath.replace(/\\/g, '/'));

  // Reject absolute paths and post-normalization traversal escapes
  if (path.posix.isAbsolute(n) || n.startsWith('../')) return false;

  // Step 2: Blocklist overrides everything
  const inBlocklist = SELF_IMPROVE_BLOCKED_FILES.some((blocked) => {
    const dir = blocked.endsWith('/') ? blocked : blocked + '/';
    return n === blocked || n.startsWith(dir);
  });
  if (inBlocklist) return false;

  // Step 3: Narrow allowlist — precise file-type scoping after normalization

  // a. Exact: agents/PRIME.md
  if (n === 'agents/PRIME.md') return true;

  // b. .md files DIRECTLY inside agents/crew/ (no sub-directories)
  if (n.startsWith('agents/crew/') && n.endsWith('.md')) {
    const rel = n.slice('agents/crew/'.length);
    if (!rel.includes('/')) return true; // only direct children, not nested
  }

  // c. Exact: agents/crew/tools.json
  if (n === 'agents/crew/tools.json') return true;

  // d. Direct children of server/agent/tools/ (no further subdirectory nesting)
  if (n.startsWith('server/agent/tools/')) {
    const rel = n.slice('server/agent/tools/'.length);
    if (rel.length > 0 && !rel.includes('/')) return true;
  }

  return false;
}

/** Create a deliverable inbox item for medium/high-risk (or rejected low-risk) improvements. */
async function createInboxItem(userId: string, improvement: Improvement): Promise<void> {
  try {
    const body = [
      '## Rationale',
      improvement.rationale,
      '',
      '## Proposed Change',
      improvement.proposedChange,
      '',
      `**Target files:** ${(improvement.targetFiles || []).join(', ') || 'N/A'}`,
      `**Risk level:** ${improvement.riskLevel}`,
    ].join('\n');

    await db.insert(schema.deliverables).values({
      userId,
      agentType: 'planning',
      type: 'plan',
      title: `Self-improvement proposal: ${improvement.title}`,
      body,
      summary: improvement.rationale.slice(0, 200),
      meta: {
        source: 'self_improvement_cycle',
        riskLevel: improvement.riskLevel,
        targetFiles: improvement.targetFiles,
      },
    });
  } catch (err) {
    console.error(`[SelfImprovement] Failed to create inbox item for "${improvement.title}":`, err);
  }
}

// ── Main cycle ────────────────────────────────────────────────────────────────

/**
 * Run one self-improvement cycle for a single user.
 * Returns { applied, queued }. Never throws.
 *
 * Timeout strategy (two-layer):
 *   1. Promise.race with a hard 10-minute deadline timer — guarantees this
 *      function returns within the budget even if a substep (selfHealTool,
 *      DB call, etc.) hangs and never resolves.
 *   2. AbortController — when the deadline fires we call controller.abort()
 *      so _runCycleInner stops making additional DB writes / code changes at
 *      the next signal.aborted check (graceful cleanup layer on top of race).
 */
export async function runSelfImprovementCycle(
  userId: string,
): Promise<{ applied: number; queued: number }> {
  const controller = new AbortController();

  const timeoutPromise = new Promise<{ applied: number; queued: number }>((resolve) => {
    setTimeout(() => {
      console.warn(`[SelfImprovement] Hard 10-minute timeout hit for user=${userId} — aborting`);
      controller.abort(); // signal inner cycle to stop at next step check
      resolve({ applied: 0, queued: 0 });
    }, CYCLE_TIMEOUT_MS);
  });

  // Promise.race makes the hard cutoff real: even if _runCycleInner is stuck
  // inside selfHealTool.execute or another awaited operation, this outer
  // function resolves at the 10-minute mark. AbortController propagates the
  // stop signal for any subsequent async operations that respect it.
  return Promise.race([_runCycleInner(userId, controller.signal), timeoutPromise]);
}

async function _runCycleInner(
  userId: string,
  signal: AbortSignal,
): Promise<{ applied: number; queued: number }> {
  const isoWeek = getISOWeekKey(new Date());
  const messageType = 'self_improvement_cycle';

  // ── Step 1: Atomic claim (idempotency) ────────────────────────────────────
  // INSERT INTO proactive_schedule_log ON CONFLICT DO NOTHING.
  // If the row already exists (concurrent tick or server restart), skip immediately.
  // This is the single source-of-truth guard — no separate read-then-write needed.
  const claimed = await claimAndMark(userId, messageType, isoWeek);
  if (!claimed) {
    console.log(`[SelfImprovement] Cycle already claimed for user=${userId} week=${isoWeek} — skipping`);
    return { applied: 0, queued: 0 };
  }

  if (signal.aborted) return { applied: 0, queued: 0 };
  console.log(`[SelfImprovement] Cycle starting for user=${userId} week=${isoWeek}`);

  // ── Step 2: Collect evidence (parallel) ───────────────────────────────────
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [auditEntries, rawInteractions, recentErrors] = await Promise.all([
    readAuditEntries(50).catch(() => []),
    getRecentInteractions(userId, 100, 7 * 24).catch(() => []),
    db
      .select()
      .from(schema.systemErrorLog)
      .where(gte(schema.systemErrorLog.createdAt, sevenDaysAgo))
      .orderBy(desc(schema.systemErrorLog.createdAt))
      .limit(30)
      .catch(() => []),
  ]);

  // Filter interactions to those where checkResponseQuality would flag the response.
  // Pair consecutive inbound→outbound exchanges within a 5-minute window.
  const flaggedInteractions: string[] = [];
  const sortedInteractions = [...rawInteractions].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  for (let i = 0; i < sortedInteractions.length - 1; i++) {
    const inbound = sortedInteractions[i];
    const outbound = sortedInteractions[i + 1];
    if (inbound.direction !== 'inbound' || outbound.direction !== 'outbound') continue;
    const gapMs = new Date(outbound.createdAt).getTime() - new Date(inbound.createdAt).getTime();
    if (gapMs > 5 * 60 * 1000) continue;

    const quality = checkResponseQuality({
      userMessage: inbound.content,
      agentReply: outbound.content,
      toolsUsed: [],
    });
    if (quality.action === 'revise') {
      flaggedInteractions.push(
        `[${inbound.createdAt.toISOString()}] USER: ${inbound.content.slice(0, 150)} → ` +
        `JARVIS: ${outbound.content.slice(0, 150)} — FLAGGED: ${quality.reason}`,
      );
    }
  }

  // Build compact evidence strings (cap at ~6000 chars ≈ 1500 tokens total)
  const auditSummary =
    auditEntries.slice(0, 10).map((e) =>
      `[${e.timestamp}] ${e.file}: ${e.reason} (verified: ${e.verified})`,
    ).join('\n') || 'No audit entries.';

  const qualitySummary = flaggedInteractions.length > 0
    ? flaggedInteractions.slice(0, 10).join('\n')
    : 'No quality-flagged interactions this week.';

  const errorSummary =
    recentErrors.slice(0, 15).map((e) =>
      `[${e.createdAt.toISOString()}] ${e.source} (${e.level}): ${e.message.slice(0, 200)}`,
    ).join('\n') || 'No recent errors.';

  const evidenceSummary = [
    '## Recent Audit Entries (last 10)',
    auditSummary,
    '',
    '## Quality-Flagged Interactions (last 7 days)',
    qualitySummary,
    '',
    '## Recent Server Errors (last 7 days)',
    errorSummary,
  ].join('\n').slice(0, 6000);

  // Read full PRIME.md so the Codex OAuth assessment has complete policy context.
  let primeContent = '';
  try {
    primeContent = await fs.readFile(path.join(process.cwd(), 'agents/PRIME.md'), 'utf-8');
  } catch {
    primeContent = '(PRIME.md not found)';
  }

  // Format the last 10 audit entries with diffs for the LLM
  const last10AuditText =
    auditEntries.slice(0, 10).map((e) =>
      `File: ${e.file}\nReason: ${e.reason}\nVerified: ${e.verified}\nDiff:\n${e.diff.slice(0, 300)}`,
    ).join('\n---\n') || '(none)';

  if (signal.aborted) return { applied: 0, queued: 0 };

  // ── Step 3: LLM assessment call ───────────────────────────────────────────
  let assessment: AssessmentResult;

  try {
    // Race the LLM call against a hard deadline so one stalled request can't
    // block the cycle beyond the 10-minute budget (leaves 2-min slack for steps 4-5).
    const llmDeadline = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('[SelfImprovement] LLM call timed out after 8 minutes')),
        LLM_CALL_TIMEOUT_MS,
      ),
    );
    const response = await Promise.race([
      routeModelTurn({
        tier: 'smart',
        maxCompletionTokens: 2048,
        stream: false,
        toolChoice: 'none',
        userId,
        signal,
        disableRuntimeStateCard: true,
        logPrefix: '[SelfImprovement]',
        messages: [
          {
            role: 'system',
            content: `You are Jarvis's self-assessment engine. Identify concrete, specific improvements Jarvis should make to its own code or behavioral rules. Do not invent problems that aren't evidenced. Do not propose changes to core infrastructure (job queue, scheduler, database schema).

Respond with ONLY valid JSON matching this schema:
{
  "cycleAssessment": "1-2 sentence summary of the week's patterns",
  "improvements": [
    {
      "title": "short label",
      "rationale": "what evidence supports this",
      "riskLevel": "low | medium | high",
      "targetFiles": ["relative/path/to/file.ts"],
      "proposedChange": "plain-language description of the change"
    }
  ]
}

Risk level rules:
- "low": ONLY for changes to agents/PRIME.md, agents/crew/*.md, agents/crew/tools.json, or individual files under server/agent/tools/. Safe to auto-apply.
- "medium": Structural agent logic, prompt changes affecting multiple flows. Requires user review.
- "high": Auth, routing, DB, multi-system integrations. Always requires user review.

Cap at ${MAX_IMPROVEMENTS} improvements. Output JSON only — no markdown wrapper, no explanation.`,
          },
          {
            role: 'user',
            content: `## PRIME.md (Jarvis behavioral rules)\n${primeContent}\n\n## Last 10 Audit Entries\n${last10AuditText}\n\n## Evidence Summary\n${evidenceSummary}\n\nAssess and output JSON.`,
          },
        ],
      }),
      llmDeadline,
    ]);

    const raw = (response.textContent ?? '').trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON object in LLM response');
    assessment = JSON.parse(jsonMatch[0]) as AssessmentResult;

    if (!assessment.cycleAssessment) assessment.cycleAssessment = 'No significant patterns this week.';
    if (!Array.isArray(assessment.improvements)) assessment.improvements = [];
  } catch (err) {
    console.error(`[SelfImprovement] LLM assessment failed for user=${userId}:`, err);
    // Cycle was already claimed at Step 1 — no re-run this week
    return { applied: 0, queued: 0 };
  }

  if (signal.aborted) return { applied: 0, queued: 0 };

  // Sort by riskLevel ascending (lowest risk first), cap at MAX_IMPROVEMENTS
  const riskOrder: Record<string, number> = { low: 0, medium: 1, high: 2 };
  const improvements = assessment.improvements
    .filter((i) => i && i.title && i.riskLevel)
    .sort((a, b) => (riskOrder[a.riskLevel] ?? 1) - (riskOrder[b.riskLevel] ?? 1))
    .slice(0, MAX_IMPROVEMENTS);

  let applied = 0;
  let queued = 0;

  // ── Step 4: Act on improvements ───────────────────────────────────────────
  for (const improvement of improvements) {
    if (signal.aborted) break; // stop applying further changes if timeout fired

    if (improvement.riskLevel === 'low') {
      // Enforce per-cycle auto-apply cap
      if (applied >= MAX_AUTO_APPLY) {
        await createInboxItem(userId, improvement);
        queued++;
        continue;
      }

      // Enforce allowlist + blocklist: EVERY target file must pass isAllowedForAutoApply
      const targetFiles = improvement.targetFiles || [];
      const allAllowed = targetFiles.length > 0 && targetFiles.every(isAllowedForAutoApply);

      if (!allAllowed) {
        console.log(
          `[SelfImprovement] Queueing "${improvement.title}" — target file(s) not in auto-apply allowlist`,
        );
        await createInboxItem(userId, improvement);
        queued++;
        continue;
      }

      // Auto-apply via selfHealTool
      try {
        const { selfHealTool } = await import('./tools/selfHealTool');
        const result = await selfHealTool.execute(
          {
            description: [
              `[Self-Improvement Cycle] ${improvement.title}`,
              '',
              improvement.proposedChange,
              '',
              `Rationale: ${improvement.rationale}`,
            ].join('\n'),
            affected_paths: targetFiles.length > 0 ? targetFiles : undefined,
            max_iterations: 2,
          },
          {
            userId,
            state: {},
          },
        );

        if (result.ok) {
          applied++;
          console.log(`[SelfImprovement] Applied: "${improvement.title}" for user=${userId}`);
        } else {
          console.warn(
            `[SelfImprovement] selfHealTool declined "${improvement.title}": ${result.content}`,
          );
          await createInboxItem(userId, improvement);
          queued++;
        }
      } catch (err) {
        console.error(`[SelfImprovement] Auto-apply error for "${improvement.title}":`, err);
        await createInboxItem(userId, improvement);
        queued++;
      }
    } else {
      // medium or high — always queue for user review
      await createInboxItem(userId, improvement);
      queued++;
    }
  }

  if (signal.aborted) return { applied, queued };

  // ── Step 4b: Capability gap analysis ──────────────────────────────────────
  // Clusters recurring deflection/apology gaps from the week and auto-builds
  // low-risk tools or queues higher-risk proposals as inbox items.
  // Failure is fully isolated — never affects the rest of the cycle.
  let gapBuilt = 0;
  let gapQueued = 0;
  try {
    const gapResult = await runCapabilityGapAnalysis(userId);
    gapBuilt = gapResult.submitted;
    gapQueued = gapResult.queued;
  } catch (err) {
    // runCapabilityGapAnalysis already catches internally, but guard here too
    console.error(`[SelfImprovement] Gap analysis step threw unexpectedly for user=${userId}:`, err);
  }

  // ── Step 5: Notify via Telegram — strict Telegram-only delivery ──────────
  // Origin channel = the channel of the user's most recent inbound interaction
  // (7-day window). Only sends if Telegram was the exact origin; no fallback to
  // other channels. Uses getChannel('telegram').sendMessage directly so the
  // message is guaranteed to be delivered via Telegram and not fanned out to
  // other channels via notifyUser preference routing.
  try {
    const mostRecentInbound = sortedInteractions
      .filter((i) => i.direction === 'inbound')
      .slice(-1)[0];
    const originChannel = mostRecentInbound?.channel ?? null;

    if (originChannel === 'telegram') {
      const telegramCh = getChannel('telegram');
      if (telegramCh) {
        const msg = [
          'Self-improvement cycle complete.',
          `Behavior fixes applied: ${applied} | queued: ${queued}`,
          `New capabilities submitted for build: ${gapBuilt} | in review: ${gapQueued}`,
          assessment.cycleAssessment,
        ].join('\n');
        await telegramCh.sendMessage(userId, msg, {}).catch((err: unknown) => {
          console.error(`[SelfImprovement] Telegram send failed for user=${userId}:`, err);
        });
      }
    }
  } catch (err) {
    console.error(`[SelfImprovement] Notify step failed for user=${userId}:`, err);
  }

  console.log(
    `[SelfImprovement] Cycle complete for user=${userId} week=${isoWeek} — applied=${applied} queued=${queued} gapSubmitted=${gapBuilt} gapInReview=${gapQueued}`,
  );
  return { applied, queued };
}

// ── Scheduler entry point ─────────────────────────────────────────────────────

/**
 * Called by scheduler.ts at server-local Sunday 02:00 (once per week via
 * lastSelfImprovementRunKey guard). Iterates all users, filters to those:
 *   1. With selfEditCapability enabled (write-access gate via integration owner record)
 *   2. Whose local timezone reads Sunday 02:xx
 * Per-user errors are isolated — one failure cannot affect others.
 */
export async function runSelfImprovementForAllUsers(now: Date): Promise<void> {
  let allUsers: { id: string }[];
  let allPrefs: { userId: string; data: unknown }[];

  try {
    [allUsers, allPrefs] = await Promise.all([
      db.select({ id: schema.users.id }).from(schema.users),
      db
        .select({ userId: schema.userPreferences.userId, data: schema.userPreferences.data })
        .from(schema.userPreferences),
    ]);
  } catch (err) {
    console.error('[SelfImprovement] Failed to fetch users/prefs for batch run:', err);
    return;
  }

  const prefsMap = new Map<string, Record<string, unknown>>();
  for (const p of allPrefs) {
    prefsMap.set(p.userId, (p.data as Record<string, unknown>) || {});
  }

  for (const user of allUsers) {
    try {
      // Gate 1: selfEditCapability gate — only run for users authorised to apply
      // code changes. This deployment is single-owner/single-user (Jarvis is a
      // personal AI assistant), so the integration-owner record — auto-seeded to
      // the first registered user — is the correct write-authorisation guard.
      // If multi-user self-edit is added in the future, replace this check with
      // a per-user capability flag (e.g. a 'selfEdit' field in user preferences)
      // so non-owner users can be selectively enrolled.
      const hasSelfEditCapability = await isIntegrationOwner(user.id);
      if (!hasSelfEditCapability) continue;

      // Gate 2: per-user timezone check — only fire when local time is Sunday 02:xx
      const prefs = prefsMap.get(user.id) || {};
      const tz = typeof prefs.timezone === 'string' ? prefs.timezone : 'UTC';
      const { dow, hour } = localDowAndHour(now, tz);
      if (dow !== 0 || hour !== 2) continue;

      console.log(`[SelfImprovement] Firing cycle for user=${user.id} (tz=${tz})`);

      // Fire and forget — claimAndMark inside runSelfImprovementCycle ensures atomicity
      runSelfImprovementCycle(user.id).then(({ applied, queued }) => {
        console.log(
          `[Scheduler] self-improvement cycle — userId=${user.id} improvements=${applied} queued=${queued}`,
        );
      }).catch((err) => {
        console.error(`[Scheduler] self-improvement cycle failed for userId=${user.id}:`, err);
      });
    } catch (err) {
      console.error(`[SelfImprovement] Per-user check error for userId=${user.id}:`, err);
    }
  }
}
