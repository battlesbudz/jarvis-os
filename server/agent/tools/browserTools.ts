/**
 * Server-side headless browser tools for the Jarvis agent.
 * Backed by the @playwright/mcp server (one subprocess per user).
 *
 * Direct-wrap tools:
 *   browser_navigate, browser_click, browser_type, browser_screenshot,
 *   browser_extract, browser_close, browser_snapshot, browser_wait_for,
 *   browser_select, browser_clear_session,
 *   browser_evaluate, browser_scroll, browser_hover, browser_drag,
 *   browser_check, browser_uncheck, browser_choose_file,
 *   browser_navigate_back, browser_navigate_forward, browser_reload,
 *   browser_get_cookies, browser_set_cookies, browser_delete_cookies,
 *   browser_network_requests, browser_console_messages,
 *   browser_tab_new, browser_tab_list, browser_tab_select, browser_tab_close
 *
 * Dynamic passthrough:
 *   browser_tool — calls any Playwright MCP tool by name with arbitrary args
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

// ── YouTube auth-gate detection ────────────────────────────────────────────────

/** Patterns that indicate the final URL is a YouTube-specific auth/consent wall. */
const YT_AUTH_URL_PATTERNS = [
  /youtube\.com\/signin/,
  /youtube\.com\/accounts\//,
  /consent\.youtube\.com/,
  /youtube\.com\/sorry/,
];

/**
 * Return true if the given URL looks like a YouTube watch/shorts/channel page
 * (i.e. the navigation was intended for YouTube, not another Google service).
 */
function isYouTubeDomain(url: string): boolean {
  return url.includes("youtube.com") || url.includes("youtu.be");
}

/**
 * Attempt to extract the browser's final navigated URL from MCP result text.
 * Playwright MCP often emits lines like "Navigated to https://…" or
 * "Page URL: https://…" in the result content.
 * Returns the extracted URL, or null if none is found.
 */
function extractFinalUrl(mcpResultText: string): string | null {
  const patterns = [
    /Navigated to (https?:\/\/[^\s"']+)/i,
    /Page URL[:\s]+(https?:\/\/[^\s"']+)/i,
    /Current URL[:\s]+(https?:\/\/[^\s"']+)/i,
  ];
  for (const rx of patterns) {
    const m = rx.exec(mcpResultText);
    if (m) return m[1];
  }
  return null;
}

/**
 * Return true when a YouTube-targeted navigation has hit an auth/consent wall.
 *
 * This function is intentionally scoped to YouTube navigations only to avoid
 * false-positives on legitimate Google sign-in flows for other services.
 *
 * Detection signals (all require the original URL to be a YouTube domain):
 *   1. Final navigated URL matches a YouTube-specific auth pattern or accounts.google.com.
 *   2. Page text contains YouTube-specific sign-in / consent phrases.
 */
function isYouTubeAuthGate(originalUrl: string, pageText: string, finalUrl?: string | null): boolean {
  // Only apply auth-gate logic when the user was navigating to YouTube
  if (!isYouTubeDomain(originalUrl)) return false;

  // Check the final URL (post-redirect) first — catches redirects to accounts.google.com
  // or youtube.com/signin that occur after following a normal YouTube video URL
  if (finalUrl) {
    if (/accounts\.google\.com/.test(finalUrl)) return true;
    if (YT_AUTH_URL_PATTERNS.some((rx) => rx.test(finalUrl))) return true;
  }

  // Check the original URL for direct navigation to known YouTube auth patterns
  if (YT_AUTH_URL_PATTERNS.some((rx) => rx.test(originalUrl))) return true;

  // Page text heuristics — only applied when we already know this is a YouTube navigation
  const textLower = pageText.toLowerCase().slice(0, 3000);
  if (
    textLower.includes("sign in to confirm you're not a bot") ||
    textLower.includes("sign in to watch") ||
    textLower.includes("confirm your age") ||
    textLower.includes("before you continue to youtube")
  ) {
    return true;
  }

  return false;
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
      wait_until: {
        type: "string",
        description: "Navigation wait condition: 'load', 'domcontentloaded', 'networkidle' (informational — MCP handles wait internally)",
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
      const navText = mcpText(navResult.content);
      const pageText = (mcpText(snapResult.content) || navText).slice(0, 4000);

      // Extract the final URL the browser actually landed on after any redirects
      // so auth-gate detection works even when the original URL looked like a normal video.
      const finalUrl = extractFinalUrl(navText) ?? extractFinalUrl(pageText);

      // Detect YouTube authentication / consent walls and return a clear message
      // instead of presenting a broken or empty session to the agent.
      if (isYouTubeAuthGate(url, pageText, finalUrl)) {
        const effectiveUrl = finalUrl ?? url;
        const isYtRelated = url.includes("youtube.com") || url.includes("youtu.be") ||
          (finalUrl !== null && finalUrl !== undefined && (finalUrl.includes("youtube.com") || finalUrl.includes("accounts.google.com")));
        const ytNote = isYtRelated
          ? " If you were trying to read this video's transcript, use the get_youtube_transcript tool instead — it doesn't require a browser session."
          : "";
        console.warn(`[${ctx.channel || "Agent"}] browser_navigate hit YouTube auth gate → ${effectiveUrl}`);
        return {
          ok: false,
          content:
            `YouTube is asking for a sign-in on this page and the headless browser cannot proceed.${ytNote}`,
          label: "browser_navigate: YouTube auth gate",
        };
      }

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
      selector: {
        type: "string",
        description: "CSS selector or aria-label description (alias for text, used when text is not provided).",
      },
    },
  },
  async execute(args, ctx) {
    if (!await hasActiveBrowserContext(ctx.userId)) {
      return { ok: false, content: "No active browser session. Call browser_navigate first.", label: "browser_click: no session" };
    }

    let ref = args.ref ? String(args.ref).trim() : "";
    const description = (args.text ? String(args.text) : args.selector ? String(args.selector) : ref).trim();

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
      label: { type: "string", description: "Label text or description of the input field. Used when ref is not provided." },
      placeholder: { type: "string", description: "Placeholder text of the input field (alias for label)." },
      selector: { type: "string", description: "CSS selector or aria-label (alias for label)." },
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
    const description = (args.label ? String(args.label) : args.placeholder ? String(args.placeholder) : args.selector ? String(args.selector) : ref).trim();
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
    // Also close daemon browser context when local routing is active
    await closeDaemonBrowserSession(ctx.userId);
    return { ok: true, content: "Browser session closed.", label: "browser_close: closed" };
  },
};

// ── browser_evaluate ──────────────────────────────────────────────────────────

export const browserEvaluateTool: AgentTool = {
  name: "browser_evaluate",
  description:
    "Execute arbitrary JavaScript in the current browser page and return the result. " +
    "Use this to read DOM values, trigger JS functions, or perform calculations that aren't " +
    "accessible via the accessibility tree. Returned value is JSON-serialised.",
  parameters: {
    type: "object",
    properties: {
      function: {
        type: "string",
        description: "JavaScript expression or function body to evaluate in the page context. " +
          "E.g. 'document.title' or '() => Array.from(document.querySelectorAll(\"a\")).map(a=>a.href)'",
      },
    },
    required: ["function"],
  },
  async execute(args, ctx) {
    if (!await hasActiveBrowserContext(ctx.userId)) {
      return { ok: false, content: "No active browser session. Call browser_navigate first.", label: "browser_evaluate: no session" };
    }
    const fn = String(args.function || "").trim();
    if (!fn) return { ok: false, content: "`function` is required.", label: "browser_evaluate: no function" };

    try {
      const result = await callBrowserTool(ctx.userId, "browser_evaluate", { function: fn });
      const text = mcpText(result.content);
      if (result.isError) {
        return { ok: false, content: `browser_evaluate failed: ${text}`, label: "browser_evaluate: error" };
      }
      console.log(`[${ctx.channel || "Agent"}] browser_evaluate → ${text.length} chars`);
      return { ok: true, content: text || "(undefined)", label: "JS evaluated" };
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      return { ok: false, content: `browser_evaluate failed: ${msg}`, label: "browser_evaluate: error" };
    }
  },
};

// ── browser_scroll ────────────────────────────────────────────────────────────

export const browserScrollTool: AgentTool = {
  name: "browser_scroll",
  description:
    "Scroll the current browser page or a specific element. " +
    "Use `direction` to scroll up/down/left/right by a pixel amount, or provide " +
    "a `coordinate` to scroll to a specific X,Y position on the page.",
  parameters: {
    type: "object",
    properties: {
      x: { type: "number", description: "Horizontal scroll target (pixels from left), or scroll delta X when used with direction" },
      y: { type: "number", description: "Vertical scroll target (pixels from top), or scroll delta Y when used with direction" },
      direction: {
        type: "string",
        enum: ["up", "down", "left", "right"],
        description: "Direction to scroll. Combined with `scrollDistance` (pixels).",
      },
      scrollDistance: { type: "number", description: "How many pixels to scroll in `direction` (default: 500)" },
      element: { type: "string", description: "Human-readable description of the element to scroll within (optional)." },
      ref: { type: "string", description: "Ref of the element to scroll within (optional, from browser_snapshot)." },
    },
  },
  async execute(args, ctx) {
    if (!await hasActiveBrowserContext(ctx.userId)) {
      return { ok: false, content: "No active browser session. Call browser_navigate first.", label: "browser_scroll: no session" };
    }
    const mcpArgs: Record<string, unknown> = {};
    if (args.x != null) mcpArgs.x = Number(args.x);
    if (args.y != null) mcpArgs.y = Number(args.y);
    if (args.direction) mcpArgs.direction = String(args.direction);
    if (args.scrollDistance != null) mcpArgs.scrollDistance = Number(args.scrollDistance);
    if (args.ref) mcpArgs.ref = String(args.ref);
    if (args.element) mcpArgs.element = String(args.element);

    try {
      const result = await callBrowserTool(ctx.userId, "browser_scroll", mcpArgs);
      const text = mcpText(result.content);
      if (result.isError) {
        return { ok: false, content: `browser_scroll failed: ${text}`, label: "browser_scroll: error" };
      }
      console.log(`[${ctx.channel || "Agent"}] browser_scroll ${JSON.stringify(mcpArgs)}`);
      return { ok: true, content: text || "Scrolled.", label: "Scrolled" };
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      return { ok: false, content: `browser_scroll failed: ${msg}`, label: "browser_scroll: error" };
    }
  },
};

// ── browser_hover ─────────────────────────────────────────────────────────────

export const browserHoverTool: AgentTool = {
  name: "browser_hover",
  description:
    "Hover the mouse over an element on the current browser page (without clicking). " +
    "Useful for revealing tooltips, dropdown menus, or triggering hover states. " +
    "Provide a `ref` from browser_snapshot for precise targeting, or a human-readable `element` description.",
  parameters: {
    type: "object",
    properties: {
      ref: { type: "string", description: "Element ref from browser_snapshot (e.g. 'e4'). Preferred." },
      element: { type: "string", description: "Human-readable description of the element to hover over. Used when ref is not provided." },
    },
  },
  async execute(args, ctx) {
    if (!await hasActiveBrowserContext(ctx.userId)) {
      return { ok: false, content: "No active browser session. Call browser_navigate first.", label: "browser_hover: no session" };
    }

    let ref = args.ref ? String(args.ref).trim() : "";
    const description = args.element ? String(args.element).trim() : ref;

    if (!ref) {
      if (!description) {
        return { ok: false, content: "Provide `ref` (from browser_snapshot) or `element` description.", label: "browser_hover: no target" };
      }
      const resolved = await snapshotAndResolve(ctx.userId, description);
      if ("error" in resolved) {
        return { ok: false, content: resolved.error, label: "browser_hover: element not found" };
      }
      ref = resolved.ref;
    }

    try {
      const result = await callBrowserTool(ctx.userId, "browser_hover", { ref, element: description || ref });
      const text = mcpText(result.content);
      if (result.isError) {
        return { ok: false, content: `browser_hover failed: ${text}`, label: "browser_hover: error" };
      }
      console.log(`[${ctx.channel || "Agent"}] browser_hover ref=${ref} "${description}"`);
      return { ok: true, content: text || `Hovered over "${description || ref}".`, label: `Hovered: ${description || ref}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      return { ok: false, content: `browser_hover failed: ${msg}`, label: "browser_hover: error" };
    }
  },
};

// ── browser_drag ──────────────────────────────────────────────────────────────

export const browserDragTool: AgentTool = {
  name: "browser_drag",
  description:
    "Drag an element (or coordinates) to a target position on the current browser page. " +
    "Use this for drag-and-drop interactions, sliders, and sortable lists.",
  parameters: {
    type: "object",
    properties: {
      startElement: { type: "string", description: "Description or ref of the element to drag from." },
      startRef: { type: "string", description: "Ref of the element to drag from (preferred, from browser_snapshot)." },
      endElement: { type: "string", description: "Description or ref of the element to drop onto." },
      endRef: { type: "string", description: "Ref of the drop target element (preferred, from browser_snapshot)." },
      startX: { type: "number", description: "Starting X coordinate (pixels). Use instead of startElement/startRef when targeting by coordinates." },
      startY: { type: "number", description: "Starting Y coordinate (pixels)." },
      endX: { type: "number", description: "Ending X coordinate (pixels)." },
      endY: { type: "number", description: "Ending Y coordinate (pixels)." },
    },
  },
  async execute(args, ctx) {
    if (!await hasActiveBrowserContext(ctx.userId)) {
      return { ok: false, content: "No active browser session. Call browser_navigate first.", label: "browser_drag: no session" };
    }
    const mcpArgs: Record<string, unknown> = {};
    if (args.startRef) mcpArgs.startRef = String(args.startRef);
    if (args.startElement) mcpArgs.startElement = String(args.startElement);
    if (args.endRef) mcpArgs.endRef = String(args.endRef);
    if (args.endElement) mcpArgs.endElement = String(args.endElement);
    if (args.startX != null) mcpArgs.startX = Number(args.startX);
    if (args.startY != null) mcpArgs.startY = Number(args.startY);
    if (args.endX != null) mcpArgs.endX = Number(args.endX);
    if (args.endY != null) mcpArgs.endY = Number(args.endY);

    try {
      const result = await callBrowserTool(ctx.userId, "browser_drag", mcpArgs);
      const text = mcpText(result.content);
      if (result.isError) {
        return { ok: false, content: `browser_drag failed: ${text}`, label: "browser_drag: error" };
      }
      console.log(`[${ctx.channel || "Agent"}] browser_drag ${JSON.stringify(mcpArgs)}`);
      return { ok: true, content: text || "Drag complete.", label: "Drag complete" };
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      return { ok: false, content: `browser_drag failed: ${msg}`, label: "browser_drag: error" };
    }
  },
};

// ── browser_check ─────────────────────────────────────────────────────────────

export const browserCheckTool: AgentTool = {
  name: "browser_check",
  description:
    "Check (tick) a checkbox element on the current browser page. " +
    "Provide a `ref` from browser_snapshot for precise targeting, or a human-readable `element` description.",
  parameters: {
    type: "object",
    properties: {
      ref: { type: "string", description: "Element ref from browser_snapshot (e.g. 'e7'). Preferred." },
      element: { type: "string", description: "Human-readable description of the checkbox (e.g. 'Accept terms'). Used when ref is not provided." },
    },
  },
  async execute(args, ctx) {
    if (!await hasActiveBrowserContext(ctx.userId)) {
      return { ok: false, content: "No active browser session. Call browser_navigate first.", label: "browser_check: no session" };
    }

    let ref = args.ref ? String(args.ref).trim() : "";
    const description = args.element ? String(args.element).trim() : ref;

    if (!ref) {
      if (!description) {
        return { ok: false, content: "Provide `ref` (from browser_snapshot) or `element` description.", label: "browser_check: no target" };
      }
      const resolved = await snapshotAndResolve(ctx.userId, description);
      if ("error" in resolved) {
        return { ok: false, content: resolved.error, label: "browser_check: element not found" };
      }
      ref = resolved.ref;
    }

    try {
      const result = await callBrowserTool(ctx.userId, "browser_check", { ref, element: description || ref });
      const text = mcpText(result.content);
      if (result.isError) {
        return { ok: false, content: `browser_check failed: ${text}`, label: "browser_check: error" };
      }
      console.log(`[${ctx.channel || "Agent"}] browser_check ref=${ref} "${description}"`);
      return { ok: true, content: text || `Checked "${description || ref}".`, label: `Checked: ${description || ref}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      return { ok: false, content: `browser_check failed: ${msg}`, label: "browser_check: error" };
    }
  },
};

// ── browser_uncheck ───────────────────────────────────────────────────────────

export const browserUncheckTool: AgentTool = {
  name: "browser_uncheck",
  description:
    "Uncheck (untick) a checkbox element on the current browser page. " +
    "Provide a `ref` from browser_snapshot for precise targeting, or a human-readable `element` description.",
  parameters: {
    type: "object",
    properties: {
      ref: { type: "string", description: "Element ref from browser_snapshot (e.g. 'e7'). Preferred." },
      element: { type: "string", description: "Human-readable description of the checkbox to uncheck. Used when ref is not provided." },
    },
  },
  async execute(args, ctx) {
    if (!await hasActiveBrowserContext(ctx.userId)) {
      return { ok: false, content: "No active browser session. Call browser_navigate first.", label: "browser_uncheck: no session" };
    }

    let ref = args.ref ? String(args.ref).trim() : "";
    const description = args.element ? String(args.element).trim() : ref;

    if (!ref) {
      if (!description) {
        return { ok: false, content: "Provide `ref` (from browser_snapshot) or `element` description.", label: "browser_uncheck: no target" };
      }
      const resolved = await snapshotAndResolve(ctx.userId, description);
      if ("error" in resolved) {
        return { ok: false, content: resolved.error, label: "browser_uncheck: element not found" };
      }
      ref = resolved.ref;
    }

    try {
      const result = await callBrowserTool(ctx.userId, "browser_uncheck", { ref, element: description || ref });
      const text = mcpText(result.content);
      if (result.isError) {
        return { ok: false, content: `browser_uncheck failed: ${text}`, label: "browser_uncheck: error" };
      }
      console.log(`[${ctx.channel || "Agent"}] browser_uncheck ref=${ref} "${description}"`);
      return { ok: true, content: text || `Unchecked "${description || ref}".`, label: `Unchecked: ${description || ref}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      return { ok: false, content: `browser_uncheck failed: ${msg}`, label: "browser_uncheck: error" };
    }
  },
};

// ── browser_choose_file ───────────────────────────────────────────────────────

export const browserChooseFileTool: AgentTool = {
  name: "browser_choose_file",
  description:
    "Set the value of a file input element on the current browser page. " +
    "Provide one or more file paths (server-side paths accessible to the headless browser). " +
    "Provide a `ref` from browser_snapshot for precise targeting, or a human-readable `element` description.",
  parameters: {
    type: "object",
    properties: {
      ref: { type: "string", description: "Element ref of the file input (from browser_snapshot). Preferred." },
      element: { type: "string", description: "Human-readable description of the file input. Used when ref is not provided." },
      paths: {
        type: "array",
        items: { type: "string" },
        description: "Absolute file path(s) to attach. The headless browser must have read access to these paths.",
      },
    },
    required: ["paths"],
  },
  async execute(args, ctx) {
    if (!await hasActiveBrowserContext(ctx.userId)) {
      return { ok: false, content: "No active browser session. Call browser_navigate first.", label: "browser_choose_file: no session" };
    }
    const paths = Array.isArray(args.paths) ? args.paths.map(String) : [];
    if (!paths.length) {
      return { ok: false, content: "`paths` array must contain at least one file path.", label: "browser_choose_file: no paths" };
    }

    let ref = args.ref ? String(args.ref).trim() : "";
    const description = args.element ? String(args.element).trim() : ref;

    if (!ref) {
      if (!description) {
        return { ok: false, content: "Provide `ref` (from browser_snapshot) or `element` description.", label: "browser_choose_file: no target" };
      }
      const resolved = await snapshotAndResolve(ctx.userId, description);
      if ("error" in resolved) {
        return { ok: false, content: resolved.error, label: "browser_choose_file: element not found" };
      }
      ref = resolved.ref;
    }

    try {
      const result = await callBrowserTool(ctx.userId, "browser_choose_file", { ref, element: description || ref, paths });
      const text = mcpText(result.content);
      if (result.isError) {
        return { ok: false, content: `browser_choose_file failed: ${text}`, label: "browser_choose_file: error" };
      }
      console.log(`[${ctx.channel || "Agent"}] browser_choose_file ref=${ref} paths=${paths.join(", ")}`);
      return { ok: true, content: text || `File(s) selected: ${paths.join(", ")}`, label: "File chosen" };
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      return { ok: false, content: `browser_choose_file failed: ${msg}`, label: "browser_choose_file: error" };
    }
  },
};

// ── browser_navigate_back ─────────────────────────────────────────────────────

export const browserNavigateBackTool: AgentTool = {
  name: "browser_navigate_back",
  description: "Navigate the browser back to the previous page in the session history (like pressing the back button).",
  parameters: { type: "object", properties: {} },
  async execute(_args, ctx) {
    if (!await hasActiveBrowserContext(ctx.userId)) {
      return { ok: false, content: "No active browser session. Call browser_navigate first.", label: "browser_navigate_back: no session" };
    }
    try {
      const result = await callBrowserTool(ctx.userId, "browser_navigate_back", {});
      const text = mcpText(result.content);
      if (result.isError) {
        return { ok: false, content: `browser_navigate_back failed: ${text}`, label: "browser_navigate_back: error" };
      }
      console.log(`[${ctx.channel || "Agent"}] browser_navigate_back`);
      return { ok: true, content: text || "Navigated back.", label: "Navigated back" };
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      return { ok: false, content: `browser_navigate_back failed: ${msg}`, label: "browser_navigate_back: error" };
    }
  },
};

// ── browser_navigate_forward ──────────────────────────────────────────────────

export const browserNavigateForwardTool: AgentTool = {
  name: "browser_navigate_forward",
  description: "Navigate the browser forward to the next page in the session history (like pressing the forward button).",
  parameters: { type: "object", properties: {} },
  async execute(_args, ctx) {
    if (!await hasActiveBrowserContext(ctx.userId)) {
      return { ok: false, content: "No active browser session. Call browser_navigate first.", label: "browser_navigate_forward: no session" };
    }
    try {
      const result = await callBrowserTool(ctx.userId, "browser_navigate_forward", {});
      const text = mcpText(result.content);
      if (result.isError) {
        return { ok: false, content: `browser_navigate_forward failed: ${text}`, label: "browser_navigate_forward: error" };
      }
      console.log(`[${ctx.channel || "Agent"}] browser_navigate_forward`);
      return { ok: true, content: text || "Navigated forward.", label: "Navigated forward" };
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      return { ok: false, content: `browser_navigate_forward failed: ${msg}`, label: "browser_navigate_forward: error" };
    }
  },
};

// ── browser_reload ────────────────────────────────────────────────────────────

export const browserReloadTool: AgentTool = {
  name: "browser_reload",
  description: "Reload the current browser page (equivalent to pressing F5 or Ctrl+R).",
  parameters: { type: "object", properties: {} },
  async execute(_args, ctx) {
    if (!await hasActiveBrowserContext(ctx.userId)) {
      return { ok: false, content: "No active browser session. Call browser_navigate first.", label: "browser_reload: no session" };
    }
    try {
      const result = await callBrowserTool(ctx.userId, "browser_reload", {});
      const text = mcpText(result.content);
      if (result.isError) {
        return { ok: false, content: `browser_reload failed: ${text}`, label: "browser_reload: error" };
      }
      console.log(`[${ctx.channel || "Agent"}] browser_reload`);
      return { ok: true, content: text || "Page reloaded.", label: "Page reloaded" };
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      return { ok: false, content: `browser_reload failed: ${msg}`, label: "browser_reload: error" };
    }
  },
};

// ── browser_get_cookies ───────────────────────────────────────────────────────

export const browserGetCookiesTool: AgentTool = {
  name: "browser_get_cookies",
  description:
    "Return all cookies currently stored in the browser session, optionally filtered to a specific URL. " +
    "Useful for reading auth tokens or session identifiers.",
  parameters: {
    type: "object",
    properties: {
      urls: {
        type: "array",
        items: { type: "string" },
        description: "Optional list of URLs to filter cookies by (returns cookies valid for those URLs only).",
      },
    },
  },
  async execute(args, ctx) {
    if (!await hasActiveBrowserContext(ctx.userId)) {
      return { ok: false, content: "No active browser session. Call browser_navigate first.", label: "browser_get_cookies: no session" };
    }
    const mcpArgs: Record<string, unknown> = {};
    if (Array.isArray(args.urls) && args.urls.length) {
      for (const u of args.urls) {
        const err = validateUrl(String(u));
        if (err) return { ok: false, content: `Invalid URL in urls: ${err}`, label: "browser_get_cookies: bad URL" };
      }
      mcpArgs.urls = args.urls.map(String);
    }

    try {
      const result = await callBrowserTool(ctx.userId, "browser_get_cookies", mcpArgs);
      const text = mcpText(result.content);
      if (result.isError) {
        return { ok: false, content: `browser_get_cookies failed: ${text}`, label: "browser_get_cookies: error" };
      }
      console.log(`[${ctx.channel || "Agent"}] browser_get_cookies`);
      return { ok: true, content: text || "No cookies found.", label: "Cookies retrieved" };
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      return { ok: false, content: `browser_get_cookies failed: ${msg}`, label: "browser_get_cookies: error" };
    }
  },
};

// ── browser_set_cookies ───────────────────────────────────────────────────────

export const browserSetCookiesTool: AgentTool = {
  name: "browser_set_cookies",
  description:
    "Set one or more cookies in the current browser session. " +
    "Each cookie requires at minimum a `name`, `value`, and `url` (to scope the cookie to the correct domain).",
  parameters: {
    type: "object",
    properties: {
      cookies: {
        type: "array",
        description: "Array of cookie objects to set.",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            value: { type: "string" },
            url: { type: "string", description: "URL the cookie applies to (must start with http:// or https://)" },
            domain: { type: "string" },
            path: { type: "string" },
            expires: { type: "number", description: "Unix timestamp when the cookie expires" },
            httpOnly: { type: "boolean" },
            secure: { type: "boolean" },
          },
          required: ["name", "value"],
        },
      },
    },
    required: ["cookies"],
  },
  async execute(args, ctx) {
    if (!await hasActiveBrowserContext(ctx.userId)) {
      return { ok: false, content: "No active browser session. Call browser_navigate first.", label: "browser_set_cookies: no session" };
    }
    const cookies = Array.isArray(args.cookies) ? args.cookies : [];
    if (!cookies.length) {
      return { ok: false, content: "`cookies` array must not be empty.", label: "browser_set_cookies: no cookies" };
    }

    for (const c of cookies) {
      if (c.url) {
        const err = validateUrl(String(c.url));
        if (err) return { ok: false, content: `Invalid cookie URL: ${err}`, label: "browser_set_cookies: bad URL" };
      }
    }

    try {
      const result = await callBrowserTool(ctx.userId, "browser_set_cookies", { cookies });
      const text = mcpText(result.content);
      if (result.isError) {
        return { ok: false, content: `browser_set_cookies failed: ${text}`, label: "browser_set_cookies: error" };
      }
      console.log(`[${ctx.channel || "Agent"}] browser_set_cookies count=${cookies.length}`);
      return { ok: true, content: text || `Set ${cookies.length} cookie(s).`, label: "Cookies set" };
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      return { ok: false, content: `browser_set_cookies failed: ${msg}`, label: "browser_set_cookies: error" };
    }
  },
};

// ── browser_delete_cookies ────────────────────────────────────────────────────

export const browserDeleteCookiesTool: AgentTool = {
  name: "browser_delete_cookies",
  description:
    "Delete cookies from the current browser session. " +
    "Call without arguments to clear all cookies, or pass `name` and/or `url` to target specific cookies.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Name of the specific cookie to delete (optional)." },
      url: { type: "string", description: "Delete cookies scoped to this URL only (optional)." },
    },
  },
  async execute(args, ctx) {
    if (!await hasActiveBrowserContext(ctx.userId)) {
      return { ok: false, content: "No active browser session. Call browser_navigate first.", label: "browser_delete_cookies: no session" };
    }
    const mcpArgs: Record<string, unknown> = {};
    if (args.name) mcpArgs.name = String(args.name);
    if (args.url) {
      const err = validateUrl(String(args.url));
      if (err) return { ok: false, content: `Invalid URL: ${err}`, label: "browser_delete_cookies: bad URL" };
      mcpArgs.url = String(args.url);
    }

    try {
      const result = await callBrowserTool(ctx.userId, "browser_delete_cookies", mcpArgs);
      const text = mcpText(result.content);
      if (result.isError) {
        return { ok: false, content: `browser_delete_cookies failed: ${text}`, label: "browser_delete_cookies: error" };
      }
      console.log(`[${ctx.channel || "Agent"}] browser_delete_cookies ${JSON.stringify(mcpArgs)}`);
      return { ok: true, content: text || "Cookie(s) deleted.", label: "Cookies deleted" };
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      return { ok: false, content: `browser_delete_cookies failed: ${msg}`, label: "browser_delete_cookies: error" };
    }
  },
};

// ── browser_network_requests ──────────────────────────────────────────────────

export const browserNetworkRequestsTool: AgentTool = {
  name: "browser_network_requests",
  description:
    "Return a log of network requests made by the current browser page since the session started. " +
    "Useful for debugging API calls, finding hidden endpoints, or inspecting request/response data.",
  parameters: {
    type: "object",
    properties: {
      filter: { type: "string", description: "Optional URL pattern to filter results (case-insensitive substring match)." },
    },
  },
  async execute(args, ctx) {
    if (!await hasActiveBrowserContext(ctx.userId)) {
      return { ok: false, content: "No active browser session. Call browser_navigate first.", label: "browser_network_requests: no session" };
    }
    const mcpArgs: Record<string, unknown> = {};
    if (args.filter) mcpArgs.filter = String(args.filter);

    try {
      const result = await callBrowserTool(ctx.userId, "browser_network_requests", mcpArgs);
      const text = mcpText(result.content);
      if (result.isError) {
        return { ok: false, content: `browser_network_requests failed: ${text}`, label: "browser_network_requests: error" };
      }
      console.log(`[${ctx.channel || "Agent"}] browser_network_requests`);
      return { ok: true, content: text.slice(0, 8000) || "No network requests recorded.", label: "Network requests" };
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      return { ok: false, content: `browser_network_requests failed: ${msg}`, label: "browser_network_requests: error" };
    }
  },
};

// ── browser_console_messages ──────────────────────────────────────────────────

export const browserConsoleMessagesTool: AgentTool = {
  name: "browser_console_messages",
  description:
    "Return browser console messages (log, warn, error, info) from the current page. " +
    "Useful for debugging JavaScript errors or reading output from page scripts.",
  parameters: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["log", "warn", "error", "info", "all"],
        description: "Filter by message level (default: 'all').",
      },
    },
  },
  async execute(args, ctx) {
    if (!await hasActiveBrowserContext(ctx.userId)) {
      return { ok: false, content: "No active browser session. Call browser_navigate first.", label: "browser_console_messages: no session" };
    }
    const mcpArgs: Record<string, unknown> = {};
    if (args.type && args.type !== "all") mcpArgs.type = String(args.type);

    try {
      const result = await callBrowserTool(ctx.userId, "browser_console_messages", mcpArgs);
      const text = mcpText(result.content);
      if (result.isError) {
        return { ok: false, content: `browser_console_messages failed: ${text}`, label: "browser_console_messages: error" };
      }
      console.log(`[${ctx.channel || "Agent"}] browser_console_messages`);
      return { ok: true, content: text.slice(0, 6000) || "No console messages.", label: "Console messages" };
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      return { ok: false, content: `browser_console_messages failed: ${msg}`, label: "browser_console_messages: error" };
    }
  },
};

// ── browser_tab_new ───────────────────────────────────────────────────────────

export const browserTabNewTool: AgentTool = {
  name: "browser_tab_new",
  description: "Open a new browser tab. Optionally navigate to a URL in the new tab immediately.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "URL to navigate to in the new tab (optional). Must start with http:// or https://." },
    },
  },
  async execute(args, ctx) {
    if (!await hasActiveBrowserContext(ctx.userId)) {
      return { ok: false, content: "No active browser session. Call browser_navigate first.", label: "browser_tab_new: no session" };
    }
    const mcpArgs: Record<string, unknown> = {};
    if (args.url) {
      const urlErr = validateUrl(String(args.url));
      if (urlErr) return { ok: false, content: urlErr, label: "browser_tab_new: bad URL" };
      mcpArgs.url = String(args.url);
    }

    try {
      const result = await callBrowserTool(ctx.userId, "browser_tab_new", mcpArgs);
      const text = mcpText(result.content);
      if (result.isError) {
        return { ok: false, content: `browser_tab_new failed: ${text}`, label: "browser_tab_new: error" };
      }
      console.log(`[${ctx.channel || "Agent"}] browser_tab_new url=${args.url ?? "blank"}`);
      return { ok: true, content: text || "New tab opened.", label: "New tab opened" };
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      return { ok: false, content: `browser_tab_new failed: ${msg}`, label: "browser_tab_new: error" };
    }
  },
};

// ── browser_tab_list ──────────────────────────────────────────────────────────

export const browserTabListTool: AgentTool = {
  name: "browser_tab_list",
  description: "List all open tabs in the current browser session, showing their index, title, and URL.",
  parameters: { type: "object", properties: {} },
  async execute(_args, ctx) {
    if (!await hasActiveBrowserContext(ctx.userId)) {
      return { ok: false, content: "No active browser session. Call browser_navigate first.", label: "browser_tab_list: no session" };
    }
    try {
      const result = await callBrowserTool(ctx.userId, "browser_tab_list", {});
      const text = mcpText(result.content);
      if (result.isError) {
        return { ok: false, content: `browser_tab_list failed: ${text}`, label: "browser_tab_list: error" };
      }
      console.log(`[${ctx.channel || "Agent"}] browser_tab_list`);
      return { ok: true, content: text || "No tabs found.", label: "Tab list" };
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      return { ok: false, content: `browser_tab_list failed: ${msg}`, label: "browser_tab_list: error" };
    }
  },
};

// ── browser_tab_select ────────────────────────────────────────────────────────

export const browserTabSelectTool: AgentTool = {
  name: "browser_tab_select",
  description: "Switch to a browser tab by its index (0-based). Use browser_tab_list to see available tabs and their indices.",
  parameters: {
    type: "object",
    properties: {
      index: { type: "number", description: "Zero-based index of the tab to switch to." },
    },
    required: ["index"],
  },
  async execute(args, ctx) {
    if (!await hasActiveBrowserContext(ctx.userId)) {
      return { ok: false, content: "No active browser session. Call browser_navigate first.", label: "browser_tab_select: no session" };
    }
    const index = Number(args.index);
    if (!Number.isInteger(index) || index < 0) {
      return { ok: false, content: "`index` must be a non-negative integer.", label: "browser_tab_select: bad index" };
    }

    try {
      const result = await callBrowserTool(ctx.userId, "browser_tab_select", { index });
      const text = mcpText(result.content);
      if (result.isError) {
        return { ok: false, content: `browser_tab_select failed: ${text}`, label: "browser_tab_select: error" };
      }
      console.log(`[${ctx.channel || "Agent"}] browser_tab_select index=${index}`);
      return { ok: true, content: text || `Switched to tab ${index}.`, label: `Tab ${index} selected` };
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      return { ok: false, content: `browser_tab_select failed: ${msg}`, label: "browser_tab_select: error" };
    }
  },
};

// ── browser_tab_close ─────────────────────────────────────────────────────────

export const browserTabCloseTool: AgentTool = {
  name: "browser_tab_close",
  description: "Close a browser tab by its index (0-based). Omit `index` to close the currently active tab.",
  parameters: {
    type: "object",
    properties: {
      index: { type: "number", description: "Zero-based index of the tab to close. Omit to close the active tab." },
    },
  },
  async execute(args, ctx) {
    if (!await hasActiveBrowserContext(ctx.userId)) {
      return { ok: false, content: "No active browser session. Call browser_navigate first.", label: "browser_tab_close: no session" };
    }
    const mcpArgs: Record<string, unknown> = {};
    if (args.index != null) mcpArgs.index = Number(args.index);

    try {
      const result = await callBrowserTool(ctx.userId, "browser_tab_close", mcpArgs);
      const text = mcpText(result.content);
      if (result.isError) {
        return { ok: false, content: `browser_tab_close failed: ${text}`, label: "browser_tab_close: error" };
      }
      console.log(`[${ctx.channel || "Agent"}] browser_tab_close index=${args.index ?? "active"}`);
      return { ok: true, content: text || "Tab closed.", label: "Tab closed" };
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      return { ok: false, content: `browser_tab_close failed: ${msg}`, label: "browser_tab_close: error" };
    }
  },
};

// ── browser_tool (dynamic passthrough) ───────────────────────────────────────

/**
 * Recursively walk an args object and SSRF-validate any string value whose key
 * is "url" or ends with "url" (case-insensitive).  Returns an error string on
 * the first violation, or null if all URLs are safe.
 */
function scanArgsForUrls(value: unknown, keyPath: string): string | null {
  if (value === null || value === undefined) return null;

  if (typeof value === "string") {
    // Only validate when the key looks like a URL field
    const key = keyPath.split(".").pop() ?? "";
    if (key === "url" || key.toLowerCase().endsWith("url")) {
      const err = validateUrl(value);
      if (err) return `invalid ${keyPath || "url"}: ${err}`;
    }
    return null;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const err = scanArgsForUrls(value[i], `${keyPath}[${i}]`);
      if (err) return err;
    }
    return null;
  }

  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const childPath = keyPath ? `${keyPath}.${k}` : k;
      const err = scanArgsForUrls(v, childPath);
      if (err) return err;
    }
    return null;
  }

  return null;
}

/**
 * Tools that are blocked in the dynamic passthrough because they could reach
 * internal network addresses, modify the host OS, or are handled by dedicated
 * agent tools that include extra safety/validation logic.
 *
 * Any tool NOT in this list is forwarded directly to the Playwright MCP server.
 */
const BROWSER_TOOL_DENYLIST = new Set([
  "browser_navigate",           // use browser_navigate (has SSRF + YouTube auth-gate checks)
  "browser_set_cookies",        // use browser_set_cookies (has URL validation)
  "browser_get_cookies",        // use browser_get_cookies (has URL validation)
  "browser_delete_cookies",     // use browser_delete_cookies (has URL validation)
  "browser_tab_new",            // use browser_tab_new (has URL validation)
  "browser_pdf_save",           // niche; excluded from scope
  "browser_close",              // use browser_close
  "browser_clear_session",      // use browser_clear_session
  "browser_install",            // dangerous — modifies system
  "browser_generate_playwright_test", // dev-tool; not relevant to agent tasks
]);

export const browserToolPassthrough: AgentTool = {
  name: "browser_tool",
  description:
    "Dynamic passthrough: call any Playwright MCP browser tool by name with arbitrary arguments. " +
    "Use this for tools not covered by the dedicated agent tools, or for future Playwright MCP tools " +
    "that are not yet wrapped. " +
    "Known tools (partial list): browser_key_press, browser_press_key, browser_file_upload, " +
    "browser_handle_dialog, browser_resize, browser_pdf_save. " +
    "Do NOT use this for: browser_navigate (use browser_navigate), browser_set_cookies, " +
    "browser_get_cookies, browser_delete_cookies, browser_tab_new (all have dedicated wrappers with " +
    "SSRF validation). If `args` contains a `url` field it will be SSRF-validated automatically.",
  parameters: {
    type: "object",
    properties: {
      tool_name: {
        type: "string",
        description: "Exact Playwright MCP tool name to call (e.g. 'browser_key_press', 'browser_handle_dialog').",
      },
      args: {
        type: "object",
        description: "Arguments object to pass to the tool. Structure depends on the tool being called.",
      },
    },
    required: ["tool_name"],
  },
  async execute(rawArgs, ctx) {
    if (!await hasActiveBrowserContext(ctx.userId)) {
      return { ok: false, content: "No active browser session. Call browser_navigate first.", label: "browser_tool: no session" };
    }

    const toolName = String(rawArgs.tool_name || "").trim();
    if (!toolName) return { ok: false, content: "`tool_name` is required.", label: "browser_tool: no tool_name" };

    if (BROWSER_TOOL_DENYLIST.has(toolName)) {
      return {
        ok: false,
        content: `"${toolName}" is blocked in the dynamic passthrough. Use its dedicated agent tool instead (e.g. browser_navigate, browser_set_cookies, browser_tab_new).`,
        label: "browser_tool: blocked",
      };
    }

    const toolArgs: Record<string, unknown> =
      rawArgs.args && typeof rawArgs.args === "object" && !Array.isArray(rawArgs.args)
        ? (rawArgs.args as Record<string, unknown>)
        : {};

    // SSRF guard: recursively validate any URL-like field in args (including nested objects/arrays)
    const ssrfError = scanArgsForUrls(toolArgs, "");
    if (ssrfError) return { ok: false, content: `SSRF guard: ${ssrfError}`, label: "browser_tool: SSRF blocked" };

    try {
      const result = await callBrowserTool(ctx.userId, toolName, toolArgs);
      const text = mcpText(result.content);
      if (result.isError) {
        return { ok: false, content: `browser_tool(${toolName}) failed: ${text}`, label: `${toolName}: error` };
      }
      console.log(`[${ctx.channel || "Agent"}] browser_tool tool=${toolName}`);
      return {
        ok: true,
        content: text.slice(0, 8000) || `${toolName} completed.`,
        label: toolName,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      return { ok: false, content: `browser_tool(${toolName}) failed: ${msg}`, label: `${toolName}: error` };
    }
  },
};
