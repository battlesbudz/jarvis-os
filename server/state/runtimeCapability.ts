import type OpenAI from "openai";
import { eq, sql } from "drizzle-orm";

import type { FallbackChainEntry } from "../agent/providers/fallback";
import type { ProviderTurnResult } from "../agent/providers/base";
import type { AndroidDaemonAction } from "../daemon/bridge";
import { toolDescriptorFromAgentTool } from "../core/tools/agentToolAdapter";
import {
  createRuntimeExplanation,
  renderRuntimeExplanation,
  runtimeSource,
  runtimeToolFailureExplanation,
  type RuntimeExplanation,
  type RuntimeExplanationSource,
} from "../core/runtime/runtimeExplanation";
import { integrationStatus, type IntegrationName, type IntegrationStatusValue } from "@shared/schema";

type RuntimeCapabilityIntent = "tools" | "accounts" | "device_control";
type RuntimeCapabilityCheckStatus = "ready" | "disabled" | "offline" | "unknown";

export interface RuntimeCapabilityAccount {
  id: string;
  label: string;
  connected: boolean;
  ready: boolean;
  readiness: string;
  status: string;
  blockedReason: string | null;
  lastCheckedAt: string;
}

export interface RuntimeCapabilityCheck {
  status: RuntimeCapabilityCheckStatus;
  reason?: string;
  lastCheckedAt: string;
}

export interface RuntimeCapabilityDeviceState {
  desktop: {
    connected: boolean;
    hostname: string | null;
    lastSeenAt: string | null;
    permissions: string[];
  };
  android: {
    connected: boolean;
    hostname: string | null;
    lastSeenAt: string | null;
    activeDevice: string | null;
    permissions: {
      openApp: RuntimeCapabilityCheck;
      browse: RuntimeCapabilityCheck;
      screenCapture: RuntimeCapabilityCheck;
      readScreen: RuntimeCapabilityCheck;
      tapType: RuntimeCapabilityCheck;
      accessibility: RuntimeCapabilityCheck;
      notificationAccess: RuntimeCapabilityCheck;
      microphone: RuntimeCapabilityCheck;
    };
  };
}

export interface RuntimeCapabilityToolGroup {
  label: string;
  provider: string;
  tools: string[];
  approvalRequired: string[];
}

export interface RuntimeCapabilityState {
  userId: string;
  checkedAt: string;
  accounts: RuntimeCapabilityAccount[];
  toolGroups: RuntimeCapabilityToolGroup[];
  deviceControl: RuntimeCapabilityDeviceState;
  uncertainty: string[];
}

export interface RuntimeCapabilityStateDeps {
  now?: () => Date;
  loadConnectedAccounts?: (userId: string, checkedAt: string) => Promise<RuntimeCapabilityAccount[]>;
  loadDeviceControlState?: (userId: string, checkedAt: string) => Promise<RuntimeCapabilityDeviceState>;
}

export interface RuntimeCapabilityPreflightResult {
  ok: boolean;
  source: "runtime_capability_state";
  status: RuntimeCapabilityCheckStatus;
  reason: string;
  lastCheckedAt: string;
  action: RuntimeCapabilityAndroidAction;
}

export type RuntimeCapabilityAndroidAction =
  | "android_open_app"
  | "android_browse"
  | "android_capture_screen"
  | "android_read_screen"
  | "android_tap_type"
  | "android_read_notifications";

const KNOWN_CAPABILITY_INTEGRATIONS: Array<{ id: IntegrationName; label: string }> = [
  { id: "google", label: "Google" },
  { id: "outlook", label: "Outlook" },
  { id: "telegram", label: "Telegram" },
  { id: "discord", label: "Discord" },
  { id: "slack", label: "Slack" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "github", label: "GitHub" },
];

const HEALTHY_STATUSES = new Set<IntegrationStatusValue>(["healthy", "expiring_soon", "degraded"]);

let runtimeCapabilityDepsForTesting: RuntimeCapabilityStateDeps | null = null;

export function _setRuntimeCapabilityDepsForTesting(deps: RuntimeCapabilityStateDeps | null): void {
  runtimeCapabilityDepsForTesting = deps;
}

function textFromContent(content: OpenAI.Chat.Completions.ChatCompletionMessageParam["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function latestUserText(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") return textFromContent(message.content);
  }
  return "";
}

function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/['`\u2018\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isBareCapabilityPrompt(normalized: string, capabilityPattern: string): boolean {
  return new RegExp(
    `^(?:can you|are you able to) (?:${capabilityPattern})(?: (?:right now|currently|today|on my phone|on this phone|for me))?$`,
  ).test(normalized);
}

function isDirectCapabilityActionRequest(normalized: string): boolean {
  return /^(?:can you|are you able to) (?:use )?(?:device control|phone control|android control|control my phone|control the phone|the phone|my phone|your phone) (?:to|and) (?:open|launch|search|take|tap|type|scroll|send|create|delete|run)\b/.test(normalized);
}

function isBroadHelpPrompt(normalized: string): boolean {
  return /^what can you do (?:to|for|about|with|when|if)\b/.test(normalized);
}

const ACTION_REQUEST_VERBS =
  "(?:open|launch|search|take|tap|type|scroll|send|create|delete|merge|run|email|message|text|forward|reply|draft|write|schedule|remind|book|save|upload|post|submit|file|archive)";

function hasMixedCapabilityActionRequest(rawText: string, normalized: string): boolean {
  const politeActionPrefix = String.raw`(?:(?:can|could|would|will)\s+you\s+|are\s+you\s+able\s+to\s+)?`;
  const followUpAction = new RegExp(
    `\\b(?:and(?: then)?|then|after that|afterward|afterwards)\\s+(?:please\\s+)?${politeActionPrefix}${ACTION_REQUEST_VERBS}\\b`,
  ).test(normalized);
  if (followUpAction) return true;
  return new RegExp(`[?.!,;:]\\s*(?:please\\s+)?${politeActionPrefix}${ACTION_REQUEST_VERBS}\\b`, "i").test(rawText);
}

export function classifyRuntimeCapabilityIntent(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): RuntimeCapabilityIntent | null {
  const rawText = latestUserText(messages);
  const normalized = normalizeQuestion(rawText);
  if (!normalized) return null;

  const asksAboutCapability = /\b(what tools|which tools|what capabilities|what can you do|what can you access|do you have access|can you|are you able to)\b/.test(normalized);
  if (asksAboutCapability && hasMixedCapabilityActionRequest(rawText, normalized)) {
    return null;
  }
  if (isDirectCapabilityActionRequest(normalized)) {
    return null;
  }
  if (isBroadHelpPrompt(normalized)) {
    return null;
  }
  if (!asksAboutCapability && /\b(open|launch|search|take|tap|type|scroll|send|create|delete|merge|run)\b/.test(normalized)) {
    return null;
  }

  if (/^(?:what|which) tools can you use to\b/.test(normalized)) {
    return "tools";
  }

  if (isBareCapabilityPrompt(normalized, "send emails?|email|search the web|search web|browse the web|browse web")) {
    return "tools";
  }

  if (isBareCapabilityPrompt(normalized, "take screenshots?|capture my screen|read my screen|control my phone|open apps|tap|type|scroll")) {
    return "device_control";
  }

  if (/\b(device control|phone control|control my phone|control the phone|android control|android device|accessibility|screen capture|screenshot permission|notification access|microphone permission)\b/.test(normalized)) {
    return "device_control";
  }

  if (/\b(accounts?|connections?|connected accounts?|gmail|google|calendar|drive|slack|discord|telegram|whatsapp|github)\b/.test(normalized)
    && /\b(connected|linked|working|available|access|setup|configured|status)\b/.test(normalized)) {
    return "accounts";
  }

  if (/\b(tools?|capabilities|what can you do|what can you access|what do you have access to)\b/.test(normalized)) {
    return "tools";
  }

  return null;
}

function hasServerCredential(integration: string, linkedIntegrations: Set<string>): boolean {
  switch (integration) {
    case "google":
      return Boolean((process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_WEB_CLIENT_ID) && process.env.GOOGLE_CLIENT_SECRET);
    case "outlook":
      return Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
    case "telegram":
      return Boolean(process.env.TELEGRAM_BOT_TOKEN);
    case "discord":
      return Boolean(process.env.DISCORD_BOT_TOKEN);
    case "slack":
      return Boolean(process.env.SLACK_BOT_TOKEN) || linkedIntegrations.has("slack");
    case "whatsapp":
      return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
    case "github":
      return Boolean(process.env.GITHUB_CLIENT_ID) || linkedIntegrations.has("github");
    default:
      return false;
  }
}

async function loadConnectedAccountsFromDb(userId: string, checkedAt: string): Promise<RuntimeCapabilityAccount[]> {
  const { db } = await import("../db");
  const rows = await db
    .select()
    .from(integrationStatus)
    .where(eq(integrationStatus.userId, userId));
  const linkedRaw = await db.execute(sql`
    SELECT DISTINCT integration FROM (
      SELECT 'telegram' AS integration FROM telegram_links WHERE user_id = ${userId}
      UNION ALL
      SELECT channel AS integration FROM channel_links WHERE user_id = ${userId}
        AND channel IN ('discord', 'slack', 'whatsapp')
      UNION ALL
      SELECT CASE WHEN provider = 'microsoft' THEN 'outlook' ELSE provider END AS integration
      FROM user_oauth_tokens
      WHERE user_id = ${userId}
        AND provider IN ('google', 'microsoft', 'slack', 'github')
    ) linked
  `);
  const linkedRows = ((linkedRaw as any).rows ?? (Array.isArray(linkedRaw) ? linkedRaw : [])) as Array<{ integration: string }>;
  const linkedIntegrations = new Set(linkedRows.map((row) => row.integration));
  const byIntegration = new Map(rows.map((row) => [row.integration, row]));

  return KNOWN_CAPABILITY_INTEGRATIONS.map(({ id, label }) => {
    const row = byIntegration.get(id);
    const status = row?.status ?? "unconfigured";
    const connected = linkedIntegrations.has(id) || status !== "unconfigured";
    const ready = HEALTHY_STATUSES.has(status);
    const serverConfigured = hasServerCredential(id, linkedIntegrations);
    const blockedReason = ready
      ? null
      : row?.errorMessage
        ?? (!connected ? "Account is not linked" : null)
        ?? (!serverConfigured ? "Server credential is missing" : "Capability is not runnable");
    return {
      id,
      label,
      connected,
      ready,
      readiness: ready ? "runnable" : connected ? "linked_blocked" : "not_linked",
      status,
      blockedReason,
      lastCheckedAt: row?.lastCheckedAt ? row.lastCheckedAt.toISOString() : checkedAt,
    };
  });
}

function permissionCheck(enabled: boolean, permission: AndroidDaemonAction, checkedAt: string): RuntimeCapabilityCheck {
  if (enabled) return { status: "ready", lastCheckedAt: checkedAt };
  return {
    status: "disabled",
    reason: `${permission} permission is disabled.`,
    lastCheckedAt: checkedAt,
  };
}

function liveBooleanCheck(
  value: unknown,
  checkedAt: string,
  disabledReason: string,
  unknownReason: string,
): RuntimeCapabilityCheck {
  if (value === true) return { status: "ready", lastCheckedAt: checkedAt };
  if (value === false) return { status: "disabled", reason: disabledReason, lastCheckedAt: checkedAt };
  return { status: "unknown", reason: unknownReason, lastCheckedAt: checkedAt };
}

function boolFromLiveData(data: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

async function loadDeviceControlStateFromDaemon(userId: string, checkedAt: string): Promise<RuntimeCapabilityDeviceState> {
  const {
    getAndroidDaemonPermissions,
    getDaemonDeviceMeta,
    getDaemonLastSeen,
    getDaemonPermissions,
    isAndroidDaemonActive,
    isDesktopDaemonActive,
    pingAndroidDaemon,
  } = await import("../daemon/bridge");
  const desktopConnected = isDesktopDaemonActive(userId);
  const androidConnected = isAndroidDaemonActive(userId);
  const [desktopMeta, androidMeta, desktopPerms, androidPerms, desktopLastSeenAt, androidLastSeenAt] = await Promise.all([
    getDaemonDeviceMeta(userId, "desktop").catch(() => ({ hostname: null, platform: null })),
    getDaemonDeviceMeta(userId, "android").catch(() => ({ hostname: null, platform: null })),
    getDaemonPermissions(userId).catch(() => null),
    getAndroidDaemonPermissions(userId).catch(() => null),
    getDaemonLastSeen(userId, "desktop").catch(() => null),
    getDaemonLastSeen(userId, "android").catch(() => null),
  ]);

  const desktopPermissions = desktopPerms
    ? Object.entries(desktopPerms).filter(([, enabled]) => enabled).map(([name]) => name)
    : [];
  const androidPermissions = androidPerms ?? {
    android_open_app: false,
    android_browse: false,
    android_screenshot: false,
    android_read_screen: false,
    android_tap_type: false,
    android_camera: false,
    android_location: false,
    android_sms: false,
    android_screen_record: false,
    android_file_list: false,
    android_file_read: false,
    android_local_model: false,
  };

  let liveData: Record<string, unknown> = {};
  let liveError: string | null = null;
  if (androidConnected) {
    try {
      const ping = await pingAndroidDaemon(userId, 2500);
      if (ping.ok) liveData = ping.data && typeof ping.data === "object" ? ping.data as Record<string, unknown> : {};
      else liveError = ping.error ?? "Android daemon ping failed.";
    } catch (error) {
      liveError = error instanceof Error ? error.message : String(error);
    }
  }

  const liveUnknownReason = liveError
    ? `Live Android status check failed: ${liveError}`
    : "This Android daemon build did not report this runtime permission.";
  const offlineCheck: RuntimeCapabilityCheck = {
    status: "offline",
    reason: "Android Device Control is not connected.",
    lastCheckedAt: checkedAt,
  };

  const liveAccessibility = boolFromLiveData(liveData, ["accessibilityEnabled", "accessibilityServiceEnabled"]);
  const liveNotifications = boolFromLiveData(liveData, ["notificationListenerActive", "notificationAccessEnabled"]);
  const liveMicrophone = boolFromLiveData(liveData, ["microphonePermissionGranted", "micPermissionGranted", "recordAudioPermissionGranted"]);

  return {
    desktop: {
      connected: desktopConnected,
      hostname: desktopMeta.hostname,
      lastSeenAt: desktopLastSeenAt,
      permissions: desktopPermissions,
    },
    android: {
      connected: androidConnected,
      hostname: androidMeta.hostname,
      lastSeenAt: androidLastSeenAt,
      activeDevice: androidConnected ? androidMeta.hostname : null,
      permissions: {
        openApp: androidConnected ? permissionCheck(androidPermissions.android_open_app, "android_open_app", checkedAt) : offlineCheck,
        browse: androidConnected ? permissionCheck(androidPermissions.android_browse, "android_browse", checkedAt) : offlineCheck,
        screenCapture: androidConnected ? permissionCheck(androidPermissions.android_screenshot, "android_screenshot", checkedAt) : offlineCheck,
        readScreen: androidConnected ? permissionCheck(androidPermissions.android_read_screen, "android_read_screen", checkedAt) : offlineCheck,
        tapType: androidConnected ? permissionCheck(androidPermissions.android_tap_type, "android_tap_type", checkedAt) : offlineCheck,
        accessibility: androidConnected
          ? liveBooleanCheck(
            liveAccessibility,
            checkedAt,
            "Android accessibility service is disabled.",
            liveUnknownReason,
          )
          : offlineCheck,
        notificationAccess: androidConnected
          ? liveBooleanCheck(
            liveNotifications,
            checkedAt,
            "Android notification listener is disabled.",
            liveUnknownReason,
          )
          : offlineCheck,
        microphone: androidConnected
          ? liveBooleanCheck(
            liveMicrophone,
            checkedAt,
            "Android microphone permission is disabled.",
            liveUnknownReason,
          )
          : offlineCheck,
      },
    },
  };
}

function providerLabel(provider: string): string {
  switch (provider) {
    case "email": return "Email";
    case "google": return "Google";
    case "outlook": return "Outlook";
    case "runtime": return "Runtime";
    case "github": return "GitHub";
    case "memory": return "Memory";
    case "discord": return "Discord";
    case "telegram": return "Telegram";
    case "slack": return "Slack";
    case "whatsapp": return "WhatsApp";
    case "weather": return "Weather";
    default: return "Other";
  }
}

function toolCapabilityProvider(toolName: string, inferredProvider: string | undefined): string {
  if (/^(?:send_email|fetch_emails)$/i.test(toolName)) return "email";
  return inferredProvider ?? "other";
}

function buildToolGroups(routeToolNames: string[]): RuntimeCapabilityToolGroup[] {
  const groups = new Map<string, RuntimeCapabilityToolGroup>();
  for (const name of routeToolNames) {
    const descriptor = toolDescriptorFromAgentTool({ name });
    const provider = toolCapabilityProvider(name, descriptor.provider);
    const group = groups.get(provider) ?? {
      label: providerLabel(provider),
      provider,
      tools: [],
      approvalRequired: [],
    };
    group.tools.push(name);
    if (descriptor.approvalRequired) group.approvalRequired.push(name);
    groups.set(provider, group);
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export async function buildRuntimeCapabilityState(input: {
  userId: string;
  routeToolNames?: string[];
}, deps: RuntimeCapabilityStateDeps = {}): Promise<RuntimeCapabilityState> {
  const mergedDeps = { ...(runtimeCapabilityDepsForTesting ?? {}), ...deps };
  const checkedAt = (mergedDeps.now?.() ?? new Date()).toISOString();
  const [accounts, deviceControl] = await Promise.all([
    (mergedDeps.loadConnectedAccounts ?? loadConnectedAccountsFromDb)(input.userId, checkedAt),
    (mergedDeps.loadDeviceControlState ?? loadDeviceControlStateFromDaemon)(input.userId, checkedAt),
  ]);
  const uncertainty: string[] = [];
  const androidChecks = deviceControl.android.permissions;
  for (const [name, check] of Object.entries(androidChecks)) {
    if (check.status === "unknown") {
      uncertainty.push(`Android ${name} is unknown as of ${check.lastCheckedAt}: ${check.reason ?? "No reason reported."}`);
    }
  }
  return {
    userId: input.userId,
    checkedAt,
    accounts,
    toolGroups: buildToolGroups(input.routeToolNames ?? []),
    deviceControl,
    uncertainty,
  };
}

function providerTurnResult(
  text: string,
  route: FallbackChainEntry | undefined,
  runtimeExplanation?: RuntimeExplanation,
): ProviderTurnResult {
  const renderedText = runtimeExplanation ? renderRuntimeExplanation(runtimeExplanation) : text;
  return {
    textContent: renderedText,
    textChunks: [renderedText],
    toolCallList: [],
    finishReason: "stop",
    providerName: "jarvis-runtime",
    model: route?.model,
    fallbackUsed: false,
    runtimeExplanation,
  };
}

function renderAccountsAnswer(state: RuntimeCapabilityState): string {
  const connected = state.accounts.filter((account) => account.connected);
  const notConnected = state.accounts.filter((account) => !account.connected);
  const connectedText = connected.length > 0
    ? connected.map((account) => `${account.label}: connected${account.ready ? " and ready" : ` but blocked (${account.blockedReason ?? account.status})`}`).join("; ")
    : "No connected accounts are ready in capability state.";
  const notConnectedText = notConnected.length > 0
    ? `Not connected: ${notConnected.map((account) => `${account.label}: not connected`).join("; ")}.`
    : "All known accounts are connected or linked.";
  return `Connected accounts from JARVIS capability state: ${connectedText}. ${notConnectedText}`;
}

function renderEffectiveAndroidStatus(
  label: string,
  state: RuntimeCapabilityState,
  action: RuntimeCapabilityAndroidAction,
): string {
  const check = preflightRuntimeCapabilityAction(state, action);
  const reason = check.status === "ready" || !check.reason ? "" : ` (${check.reason})`;
  return `${label}: ${check.status}${reason}.`;
}

function renderDeviceControlAnswer(state: RuntimeCapabilityState): string {
  const android = state.deviceControl.android;
  const permissions = android.permissions;
  const activeDevice = android.activeDevice ? `; active device: ${android.activeDevice}` : "";
  const lastSeen = android.lastSeenAt ? `; last seen: ${android.lastSeenAt}` : "";
  return [
    `Android Device Control: ${android.connected ? "connected" : "not connected"}${activeDevice}${lastSeen}.`,
    `Accessibility: ${permissions.accessibility.status}.`,
    renderEffectiveAndroidStatus("Screen capture", state, "android_capture_screen"),
    renderEffectiveAndroidStatus("Read screen", state, "android_read_screen"),
    renderEffectiveAndroidStatus("Tap/type", state, "android_tap_type"),
    `Notification access: ${permissions.notificationAccess.status}.`,
    `Microphone: ${permissions.microphone.status}.`,
  ].join(" ");
}

const ACCOUNT_BACKED_TOOL_PROVIDERS = new Set(["google", "outlook", "github", "discord", "telegram", "slack", "whatsapp"]);

function renderEmailToolGroupLabel(accounts: RuntimeCapabilityAccount[]): string {
  const emailAccounts = accounts.filter((account) => account.id === "google" || account.id === "outlook");
  const ready = emailAccounts.filter((account) => account.ready);
  if (ready.length > 0) return `Email ready via ${ready.map((account) => account.label).join(" or ")}`;
  const connected = emailAccounts.filter((account) => account.connected);
  if (connected.length > 0) {
    return `Email blocked (${connected.map((account) => `${account.label}: ${account.blockedReason ?? account.status}`).join("; ")})`;
  }
  return "Email not connected";
}

function renderToolGroupLabel(group: RuntimeCapabilityToolGroup, accounts: RuntimeCapabilityAccount[]): string {
  if (group.provider === "email") return renderEmailToolGroupLabel(accounts);
  if (!ACCOUNT_BACKED_TOOL_PROVIDERS.has(group.provider)) return group.label;
  const account = accounts.find((candidate) => candidate.id === group.provider);
  if (!account) return `${group.label} not connected`;
  if (account.ready) return `${group.label} ready`;
  if (account.connected) return `${group.label} blocked (${account.blockedReason ?? account.status})`;
  return `${group.label} not connected`;
}

function renderToolsAnswer(state: RuntimeCapabilityState): string {
  const groupText = state.toolGroups.length > 0
    ? state.toolGroups.map((group) => `${renderToolGroupLabel(group, state.accounts)}: ${group.tools.join(", ")}`).join("; ")
    : "No tools are attached to this turn.";
  const androidText = state.deviceControl.android.connected ? "Android connected" : "Android not connected";
  return `Available tools from this route: ${groupText}. Device Control: ${androidText}.`;
}

export async function answerRuntimeCapabilityQuestion(input: {
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  userId?: string;
  route: FallbackChainEntry | undefined;
  routeToolNames?: string[];
}, deps: RuntimeCapabilityStateDeps = {}): Promise<ProviderTurnResult | null> {
  const intent = classifyRuntimeCapabilityIntent(input.messages);
  if (!intent) return null;

  const userId = input.userId?.trim();
  if (!userId) {
    const explanation = createRuntimeExplanation({
      title: "Authentication required",
      message: "Authentication/runtime error: Jarvis needs a signed-in user before answering connected account, tool, or device-control status.",
      severity: "error",
      attemptedSources: [runtimeSource("Diagnostics")],
    });
    return providerTurnResult(explanation.message, input.route, explanation);
  }

  let state: RuntimeCapabilityState;
  try {
    state = await buildRuntimeCapabilityState({ userId, routeToolNames: input.routeToolNames }, deps);
  } catch (error) {
    console.warn("[RuntimeCapability] capability state unavailable:", error);
    const explanation = createRuntimeExplanation({
      title: "Capability state unavailable",
      message: "Authentication/runtime error: Capability state is unavailable right now, so Jarvis cannot verify connected accounts, tools, or device control.",
      severity: "error",
      attemptedSources: [runtimeSource("Diagnostics")],
      actions: [{ id: "retry_capability_state", label: "Try again", kind: "retry" }],
    });
    return providerTurnResult(explanation.message, input.route, explanation);
  }

  if (intent === "accounts") {
    const message = renderAccountsAnswer(state);
    const explanation = createRuntimeExplanation({
      title: "Connected accounts",
      message,
      usedSources: [runtimeSource("Connector")],
    });
    return providerTurnResult(message, input.route, explanation);
  }
  if (intent === "device_control") {
    const message = renderDeviceControlAnswer(state);
    const explanation = createRuntimeExplanation({
      title: "Device control status",
      message,
      severity: state.uncertainty.length > 0 ? "warning" : "info",
      usedSources: [runtimeSource("Diagnostics")],
    });
    return providerTurnResult(message, input.route, explanation);
  }
  const message = renderToolsAnswer(state);
  const usedSources: RuntimeExplanationSource[] = [runtimeSource("Tool"), runtimeSource("Diagnostics")];
  if (state.accounts.length > 0) usedSources.push(runtimeSource("Connector"));
  const explanation = createRuntimeExplanation({
    title: "Available tools",
    message,
    severity: state.uncertainty.length > 0 ? "warning" : "info",
    usedSources,
  });
  return providerTurnResult(message, input.route, explanation);
}

export function explainRuntimeCapabilityPreflight(result: RuntimeCapabilityPreflightResult): RuntimeExplanation {
  if (result.ok) {
    return createRuntimeExplanation({
      title: "Capability ready",
      message: `${result.action} is ready: ${result.reason}`,
      usedSources: [runtimeSource("Diagnostics"), runtimeSource("Tool", result.action)],
    });
  }

  const needsSetup = result.status === "disabled" || result.status === "offline";
  return runtimeToolFailureExplanation({
    title: "Capability unavailable",
    toolLabel: result.action,
    reason: result.reason,
    actionId: needsSetup ? "check_setup" : "retry_capability",
    actionLabel: needsSetup ? "Check setup" : "Try again",
    actionKind: needsSetup ? "open_settings" : "retry",
    attemptedSources: [runtimeSource("Diagnostics"), runtimeSource("Tool", result.action)],
  });
}

function preflightCheckForAction(
  state: RuntimeCapabilityState,
  action: RuntimeCapabilityAndroidAction,
): RuntimeCapabilityCheck {
  const permissions = state.deviceControl.android.permissions;
  const accessibilityBacked = (check: RuntimeCapabilityCheck, capabilityName: string): RuntimeCapabilityCheck => {
    if (check.status !== "ready") return check;
    if (permissions.accessibility.status === "ready") return check;
    if (permissions.accessibility.status === "unknown") return check;
    return {
      status: permissions.accessibility.status,
      reason: permissions.accessibility.reason ?? `Android accessibility service is required for ${capabilityName}.`,
      lastCheckedAt: permissions.accessibility.lastCheckedAt ?? check.lastCheckedAt,
    };
  };
  const launchFallbackCapable = (check: RuntimeCapabilityCheck, capabilityName: string): RuntimeCapabilityCheck => {
    if (check.status !== "ready") return check;
    if (permissions.accessibility.status === "ready") return check;
    return {
      status: "ready",
      reason: `Android accessibility service is ${permissions.accessibility.status}; ${capabilityName} can only use the Android notification fallback and may need manual confirmation.`,
      lastCheckedAt: permissions.accessibility.lastCheckedAt ?? check.lastCheckedAt,
    };
  };

  switch (action) {
    case "android_open_app":
      return launchFallbackCapable(permissions.openApp, "android_open_app");
    case "android_browse":
      return launchFallbackCapable(permissions.browse, "android_browse");
    case "android_capture_screen":
      return accessibilityBacked(permissions.screenCapture, "android_capture_screen");
    case "android_read_screen":
      return accessibilityBacked(permissions.readScreen, "android_read_screen");
    case "android_tap_type":
      return accessibilityBacked(permissions.tapType, "android_tap_type");
    case "android_read_notifications":
      if (permissions.notificationAccess.status === "ready") return permissions.notificationAccess;
      if (permissions.readScreen.status === "ready" && permissions.tapType.status === "ready") {
        const accessibilityCheck = accessibilityBacked(permissions.readScreen, "android_read_notifications");
        if (accessibilityCheck.status !== "ready") return accessibilityCheck;
        return {
          status: "ready",
          reason: "Notification listener is unavailable, but the accessibility fallback is ready.",
          lastCheckedAt: permissions.notificationAccess.lastCheckedAt,
        };
      }
      if (permissions.readScreen.status !== "ready") return permissions.readScreen;
      return permissions.tapType;
  }
}

export function preflightRuntimeCapabilityAction(
  state: RuntimeCapabilityState,
  action: RuntimeCapabilityAndroidAction,
): RuntimeCapabilityPreflightResult {
  if (!state.deviceControl.android.connected) {
    return {
      ok: false,
      source: "runtime_capability_state",
      status: "offline",
      reason: "Android Device Control is not connected.",
      lastCheckedAt: state.checkedAt,
      action,
    };
  }

  const check = preflightCheckForAction(state, action);
  if (check.status === "ready") {
    return {
      ok: true,
      source: "runtime_capability_state",
      status: "ready",
      reason: check.reason ?? "Capability is ready.",
      lastCheckedAt: check.lastCheckedAt,
      action,
    };
  }

  return {
    ok: false,
    source: "runtime_capability_state",
    status: check.status,
    reason: check.reason ?? `Required Android capability is ${check.status}.`,
    lastCheckedAt: check.lastCheckedAt,
    action,
  };
}

export async function preflightAndroidRuntimeCapabilityAction(
  userId: string,
  action: RuntimeCapabilityAndroidAction,
): Promise<RuntimeCapabilityPreflightResult> {
  const state = await buildRuntimeCapabilityState({ userId });
  return preflightRuntimeCapabilityAction(state, action);
}
