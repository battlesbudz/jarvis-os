import type { AgentTool, ToolResult } from "../types";
import { db } from "../../db";
import { eq } from "drizzle-orm";
import { userPreferences } from "@shared/schema";
import { promises as dns } from "dns";

export interface OpenClawBridgeConfig {
  mode: "telegram" | "gateway";
  telegramChatId?: string;
  gatewayUrl?: string;
  gatewayToken?: string;
  enabled: boolean;
  timeoutMinutes?: number;
}

// ── Pending delegation store ─────────────────────────────────────────────────
// Keyed by userId.  Resolved by telegramRoutes.ts when a message arrives
// from the configured OpenClaw chat that is a Telegram reply to sentMessageId.
export interface PendingDelegation {
  chatId: string;
  sentMessageId: number | null; // message_id we sent — primary reply_to correlation
  nonce: string;                // embedded nonce — secondary correlation if no reply_to
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export const pendingOpenClawDelegations = new Map<string, PendingDelegation>();

// ── Gateway response types ───────────────────────────────────────────────────
interface GatewayImmediateResponse {
  result?: string;
  output?: string;
  content?: string;
  message?: string;
  status?: string;
}

interface GatewayJobResponse {
  id?: string;
  job_id?: string;
  task_id?: string;
  status?: "queued" | "running" | "complete" | "done" | "finished" | "error" | "failed" | string;
  result?: string | object;
  error?: string | object;
}

// ── SSRF protection ──────────────────────────────────────────────────────────
// Two-layer: (1) literal IP/hostname patterns, (2) DNS resolution to catch
// public hostnames resolving to private/internal IPs.
const PRIVATE_IP_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^::1$/,
  /^fc[0-9a-f]{2}:/i,
  /^fe80:/i,
  /^0\.0\.0\.0$/,
];
const PRIVATE_HOSTNAMES = /^(localhost|.*\.local|.*\.internal|.*\.corp|.*\.intranet)$/i;

function isPrivateIp(ip: string): boolean {
  return PRIVATE_IP_RANGES.some((re) => re.test(ip));
}

async function validateGatewayUrl(
  raw: string
): Promise<{ ok: true; url: URL } | { ok: false; error: string }> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: "Gateway URL is not a valid URL." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Gateway URL must use http or https." };
  }
  const host = parsed.hostname;

  // Layer 1: literal hostname/IP check
  if (isPrivateIp(host) || PRIVATE_HOSTNAMES.test(host)) {
    return {
      ok: false,
      error:
        "Gateway URL points to a private/loopback address. Use a public tunnel URL (ngrok, Cloudflare Tunnel, Tailscale funnel).",
    };
  }

  // Layer 2: DNS resolution — resolve and block if any address is private
  try {
    let addresses: string[] = [];
    try {
      addresses = await dns.resolve(host);
    } catch {
      const v4 = await dns.resolve4(host).catch(() => [] as string[]);
      const v6 = await dns.resolve6(host).catch(() => [] as string[]);
      addresses = [...v4, ...v6];
    }
    if (addresses.length === 0) {
      return {
        ok: false,
        error: `Cannot resolve gateway hostname "${host}". Ensure the tunnel is active.`,
      };
    }
    for (const addr of addresses) {
      if (isPrivateIp(addr)) {
        return {
          ok: false,
          error: `Gateway hostname "${host}" resolves to a private IP (${addr}). SSRF protection requires a public gateway address.`,
        };
      }
    }
  } catch {
    return {
      ok: false,
      error: `Cannot resolve gateway hostname "${host}". Ensure the tunnel is active.`,
    };
  }

  return { ok: true, url: parsed };
}

// ── Nonce ────────────────────────────────────────────────────────────────────
// Short random ID embedded in the sent task message so OpenClaw can echo it
// back as a deterministic secondary correlation key (in case it doesn't
// reply as a Telegram threaded reply to the original message_id).
function generateNonce(): string {
  return Math.random().toString(36).slice(2, 9).toUpperCase();
}

// ── Config helper ────────────────────────────────────────────────────────────
export async function getOpenClawConfig(userId: string): Promise<OpenClawBridgeConfig | null> {
  try {
    const rows = await db
      .select({ data: userPreferences.data })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);
    const prefs = (rows[0]?.data as Record<string, unknown>) ?? {};
    const cfg = prefs.openclawBridge as OpenClawBridgeConfig | undefined;
    if (!cfg || !cfg.enabled) return null;
    return cfg;
  } catch {
    return null;
  }
}

// ── Tool resolver injection ───────────────────────────────────────────────────
// Populated by index.ts after all tools are registered to avoid circular imports.
// Used by openclawTestTool to look up live registered tools by name.
let _toolResolver: ((name: string) => AgentTool | undefined) | null = null;
export function initOpenClawToolResolver(resolver: (name: string) => AgentTool | undefined): void {
  _toolResolver = resolver;
}

// ── Result helpers ───────────────────────────────────────────────────────────
function ok(content: string, label?: string, detail?: string): ToolResult {
  return { ok: true, content, label, detail };
}
function fail(content: string, label?: string): ToolResult {
  return { ok: false, content, label };
}

// ── openclaw_delegate tool ───────────────────────────────────────────────────
export const openclawDelegateTool: AgentTool = {
  name: "openclaw_delegate",
  description:
    "Delegate a task to OpenClaw — a locally-running AI agent on the user's machine with full computer-use capabilities: shell execution, browser control, code running, vibe coding (building apps), file operations, and multi-model reasoning. Use this when the user asks to: run or write code, execute shell commands, control the browser, build a new app, create a Replit project, or do anything that requires local compute. Returns OpenClaw's result once the task is complete.",
  parameters: {
    type: "object",
    properties: {
      task: {
        type: "string",
        description:
          "The full task description for OpenClaw. Be specific and include all context — OpenClaw will act on exactly this message.",
      },
      timeout_minutes: {
        type: "number",
        description:
          "Max minutes to wait for a result. Defaults to the user's configured timeout (or 10 if not set). Max 30. For long build tasks, use a higher value.",
      },
    },
    required: ["task"],
  },
  async execute(args, ctx): Promise<ToolResult> {
    const task = String(args.task ?? "").trim();
    if (!task) return fail("task argument is required.");

    const userId = ctx.userId;
    const cfg = await getOpenClawConfig(userId);

    if (!cfg) {
      return fail(
        "OpenClaw bridge is not configured or disabled. Go to Settings → OpenClaw Brain to set up the connection.",
        "openclaw_not_configured"
      );
    }

    const SERVER_MAX_TIMEOUT_MINUTES = 30;
    const userDefaultTimeout = Math.max(1, Math.min(Number(cfg.timeoutMinutes) || 10, SERVER_MAX_TIMEOUT_MINUTES));
    const rawOverride = Number(args.timeout_minutes);
    const effectiveMinutes = rawOverride > 0
      ? Math.max(1, Math.min(rawOverride, SERVER_MAX_TIMEOUT_MINUTES))
      : userDefaultTimeout;
    const timeoutMs = effectiveMinutes * 60 * 1000;

    // Guard: reject if there's already a pending delegation for this user.
    if (pendingOpenClawDelegations.has(userId)) {
      return fail(
        "A delegation to OpenClaw is already in progress for your account. Wait for it to complete (or timeout) before sending another task.",
        "openclaw_delegation_in_progress"
      );
    }

    // ── Telegram mode ─────────────────────────────────────────────────────
    if (cfg.mode === "telegram") {
      const chatId = cfg.telegramChatId?.trim();
      if (!chatId) {
        return fail(
          "Telegram chat ID is not set. Configure it in Settings → OpenClaw Brain.",
          "openclaw_telegram_no_chatid"
        );
      }

      // Generate a per-request nonce and embed it in the task message.
      // telegramRoutes.ts resolves the pending delegation when it receives a
      // message from the same chatId that satisfies EITHER:
      //   (A) reply_to_message.message_id === sentMessageId  [primary — standard reply]
      //   (B) text contains the embedded correlation tag [OC:{nonce}]  [secondary]
      // Both are explicit correlation keys; arbitrary unrelated messages are rejected.
      const nonce = generateNonce();
      const sentText =
        `[JARVIS→OPENCLAW] ref:${nonce}\n${task}\n\n` +
        `(Reply to this message, or start your response with [OC:${nonce}])`;

      const sentResult = await sendMessageWithId(chatId, sentText);
      if (!sentResult) {
        return fail(
          "Failed to send task to OpenClaw via Telegram — bot token may be missing or chat ID is incorrect. Check Settings → OpenClaw Brain.",
          "openclaw_telegram_send_failed"
        );
      }

      // Await a correlated reply.  The existing Telegram poller (processUpdate)
      // checks every incoming message against pendingOpenClawDelegations and
      // resolves this Promise when a matching message arrives.
      let replyText: string;
      try {
        replyText = await new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => {
            pendingOpenClawDelegations.delete(userId);
            reject(
              new Error(
                `OpenClaw did not reply within ${Math.round(timeoutMs / 60000)} minutes. ` +
                  `The task was sent (message_id=${sentResult.message_id}, nonce=${nonce}). ` +
                  `Check your Telegram chat for partial output.`
              )
            );
          }, timeoutMs);

          pendingOpenClawDelegations.set(userId, {
            chatId,
            sentMessageId: sentResult.message_id,
            nonce,
            resolve: (text: string) => {
              clearTimeout(timer);
              resolve(text);
            },
            reject: (err: Error) => {
              clearTimeout(timer);
              reject(err);
            },
            timer,
          });
        });
      } catch (err) {
        return fail(
          err instanceof Error ? err.message : String(err),
          "openclaw_telegram_timeout"
        );
      }

      return ok(replyText, "openclaw_delegate", `telegram/message_id=${sentResult.message_id}`);
    }

    // ── Gateway mode ──────────────────────────────────────────────────────
    if (cfg.mode === "gateway") {
      const rawUrl = cfg.gatewayUrl?.trim();
      if (!rawUrl) {
        return fail(
          "Gateway URL is not set. Configure it in Settings → OpenClaw Brain.",
          "openclaw_gateway_no_url"
        );
      }

      const urlCheck = await validateGatewayUrl(rawUrl);
      if (!urlCheck.ok) {
        return fail(`Gateway URL rejected: ${urlCheck.error}`, "openclaw_ssrf_blocked");
      }
      const gatewayBase = rawUrl.replace(/\/$/, "");

      // Send token in both Authorization header AND body per spec ({ message, token })
      const authHeaders: Record<string, string> = cfg.gatewayToken
        ? { Authorization: `Bearer ${cfg.gatewayToken}` }
        : {};
      const bodyPayload: Record<string, string> = { message: task };
      if (cfg.gatewayToken) bodyPayload.token = cfg.gatewayToken;

      let response: Response;
      try {
        response = await fetch(`${gatewayBase}/api/v1/message`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify(bodyPayload),
          signal: AbortSignal.timeout(30_000),
        });
      } catch (err) {
        return fail(
          `Could not reach OpenClaw gateway at ${rawUrl}: ${err instanceof Error ? err.message : String(err)}. Make sure your tunnel (ngrok/Cloudflare/Tailscale) is active.`,
          "openclaw_gateway_unreachable"
        );
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        return fail(
          `OpenClaw gateway returned HTTP ${response.status}: ${body.slice(0, 300)}`,
          "openclaw_gateway_http_error"
        );
      }

      const contentType = response.headers.get("content-type") ?? "";

      // SSE streaming
      if (contentType.includes("text/event-stream")) {
        const reader = response.body?.getReader();
        if (!reader) {
          return fail(
            "Gateway returned SSE stream but body is unreadable.",
            "openclaw_sse_error"
          );
        }
        const decoder = new TextDecoder();
        const chunks: string[] = [];
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const { done, value } = await reader
            .read()
            .catch(() => ({ done: true as const, value: undefined }));
          if (done) break;
          if (value) {
            const chunk = decoder.decode(value);
            for (const line of chunk.split("\n")) {
              if (line.startsWith("data:")) {
                const payload = line.slice(5).trim();
                if (payload && payload !== "[DONE]") chunks.push(payload);
              }
            }
          }
        }
        reader.cancel().catch(() => {});
        const result = chunks.join("");
        return ok(result || "(empty SSE stream from OpenClaw)", "openclaw_delegate", "gateway/sse");
      }

      // JSON — either immediate result or async job stub
      const data = (await response.json().catch(() => null)) as
        | GatewayImmediateResponse
        | GatewayJobResponse
        | null;

      // Detect async job
      const jobData = data as GatewayJobResponse | null;
      const jobId =
        jobData?.job_id ??
        jobData?.task_id ??
        ((jobData?.status === "queued" || jobData?.status === "running")
          ? jobData?.id
          : undefined);

      if (jobId) {
        const deadline = Date.now() + timeoutMs;

        // Per spec: first try /api/v1/events SSE stream for real-time results.
        // Fall back to polling /api/v1/jobs/{jobId} every 15s if events unavailable.
        const eventsUrl = `${gatewayBase}/api/v1/events?job_id=${encodeURIComponent(String(jobId))}`;
        let usedSse = false;
        try {
          const eventsRes = await fetch(eventsUrl, {
            method: "GET",
            headers: { Accept: "text/event-stream", ...authHeaders },
            signal: AbortSignal.timeout(8_000), // 8s to establish the SSE stream
          });
          if (eventsRes.ok && eventsRes.headers.get("content-type")?.includes("text/event-stream")) {
            usedSse = true;
            const evReader = eventsRes.body?.getReader();
            if (evReader) {
              const decoder = new TextDecoder();
              const chunks: string[] = [];
              while (Date.now() < deadline) {
                const { done, value } = await evReader
                  .read()
                  .catch(() => ({ done: true as const, value: undefined }));
                if (done) break;
                if (value) {
                  const chunk = decoder.decode(value);
                  for (const line of chunk.split("\n")) {
                    if (line.startsWith("data:")) {
                      const payload = line.slice(5).trim();
                      if (payload === "[DONE]") {
                        evReader.cancel().catch(() => {});
                        return ok(chunks.join(""), "openclaw_delegate", `gateway/events/${jobId}`);
                      }
                      if (payload) chunks.push(payload);
                    }
                  }
                }
              }
              evReader.cancel().catch(() => {});
              if (chunks.length > 0) {
                return ok(chunks.join(""), "openclaw_delegate", `gateway/events/${jobId}`);
              }
            }
          }
        } catch {
          // Events endpoint not available — fall through to polling
        }

        // Polling fallback: check /api/v1/jobs/{jobId} every 15s
        const pollUrl = `${gatewayBase}/api/v1/jobs/${jobId}`;
        let lastData: GatewayJobResponse | null = data as GatewayJobResponse;
        while (Date.now() < deadline) {
          await new Promise<void>((r) => setTimeout(r, 15_000)); // poll every 15s per spec
          try {
            const pollRes = await fetch(pollUrl, {
              method: "GET",
              headers: { "Content-Type": "application/json", ...authHeaders },
              signal: AbortSignal.timeout(15_000),
            });
            if (!pollRes.ok) break;
            lastData = (await pollRes.json()) as GatewayJobResponse;
            const status = lastData?.status;
            if (
              status === "complete" ||
              status === "done" ||
              status === "finished" ||
              lastData?.result !== undefined
            ) {
              const raw = lastData?.result;
              const resultStr = typeof raw === "string" ? raw : JSON.stringify(raw);
              return ok(resultStr, "openclaw_delegate", `gateway/${usedSse ? "events-fallback" : "job"}/${jobId}`);
            }
            if (status === "error" || status === "failed") {
              const raw = lastData?.error;
              const errStr = typeof raw === "string" ? raw : JSON.stringify(raw);
              return fail(errStr, "openclaw_job_failed");
            }
          } catch {
            break;
          }
        }

        return fail(
          `OpenClaw job ${jobId} did not complete within ${Math.round(timeoutMs / 60000)} minutes. Last status: ${JSON.stringify(lastData)}`,
          "openclaw_job_timeout"
        );
      }

      // Immediate result
      const immData = data as GatewayImmediateResponse | null;
      const immediateResult =
        immData?.result ??
        immData?.output ??
        immData?.content ??
        immData?.message ??
        (data !== null ? JSON.stringify(data) : "(empty response from OpenClaw)");
      return ok(
        typeof immediateResult === "string" ? immediateResult : JSON.stringify(immediateResult),
        "openclaw_delegate",
        "gateway/immediate"
      );
    }

    return fail(`Unknown bridge mode: ${String((cfg as OpenClawBridgeConfig).mode)}`);
  },
};

// ── Code application helpers ──────────────────────────────────────────────────

function toCamelCase(snake: string): string {
  return snake.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Scans OpenClaw's response for labelled code blocks.
 * Returns a map of normalised file path → file content.
 * Looks for headings / bold text mentioning a file path immediately preceding each block.
 */
function extractNamedCodeBlocks(text: string): Map<string, string> {
  const result = new Map<string, string>();
  const codeBlockRe = /```(?:\w+)?\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRe.exec(text)) !== null) {
    const code = match[1];
    const blockStart = match.index;
    const preceding = text.slice(Math.max(0, blockStart - 700), blockStart);

    // Patterns: "File: path", "**`path`**", "## path", "`path`:"
    const filePathRe =
      /(?:(?:file|path|filename)[:\s`*_]+([a-zA-Z0-9_\-./]+\.(?:ts|js|json)))|`([a-zA-Z0-9_\-./]+\.(?:ts|js|json))`|#{1,4}\s+`?([a-zA-Z0-9_\-./]+\.(?:ts|js|json))`?/gi;
    let lastFilePath: string | null = null;
    let fm: RegExpExecArray | null;
    while ((fm = filePathRe.exec(preceding)) !== null) {
      lastFilePath = fm[1] ?? fm[2] ?? fm[3];
    }

    if (lastFilePath) {
      result.set(lastFilePath.replace(/^\.\//, ""), code);
    }
  }

  return result;
}

interface ApplyResult {
  applied: string[];
  warnings: string[];
}

/**
 * Applies OpenClaw-built code directly to the codebase:
 *   1. Writes the new tool file (and optional route file) to disk.
 *   2. Programmatically patches server/agent/tools/index.ts:
 *      - adds the import at the top
 *      - adds the tool to ALL_TOOLS[]
 *      - adds the tool to telegramCoachTools()
 *      - adds the re-export at the bottom
 */
async function applyOpenClawBuildResult(
  featureName: string,
  openClawResponse: string,
  needsApiEndpoint: boolean
): Promise<ApplyResult> {
  const { promises: fs } = await import("fs");
  const path = await import("path");

  const applied: string[] = [];
  const warnings: string[] = [];

  const toolExportName = `${toCamelCase(featureName)}Tool`;
  const toolFilePath = `server/agent/tools/${featureName}.ts`;
  // Route files live at server/<featureName>Routes.ts — matching repo convention
  // (server/dataRoutes.ts, server/telegramRoutes.ts, etc.)
  const routeFilePath = `server/${featureName}Routes.ts`;

  const codeBlocks = extractNamedCodeBlocks(openClawResponse);

  // ── 1. Write tool file (independent step) ──────────────────────────────
  try {
    const toolCode = codeBlocks.get(toolFilePath);
    if (toolCode) {
      await fs.mkdir(path.resolve(process.cwd(), "server/agent/tools"), { recursive: true });
      await fs.writeFile(path.resolve(process.cwd(), toolFilePath), toolCode, "utf8");
      applied.push(toolFilePath);
    } else {
      warnings.push(
        `No code block found for ${toolFilePath}. Create the file manually from OpenClaw's output above.`
      );
    }
  } catch (err) {
    warnings.push(
      `Failed to write ${toolFilePath}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // ── 2. Write route file if requested (independent step) ─────────────────
  if (needsApiEndpoint) {
    try {
      // Accept either the canonical path or legacy "server/routes/<name>.ts"
      const routeCode =
        codeBlocks.get(routeFilePath) ??
        codeBlocks.get(`server/routes/${featureName}.ts`);
      if (routeCode) {
        await fs.mkdir(path.resolve(process.cwd(), "server"), { recursive: true });
        await fs.writeFile(path.resolve(process.cwd(), routeFilePath), routeCode, "utf8");
        applied.push(routeFilePath);
      } else {
        warnings.push(
          `No code block found for ${routeFilePath}. Add the Express route file manually and mount it in server/index.ts.`
        );
      }
    } catch (err) {
      warnings.push(
        `Failed to write ${routeFilePath}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // ── 3. Patch index.ts (independent step) ───────────────────────────────
  // Only patch index.ts if the tool file was actually written; patching index.ts
  // to import a file that does not exist would break the server on restart.
  const toolFileWritten = applied.includes(toolFilePath);
  if (!toolFileWritten) {
    warnings.push(
      `Skipping index.ts patch because ${toolFilePath} was not written — add registrations manually once the file exists.`
    );
  } else {
    try {
      const indexAbsPath = path.resolve(process.cwd(), "server/agent/tools/index.ts");
      let idx = await fs.readFile(indexAbsPath, "utf8");
      let indexModified = false;

      // Determine the actual exported constant name from the written tool file.
      // OpenClaw may use a slightly different casing; parse the real symbol first.
      // Falls back to the convention-derived name if parsing fails.
      let actualExportName = toolExportName;
      try {
        const writtenCode = await fs.readFile(
          path.resolve(process.cwd(), toolFilePath),
          "utf8"
        );
        const exportMatch = writtenCode.match(/^export const (\w+)\s*:\s*AgentTool/m);
        if (exportMatch?.[1]) {
          actualExportName = exportMatch[1];
          if (actualExportName !== toolExportName) {
            warnings.push(
              `OpenClaw used export name \`${actualExportName}\` (expected \`${toolExportName}\`). Registering with actual name.`
            );
          }
        }
      } catch {
        // Non-fatal: fall back to convention-derived name
      }

      // a) Import — idempotent: only add if not already present
      const importLine = `import { ${actualExportName} } from "./${featureName}";`;
      if (!idx.includes(`from "./${featureName}"`)) {
        const lastImportPos = idx.lastIndexOf("\nimport ");
        if (lastImportPos !== -1) {
          const lineEnd = idx.indexOf("\n", lastImportPos + 1);
          if (lineEnd !== -1) {
            idx = idx.slice(0, lineEnd) + "\n" + importLine + idx.slice(lineEnd);
            indexModified = true;
          }
        } else {
          warnings.push("Could not locate last import line in index.ts — add the import manually.");
        }
      }

      // b) ALL_TOOLS array — anchored to the `export const ALL_TOOLS` declaration
      // to avoid mis-targeting other arrays or closing brackets in the file.
      if (!idx.includes(`${actualExportName},`) && !idx.includes(`${actualExportName}\n`)) {
        const allToolsDecl = idx.indexOf("export const ALL_TOOLS");
        if (allToolsDecl !== -1) {
          const allToolsClose = idx.indexOf("\n];", allToolsDecl);
          if (allToolsClose !== -1) {
            idx =
              idx.slice(0, allToolsClose) +
              `\n  ${actualExportName},` +
              idx.slice(allToolsClose);
            indexModified = true;
          } else {
            warnings.push(
              `Could not find ALL_TOOLS closing ]; in index.ts — add \`${actualExportName},\` manually.`
            );
          }
        } else {
          warnings.push(
            `Could not find ALL_TOOLS declaration in index.ts — add \`${actualExportName},\` manually.`
          );
        }
      }

      // c) telegramCoachTools() base array — scoped search after function declaration
      const tcFnIdx = idx.indexOf("telegramCoachTools(");
      if (tcFnIdx !== -1) {
        const tcClose = idx.indexOf("\n  ];", tcFnIdx);
        if (tcClose !== -1) {
          const tcSection = idx.slice(tcFnIdx, tcClose);
          if (!tcSection.includes(`${actualExportName},`) && !tcSection.includes(`${actualExportName}\n`)) {
            idx =
              idx.slice(0, tcClose) +
              `\n    ${actualExportName},` +
              idx.slice(tcClose);
            indexModified = true;
          }
        } else {
          warnings.push(
            `Could not find telegramCoachTools base array in index.ts — add \`${actualExportName},\` there manually.`
          );
        }
      }

      // d) Re-export block — anchored to the last `export {` block in the file
      const exportBlockStart = idx.lastIndexOf("export {");
      if (exportBlockStart !== -1) {
        const exportBlockClose = idx.indexOf("\n};", exportBlockStart);
        if (exportBlockClose !== -1) {
          const exportSection = idx.slice(exportBlockStart, exportBlockClose);
          if (!exportSection.includes(`${actualExportName},`) && !exportSection.includes(`${actualExportName}\n`)) {
            idx =
              idx.slice(0, exportBlockClose) +
              `\n  ${actualExportName},` +
              idx.slice(exportBlockClose);
            indexModified = true;
          }
        } else {
          warnings.push(
            `Could not find export block closing in index.ts — add \`${actualExportName},\` to the exports manually.`
          );
        }
      }

      if (indexModified) {
        await fs.writeFile(indexAbsPath, idx, "utf8");
        applied.push("server/agent/tools/index.ts");
      } else {
        warnings.push(`index.ts already contains ${actualExportName} entries — no changes made.`);
      }
    } catch (err) {
      warnings.push(
        `Failed to patch index.ts: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return { applied, warnings };
}

// ── openclaw_build_feature tool ──────────────────────────────────────────────
export const openclawBuildFeatureTool: AgentTool = {
  name: "openclaw_build_feature",
  description:
    "Ask OpenClaw to autonomously build a new Jarvis tool and integrate it into the codebase. Use this when the user wants to add a new capability to Jarvis itself — OpenClaw will write the TypeScript tool file, register it in the tool index, add any required API endpoint, and send the resulting code back. This is Jarvis's self-improvement loop.",
  parameters: {
    type: "object",
    properties: {
      feature_name: {
        type: "string",
        description:
          "Short snake_case name for the new tool, e.g. 'weather_lookup' or 'notion_create_page'. This becomes the tool filename and tool.name value.",
      },
      description: {
        type: "string",
        description:
          "Plain-English description of what the new tool should do, when Jarvis should use it, what inputs it accepts, and what it returns. Be specific — OpenClaw will implement exactly this.",
      },
      parameters_schema: {
        type: "string",
        description:
          "Optional JSON Schema (as a JSON string) describing the tool's parameters object. If omitted, OpenClaw will infer a sensible schema from the description.",
      },
      needs_api_endpoint: {
        type: "boolean",
        description:
          "Set to true if the tool requires a new Express REST endpoint on the Jarvis server (e.g. to expose data to the frontend). Defaults to false — most tools call external APIs directly.",
      },
      timeout_minutes: {
        type: "number",
        description: "Max minutes to wait for OpenClaw to finish building (default 15, max 15).",
      },
    },
    required: ["feature_name", "description"],
  },
  async execute(args, ctx): Promise<ToolResult> {
    const rawFeatureName = String(args.feature_name ?? "").trim().replace(/\s+/g, "_");
    const featureName = rawFeatureName.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
    const description = String(args.description ?? "").trim();

    if (!featureName) return fail("feature_name must be a non-empty snake_case identifier (letters, digits, underscores only).");
    if (!description) return fail("description argument is required.");

    const parametersSchema = args.parameters_schema ? String(args.parameters_schema).trim() : null;
    const needsApiEndpoint = Boolean(args.needs_api_endpoint ?? false);
    const timeoutMinutes = Math.max(1, Math.min(Number(args.timeout_minutes) || 15, 15));

    const toolSchemaExample = `
import type { AgentTool, ToolResult } from "../types";

export const exampleTool: AgentTool = {
  name: "example_tool",
  description: "What this tool does and when Jarvis should call it.",
  parameters: {
    type: "object",
    properties: {
      input: {
        type: "string",
        description: "The main input for the tool.",
      },
    },
    required: ["input"],
  },
  async execute(args, ctx): Promise<ToolResult> {
    const input = String(args.input ?? "").trim();
    if (!input) return { ok: false, content: "input is required." };

    // Implementation here
    return { ok: true, content: "Result from tool", label: "example_tool" };
  },
};
`.trim();

    const repoStructure = `
Jarvis repo key paths:
- server/agent/tools/<toolName>.ts         — one file per tool, exports a const of type AgentTool
- server/agent/tools/index.ts              — imports all tools and registers them in ALL_TOOLS array and telegramCoachTools()
- server/<featureName>Routes.ts            — Express route files live directly under server/ (e.g. server/dataRoutes.ts, server/telegramRoutes.ts)
- server/index.ts                          — mounts route files (register new router here if needed)
- shared/schema.ts                         — Drizzle ORM schema (add new DB table here if needed)
`.trim();

    const parametersSectionLines: string[] = [];
    if (parametersSchema) {
      parametersSectionLines.push(`\n## Requested Parameters Schema\n\`\`\`json\n${parametersSchema}\n\`\`\``);
    }

    const apiEndpointSection = needsApiEndpoint
      ? `\n## API Endpoint Required\nThis tool also needs a new Express REST endpoint. Create a route file at server/${featureName}Routes.ts (following the repo convention: server/dataRoutes.ts, server/telegramRoutes.ts, etc.), mount it in server/index.ts under /api/${featureName.replace(/_/g, "-")}, and label the code block with the file path \`server/${featureName}Routes.ts\`.`
      : "";

    const task = `[JARVIS SELF-IMPROVEMENT] Build a new Jarvis agent tool.

## Tool to build: \`${featureName}\`

## Description / behaviour
${description}
${parametersSectionLines.join("\n")}${apiEndpointSection}

## AgentTool TypeScript interface (must match exactly)
\`\`\`typescript
${toolSchemaExample}
\`\`\`

## Repo structure
${repoStructure}

## Your tasks — complete ALL of these:
1. Write the complete TypeScript source for \`server/agent/tools/${featureName}.ts\`. Export the tool as \`${featureName}Tool\` (camelCase). The file must compile without errors.
2. Show the exact line(s) to add to \`server/agent/tools/index.ts\`:
   a. The import statement at the top.
   b. The entry to add to the \`ALL_TOOLS\` array.
   c. The entry to add inside \`telegramCoachTools()\`.
   d. The re-export at the bottom of the file.
3. If an API endpoint is required, write the Express route file and the mount line for server/index.ts.
4. Reply with ALL file contents in clearly labelled code blocks so the code can be applied directly.

## Important constraints
- Do NOT use the uuid package (no crypto.getRandomValues in Node without polyfill). Use Math.random().toString(36) for IDs if needed.
- Keep the tool focused — do one thing well.
- Use async/await. Handle errors with \`return { ok: false, content: "..." }\` — never throw.
- The \`ctx\` parameter has shape \`{ userId: string; ... }\`.
- Do not add comments unless they explain non-obvious logic.`;

    // Delegate to openclaw_delegate with the structured prompt
    const delegateResult = await openclawDelegateTool.execute(
      { task, timeout_minutes: timeoutMinutes },
      ctx
    );

    if (!delegateResult.ok) {
      return delegateResult;
    }

    // ── Auto-apply: write files & patch index.ts ─────────────────────────
    let applyReport = "";
    try {
      const { applied, warnings } = await applyOpenClawBuildResult(
        featureName,
        delegateResult.content,
        needsApiEndpoint
      );

      const appliedLines =
        applied.length > 0
          ? `\n\n**Files written automatically:**\n${applied.map((f) => `- \`${f}\``).join("\n")}`
          : "";
      const warnLines =
        warnings.length > 0
          ? `\n\n**Warnings (manual action needed):**\n${warnings.map((w) => `- ${w}`).join("\n")}`
          : "";

      applyReport =
        applied.length > 0 || warnings.length > 0
          ? `${appliedLines}${warnLines}\n\n${applied.length > 0 ? "Restart the server for the new tool to become active." : ""}`
          : "";
    } catch (applyErr) {
      applyReport = `\n\n**Auto-apply failed:** ${applyErr instanceof Error ? applyErr.message : String(applyErr)}. Apply the code from OpenClaw's output above manually.`;
    }

    // Always attempt a deterministic smoke test after auto-apply.
    // - If the tool is registered (auto-applied successfully): executes it and
    //   returns the actual output.
    // - If not yet registered (code returned as text, not yet applied):
    //   openclawTestTool returns a clear "not registered" message with instructions.
    // Either way, the result is always included in the same response turn.
    //
    // We extend ctx.allowedToolNames to include the just-built tool name so the
    // per-surface access control check inside openclawTestTool does not block this
    // internal invocation — the test is explicitly scoped to what was just built.
    const ctxForSmokeTest = {
      ...ctx,
      allowedToolNames: ctx.allowedToolNames
        ? new Set([...ctx.allowedToolNames, featureName])
        : undefined,
    };

    console.log(`[OpenClaw] Running smoke test for tool "${featureName}" after build`);
    const smokeResult = await openclawTestTool.execute(
      { tool_name: featureName, test_args: "{}" },
      ctxForSmokeTest
    );

    const smokeNote = smokeResult.ok
      ? `\n\n---\nSmoke test: PASSED\nOutput: ${smokeResult.content}`
      : `\n\n---\nSmoke test: ${smokeResult.content}`;

    // ok reflects the smoke-test outcome so callers get a machine-readable
    // red/green signal. "Not yet registered" counts as non-fatal (smokeResult.ok
    // is false but the build itself succeeded — the content explains what to do next).
    return {
      ok: smokeResult.ok,
      content: delegateResult.content + applyReport + smokeNote,
      label: "openclaw_build_feature",
      detail: smokeResult.ok ? `Built and verified: ${featureName}` : `Built (test pending): ${featureName}`,
    };
  },
};

// ── openclaw_test_tool ───────────────────────────────────────────────────────
// Executes a registered tool by name with caller-supplied test args.
// Used as the final step of the self-improvement loop: after OpenClaw delivers
// new tool code and it has been applied to the codebase, call this to verify
// the tool runs without errors before telling the user it's ready.
export const openclawTestTool: AgentTool = {
  name: "openclaw_test_tool",
  description:
    "Run a smoke test against a registered Jarvis tool. Invokes the tool with the provided test arguments and reports whether it passed or failed. Use this after openclaw_build_feature to verify the new tool works before confirming to the user. If the tool is not yet registered (code hasn't been applied to the codebase), the test will report that clearly.",
  parameters: {
    type: "object",
    properties: {
      tool_name: {
        type: "string",
        description: "Exact name of the tool to test (the tool.name value, e.g. 'weather_lookup').",
      },
      test_args: {
        type: "string",
        description:
          "JSON object string of arguments to pass to the tool. Use safe, non-destructive dummy values. If omitted, an empty object is used.",
      },
    },
    required: ["tool_name"],
  },
  async execute(args, ctx): Promise<ToolResult> {
    const toolName = String(args.tool_name ?? "").trim();
    if (!toolName) return fail("tool_name is required.");

    // Guard: prevent self-invocation (infinite recursion).
    if (toolName === "openclaw_test_tool") {
      return fail("openclaw_test_tool cannot test itself.", "openclaw_test_tool");
    }

    // Guard: block meta/orchestration tools that must not be invoked indirectly
    // to prevent unintended side effects or prompt-injection escalation paths.
    const META_TOOLS = new Set([
      "openclaw_delegate",
      "openclaw_build_feature",
      "spawn_subagent",
      "queue_background_job",
    ]);
    if (META_TOOLS.has(toolName)) {
      return fail(
        `"${toolName}" is an orchestration tool and cannot be invoked via the smoke-test path.`,
        "openclaw_test_tool"
      );
    }

    // Guard: enforce per-surface access control.
    // ctx.allowedToolNames is populated by the harness to contain only the tools
    // visible in the current agent run. Anything outside that set cannot be tested
    // here, even if it exists in ALL_TOOLS, preventing surface-escaping.
    if (ctx.allowedToolNames && !ctx.allowedToolNames.has(toolName)) {
      return fail(
        `Tool "${toolName}" is not in the allowed tool set for this agent surface and cannot be tested here.`,
        "openclaw_test_tool"
      );
    }

    const testArgsRaw = String(args.test_args ?? "{}").trim();
    let testArgs: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(testArgsRaw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        testArgs = parsed as Record<string, unknown>;
      }
    } catch {
      return fail(`test_args is not valid JSON: ${testArgsRaw}`);
    }

    if (!_toolResolver) {
      return fail(
        "Tool resolver not initialized — server may be starting up. Try again in a moment.",
        "openclaw_test_tool"
      );
    }
    const tool = _toolResolver(toolName);
    if (!tool) {
      return fail(
        `Tool "${toolName}" is not registered in the live server. ` +
          "Apply the code that OpenClaw built to the codebase (add the tool file and register it in index.ts), " +
          "then restart the server so it appears in the registry.",
        "openclaw_test_tool"
      );
    }

    const SMOKE_TIMEOUT_MS = 30_000;
    let result: ToolResult;
    try {
      const resultPromise = tool.execute(testArgs, ctx);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`smoke test timed out after ${SMOKE_TIMEOUT_MS / 1000}s`)), SMOKE_TIMEOUT_MS)
      );
      result = await Promise.race([resultPromise, timeoutPromise]);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        content:
          `Tool "${toolName}" threw an exception during the smoke test: ${detail}\n\n` +
          "Ask OpenClaw to fix it by calling openclaw_build_feature again with the error details included in the description.",
        label: "openclaw_test_tool",
        detail: `throw: ${toolName} — ${detail}`,
      };
    }

    if (result.ok) {
      return {
        ok: true,
        content:
          `Smoke test PASSED for tool "${toolName}".\n\nOutput: ${result.content}`,
        label: "openclaw_test_tool",
        detail: `pass: ${toolName}`,
      };
    }
    return {
      ok: false,
      content:
        `Smoke test FAILED for tool "${toolName}".\n\nError: ${result.content}\n\n` +
        "Ask OpenClaw to fix it by calling openclaw_build_feature again, including this error in the description.",
      label: "openclaw_test_tool",
      detail: `fail: ${toolName} — ${result.content}`,
    };
  },
};

// ── openclaw_status tool ─────────────────────────────────────────────────────
export const openclawStatusTool: AgentTool = {
  name: "openclaw_status",
  description:
    "Check whether the OpenClaw compute bridge is configured and reachable. Returns online status, the configured mode (telegram or gateway), and latency for gateway mode. Use this before delegating a task if you are unsure whether the bridge is active.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  async execute(_args, ctx): Promise<ToolResult> {
    const statusJson = await checkOpenClawStatus(ctx.userId);
    const data = JSON.parse(statusJson) as { online: boolean; message?: string };
    return {
      ok: !!data.online,
      content: statusJson,
      label: "openclaw_status",
      detail: data.message,
    };
  },
};

// ── Shared status check — used by tool + REST endpoint ───────────────────────
export async function checkOpenClawStatus(userId: string): Promise<string> {
  let rawPrefs: Record<string, unknown> = {};
  try {
    const rows = await db
      .select({ data: userPreferences.data })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);
    rawPrefs = (rows[0]?.data as Record<string, unknown>) ?? {};
  } catch {}

  const cfg = rawPrefs.openclawBridge as OpenClawBridgeConfig | undefined;

  if (!cfg) {
    return JSON.stringify({
      configured: false,
      online: false,
      message: "OpenClaw bridge is not configured. Go to Settings → OpenClaw Brain to set it up.",
    });
  }

  if (!cfg.enabled) {
    return JSON.stringify({
      configured: true,
      online: false,
      mode: cfg.mode,
      message:
        "OpenClaw bridge is configured but currently disabled. Enable it in Settings → OpenClaw Brain.",
    });
  }

  if (cfg.mode === "telegram") {
    const chatId = cfg.telegramChatId?.trim();
    const hasBotToken = !!process.env.TELEGRAM_BOT_TOKEN;

    if (!chatId) {
      return JSON.stringify({
        configured: true,
        online: false,
        mode: "telegram",
        message: "Telegram chat ID is not set. Enter it in Settings → OpenClaw Brain.",
      });
    }
    if (!hasBotToken) {
      return JSON.stringify({
        configured: true,
        online: false,
        mode: "telegram",
        message: "Telegram bot token is not set — configure TELEGRAM_BOT_TOKEN.",
      });
    }

    // Liveness probe: call Telegram getChat API to verify bot can reach the chat
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getChat?chat_id=${encodeURIComponent(chatId)}`,
        { signal: AbortSignal.timeout(5000) }
      );
      const body = (await res.json()) as { ok: boolean; result?: { type?: string; title?: string } };
      if (!res.ok || !body.ok) {
        return JSON.stringify({
          configured: true,
          online: false,
          mode: "telegram",
          chatId,
          message:
            "Bot cannot reach the configured Telegram chat. Verify the chat ID in Settings → OpenClaw Brain and ensure the bot is a member of that chat.",
        });
      }
      return JSON.stringify({
        configured: true,
        online: true,
        mode: "telegram",
        chatId,
        chatType: body.result?.type ?? "unknown",
        message:
          "OpenClaw Telegram bridge is active. Tasks will be sent to the configured chat and replies forwarded back to Jarvis.",
      });
    } catch {
      return JSON.stringify({
        configured: true,
        online: false,
        mode: "telegram",
        chatId,
        message: "Could not verify Telegram chat reachability — check your connection.",
      });
    }
  }

  if (cfg.mode === "gateway") {
    const rawUrl = cfg.gatewayUrl?.trim();
    if (!rawUrl) {
      return JSON.stringify({
        configured: true,
        online: false,
        mode: "gateway",
        message: "Gateway URL is not set. Enter it in Settings → OpenClaw Brain.",
      });
    }

    const urlCheck = await validateGatewayUrl(rawUrl);
    if (!urlCheck.ok) {
      return JSON.stringify({
        configured: true,
        online: false,
        mode: "gateway",
        message: `Gateway URL validation failed: ${urlCheck.error}`,
      });
    }

    const checkUrl = `${rawUrl.replace(/\/$/, "")}/api/v1/check`;
    const authHeaders: Record<string, string> = cfg.gatewayToken
      ? { Authorization: `Bearer ${cfg.gatewayToken}` }
      : {};
    const t0 = Date.now();
    try {
      const res = await fetch(checkUrl, {
        method: "GET",
        headers: authHeaders,
        signal: AbortSignal.timeout(5000),
      });
      const latencyMs = Date.now() - t0;
      if (res.ok) {
        return JSON.stringify({
          configured: true,
          online: true,
          mode: "gateway",
          latencyMs,
          gatewayUrl: rawUrl,
          message: `OpenClaw gateway is online (${latencyMs}ms latency).`,
        });
      }
      return JSON.stringify({
        configured: true,
        online: false,
        mode: "gateway",
        latencyMs,
        gatewayUrl: rawUrl,
        message: `Gateway responded with HTTP ${res.status}. Make sure OpenClaw is running and your tunnel is active.`,
      });
    } catch (err) {
      const latencyMs = Date.now() - t0;
      return JSON.stringify({
        configured: true,
        online: false,
        mode: "gateway",
        latencyMs,
        gatewayUrl: rawUrl,
        message: `Cannot reach gateway at ${rawUrl}: ${err instanceof Error ? err.message : String(err)}. Check that your tunnel is active.`,
      });
    }
  }

  return JSON.stringify({
    configured: true,
    online: false,
    message: `Unknown mode: ${String((cfg as OpenClawBridgeConfig).mode)}`,
  });
}

// ── Telegram send helper — captures message_id ───────────────────────────────
interface TelegramSendResult {
  message_id: number;
}

async function sendMessageWithId(
  chatId: string,
  text: string
): Promise<TelegramSendResult | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { ok: boolean; result?: { message_id: number } };
    return data.ok && data.result ? { message_id: data.result.message_id } : null;
  } catch {
    return null;
  }
}
