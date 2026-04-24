/**
 * Server-side headless browser tools for the Jarvis agent.
 * Backed by Playwright / Chromium (always-on, no daemon required).
 *
 * Tools: browser_navigate, browser_click, browser_type,
 *        browser_screenshot, browser_extract
 */
import type { AgentTool } from "../types";
import { getOrCreateSession, touchSession, closeSession, hasSession } from "../browser/sessionManager";

// ── Helpers ────────────────────────────────────────────────────────────────────

function validateUrl(url: string): string | null {
  const u = url.trim();
  if (!u) return "No URL provided.";
  if (!u.startsWith("http://") && !u.startsWith("https://")) return `URL must start with http:// or https://. Got: ${u}`;
  return null;
}

async function safePageText(page: import("playwright").Page, maxChars = 3000): Promise<string> {
  try {
    const text: string = await page.evaluate(() => {
      const clone = document.cloneNode(true) as Document;
      clone.querySelectorAll("script,style,noscript,svg,iframe").forEach((el) => el.remove());
      return (clone.body?.innerText || clone.body?.textContent || "").replace(/\s{3,}/g, "\n\n").trim();
    });
    return text.slice(0, maxChars);
  } catch {
    return "";
  }
}

// ── browser_navigate ───────────────────────────────────────────────────────────

export const browserNavigateTool: AgentTool = {
  name: "browser_navigate",
  description:
    "Open a URL in a headless browser and return the page title plus a text summary of the visible content. " +
    "Use this for JS-rendered pages that web_fetch cannot read, or when you need to interact with the page afterwards (click, type, etc.). " +
    "Each user has one persistent browser session that times out after 5 minutes of inactivity.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Full URL to navigate to (must start with http:// or https://)",
      },
      wait_until: {
        type: "string",
        enum: ["load", "domcontentloaded", "networkidle"],
        description: "When to consider navigation complete (default: load)",
      },
    },
    required: ["url"],
  },
  async execute(args, ctx) {
    const url = String(args.url || "").trim();
    const urlError = validateUrl(url);
    if (urlError) return { ok: false, content: urlError, label: "browser_navigate: bad URL" };

    const waitUntil = (["load", "domcontentloaded", "networkidle"] as const).includes(
      args.wait_until as "load",
    )
      ? (args.wait_until as "load" | "domcontentloaded" | "networkidle")
      : "load";

    try {
      const page = await getOrCreateSession(ctx.userId);
      await page.goto(url, { waitUntil, timeout: 30000 });
      touchSession(ctx.userId);

      const title = await page.title();
      const text = await safePageText(page, 3000);
      const currentUrl = page.url();

      console.log(`[${ctx.channel || "Agent"}] browser_navigate → ${currentUrl} title="${title}"`);
      return {
        ok: true,
        content:
          `**Page:** ${title}\n**URL:** ${currentUrl}\n\n${text || "(No readable text found)"}`,
        label: `Navigated: ${title || url}`,
        detail: currentUrl,
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
    "Click an element on the current browser page. Specify either visible text (e.g. a button label) or a CSS selector. " +
    "Returns success/failure and the updated page title.",
  parameters: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "Visible text of the element to click (e.g. button label, link text)",
      },
      selector: {
        type: "string",
        description: "CSS selector of the element to click (used if text is not provided)",
      },
    },
  },
  async execute(args, ctx) {
    if (!hasSession(ctx.userId)) {
      return { ok: false, content: "No active browser session. Call browser_navigate first.", label: "browser_click: no session" };
    }

    const text = args.text ? String(args.text).trim() : "";
    const selector = args.selector ? String(args.selector).trim() : "";

    if (!text && !selector) {
      return { ok: false, content: "Provide either `text` or `selector`.", label: "browser_click: no target" };
    }

    try {
      const page = await getOrCreateSession(ctx.userId);

      if (text) {
        await page.getByText(text, { exact: false }).first().click({ timeout: 10000 });
      } else {
        await page.locator(selector).first().click({ timeout: 10000 });
      }

      await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
      touchSession(ctx.userId);

      const title = await page.title();
      const currentUrl = page.url();
      console.log(`[${ctx.channel || "Agent"}] browser_click "${text || selector}" → ${currentUrl}`);
      return {
        ok: true,
        content: `Clicked "${text || selector}". Page is now: ${title} (${currentUrl})`,
        label: `Clicked: ${text || selector}`,
        detail: currentUrl,
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
    "Find an input field on the current browser page and type text into it. " +
    "Locate by label text, placeholder text, or CSS selector. " +
    "Set submit=true to press Enter after typing (useful for search forms).",
  parameters: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "The text to type into the field",
      },
      label: {
        type: "string",
        description: "Label text associated with the input field",
      },
      placeholder: {
        type: "string",
        description: "Placeholder text of the input field",
      },
      selector: {
        type: "string",
        description: "CSS selector of the input field (fallback if label/placeholder not found)",
      },
      submit: {
        type: "boolean",
        description: "Press Enter after typing (default: false)",
      },
    },
    required: ["text"],
  },
  async execute(args, ctx) {
    if (!hasSession(ctx.userId)) {
      return { ok: false, content: "No active browser session. Call browser_navigate first.", label: "browser_type: no session" };
    }

    const textToType = String(args.text || "").trim();
    if (!textToType) return { ok: false, content: "`text` is required.", label: "browser_type: no text" };

    const label = args.label ? String(args.label).trim() : "";
    const placeholder = args.placeholder ? String(args.placeholder).trim() : "";
    const selector = args.selector ? String(args.selector).trim() : "";
    const submit = Boolean(args.submit);

    if (!label && !placeholder && !selector) {
      return { ok: false, content: "Provide at least one of: label, placeholder, selector.", label: "browser_type: no locator" };
    }

    try {
      const page = await getOrCreateSession(ctx.userId);

      let locator: import("playwright").Locator;
      if (label) {
        locator = page.getByLabel(label, { exact: false });
      } else if (placeholder) {
        locator = page.getByPlaceholder(placeholder, { exact: false });
      } else {
        locator = page.locator(selector);
      }

      await locator.first().clear({ timeout: 10000 });
      await locator.first().type(textToType, { delay: 30 });

      if (submit) {
        await locator.first().press("Enter");
        await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
      }

      touchSession(ctx.userId);

      const title = await page.title();
      console.log(`[${ctx.channel || "Agent"}] browser_type into "${label || placeholder || selector}" submit=${submit}`);
      return {
        ok: true,
        content: `Typed "${textToType}" into field. Page: ${title}${submit ? " (submitted)" : ""}`,
        label: `Typed into: ${label || placeholder || selector}`,
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
    "Use this to visually inspect the current page state, verify a form was filled correctly, or read content that isn't accessible as text.",
  parameters: {
    type: "object",
    properties: {
      full_page: {
        type: "boolean",
        description: "Capture the full scrollable page (default: false = viewport only)",
      },
    },
  },
  async execute(args, ctx) {
    if (!hasSession(ctx.userId)) {
      return { ok: false, content: "No active browser session. Call browser_navigate first.", label: "browser_screenshot: no session" };
    }

    try {
      const page = await getOrCreateSession(ctx.userId);
      const fullPage = Boolean(args.full_page);

      const buffer = await page.screenshot({ type: "png", fullPage });
      const base64 = buffer.toString("base64");
      touchSession(ctx.userId);

      const title = await page.title();
      const currentUrl = page.url();
      console.log(`[${ctx.channel || "Agent"}] browser_screenshot "${title}" full=${fullPage} size=${buffer.length}B`);
      return {
        ok: true,
        content: `Screenshot captured for page: ${title} (${currentUrl})\n\n[image/png;base64,${base64}]`,
        label: `Screenshot: ${title || currentUrl}`,
        detail: `${buffer.length} bytes`,
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
    "Extract all visible text from the current browser page, cleaned of scripts and styles. " +
    "More thorough than web_fetch for JavaScript-rendered pages (SPAs, dashboards, etc.).",
  parameters: {
    type: "object",
    properties: {
      max_chars: {
        type: "number",
        description: "Maximum characters to return (default 8000, max 30000)",
      },
      selector: {
        type: "string",
        description: "Optional CSS selector to extract text from a specific section of the page",
      },
    },
  },
  async execute(args, ctx) {
    if (!hasSession(ctx.userId)) {
      return { ok: false, content: "No active browser session. Call browser_navigate first.", label: "browser_extract: no session" };
    }

    try {
      const page = await getOrCreateSession(ctx.userId);
      const maxChars = Math.min(30000, Math.max(500, Number(args.max_chars) || 8000));
      const selector = args.selector ? String(args.selector).trim() : "";

      let text: string;
      if (selector) {
        text = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (!el) return "";
          return (el as HTMLElement).innerText || el.textContent || "";
        }, selector);
      } else {
        text = await safePageText(page, maxChars);
      }

      const result = text.trim().slice(0, maxChars);
      const wasCut = text.length > maxChars;
      touchSession(ctx.userId);

      const title = await page.title();
      const currentUrl = page.url();
      console.log(`[${ctx.channel || "Agent"}] browser_extract "${title}" → ${result.length} chars`);
      return {
        ok: true,
        content:
          `**${title}** — ${currentUrl}\n\n${result || "(No visible text found)"}` +
          (wasCut ? `\n\n[…truncated at ${maxChars} chars]` : ""),
        label: `Extracted: ${title || currentUrl}`,
        detail: `${result.length} chars`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      return { ok: false, content: `browser_extract failed: ${msg}`, label: "browser_extract: error" };
    }
  },
};

// ── browser_close ──────────────────────────────────────────────────────────────

export const browserCloseTool: AgentTool = {
  name: "browser_close",
  description:
    "Close the current browser session. Call this when you are done with browser tasks to free resources. " +
    "Sessions close automatically after 5 minutes of inactivity.",
  parameters: {
    type: "object",
    properties: {},
  },
  async execute(_args, ctx) {
    if (!hasSession(ctx.userId)) {
      return { ok: true, content: "No active browser session to close.", label: "browser_close: no session" };
    }
    await closeSession(ctx.userId);
    return { ok: true, content: "Browser session closed.", label: "browser_close: closed" };
  },
};
