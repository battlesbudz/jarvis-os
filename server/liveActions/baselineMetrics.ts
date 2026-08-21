import { createHmac, randomBytes } from "node:crypto";
import { getLiveActionFeatureFlags, type LiveActionFeatureFlags } from "./rollout";

export const LIVE_ACTION_BASELINE_METRICS = [
  "status_check_follow_up",
  "status_check_exposure_count",
  "reconnect_restoration_ms",
  "duplicate_representation_count",
  "rendered_representation_count",
  "terminal_state_drift_count",
  "terminal_representation_count",
  "acknowledgement_visible_latency_ms",
  "baseline_value_overflow_count",
] as const;

export type LiveActionBaselineMetric = typeof LIVE_ACTION_BASELINE_METRICS[number];

const METRIC_SET = new Set<string>(LIVE_ACTION_BASELINE_METRICS);
const CLIENT_SUBMITTED_METRIC_SET = new Set<string>([
  "reconnect_restoration_ms",
  "acknowledgement_visible_latency_ms",
]);
const ALLOWED_SURFACES = new Set([
  "chat",
  "voice",
  "projects",
  "inbox",
  "mission_control",
  "telegram",
  "discord",
  "slack",
  "whatsapp",
  "webchat",
  "gateway",
  "unknown",
]);
const MAX_USERS = 500;
const MAX_REPRESENTATION_SNAPSHOTS_PER_USER = 20;
const MAX_STATUS_OBSERVATION_IDS = 10_000;
const REPRESENTATION_TTL_MS = 5 * 60 * 1_000;
const representationFingerprintKey = randomBytes(32);
const LATENCY_BUCKETS_MS = [100, 250, 500, 1_000, 1_500, 2_000, 3_000, 5_000, 10_000, 30_000, 60_000, 300_000, 3_600_000, 86_400_000, 31_536_000_000] as const;
const TERMINAL_RECONCILIATION_WINDOW_MS = 5 * 60 * 1_000;
const MAX_MISMATCH_HEARTBEAT_GAP_MS = 90 * 1_000;
const STATUS_OBSERVATION_TTL_MS = 10 * 60 * 1_000;

interface MetricAggregate {
  count: number;
  sum: number;
  max: number;
  latestAt: string;
  histogram?: number[];
}

interface UserBaseline {
  lastTouchedAt: number;
  metrics: Map<string, MetricAggregate>;
  deploymentMetrics: Map<string, MetricAggregate>;
}

export interface LiveActionBaselineReport {
  generatedAt: string;
  flags: LiveActionFeatureFlags;
  metrics: Record<string, {
    count: number;
    sum: number;
    average: number;
    max: number;
    latestAt: string;
    p50?: number;
    p95?: number;
    histogram?: Array<{ upperBoundMs: number; count: number }>;
  }>;
  privacy: {
    contentStored: false;
    identifiersStoredInMetrics: false;
    allowedDimensions: readonly ["metric", "surface"];
  };
}

const baselines = new Map<string, UserBaseline>();
const representationSnapshots = new Map<string, Map<string, {
  observedAt: number;
  sequence: number;
  counts: Map<string, number>;
}>>();
const terminalMismatchFirstSeen = new Map<string, Map<string, { firstSeenAt: number; lastSeenAt: number }>>();
const statusObservationIds = new Map<string, number>();

function deleteTerminalMismatchesWithPrefix(userId: string, prefix: string): void {
  const mismatches = terminalMismatchFirstSeen.get(userId);
  if (!mismatches) return;
  for (const key of mismatches.keys()) {
    if (key.startsWith(prefix)) mismatches.delete(key);
  }
  if (mismatches.size === 0) terminalMismatchFirstSeen.delete(userId);
}

function pruneRepresentationState(nowMs = Date.now()): void {
  for (const [userId, snapshots] of representationSnapshots) {
    for (const [key, snapshot] of snapshots) {
      if (nowMs - snapshot.observedAt <= REPRESENTATION_TTL_MS) continue;
      snapshots.delete(key);
      deleteTerminalMismatchesWithPrefix(userId, `${key}:`);
    }
    if (snapshots.size === 0) representationSnapshots.delete(userId);
  }
  for (const [userId, mismatches] of terminalMismatchFirstSeen) {
    for (const [key, mismatch] of mismatches) {
      if (nowMs - mismatch.lastSeenAt > MAX_MISMATCH_HEARTBEAT_GAP_MS) mismatches.delete(key);
    }
    if (mismatches.size === 0) terminalMismatchFirstSeen.delete(userId);
  }
}

function pruneStatusObservationIds(nowMs = Date.now()): void {
  for (const [key, observedAt] of statusObservationIds) {
    if (nowMs - observedAt > STATUS_OBSERVATION_TTL_MS) statusObservationIds.delete(key);
  }
}

function pruneBaselineState(): void {
  const nowMs = Date.now();
  pruneRepresentationState(nowMs);
  pruneStatusObservationIds(nowMs);
}

const baselinePruneTimer = setInterval(pruneBaselineState, MAX_MISMATCH_HEARTBEAT_GAP_MS);
baselinePruneTimer.unref?.();

function fingerprintRepresentation(userId: string, kind: "agent_job" | "project", identity: string): string {
  return createHmac("sha256", representationFingerprintKey)
    .update(userId)
    .update("\0")
    .update(kind)
    .update("\0")
    .update(identity)
    .digest("base64url");
}

function sanitizeSurface(surface: string | undefined): string {
  const normalized = surface?.trim().toLowerCase();
  if (normalized === "appchat") return "chat";
  return normalized && ALLOWED_SURFACES.has(normalized) ? normalized : "unknown";
}

function pruneUsers(): void {
  if (baselines.size < MAX_USERS) return;
  const oldest = [...baselines.entries()].sort((a, b) => a[1].lastTouchedAt - b[1].lastTouchedAt)[0]?.[0];
  if (oldest) {
    baselines.delete(oldest);
    representationSnapshots.delete(oldest);
    terminalMismatchFirstSeen.delete(oldest);
  }
}

function addMetricObservation(
  metrics: Map<string, MetricAggregate>,
  key: string,
  metric: LiveActionBaselineMetric,
  value: number,
  now: Date,
): void {
  const current = metrics.get(key);
  let histogram = current?.histogram;
  if (metric.endsWith("_ms")) {
    histogram = [...(histogram ?? LATENCY_BUCKETS_MS.map(() => 0))];
    const bucketIndex = LATENCY_BUCKETS_MS.findIndex((limit) => value <= limit);
    histogram[bucketIndex >= 0 ? bucketIndex : histogram.length - 1] += 1;
  }
  metrics.set(key, {
    count: (current?.count ?? 0) + 1,
    sum: (current?.sum ?? 0) + value,
    max: Math.max(current?.max ?? 0, value),
    latestAt: now.toISOString(),
    histogram,
  });
}

export function recordLiveActionBaseline(input: {
  userId: string;
  metric: LiveActionBaselineMetric;
  surface?: string;
  value?: number;
  now?: Date;
  includeInDeployment?: boolean;
}): void {
  if (!input.userId || !METRIC_SET.has(input.metric)) return;
  const value = Number.isFinite(input.value) ? Math.max(0, Number(input.value)) : 1;
  const now = input.now ?? new Date();
  const surface = sanitizeSurface(input.surface);
  const key = `${input.metric}:${surface}`;
  let baseline = baselines.get(input.userId);
  if (!baseline) {
    pruneUsers();
    baseline = { lastTouchedAt: now.getTime(), metrics: new Map(), deploymentMetrics: new Map() };
    baselines.set(input.userId, baseline);
  }
  baseline.lastTouchedAt = now.getTime();
  addMetricObservation(baseline.metrics, key, input.metric, value, now);
  if (input.includeInDeployment) {
    addMetricObservation(baseline.deploymentMetrics, key, input.metric, value, now);
  }
}

export function recordStatusCheckFollowUp(input: {
  userId: string;
  message: string;
  surface?: string;
  observationId?: string;
}): boolean {
  const isStatusCheck = /\b(?:what(?:'s| is) the status|status update)\b[^?\n]{0,60}\??\s*$/i.test(input.message)
    || /\b(?:is it|are you|is that|did it|did you|still)\b[\s\S]{0,60}\b(?:running|working|done|finished|complete|completed|status|stuck)\b/i.test(input.message);
  if (input.observationId) {
    const nowMs = Date.now();
    const observationKey = createHmac("sha256", representationFingerprintKey)
      .update(input.userId)
      .update("\0")
      .update(input.observationId)
      .digest("base64url");
    if (statusObservationIds.has(observationKey)) return isStatusCheck;
    // Bound memory; only events beyond this cap lose oldest-first retry deduplication.
    if (statusObservationIds.size >= MAX_STATUS_OBSERVATION_IDS) {
      const oldestKey = statusObservationIds.keys().next().value;
      if (oldestKey) statusObservationIds.delete(oldestKey);
    }
    statusObservationIds.set(observationKey, nowMs);
  }
  recordLiveActionBaseline({
    userId: input.userId,
    metric: "status_check_exposure_count",
    surface: input.surface,
    includeInDeployment: true,
  });
  if (isStatusCheck) {
    recordLiveActionBaseline({
      userId: input.userId,
      metric: "status_check_follow_up",
      surface: input.surface,
      includeInDeployment: true,
    });
  }
  return isStatusCheck;
}

export function recordRenderedRepresentationSnapshot(input: {
  userId: string;
  kind: "agent_job" | "project";
  surface: string;
  clientId: string;
  identities: string[];
  sequence: number;
  nowMs?: number;
}): { duplicateCount: number; representationCount: number } | null {
  const nowMs = input.nowMs ?? Date.now();
  const surface = sanitizeSurface(input.surface);
  pruneRepresentationState(nowMs);
  const userSnapshots = representationSnapshots.get(input.userId) ?? new Map();
  const clientFingerprint = fingerprintRepresentation(input.userId, input.kind, input.clientId);
  const snapshotKey = `${input.kind}:${surface}:${clientFingerprint}`;
  if ((userSnapshots.get(snapshotKey)?.sequence ?? -1) >= input.sequence) return null;
  if (!userSnapshots.has(snapshotKey) && userSnapshots.size >= MAX_REPRESENTATION_SNAPSHOTS_PER_USER) {
    let oldestKey: string | undefined;
    let oldestObservedAt = Number.POSITIVE_INFINITY;
    for (const [key, snapshot] of userSnapshots) {
      if (snapshot.observedAt >= oldestObservedAt) continue;
      oldestKey = key;
      oldestObservedAt = snapshot.observedAt;
    }
    if (oldestKey) {
      userSnapshots.delete(oldestKey);
      deleteTerminalMismatchesWithPrefix(input.userId, `${oldestKey}:`);
    }
  }
  const counts = new Map<string, number>();
  for (const identity of input.identities.slice(0, 100)) {
    if (!identity) continue;
    const fingerprint = fingerprintRepresentation(input.userId, input.kind, identity);
    counts.set(fingerprint, (counts.get(fingerprint) ?? 0) + 1);
  }
  userSnapshots.set(snapshotKey, { observedAt: nowMs, sequence: input.sequence, counts });
  representationSnapshots.set(input.userId, userSnapshots);

  let total = 0;
  const unique = new Set<string>();
  for (const [key, snapshot] of userSnapshots) {
    if (!key.startsWith(`${input.kind}:`) || nowMs - snapshot.observedAt > REPRESENTATION_TTL_MS) continue;
    for (const [fingerprint, count] of snapshot.counts) {
      total += count;
      unique.add(fingerprint);
    }
  }
  const duplicateCount = Math.max(0, total - unique.size);
  recordLiveActionBaseline({
    userId: input.userId,
    metric: "duplicate_representation_count",
    surface,
    value: duplicateCount,
  });
  recordLiveActionBaseline({
    userId: input.userId,
    metric: "rendered_representation_count",
    surface,
    value: total,
  });
  return { duplicateCount, representationCount: total };
}

function estimateHistogramPercentile(histogram: number[], percentile: number): number {
  const total = histogram.reduce((sum, count) => sum + count, 0);
  if (total === 0) return 0;
  const target = Math.ceil(total * percentile);
  let cumulative = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    cumulative += histogram[index];
    if (cumulative >= target) return LATENCY_BUCKETS_MS[index];
  }
  return LATENCY_BUCKETS_MS[LATENCY_BUCKETS_MS.length - 1];
}

export function observeTerminalStateDrift(input: {
  userId: string;
  kind: "agent_job" | "project";
  surface: string;
  clientId: string;
  entries: Array<{ id: string; status?: string }>;
  canonicalStatuses: ReadonlyMap<string, string>;
  terminalStatuses: ReadonlySet<string>;
  nowMs?: number;
}): { persistentDriftCount: number; pendingMismatchCount: number } {
  const nowMs = input.nowMs ?? Date.now();
  pruneRepresentationState(nowMs);
  const surface = sanitizeSurface(input.surface);
  const clientFingerprint = fingerprintRepresentation(input.userId, input.kind, input.clientId);
  const prefix = `${input.kind}:${surface}:${clientFingerprint}:`;
  const firstSeen = terminalMismatchFirstSeen.get(input.userId) ?? new Map<string, { firstSeenAt: number; lastSeenAt: number }>();
  const observedKeys = new Set<string>();
  let persistentDriftCount = 0;
  let pendingMismatchCount = 0;
  let terminalRepresentationCount = 0;

  for (const entry of input.entries) {
    const key = `${prefix}${fingerprintRepresentation(input.userId, input.kind, entry.id)}`;
    observedKeys.add(key);
    const canonicalStatus = input.canonicalStatuses.get(entry.id);
    const mismatched = !canonicalStatus || (
      (input.terminalStatuses.has(canonicalStatus) || input.terminalStatuses.has(entry.status ?? ""))
      && canonicalStatus !== entry.status
    );
    if (!mismatched) {
      firstSeen.delete(key);
      if ((canonicalStatus && input.terminalStatuses.has(canonicalStatus)) || input.terminalStatuses.has(entry.status ?? "")) {
        terminalRepresentationCount += 1;
      }
      continue;
    }
    const previous = firstSeen.get(key);
    const mismatchStartedAt = previous && nowMs - previous.lastSeenAt <= MAX_MISMATCH_HEARTBEAT_GAP_MS
      ? previous.firstSeenAt
      : nowMs;
    firstSeen.set(key, { firstSeenAt: mismatchStartedAt, lastSeenAt: nowMs });
    if (nowMs - mismatchStartedAt >= TERMINAL_RECONCILIATION_WINDOW_MS) {
      persistentDriftCount += 1;
      terminalRepresentationCount += 1;
    } else {
      pendingMismatchCount += 1;
    }
  }
  for (const key of firstSeen.keys()) {
    if (key.startsWith(prefix) && !observedKeys.has(key)) firstSeen.delete(key);
  }
  terminalMismatchFirstSeen.set(input.userId, firstSeen);
  recordLiveActionBaseline({
    userId: input.userId,
    metric: "terminal_state_drift_count",
    surface,
    value: persistentDriftCount,
  });
  recordLiveActionBaseline({
    userId: input.userId,
    metric: "terminal_representation_count",
    surface,
    value: terminalRepresentationCount,
  });
  return { persistentDriftCount, pendingMismatchCount };
}

export function getLiveActionBaselineReport(userId: string): LiveActionBaselineReport {
  const metrics: LiveActionBaselineReport["metrics"] = {};
  for (const [key, aggregate] of baselines.get(userId)?.metrics ?? []) {
    const histogram = aggregate.histogram;
    metrics[key] = {
      count: aggregate.count,
      sum: aggregate.sum,
      average: aggregate.count > 0 ? aggregate.sum / aggregate.count : 0,
      max: aggregate.max,
      latestAt: aggregate.latestAt,
      ...(histogram ? {
        p50: estimateHistogramPercentile(histogram, 0.5),
        p95: estimateHistogramPercentile(histogram, 0.95),
        histogram: histogram.map((count, index) => ({ upperBoundMs: LATENCY_BUCKETS_MS[index], count })),
      } : {}),
    };
  }
  return {
    generatedAt: new Date().toISOString(),
    flags: getLiveActionFeatureFlags(),
    metrics,
    privacy: {
      contentStored: false,
      identifiersStoredInMetrics: false,
      allowedDimensions: ["metric", "surface"],
    },
  };
}

export function getLiveActionAggregateReport(): LiveActionBaselineReport & {
  scope: "deployment";
  userCount: number;
} {
  const combined = new Map<string, MetricAggregate>();
  for (const baseline of baselines.values()) {
    for (const [key, aggregate] of baseline.deploymentMetrics) {
      const current = combined.get(key);
      const histogram = aggregate.histogram || current?.histogram
        ? LATENCY_BUCKETS_MS.map((_, index) => (current?.histogram?.[index] ?? 0) + (aggregate.histogram?.[index] ?? 0))
        : undefined;
      combined.set(key, {
        count: (current?.count ?? 0) + aggregate.count,
        sum: (current?.sum ?? 0) + aggregate.sum,
        max: Math.max(current?.max ?? 0, aggregate.max),
        latestAt: !current || aggregate.latestAt > current.latestAt ? aggregate.latestAt : current.latestAt,
        histogram,
      });
    }
  }
  const metrics: LiveActionBaselineReport["metrics"] = {};
  for (const [key, aggregate] of combined) {
    const histogram = aggregate.histogram;
    metrics[key] = {
      count: aggregate.count,
      sum: aggregate.sum,
      average: aggregate.count > 0 ? aggregate.sum / aggregate.count : 0,
      max: aggregate.max,
      latestAt: aggregate.latestAt,
      ...(histogram ? {
        p50: estimateHistogramPercentile(histogram, 0.5),
        p95: estimateHistogramPercentile(histogram, 0.95),
        histogram: histogram.map((count, index) => ({ upperBoundMs: LATENCY_BUCKETS_MS[index], count })),
      } : {}),
    };
  }
  return {
    scope: "deployment",
    userCount: [...baselines.values()].filter((baseline) => baseline.deploymentMetrics.size > 0).length,
    generatedAt: new Date().toISOString(),
    flags: getLiveActionFeatureFlags(),
    metrics,
    privacy: {
      contentStored: false,
      identifiersStoredInMetrics: false,
      allowedDimensions: ["metric", "surface"],
    },
  };
}

export function isClientSubmittedLiveActionBaselineMetric(value: unknown): value is LiveActionBaselineMetric {
  return typeof value === "string" && CLIENT_SUBMITTED_METRIC_SET.has(value);
}

export function resetLiveActionBaselinesForTests(): void {
  baselines.clear();
  representationSnapshots.clear();
  terminalMismatchFirstSeen.clear();
  statusObservationIds.clear();
}
