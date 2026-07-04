export type DiagnosticSource = "in_app" | "telegram" | "voice" | "daemon" | "unknown";

export interface DiagnosticTiming {
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  firstTokenMs?: number;
}

export interface DiagnosticSelectedRuntime {
  mode?: string | null;
  model?: string | null;
  profile?: string | null;
  provider?: string | null;
}

export interface DiagnosticVoiceTrace {
  finalTranscript: string;
  startedAt?: string;
  finishedAt?: string;
  stateTransitions: Array<{ state: string; at: string; detail?: string }>;
}

export interface TurnDiagnosticBundle {
  schemaVersion: 1;
  turnId: string;
  createdAt: string;
  source: DiagnosticSource;
  userId?: string | null;
  channel?: string | null;
  channelTurnId?: string | number | null;
  requestText?: string;
  responseText?: string;
  selected: DiagnosticSelectedRuntime;
  runtimeIntent?: string | null;
  contextPacket: unknown;
  contextEstimate: {
    chars: number;
    approximateTokens: number;
    maxContextTokens?: number | null;
  };
  offeredTools: string[];
  rawToolCalls: unknown[];
  normalizedToolCalls: unknown[];
  toolResults: unknown[];
  modelErrors: unknown[];
  timing: DiagnosticTiming;
  androidState: unknown;
  recentTurnHistory: Array<{ role: string; content: string }>;
  voiceTrace?: DiagnosticVoiceTrace;
}

export interface DiagnosticTurnRecord {
  turnId: string;
  source: DiagnosticSource;
  channel: string;
  channelTurnId?: string | number | null;
  createdAt: string;
  bundle: TurnDiagnosticBundle;
}

export type DiagnosticTargetRequest =
  | { kind: "last" }
  | { kind: "reply"; channelTurnId: string | number }
  | { kind: "specific"; turnId: string };

export type DiagnosticTargetResolution =
  | { ok: true; record: DiagnosticTurnRecord; ambiguous: false }
  | { ok: false; reason: "not_found" | "empty" | "ambiguous"; ambiguous: boolean; candidates?: DiagnosticTurnRecord[] };

export type VoiceDiagnosticFollowupTarget = "last failed action" | "last turn";

export function estimateDiagnosticContext(value: unknown): { chars: number; approximateTokens: number } {
  const serialized = typeof value === "string" ? value : JSON.stringify(value ?? null);
  const chars = serialized.length;
  return { chars, approximateTokens: Math.ceil(chars / 4) };
}

export function inferRuntimeIntent(text: string): string {
  const normalized = text.toLowerCase();
  if (/\b(copy|clipboard)\b.*\b(detail|diagnostic|debug)\b|\b(copy details|copy diagnostics)\b/.test(normalized)) return "diagnostic_copy";
  if (/\b(notification|notifications)\b/.test(normalized)) return "android_notifications";
  if (/\b(screenshot|screen shot|screen capture|what'?s on my screen|read (my )?screen)\b/.test(normalized)) return "android_screen";
  if (/\bopen\b.+\b(youtube|facebook|instagram|linkedin|app)\b|\bsearch youtube\b/.test(normalized)) return "android_app_control";
  if (/\b(memory|remember|know about me|who am i|who are you)\b/.test(normalized)) return "memory_or_identity";
  if (/\b(error|failed|broken|not working|diagnose)\b/.test(normalized)) return "runtime_diagnostics";
  return "conversation";
}

export function buildTurnDiagnosticBundle(input: {
  turnId: string;
  source: DiagnosticSource;
  userId?: string | null;
  channel?: string | null;
  channelTurnId?: string | number | null;
  requestText?: string;
  responseText?: string;
  selected?: DiagnosticSelectedRuntime;
  runtimeIntent?: string | null;
  contextPacket: unknown;
  offeredTools?: string[];
  rawToolCalls?: unknown[];
  normalizedToolCalls?: unknown[];
  toolResults?: unknown[];
  modelErrors?: unknown[];
  timing: DiagnosticTiming;
  androidState?: unknown;
  recentTurnHistory?: Array<{ role: string; content: string }>;
  voiceTrace?: DiagnosticVoiceTrace;
  maxContextTokens?: number | null;
}): TurnDiagnosticBundle {
  const contextEstimate = estimateDiagnosticContext(input.contextPacket);
  return {
    schemaVersion: 1,
    turnId: input.turnId,
    createdAt: new Date().toISOString(),
    source: input.source,
    userId: input.userId,
    channel: input.channel,
    channelTurnId: input.channelTurnId,
    requestText: input.requestText,
    responseText: input.responseText,
    selected: input.selected ?? {},
    runtimeIntent: input.runtimeIntent ?? (input.requestText ? inferRuntimeIntent(input.requestText) : null),
    contextPacket: input.contextPacket,
    contextEstimate: {
      ...contextEstimate,
      maxContextTokens: input.maxContextTokens ?? null,
    },
    offeredTools: input.offeredTools ?? [],
    rawToolCalls: input.rawToolCalls ?? [],
    normalizedToolCalls: input.normalizedToolCalls ?? [],
    toolResults: input.toolResults ?? [],
    modelErrors: input.modelErrors ?? [],
    timing: input.timing,
    androidState: input.androidState ?? null,
    recentTurnHistory: input.recentTurnHistory ?? [],
    voiceTrace: input.voiceTrace,
  };
}

export function formatDiagnosticBundleForClipboard(bundle: TurnDiagnosticBundle): string {
  return JSON.stringify(bundle, null, 2);
}

export function isDiagnosticCopyRequest(text: string): boolean {
  return /^\s*(?:copy|get|show|send)\s+(?:the\s+)?(?:(?:last|failed|turn|action)\s+)*(?:debug\s+|diagnostic\s+)?details\s*$/i.test(text)
    || /^\s*copy\s+diagnostics?\s*$/i.test(text);
}

export function diagnosticRecordHasFailure(record: DiagnosticTurnRecord): boolean {
  if (record.bundle.responseText?.trim().toLowerCase().startsWith("error:")) return true;
  return record.bundle.toolResults.some((result) => {
    if (!result || typeof result !== "object") return false;
    const value = result as { result?: unknown; ok?: unknown };
    return value.result === "error" || value.ok === false;
  });
}

export function isDiagnosticCopyRecord(record: DiagnosticTurnRecord): boolean {
  if (record.bundle.runtimeIntent === "diagnostic_copy") return true;
  const context = record.bundle.contextPacket;
  return !!context
    && typeof context === "object"
    && "command" in context
    && (context as { command?: unknown }).command === "voice_copy_details";
}

export function getActionableDiagnosticRecords(records: DiagnosticTurnRecord[]): DiagnosticTurnRecord[] {
  return records.filter((record) => !isDiagnosticCopyRecord(record));
}

export function getDiagnosticRecordsForUser(records: DiagnosticTurnRecord[], userId: string): DiagnosticTurnRecord[] {
  return records.filter((record) => record.bundle.userId === userId);
}

export function resolveDiagnosticTarget(
  records: DiagnosticTurnRecord[],
  request: DiagnosticTargetRequest,
): DiagnosticTargetResolution {
  if (records.length === 0) return { ok: false, reason: "empty", ambiguous: false };
  const newestFirst = [...records].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  if (request.kind === "last") {
    return { ok: true, record: newestFirst[0], ambiguous: false };
  }

  if (request.kind === "specific") {
    const record = newestFirst.find((candidate) => candidate.turnId === request.turnId);
    return record
      ? { ok: true, record, ambiguous: false }
      : { ok: false, reason: "not_found", ambiguous: false };
  }

  const matches = newestFirst.filter((candidate) => String(candidate.channelTurnId ?? "") === String(request.channelTurnId));
  if (matches.length === 1) return { ok: true, record: matches[0], ambiguous: false };
  if (matches.length > 1) return { ok: false, reason: "ambiguous", ambiguous: true, candidates: matches };
  return { ok: false, reason: "not_found", ambiguous: false };
}

export function resolveDiagnosticTargetFromText(
  records: DiagnosticTurnRecord[],
  text: string,
): DiagnosticTargetResolution {
  const actionableRecords = getActionableDiagnosticRecords(records);
  if (actionableRecords.length === 0) return { ok: false, reason: "empty", ambiguous: false };
  const normalized = text.trim().toLowerCase();
  const newestFirst = [...actionableRecords].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  if (/\b(failed action|last failed|failed)\b/.test(normalized)) {
    const failedRecord = newestFirst.find(diagnosticRecordHasFailure);
    return failedRecord
      ? { ok: true, record: failedRecord, ambiguous: false }
      : { ok: false, reason: "not_found", ambiguous: false };
  }

  return resolveDiagnosticTarget(actionableRecords, { kind: "last" });
}

export function resolveDiagnosticCopyRequestTarget(text: string): VoiceDiagnosticFollowupTarget | null {
  const normalized = text.trim().toLowerCase();
  if (/\b(failed action|last failed|failed)\b/.test(normalized)) return "last failed action";
  if (/\b(last turn|this turn|current turn|previous turn)\b/.test(normalized)) return "last turn";
  return null;
}

export function resolveVoiceDiagnosticFollowupTarget(text: string): VoiceDiagnosticFollowupTarget | null {
  const normalized = text.trim().toLowerCase().replace(/[.?!]+$/g, "");
  if (/^(?:the\s+)?(?:last\s+)?failed\s+action$/.test(normalized)) return "last failed action";
  if (/^last\s+failed$/.test(normalized)) return "last failed action";
  if (/^failed\s+action$/.test(normalized)) return "last failed action";
  if (/^(?:no,?\s*)?(?:just\s+)?(?:the\s+)?(?:last|previous)\s+turn$/.test(normalized)) return "last turn";
  return null;
}

export function shouldClarifyVoiceDiagnosticTarget(text: string, recentRecords: DiagnosticTurnRecord[]): boolean {
  const normalized = text.trim().toLowerCase();
  if (!isDiagnosticCopyRequest(normalized)) return false;
  if (/\b(last turn|last failed|failed action|this turn|current turn)\b/.test(normalized)) return false;
  const recent = getActionableDiagnosticRecords(recentRecords).slice(0, 3);
  const hasFailure = recent.some(diagnosticRecordHasFailure);
  return recent.length > 1 || hasFailure;
}
