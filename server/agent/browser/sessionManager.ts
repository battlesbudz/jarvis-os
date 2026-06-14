/**
 * Browser session manager.
 * Maintains one headless Chromium page per user.
 * Sessions time out after IDLE_TIMEOUT_MS of inactivity.
 */
import { chromium, type Browser, type Page } from "playwright";

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;

interface BrowserSession {
  browser: Browser;
  page: Page;
  lastActive: number;
}

const sessions = new Map<string, BrowserSession>();

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
];

async function launchSession(userId: string): Promise<BrowserSession> {
  const browser = await chromium.launch({ args: LAUNCH_ARGS });
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });
  const page = await ctx.newPage();
  const session: BrowserSession = { browser, page, lastActive: Date.now() };
  sessions.set(userId, session);
  console.log(`[Browser] session opened for user ${userId}`);
  return session;
}

export async function getOrCreateSession(userId: string): Promise<Page> {
  const existing = sessions.get(userId);
  if (existing) {
    existing.lastActive = Date.now();
    return existing.page;
  }
  const session = await launchSession(userId);
  return session.page;
}

export function touchSession(userId: string): void {
  const s = sessions.get(userId);
  if (s) s.lastActive = Date.now();
}

export async function closeSession(userId: string): Promise<void> {
  const s = sessions.get(userId);
  if (!s) return;
  sessions.delete(userId);
  try {
    await s.browser.close();
    console.log(`[Browser] session closed for user ${userId}`);
  } catch {
    /* already dead */
  }
}

export function hasSession(userId: string): boolean {
  return sessions.has(userId);
}

// Reap idle sessions
const cleanupInterval = setInterval(async () => {
  const now = Date.now();
  for (const [userId, session] of sessions.entries()) {
    if (now - session.lastActive > IDLE_TIMEOUT_MS) {
      console.log(`[Browser] closing idle session for user ${userId}`);
      await closeSession(userId);
    }
  }
}, CLEANUP_INTERVAL_MS);

// Don't hold the event loop open in tests
if (typeof (cleanupInterval as unknown as NodeJS.Timeout).unref === "function") (cleanupInterval as unknown as NodeJS.Timeout).unref();
