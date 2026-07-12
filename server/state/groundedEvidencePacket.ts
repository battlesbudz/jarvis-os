import { eq } from "drizzle-orm";

import type { MemoryContext, MemoryModelTarget } from "../memory/memoryOs";
import {
  canonicalCommitmentDedupeKey,
  isPersonalCommitment,
  type CommitmentKind,
  type CommitmentSignalLevel,
} from "../commitments/commitmentStore";
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
  commitmentKind?: CommitmentKind | string;
  signalLevel?: CommitmentSignalLevel | string;
  dedupeKey?: string | null;
  sourceType?: string;
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
  compact?: boolean;
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
  const { listPendingPersonalCommitments } = await import("../commitments/dbCommitmentRepository");
  return listPendingPersonalCommitments(userId, limit);
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

function commitmentDedupeKey(commitment: GroundedCommitmentRecord): string {
  return compactText(commitment.dedupeKey) || canonicalCommitmentDedupeKey(commitment.content);
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
  return dueDateRank(commitment.dueDate, todayKey);
}

function dedupeCommitments(
  commitments: GroundedCommitmentRecord[],
  limit: number,
  now: Date,
): { selected: GroundedCommitmentRecord[]; omitted: string[] } {
  const todayKey = now.toISOString().slice(0, 10);
  const personalCommitments = commitments.filter(isPersonalCommitment);
  const groups = new Map<string, GroundedCommitmentRecord[]>();
  for (const commitment of personalCommitments) {
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

  const selected = canonical.slice(0, limit);
  const duplicateCount = personalCommitments.length - groups.size;
  const excludedCount = commitments.length - personalCommitments.length;
  const overflowCount = canonical.length - selected.length;
  const omitted: string[] = [];
  if (duplicateCount > 0) {
    omitted.push(`Collapsed ${duplicateCount} duplicate pending commitment record(s).`);
  }
  if (excludedCount > 0) {
    omitted.push(`Omitted ${excludedCount} non-personal or low-signal commitment record(s) based on stored metadata.`);
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
    label: commitment.commitmentKind === "user_task" ? "Pending task" : "Pending commitment",
    content: commitment.content,
    source: commitment.sourceType || "commitments",
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

function renderCompactLimits(packet: GroundedEvidencePacket, maxChars: number): string {
  const groups = [
    { label: "omitted", details: packet.omitted },
    { label: "uncertainty", details: packet.uncertainty },
  ].filter((group) => group.details.length > 0);
  if (groups.length === 0) return "LIMITS: none reported.";

  const prefix = "LIMITS: ";
  const labelsAndSeparators = groups.reduce((total, group) => total + group.label.length + 1, 0) +
    Math.max(0, groups.length - 1) * 2;
  const contentBudget = Math.max(groups.length * 8, maxChars - prefix.length - labelsAndSeparators);
  const perGroupBudget = Math.max(8, Math.floor(contentBudget / groups.length));
  return `${prefix}${groups.map((group) => (
    `${group.label}=${truncateText(group.details.join(" "), perGroupBudget)}`
  )).join("; ")}`;
}

function renderCompactEvidencePacket(packet: GroundedEvidencePacket, maxChars: number): string {
  const limitBudget = Math.min(160, Math.max(48, Math.floor(maxChars * 0.28)));
  const limitsLine = renderCompactLimits(packet, limitBudget);
  const opening = [
    "## Jarvis Grounded Evidence Packet",
    "Use only EVIDENCE. Treat LIMITS as incomplete context and admit when a fact is not loaded.",
    limitsLine,
    "EVIDENCE:",
  ];
  if (packet.evidence.length === 0) {
    return truncateText([...opening, "- No grounded evidence loaded for this turn."].join("\n"), maxChars);
  }

  const openingText = opening.join("\n");
  const available = Math.max(48, maxChars - openingText.length - packet.evidence.length);
  const perItemBudget = Math.max(36, Math.floor(available / packet.evidence.length));
  const evidenceLines = packet.evidence.map((item) => {
    const prefix = `- [${item.domain}] (id=${item.id}) `;
    const contentBudget = Math.max(8, perItemBudget - prefix.length);
    return `${prefix}${truncateText(item.content, contentBudget)}`;
  });
  return truncateText([openingText, ...evidenceLines].join("\n"), maxChars);
}

export function renderGroundedEvidencePacket(
  packet: GroundedEvidencePacket,
  options: RenderGroundedEvidencePacketOptions = {},
): string {
  const maxChars = options.maxChars ?? DEFAULT_RENDER_MAX_CHARS;
  if (options.compact) return renderCompactEvidencePacket(packet, maxChars);
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

  return truncateText(lines.join("\n"), maxChars);
}

export async function buildGroundedEvidencePacketPrompt(
  input: BuildGroundedEvidencePacketInput & { renderMaxChars?: number; compact?: boolean },
  deps?: GroundedEvidencePacketDeps,
): Promise<string> {
  const packet = await buildGroundedEvidencePacket(input, deps);
  return renderGroundedEvidencePacket(packet, {
    maxChars: input.renderMaxChars ?? DEFAULT_RENDER_MAX_CHARS,
    compact: input.compact,
  });
}
