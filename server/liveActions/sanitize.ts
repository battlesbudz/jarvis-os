import { redactRuntimeValue } from "../core/protocol";

const SAFE_METADATA_KEYS = new Set([
  "artifactId",
  "deliverableId",
  "gateId",
  "phase",
  "projectId",
  "retryAttempt",
  "sourceStatus",
  "workerType",
]);

const RAW_COMMAND_PATTERN = /^\s*(?:\$|>|sudo\b|rm\b|cp\b|mv\b|chmod\b|chown\b|curl\b|wget\b|ssh\b|git\s+(?:clone|push|reset|checkout)\b|npm\s+(?:run|exec)\b|npx\b|powershell\b|cmd(?:\.exe)?\b)/i;

export function sanitizeLiveActionText(value: unknown, maxLength = 500): string | null {
  if (typeof value !== "string") return null;
  let text = value
    .replace(/<(?:thinking|analysis|reasoning)>[\s\S]*?<\/(?:thinking|analysis|reasoning)>/gi, "[reasoning redacted]")
    .replace(/\b(?:chain[- ]of[- ]thought|hidden reasoning|internal reasoning|model thoughts?)\s*:[\s\S]*/gi, "[reasoning redacted]")
    .replace(/\b(?:authorization|proxy-authorization)\s*:\s*[^\r\n]+/gi, "authorization: [redacted]")
    .replace(/\b(?:cookie|set-cookie)\s*[:=]\s*[^\r\n]+/gi, "cookie: [redacted]")
    .replace(/\bcommand failed\s*:\s*[^\r\n]*/gi, "Command failed: [redacted]")
    .replace(/\b(?:shell\s+)?command\s*:\s*[^\r\n]+/gi, "command: [redacted]")
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s\/:@]+:[^\s\/@]+@/gi, "$1[credentials redacted]@")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|gh[pousr]|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b/g, "[redacted token]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted token]")
    .replace(/\\?(["'])((?:[A-Za-z0-9]+[_-])*(?:(?:access|refresh|id|oauth)[_-]?token|client[_-]?secret|token|api[_-]?key|secret(?:[_-]?access[_-]?key)?|password|database[_-]?url))\\?\1\s*:\s*\\?(["'])[^"'\r\n]*\\?\3/gi, "$1$2$1:$3[redacted]$3")
    .replace(/\b((?:[A-Za-z0-9]+[_-])*(?:(?:access|refresh|id|oauth)[_-]?token|client[_-]?secret|token|api[_-]?key|secret(?:[_-]?access[_-]?key)?|password|database[_-]?url))\s*[=:]\s*[^\s,;&]+/gi, "$1=[redacted]")
    .replace(/(?:[A-Za-z]:\\Users\\[^\\\s]+|\/(?:Users|home)\/[^/\s]+|\/root)(?:[\\/][^\s,;]*)?/g, "[private path]")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return null;
  if (RAW_COMMAND_PATTERN.test(text)) text = "[command redacted]";
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

export function sanitizeLiveActionMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const safeEntries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => SAFE_METADATA_KEYS.has(key))
    .slice(0, 12)
    .map(([key, child]) => {
      const redacted = redactRuntimeValue(child);
      if (typeof redacted === "string") return [key, sanitizeLiveActionText(redacted, 200)];
      if (typeof redacted === "number" || typeof redacted === "boolean" || redacted === null) return [key, redacted];
      return [key, undefined];
    })
    .filter((entry) => entry[1] !== undefined);
  return Object.fromEntries(safeEntries);
}
