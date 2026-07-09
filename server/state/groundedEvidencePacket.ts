import { and, desc, eq } from "drizzle-orm";

import type { MemoryContext, MemoryModelTarget } from "../memory/memoryOs";
import {
  loadRuntimeProfileStateFromDb,
  memoryModelTargetFromActiveModel,
  type RuntimeProfileState,
} from "./stateCard";

export type GroundedEvidenceDomain =
  | "profile"
  | "soul"
  | "memory"
  | "commitment"
  | "runtime";

export interface GroundedEvidenceItem {
  id: string;
  domain: GroundedEvidenceDomain;
  label: string;
  content: string;
  source: string;
  sourceId?: string;
  recordedAt?: string;
  dueDate?: string | null;
  status?: string;
  confidence?: number;
}

export interface GroundedEvidencePacket {
  userId: string;
  requestText: string;
  generatedAt: string;
  activeDevice?: string;
  activeModel?: string;
  currentContext?: string;
  modelTarget: MemoryModelTarget;
  evidence: GroundedEvidenceItem[];
  omitted: string[];
  uncertainty: string[];
}

export interface GroundedCommitmentRecord {
  id: string;
  content: string;
  dueDate?: string | null;
  status: string;
  extractedAt?: Date | string | null;
  resolvedAt?: Date | string | null;
  sourceMessage?: string | null;
}

type SoulGroundingRecord = {
  content: string;
  manualOverride: string | null;
  generatedAt: Date | string | null;
  updatedAt: Date | string | null;
};

export interface GroundedEvidencePacketDeps {
  loadProfileState?: (userId: string) => Promise<RuntimeProfileState | null>;
  loadSoul?: (userId: string) => Promise<SoulGroundingRecord>;
  retrieveMemoryContext?: (input: {
    userId: string;
    query: string;
    limit: number;
    caller: "runtime_memory_inspection";
    skipAccessUpdate: boolean;
    canonicalOnly?: boolean;
    modelTarget?: MemoryModelTarget;
    allowRestrictedMemory?: boolean;
  }) => Promise<MemoryContext>;
  loadCommitments?: (userId: string, limit: number) => Promise<GroundedCommitmentRecord[]>;
  now?: () => Date;
}

export interface BuildGroundedEvidencePacketInput {
  userId: string;
  requestText: string;
  query?: string;
  activeDevice?: string;
  activeModel?: string;
  currentContext?: string;
  includeProfile?: boolean;
  includeSoul?: boolean;
  includeMemory?: boolean;
  includeCommitments?: boolean;
  allowRestrictedMemory?: boolean;
  memoryLimit?: number;
  commitmentLimit?: number;
}

export interface RenderGroundedEvidencePacketOptions {
  maxChars?: number;
  includeInstructions?: boolean;
}

let groundedEvidencePacketDepsForTesting: GroundedEvidencePacketDeps | null = null;

export function _setGroundedEvidencePacketDepsForTesting(
  deps: GroundedEvidencePacketDeps | null,
): void {
  groundedEvidencePacketDepsForTesting = deps;
}

const DEFAULT_MEMORY_LIMIT = 6;
const DEFAULT_COMMITMENT_LIMIT = 5;
const DEFAULT_RENDER_MAX_CHARS = 2_200;
const ABOUT_YOU_QUERY = "user profile preferences relationships work patterns goals blockers values commitments";

function compactText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  if (maxChars <= 3) return value.slice(0, Math.max(0, maxChars));
  return `${value.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function formatDate(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  const text = value.trim();
  return text || undefined;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = compactText(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function evidenceId(prefix: GroundedEvidenceDomain, id: string): string {
  return `${prefix}:${id.replace(/[^a-z0-9_.:-]+/gi, "_").slice(0, 80) || "item"}`;
}

async function defaultLoadSoul(userId: string): Promise<SoulGroundingRecord> {
  if (typeof process !== "undefined" && !process.env.DATABASE_URL) {
    return { content: "", manualOverride: null, generatedAt: null, updatedAt: null };
  }

  const [{ db }, schema] = await Promise.all([
    import("../db"),
    import("@shared/schema"),
  ]);
  const [soul] = await db
    .select({
      content: schema.jarvisSouls.content,
      manualOverride: schema.jarvisSouls.manualOverride,
      generatedAt: schema.jarvisSouls.generatedAt,
      updatedAt: schema.jarvisSouls.updatedAt,
    })
    .from(schema.jarvisSouls)
    .where(eq(schema.jarvisSouls.userId, userId))
    .limit(1);

  return soul ?? { content: "", manualOverride: null, generatedAt: null, updatedAt: null };
}

async function defaultRetrieveMemoryContext(input: {
  userId: string;
  query: string;
  limit: number;
  caller: "runtime_memory_inspection";
  skipAccessUpdate: boolean;
  canonicalOnly?: boolean;
  modelTarget?: MemoryModelTarget;
  allowRestrictedMemory?: boolean;
}): Promise<MemoryContext> {
  const { retrieveMemoryContext } = await import("../memory/memoryOs");
  return retrieveMemoryContext(input);
}

async function defaultLoadCommitments(userId: string, limit: number): Promise<GroundedCommitmentRecord[]> {
  if (typeof process !== "undefined" && !process.env.DATABASE_URL) return [];

  const [{ db }, schema] = await Promise.all([
    import("../db"),
    import("@shared/schema"),
  ]);
  return db
    .select({
      id: schema.commitments.id,
      content: schema.commitments.content,
      dueDate: schema.commitments.dueDate,
      status: schema.commitments.status,
      extractedAt: schema.commitments.extractedAt,
      resolvedAt: schema.commitments.resolvedAt,
      sourceMessage: schema.commitments.sourceMessage,
    })
    .from(schema.commitments)
    .where(and(eq(schema.commitments.userId, userId), eq(schema.commitments.status, "pending")))
    .orderBy(desc(schema.commitments.extractedAt))
    .limit(limit);
}

function profileEvidence(profile: RuntimeProfileState | null): GroundedEvidenceItem[] {
  if (!profile) return [];
  const parts = [
    profile.preferredName ? `Preferred name: ${profile.preferredName}` : "",
    profile.timezone ? `Timezone: ${profile.timezone}` : "",
    profile.language ? `Language: ${profile.language}` : "",
    profile.communicationStyle ? `Communication style: ${profile.communicationStyle}` : "",
  ].filter(Boolean);

  if (parts.length === 0) return [];
  return [{
    id: "profile:core",
    domain: "profile",
    label: "Core profile",
    content: parts.join("; "),
    source: profile.source,
    sourceId: profile.userId,
  }];
}

function soulEvidence(soul: SoulGroundingRecord): GroundedEvidenceItem[] {
  const items: GroundedEvidenceItem[] = [];
  const content = compactText(soul.content);
  if (content) {
    items.push({
      id: "soul:summary",
      domain: "soul",
      label: "Soul summary",
      content,
      source: "jarvis_soul",
      recordedAt: formatDate(soul.updatedAt ?? soul.generatedAt),
    });
  }
  const manualOverride = compactText(soul.manualOverride);
  if (manualOverride) {
    items.push({
      id: "soul:manual_override",
      domain: "soul",
      label: "Pinned personal note",
      content: manualOverride,
      source: "jarvis_soul",
      recordedAt: formatDate(soul.updatedAt ?? soul.generatedAt),
    });
  }
  return items;
}

function compactProvenance(item: MemoryContext["items"][number]): string {
  const ref = item.provenance.find((candidate) => candidate.kind === "user_memory") ?? item.provenance[0];
  if (!ref) return item.memory.id;
  return ref.id;
}

function memoryEvidence(context: MemoryContext): GroundedEvidenceItem[] {
  return context.items.map((item) => ({
    id: evidenceId("memory", item.memory.id),
    domain: "memory",
    label: item.memory.category,
    content: item.memory.content,
    source: "MemoryOS",
    sourceId: compactProvenance(item),
    confidence: item.memory.confidence,
  }));
}

function normalizedCommitmentKey(content: string): string {
  const normalized = content
    .toLowerCase()
    .replace(/['"`]/g, "")
    .replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/gi, " ")
    .replace(/\b\d{4}-\d{2}-\d{2}(?:t[\d:.z-]+)?\b/gi, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(?:the|a|an|and|or|to|of|for|with|as|one|single|same|duplicate|duplicates|duplicated|consolidated|triage|record|issue|items|alerts|notifications|notification|inbox|treat|all|five|5)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.slice(0, 180);
}

function commitmentIncidentKey(content: string): string | null {
  const text = content.toLowerCase();
  if (/\bdiscord_bot_token\b/.test(text) || (/\bdiscord\b/.test(text) && /\bbot\s+token\b/.test(text))) {
    return "incident:discord_bot_token";
  }
  if (/\btelegram\b/.test(text) && /\bhealth\s+check\b/.test(text)) return "incident:telegram_health_check";
  if (/\breplit\b/.test(text) && /\busage\s+limit\b/.test(text)) return "notification:replit_usage_limit";
  if (/\bgithub\b/.test(text) && /\bpersonal\s+access\s+token\b/.test(text)) return "notification:github_pat";
  if (/\bbuildasoil\b/.test(text) || /\bpromotional\s+email\b/.test(text)) return "notification:promotion";
  if (/\bspam\s+risk\b/.test(text)) return "notification:spam_risk";
  return null;
}

function commitmentDedupeKey(commitment: GroundedCommitmentRecord): string {
  return commitmentIncidentKey(commitment.content) ?? normalizedCommitmentKey(commitment.content);
}

function isLowSignalCommitment(commitment: GroundedCommitmentRecord): boolean {
  const text = commitment.content.toLowerCase();
  return Boolean(commitmentIncidentKey(commitment.content)) ||
    /\b(?:acknowledge|acknowledged|dismiss|dismissed|archive|archived)\b/.test(text) ||
    /\b(?:promotional|sale ending|spam risk|health summary|health check failed)\b/.test(text);
}

function dueDateRank(dueDate: string | null | undefined, todayKey: string): number {
  if (!dueDate) return 10;
  if (dueDate < todayKey) return 100;
  if (dueDate === todayKey) return 95;
  return 70;
}

function extractedAtMs(value: Date | string | null | undefined): number {
  const formatted = formatDate(value);
  if (!formatted) return 0;
  const parsed = Date.parse(formatted);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rankCommitment(commitment: GroundedCommitmentRecord, todayKey: string): number {
  return dueDateRank(commitment.dueDate, todayKey) - (isLowSignalCommitment(commitment) ? 120 : 0);
}

function dedupeCommitments(
  commitments: GroundedCommitmentRecord[],
  limit: number,
  now: Date,
): { selected: GroundedCommitmentRecord[]; omitted: string[] } {
  const todayKey = now.toISOString().slice(0, 10);
  const groups = new Map<string, GroundedCommitmentRecord[]>();
  for (const commitment of commitments) {
    const key = commitmentDedupeKey(commitment);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(commitment);
    groups.set(key, group);
  }

  const canonical = Array.from(groups.values())
    .map((group) => [...group].sort((a, b) => {
      const rankDiff = rankCommitment(b, todayKey) - rankCommitment(a, todayKey);
      if (rankDiff !== 0) return rankDiff;
      return extractedAtMs(b.extractedAt) - extractedAtMs(a.extractedAt);
    })[0]!)
    .sort((a, b) => {
      const rankDiff = rankCommitment(b, todayKey) - rankCommitment(a, todayKey);
      if (rankDiff !== 0) return rankDiff;
      return extractedAtMs(b.extractedAt) - extractedAtMs(a.extractedAt);
    });

  const selected = canonical.filter((commitment) => !isLowSignalCommitment(commitment)).slice(0, limit);
  const duplicateCount = commitments.length - groups.size;
  const lowSignalCount = canonical.filter(isLowSignalCommitment).length;
  const overflowCount = canonical.filter((commitment) => !isLowSignalCommitment(commitment)).length - selected.length;
  const omitted: string[] = [];
  if (duplicateCount > 0) {
    omitted.push(`Collapsed ${duplicateCount} duplicate pending commitment record(s).`);
  }
  if (lowSignalCount > 0) {
    omitted.push(`Omitted ${lowSignalCount} low-signal alert or notification commitment record(s).`);
  }
  if (overflowCount > 0) {
    omitted.push(`Omitted ${overflowCount} lower-ranked pending commitment record(s) beyond the packet limit.`);
  }
  return { selected, omitted };
}

function commitmentEvidence(commitments: GroundedCommitmentRecord[]): GroundedEvidenceItem[] {
  return commitments.map((commitment) => ({
    id: evidenceId("commitment", commitment.id),
    domain: "commitment",
    label: "Pending commitment",
    content: commitment.content,
    source: "commitments",
    sourceId: commitment.id,
    dueDate: commitment.dueDate,
    status: commitment.status,
    recordedAt: formatDate(commitment.extractedAt),
  }));
}

function safeUncertaintyMessage(source: string, error: unknown): string {
  const suffix = error instanceof Error && error.name ? ` (${error.name})` : "";
  return `${source} was unavailable${suffix}.`;
}

export async function buildGroundedEvidencePacket(
  input: BuildGroundedEvidencePacketInput,
  deps: GroundedEvidencePacketDeps = {},
): Promise<GroundedEvidencePacket> {
  const effectiveDeps = {
    ...groundedEvidencePacketDepsForTesting,
    ...deps,
  };
  const now = effectiveDeps.now ?? (() => new Date());
  const generatedAt = now();
  const modelTarget = memoryModelTargetFromActiveModel(input.activeModel);
  const query = compactText(input.query) || ABOUT_YOU_QUERY;
  const memoryLimit = Math.max(0, input.memoryLimit ?? DEFAULT_MEMORY_LIMIT);
  const commitmentLimit = Math.max(0, input.commitmentLimit ?? DEFAULT_COMMITMENT_LIMIT);
  const evidence: GroundedEvidenceItem[] = [];
  const omitted: string[] = [];
  const uncertainty: string[] = [];

  if (input.includeProfile !== false) {
    try {
      const loadProfile = effectiveDeps.loadProfileState ?? loadRuntimeProfileStateFromDb;
      const profile = await loadProfile(input.userId);
      evidence.push(...profileEvidence(profile));
      if (!profile) uncertainty.push("Profile store did not return a user profile.");
    } catch (error) {
      uncertainty.push(safeUncertaintyMessage("Profile store", error));
    }
  }

  if (input.includeSoul !== false) {
    try {
      const loadSoul = effectiveDeps.loadSoul ?? defaultLoadSoul;
      evidence.push(...soulEvidence(await loadSoul(input.userId)));
    } catch (error) {
      uncertainty.push(safeUncertaintyMessage("Soul", error));
    }
  }

  if (input.includeMemory !== false && memoryLimit > 0) {
    try {
      const retrieveMemoryContext = effectiveDeps.retrieveMemoryContext ?? defaultRetrieveMemoryContext;
      const memoryContext = await retrieveMemoryContext({
        userId: input.userId,
        query,
        limit: memoryLimit,
        caller: "runtime_memory_inspection",
        skipAccessUpdate: true,
        canonicalOnly: true,
        modelTarget,
        allowRestrictedMemory: input.allowRestrictedMemory ?? false,
      });
      evidence.push(...memoryEvidence(memoryContext));
      uncertainty.push(...memoryContext.uncertainty);
    } catch (error) {
      uncertainty.push(safeUncertaintyMessage("MemoryOS", error));
    }
  }

  if (input.includeCommitments !== false && commitmentLimit > 0) {
    try {
      const loadCommitments = effectiveDeps.loadCommitments ?? defaultLoadCommitments;
      const rawCommitments = await loadCommitments(input.userId, Math.max(50, commitmentLimit * 6));
      const { selected, omitted: omittedCommitments } = dedupeCommitments(rawCommitments, commitmentLimit, generatedAt);
      evidence.push(...commitmentEvidence(selected));
      omitted.push(...omittedCommitments);
    } catch (error) {
      uncertainty.push(safeUncertaintyMessage("Commitment store", error));
    }
  }

  return {
    userId: input.userId,
    requestText: input.requestText,
    generatedAt: generatedAt.toISOString(),
    activeDevice: input.activeDevice,
    activeModel: input.activeModel,
    currentContext: input.currentContext,
    modelTarget,
    evidence,
    omitted: uniqueStrings(omitted),
    uncertainty: uniqueStrings(uncertainty),
  };
}

function renderEvidenceLine(item: GroundedEvidenceItem, index: number): string {
  const metadata = [
    `id=${item.id}`,
    `source=${item.source}`,
    item.sourceId ? `sourceId=${item.sourceId}` : "",
    item.status ? `status=${item.status}` : "",
    item.dueDate ? `due=${item.dueDate}` : "",
    item.recordedAt ? `recorded=${item.recordedAt}` : "",
    typeof item.confidence === "number" ? `confidence=${item.confidence}` : "",
  ].filter(Boolean).join("; ");
  return `${index + 1}. [${item.domain}/${item.label}] (${metadata}) ${truncateText(item.content, 260)}`;
}

export function renderGroundedEvidencePacket(
  packet: GroundedEvidencePacket,
  options: RenderGroundedEvidencePacketOptions = {},
): string {
  const includeInstructions = options.includeInstructions ?? true;
  const lines: string[] = [
    "## Jarvis Grounded Evidence Packet",
    "Authoritative facts loaded by Jarvis for this turn. The model may verbalize these facts, but it must not add unsupported claims.",
    "",
    `Request: ${packet.requestText || "(empty)"}`,
    `Generated at: ${packet.generatedAt}`,
    `Model target: ${packet.modelTarget}`,
  ];

  if (packet.activeDevice || packet.activeModel || packet.currentContext) {
    lines.push(
      `Runtime: ${[
        packet.activeDevice ? `device=${packet.activeDevice}` : "",
        packet.activeModel ? `model=${packet.activeModel}` : "",
        packet.currentContext ? `context=${packet.currentContext}` : "",
      ].filter(Boolean).join("; ")}`,
    );
  }

  if (includeInstructions) {
    lines.push(
      "",
      "Grounding rules:",
      "- Use only EVIDENCE below for claims about the user, Jarvis memory, commitments, notifications, or device state.",
      "- If EVIDENCE does not contain the answer, say Jarvis does not currently have that information loaded.",
      "- Do not treat omitted low-signal alerts, duplicate health checks, spam, or promotional notifications as important personal facts.",
      "- Keep the answer concise and cite evidence IDs only when useful.",
    );
  }

  lines.push("", "EVIDENCE:");
  if (packet.evidence.length === 0) {
    lines.push("- No grounded evidence loaded for this turn.");
  } else {
    lines.push(...packet.evidence.map(renderEvidenceLine));
  }

  if (packet.omitted.length > 0) {
    lines.push("", "Omitted:", ...packet.omitted.map((entry) => `- ${entry}`));
  }
  if (packet.uncertainty.length > 0) {
    lines.push("", "Uncertainty:", ...packet.uncertainty.map((entry) => `- ${entry}`));
  }

  return truncateText(lines.join("\n"), options.maxChars ?? DEFAULT_RENDER_MAX_CHARS);
}

export async function buildGroundedEvidencePacketPrompt(
  input: BuildGroundedEvidencePacketInput & { renderMaxChars?: number },
  deps?: GroundedEvidencePacketDeps,
): Promise<string> {
  const packet = await buildGroundedEvidencePacket(input, deps);
  return renderGroundedEvidencePacket(packet, { maxChars: input.renderMaxChars ?? DEFAULT_RENDER_MAX_CHARS });
}
