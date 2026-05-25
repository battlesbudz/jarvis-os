import type { OneApiStatus } from "./oneApiConnection";
import type { OneCliSetupStatus } from "./oneCliConnection";

export const ONE_CONNECTION_PLATFORMS = [
  "gmail",
  "google-calendar",
  "outlook-mail",
  "outlook-calendar",
  "slack",
  "discord",
  "whatsapp",
] as const;

export type OneConnectionPlatform = typeof ONE_CONNECTION_PLATFORMS[number];

const PLATFORM_LABELS: Record<OneConnectionPlatform, string> = {
  gmail: "Gmail",
  "google-calendar": "Google Calendar",
  "outlook-mail": "Outlook Mail",
  "outlook-calendar": "Outlook Calendar",
  slack: "Slack",
  discord: "Discord",
  whatsapp: "WhatsApp",
};

const RISKY_ACTION_WORDS = [
  "send",
  "delete",
  "remove",
  "trash",
  "post",
  "publish",
  "update",
  "patch",
  "modify",
  "write",
  "calendar-write",
  "calendar_write",
  "createevent",
  "create_event",
  "events.create",
  "events.update",
  "calendar.create",
  "calendar.update",
  "chat.postmessage",
];

const PROPOSAL_ACTION_WORDS = ["draft", "create", "insert", "compose", "proposal"];
const READ_ACTION_WORDS = ["get", "list", "read", "search", "find", "fetch", "lookup", "query"];

export type OneActionPermission = {
  level: "read" | "proposal" | "write";
  approvalRequired: boolean;
  reason: string;
};

export type OneConnectionCenterStatus = OneApiStatus;

export function isOneConnectionPlatform(value: string): value is OneConnectionPlatform {
  return (ONE_CONNECTION_PLATFORMS as readonly string[]).includes(value);
}

function normalizeActionId(actionId: string): string {
  return actionId.toLowerCase().replace(/\s+/g, "_");
}

export function classifyOneActionPermission(_platform: string, actionId: string): OneActionPermission {
  const normalized = normalizeActionId(actionId);
  if (RISKY_ACTION_WORDS.some((word) => normalized.includes(word))) {
    return {
      level: "write",
      approvalRequired: true,
      reason: "This action can send, delete, post, or update an external account.",
    };
  }
  if (PROPOSAL_ACTION_WORDS.some((word) => normalized.includes(word))) {
    return {
      level: "proposal",
      approvalRequired: true,
      reason: "This action creates a draft or proposal and needs user approval first.",
    };
  }
  if (READ_ACTION_WORDS.some((word) => normalized.includes(word))) {
    return {
      level: "read",
      approvalRequired: false,
      reason: "Read-only One actions are allowed without an approval gate.",
    };
  }
  return {
    level: "proposal",
    approvalRequired: true,
    reason: "Jarvis could not prove this One action is read-only.",
  };
}

export function buildOneStatusResponse(status: OneApiStatus): OneConnectionCenterStatus {
  return {
    apiKeyConfigured: Boolean(status.apiKeyConfigured),
    apiKeyPreview: status.apiKeyPreview,
    installed: Boolean(status.installed),
    authenticated: Boolean(status.authenticated),
    ready: Boolean(status.ready),
    command: status.command || "one",
    dashboardUrl: status.dashboardUrl,
    accountEmail: status.accountEmail,
    accountName: status.accountName,
    connections: status.connections,
    nextSteps: status.nextSteps,
    error: status.error,
  };
}

function withConnectionParam(dashboardUrl: string, platform: OneConnectionPlatform): string | null {
  if (!dashboardUrl) return null;
  try {
    const url = new URL(dashboardUrl);
    url.searchParams.set("connection", platform);
    return url.toString();
  } catch {
    return null;
  }
}

export function buildOneConnectIntent(platform: OneConnectionPlatform, status: OneCliSetupStatus) {
  const label = PLATFORM_LABELS[platform];
  const dashboardUrl = withConnectionParam(status.dashboardUrl, platform);
  const cliFallbackCommand = `${status.command || "one"} add ${platform}`;
  return {
    platform,
    label,
    recommendedAction: `Developer fallback for ${label}`,
    dashboardUrl,
    cliFallbackCommand,
    setupInstructions: [
      "Normal users should paste a One API key from One API Keys in Connection Center.",
      `Developer fallback only: copy and run "${cliFallbackCommand}" if API-key mode is unavailable.`,
      "After a developer fallback connection finishes, return to Jarvis and tap Refresh.",
    ],
  };
}

export function buildOneTestResponse(status: OneConnectionCenterStatus) {
  const results = status.connections.map((connection) => {
    const ok = connection.state === "operational" || connection.state === "connected" || connection.state === "ready";
    const platform = connection.platform || "unknown";
    return {
      platform,
      label: PLATFORM_LABELS[platform as OneConnectionPlatform] || connection.label || platform,
      accountEmail: connection.accountEmail || null,
      ok,
      status: connection.state || "unknown",
      message: ok
        ? `${connection.label || platform} is connected and ready.`
        : `${connection.label || platform} is present but needs attention: ${connection.state || "unknown"}.`,
    };
  });
  const readyCount = results.filter((result) => result.ok).length;
  return {
    ok: status.apiKeyConfigured && status.authenticated && results.length > 0 && readyCount === results.length,
    summary: !status.apiKeyConfigured
      ? "Add a One API key before testing connected accounts."
      : results.length === 0
        ? "The One API key works, but no connected accounts were found yet."
        : `${readyCount} of ${results.length} connected accounts are ready.`,
    results,
    nextSteps: status.nextSteps,
    error: status.error,
  };
}
