/**
 * Server-side headless browser tools for the Jarvis agent.
 * Backed by the @playwright/mcp server (one subprocess per user).
 *
 * Tools: browser_navigate, browser_click, browser_type,
 *        browser_screenshot, browser_extract, browser_close,
 *        browser_snapshot, browser_wait_for, browser_select,
 *        browser_clear_session
 */
import type { AgentTool } from "../types";
import {
  callBrowserTool,
  closeMcpSession,
  closeDaemonBrowserSession,
  hasActiveBrowserContext,
  popLatestScreenshot,
} from "../mcp/playwrightMcpClient";

// ── SSRF + URL validation ──────────────────────────────────────────────────────

const BLOCKED_HOSTS = /^(localhost|0\.0\.0\.0|metadata\.google\.internal|169\.254\.169\.254)$/i;

const PRIVATE_CIDR_PATTERNS = [
  /^127\.\d+\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/,
  /^::1$/,
  /^f[cd][0-9a-f]{2}:/i,
];

function validateUrl(url: string): string | null {
  const u = url.trim();
  if (!u) return "No URL provided.";
  if (!u.startsWith("http://") && !u.startsWith("https://")) return `URL must start with http:// or https://. Got: ${u}`;
  let parsed: URL;
  try { parsed = new URL(u); } catch { return `Invalid URL: ${u}`; }
  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTS.test(host)) return `Blocked: "${host}" is a reserved or internal address.`;
  if (host.endsWith(".local") || host.endsWith(".internal")) return `Blocked: "${host}" is a private/internal domain.`;
  if (PRIVATE_CIDR_PATTERNS.some((rx) => rx.test(host))) return `Blocked: "${host}" is a private/reserved IP address.`;
  return null;
}

/** Extract text content from MCP tool result content items. */
function mcpText(content: { type: string; text?: string }[]): string {
  return content
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text!)
    .join("\n")
    .trim();
}

/**
 * Parse a Playwright MCP accessibility-tree snapshot to find the `ref`
 * attribute (e.g. `e1`, `e4`) for the first element whose line contains
 * `description` (case-insensitive).
 *
 * Snapshot lines look like:
 *   - button "Submit" [ref=e1]
 *   - textbox "Email" [ref=e3]
 *
 * Returns the ref string if found, null otherwise.
 */
function findRef(snapshot: string, description: string): string | null {
  if (!description || !snapshot) return null;
  const needle = description.toLowerCase();
  for (const line of snapshot.split("\n")) {
    if (line.toLowerCase().includes(needle)) {
      const m = line.match(/\[ref=([\w]+)\]/);
      if (m) return m[1];
    }
  }
  return null;
}

/**
 * Take a snapshot and resolve a ref for the given element description.
 * Returns { ref, snapshot } on success, or { error, snapshot } on failure.
 */
async function snapshotAndResolve(
  userId: string,
  description: string,
): Promise<{ ref: string; snapshot: string } | { error: string; snapshot: string }> {
  const snapResult = await callBrowserTool(userId, "browser_snapshot", {});
  const snapshot = mcpText(snapResult.content);
  if (snapResult.isError) return { error: `Snapshot failed: ${snapshot}`, snapshot };
  const ref = findRef(snapshot, description);
  if (!ref) {
    return {
      error: `Could not find element matching "${description}" in the current page. ` +
        `Use browser_snapshot to see available elements and their refs, then call this tool with the ref directly.`,
      snapshot: snapshot.slice(0, 2000),
    };
  }
  return { ref, snapshot };
}

// ── browser_navigate ───────────────────────────────────────────────────────────

export const browserNavigateTool: AgentTool = {
  name: "browser_navigate",
  description:
    "Open a URL in a headless browser and return the page title plus a readable summary of the visible content. " +
    "Use this for JS-rendered pages that web_fetch cannot read, or when you need to interact with the page afterwards (click, type, etc.). " +
    "Each user has one persistent browser session with cookies preserved across calls.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Full URL to navigate to (must start with http:// or https://)",
      },
    },
    required: ["url"],
  },
  async execute(args, ctx) {
    const url = String(args.url || "").trim();
    const urlError = validateUrl(url);
    if (urlError) return { ok: false, content: urlError, label: "browser_navigate: bad URL" };

    try {
      const navResult = await callBrowserTool(ctx.userId, "browser_navigate", { url });
      if (navResult.isError) {
        const msg = mcpText(navResult.content) || "navigation failed";
        return { ok: false, content: `browser_navigate failed: ${msg}`, label: "browser_navigate: error" };
      }

      const snapResult = await callBrowserTool(ctx.userId, "browser_snapshot", {});
      const pageText = (mcpText(snapResult.content) || mcpText(navResult.content)).slice(0, 4000);

      console.log(`[${ctx.channel || "Agent"}] browser_navigate → ${url}`);
      return {
        ok: true,
        content: `**URL:** ${url}\n\n${pageText || "(No readable content found)"}`,
        label: `Navigated: ${url}`,
        detail: url,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      return { ok: false, content: `browser_navigate failed: ${msg}`, label: "browser_navigate: error" };
    }
  },
};

// ── browser_click ──────────────────────────────────────────────────────────────

export const browserClickTool: AgentTool = {
  name: "browser_click",
  description:
    "Click an element on the current browser page. " +
    "Provide a `ref` from browser_snapshot for precise targeting, OR a human-readable `text` description " +
    "which will be resolved to a ref automatically via an internal snapshot. " +
    "Returns the updated page content after clicking.",
  parameters: {
    type: "object",
    properties: {
      ref: {
        type: "string",
        description: "Element ref from browser_snapshot (e.g. 'e1'). Preferred — use this when you know the ref.",
      },
      text: {
        type: "string",
        description: "Visible text or description of the element to click (e.g. 'Submit', 'Next link'). Used when ref is not provided.",
      },
    },
  },
  async execute(args, ctx) {
    if (!await hasActiveBrowserContext(ctx.userId)) {
      return { ok: false, content: "No active browser session. Call browser_navigate first.", label: "browser_click: no session" };
    }

    let ref = args.ref ? String(args.ref).trim() : "";
    const description = args.text ? String(args.text).trim() : ref;

    if (!ref) {
      if (!description) {
        return { ok: false, content: "Provide `ref` (from browser_snapshot) or `text` description.", label: "browser_click: no target" };
      }
      const resolved = await snapshotAndResolve(ctx.userId, description);
      if ("error" in resolved) {
        return { ok: false, content: resolved.error, label: "browser_click: element not found" };
      }
      ref = resolved.ref;
    }

    try {
      const result = await callBrowserTool(ctx.userId, "browser_click", { ref, element: description || ref });
      if (result.isError) {
        return { ok: false, content: `browser_click failed: ${mcpText(result.content)}`, label: "browser_click: error" };
      }
      const snapResult = await callBrowserTool(ctx.userId, "browser_snapshot", {});
      const pageText = mcpText(snapResult.content).slice(0, 2000);
      console.log(`[${ctx.channel || "Agent"}] browser_click ref=${ref} "${description}"`);
      return {
        ok: true,
        content: `Clicked "${description || ref}".\n\n${pageText || "(page updated)"}`,
        label: `Clicked: ${description || ref}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      return { ok: false, content: `browser_click failed: ${msg}`, label: "browser_click: error" };
    }
  },
};

// ── browser_type ───────────────────────────────────────────────────────────────

export const browserTypeTool: AgentTool = {
  name: "browser_type",
  description:
    "Type text into an input field on the current browser page. " +
    "Provide a `ref` from browser_snapshot for precise targeting, OR a `label`/`placeholder` description " +
    "which will be resolved to a ref automatically. " +
    "Set submit=true to press Enter after typing.",
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "The text to type into the field" },
      ref: { type: "string", description: "Element ref from browser_snapshot (e.g. 'e2'). Preferred." },
      label: { type: "string", description: "Label text, placeholder, or description of the input field. Used when ref is not provided." },
      submit: { type: "boolean", description: "Press Enter after typing (default: false)" },
    },
    required: ["text"],
  },
  async execute(args, ctx) {
    if (!await hasActiveBrowserContext(ctx.userId)) {
      return { ok: false, content: "No active browser session. Call browser_navigate first.", label: "browser_type: no session" };
    }
    const textToType = String(args.text || "").trim();
    if (!textToType) return { ok: false, content: "`text` is required.", label: "browser_type: no text" };

    let ref = args.ref ? String(args.ref).trim() : "";
    const description = args.label ? String(args.label).trim() : ref;
    const submit = Boolean(args.submit);

    if (!ref) {
      if (!description) {
        return { ok: false, content: "Provide `ref` (from browser_snapshot) or `label` to identify the field.", label: "browser_type: no locator" };
      }
      const resolved = await snapshotAndResolve(ctx.userId, description);
      if ("error" in resolved) {
        return { ok: false, content: resolved.error, label: "browser_type: element not found" };
      }
      ref = resolved.ref;
    }

    try {
      const result = await callBrowserTool(ctx.userId, "browser_type", { ref, element: description || ref, text: textToType, submit });
      if (result.isError) {
        return { ok: false, content: `browser_type failed: ${mcpText(result.content)}`, label: "browser_type: error" };
      }
      console.log(`[${ctx.channel || "Agent"}] browser_type ref=${ref} into "${description}" submit=${submit}`);
      return {
        ok: true,
        content: `Typed "${textToType}" into "${description || ref}"${submit ? " (submitted)" : ""}.`,
        label: `Typed into: ${description || ref}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      return { ok: false, content: `browser_type failed: ${msg}`, label: "browser_type: error" };
    }
  },
};

// ── browser_screenshot ─────────────────────────────────────────────────────────

export const browserScreenshotTool: AgentTool = {
  name: "browser_screenshot",
  description:
    "Capture a screenshot of the current browser page and return it as a base64-encoded PNG image. " +
    "Use this to visually inspect the current page state or read content that isn't accessible as text.",
  parameters: {
    type: "object",
    properties: {
      full_page: { type: "boolean", description: "Capture the full scrollable page (default: false = viewport only)" },
    },
  },
  async execute(args, ctx) {
    if (!await hasActiveBrowserContext(ctx.userId)) {
      return { ok: false, content: "No active browser session. Call browser_navigate first.", label: "browser_screenshot: no session" };
    }
    try {
      const fullPage = Boolean(args.full_page);
      const result = await callBrowserTool(ctx.userId, "browser_take_screenshot", { type: "png", fullPage });
      if (result.isError) {
        return { ok: false, content: `browser_screenshot failed: ${mcpText(result.content)}`, label: "browser_screenshot: error" };
      }

      const inline = result.content.find((c) => c.type === "image" && c.data);
      let base64: string | null = inline?.data ?? null;
      if (!base64) base64 = popLatestScreenshot(ctx.userId);
      if (!base64) {
        return { ok: false, content: "Screenshot taken but image data unavailable.", label: "browser_screenshot: no data" };
      }

      console.log(`[${ctx.channel || "Agent"}] browser_screenshot full=${fullPage} encoded_size=${base64.length}`);
      return {
        ok: true,
        content: `Screenshot captured.\n\n[image/png;base64,${base64}]`,
        label: "Screenshot captured",
        detail: `${Math.round(base64.length * 3 / 4)} bytes`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      return { ok: false, content: `browser_screenshot failed: ${msg}`, label: "browser_screenshot: error" };
    }
  },
};

// ── browser_extract ────────────────────────────────────────────────────────────

export const browserExtractTool: AgentTool = {
  name: "browser_extract",
  description:
    "Extract all visible text from the current browser page via the accessibility tree. " +
    "More thorough than web_fetch for JavaScript-rendered pages (SPAs, dashboards, etc.).",
  parameters: {
    type: "object",
    properties: {
      max_chars: { type: "number", description: "Maximum characters to return (default 8000, max 30000)" },
    },
  },
  async execute(args, ctx) {
    if (!await hasActiveBrowserContext(ctx.userId)) {
      return { ok: false, content: "No active browser session. Call browser_navigate first.", label: "browser_extract: no session" };
    }
    try {
      const maxChars = Math.min(30000, Math.max(500, Number(args.max_chars) || 8000));
      const result = await callBrowserTool(ctx.userId, "browser_snapshot", {});
      if (result.isError) {
        return { ok: false, content: `browser_extract failed: ${mcpText(result.content)}`, label: "browser_extract: error" };
      }
      const text = mcpText(result.content);
      const trimmed = text.slice(0, maxChars);
      const wasCut = text.length > maxChars;
      console.log(`[${ctx.channel || "Agent"}] browser_extract → ${trimmed.length} chars`);
      return {
        ok: true,
        content: `${trimmed || "(No visible text found)"}` + (wasCut ? `\n\n[…truncated at ${maxChars} chars]` : ""),
        label: "Page content extracted",
        detail: `${trimmed.length} chars`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      return { ok: false, content: `browser_extract failed: ${msg}`, label: "browser_extract: error" };
    }
  },
};

// ── browser_snapshot ──────────────────────────────────────────────────────────

export const browserSnapshotTool: AgentTool = {
  name: "browser_snapshot",
  description:
    "Return the accessibility tree of the current browser page. The tree shows interactive elements with " +
    "their ref IDs which can be used in browser_click and browser_type for precise targeting. " +
    "Use this before clicking or typing when the page structure is complex.",
  parameters: {
    type: "object",
    properties: {
      depth: { type: "number", description: "Limit depth of the accessibility tree (default: full tree)" },
    },
  },
  async execute(args, ctx) {
    if (!await hasActiveBrowserContext(ctx.userId)) {
      return { ok: false, content: "No active browser session. Call browser_navigate first.", label: "browser_snapshot: no session" };
    }
    try {
      const mcpArgs: Record<string, unknown> = {};
      if (args.depth) mcpArgs.depth = Number(args.depth);
      const result = await callBrowserTool(ctx.userId, "browser_snapshot", mcpArgs);
      const text = mcpText(result.content);
      if (result.isError) {
        return { ok: false, content: `browser_snapshot failed: ${text}`, label: "browser_snapshot: error" };
      }
      console.log(`[${ctx.channel || "Agent"}] browser_snapshot → ${text.length} chars`);
      return {
        ok: true,
        content: text.slice(0, 8000) || "(empty snapshot)",
        label: "Accessibility snapshot captured",
        detail: `${text.length} chars`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      return { ok: false, content: `browser_snapshot failed: ${msg}`, label: "browser_snapshot: error" };
    }
  },
};

// ── browser_wait_for ──────────────────────────────────────────────────────────

export const browserWaitForTool: AgentTool = {
  name: "browser_wait_for",
  description:
    "Wait for a condition on the current browser page before continuing. " +
    "Useful after triggering async actions (form submission, SPA navigation, AJAX loads).",
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "Wait until this text appears on the page" },
      text_gone: { type: "string", description: "Wait until this text disappears from the page" },
      time: { type: "number", description: "Wait for this many seconds regardless of page state" },
    },
  },
  async execute(args, ctx) {
    if (!await hasActiveBrowserContext(ctx.userId)) {
      return { ok: false, content: "No active browser session. Call browser_navigate first.", label: "browser_wait_for: no session" };
    }
    const mcpArgs: Record<string, unknown> = {};
    if (args.text) mcpArgs.text = String(args.text);
    if (args.text_gone) mcpArgs.textGone = String(args.text_gone);
    if (args.time) mcpArgs.time = Number(args.time);
    if (!mcpArgs.text && !mcpArgs.textGone && !mcpArgs.time) {
      return { ok: false, content: "Provide at least one of: text, text_gone, time.", label: "browser_wait_for: no condition" };
    }

    try {
      const result = await callBrowserTool(ctx.userId, "browser_wait_for", mcpArgs);
      const text = mcpText(result.content);
      console.log(`[${ctx.channel || "Agent"}] browser_wait_for ${JSON.stringify(mcpArgs)}`);
      return {
        ok: !result.isError,
        content: text || (result.isError ? "Wait condition not met." : "Wait condition satisfied."),
        label: "Wait complete",
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      return { ok: false, content: `browser_wait_for failed: ${msg}`, label: "browser_wait_for: error" };
    }
  },
};

// ── browser_select ─────────────────────────────────────────────────────────────

export const browserSelectTool: AgentTool = {
  name: "browser_select",
  description:
    "Select one or more options from a dropdown/select element on the current browser page. " +
    "Provide a `ref` from browser_snapshot for precise targeting, OR an `element` description " +
    "that will be resolved to a ref automatically.",
  parameters: {
    type: "object",
    properties: {
      ref: { type: "string", description: "Element ref from browser_snapshot (e.g. 'e5'). Preferred." },
      element: { type: "string", description: "Human-readable description of the dropdown (e.g. 'Country'). Used when ref is not provided." },
      values: {
        type: "array",
        items: { type: "string" },
        description: "One or more option values or labels to select",
      },
    },
    required: ["values"],
  },
  async execute(args, ctx) {
    if (!await hasActiveBrowserContext(ctx.userId)) {
      return { ok: false, content: "No active browser session. Call browser_navigate first.", label: "browser_select: no session" };
    }
    const values = Array.isArray(args.values) ? args.values.map(String) : [];
    if (!values.length) {
      return { ok: false, content: "Provide at least one entry in `values`.", label: "browser_select: bad args" };
    }

    let ref = args.ref ? String(args.ref).trim() : "";
    const description = args.element ? String(args.element).trim() : ref;

    if (!ref) {
      if (!description) {
        return { ok: false, content: "Provide `ref` (from browser_snapshot) or `element` description.", label: "browser_select: no target" };
      }
      const resolved = await snapshotAndResolve(ctx.userId, description);
      if ("error" in resolved) {
        return { ok: false, content: resolved.error, label: "browser_select: element not found" };
      }
      ref = resolved.ref;
    }

    try {
      const result = await callBrowserTool(ctx.userId, "browser_select_option", { ref, element: description || ref, values });
      const text = mcpText(result.content);
      console.log(`[${ctx.channel || "Agent"}] browser_select ref=${ref} "${description}" values=${values}`);
      return {
        ok: !result.isError,
        content: text || `Selected ${values.join(", ")} in "${description || ref}".`,
        label: `Selected: ${values.join(", ")}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      return { ok: false, content: `browser_select failed: ${msg}`, label: "browser_select: error" };
    }
  },
};

// ── browser_clear_session ─────────────────────────────────────────────────────

export const browserClearSessionTool: AgentTool = {
  name: "browser_clear_session",
  description:
    "Close the browser session and clear all stored cookies, login state, and local storage. " +
    "Use this to log out of sites or start fresh. A new session will be created on the next browser call.",
  parameters: { type: "object", properties: {} },
  async execute(_args, ctx) {
    // Close server-side session and wipe its profile dir (cookies/localStorage)
    closeMcpSession(ctx.userId, true /* wipeProfile */);
    // When routing through daemon local browser: close the current browser
    // context on the daemon's MCP server (best-effort; cannot wipe real Chrome profile)
    await closeDaemonBrowserSession(ctx.userId);
    return {
      ok: true,
      content: "Browser session cleared. Server-side cookies and storage wiped; daemon browser context closed.",
      label: "Session cleared",
    };
  },
};

// ── browser_close ──────────────────────────────────────────────────────────────

export const browserCloseTool: AgentTool = {
  name: "browser_close",
  description:
    "Close the current browser session to free resources. " +
    "Sessions close automatically after 5 minutes of inactivity.",
  parameters: { type: "object", properties: {} },
  async execute(_args, ctx) {
    if (!await hasActiveBrowserContext(ctx.userId)) {
      return { ok: true, content: "No active browser session to close.", label: "browser_close: no session" };
    }
    closeMcpSession(ctx.userId);
    return { ok: true, content: "Browser session closed.", label: "browser_close: closed" };
  },
};
