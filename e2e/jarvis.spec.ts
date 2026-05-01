import { test, expect, Page } from "@playwright/test";
import * as http from "http";

const BASE = "http://localhost:8081";
const API = "http://localhost:5000";
const AUTH_KEY = "@gameplan_auth_token";

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve(data));
      res.on("error", reject);
    }).on("error", reject);
  });
}

async function fetchDevTokenNodeJs(): Promise<string> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const raw = await httpGet(`${API}/api/dev-token`);
      const d = JSON.parse(raw) as { token?: string };
      if (d.token) return d.token;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 300 * attempt));
  }
  throw new Error("Could not fetch dev-token after 3 attempts (Node.js side)");
}

async function devLoginViaApi(page: Page) {
  const token = await fetchDevTokenNodeJs();

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector('[data-testid="username-input"]', { timeout: 15000 });

  await page.evaluate(
    ([key, t]) => window.localStorage.setItem(key, t),
    [AUTH_KEY, token]
  );

  await page.reload({ waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(2000);
}

test.describe("Password login UI", () => {
  test("shows username and password fields on login screen", async ({ page }) => {
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });

    await expect(page.locator('[data-testid="username-input"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="password-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="password-login-button"]')).toBeVisible();
    await expect(page.locator('[data-testid="google-sign-in-button"]')).toBeVisible();
    await expect(page.locator('[data-testid="dev-login-button"]')).toBeVisible();
  });

  test("shows error for invalid username/password credentials", async ({ page }) => {
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector('[data-testid="username-input"]', { timeout: 10000 });

    await page.fill('[data-testid="username-input"]', "wronguser_abc123xyz");
    await page.fill('[data-testid="password-input"]', "badpassword999");
    await page.click('[data-testid="password-login-button"]', { force: true });

    const errorEl = page.locator("text=/invalid|failed|incorrect/i").first();
    await expect(errorEl).toBeVisible({ timeout: 8000 });
  });
});

test.describe("Authenticated flows — real account", () => {
  test("dev-token login: main app loads after injecting JWT", async ({ page }) => {
    await devLoginViaApi(page);

    const url = page.url();
    expect(url).not.toContain("login");

    const body = await page.content();
    const appLoaded =
      body.includes("Mission Control") ||
      body.includes("Profile") ||
      body.includes("Jarvis") ||
      body.includes("Settings");
    expect(appLoaded).toBe(true);
  });

  test("profile tab renders JARVIS Soul section", async ({ page }) => {
    await devLoginViaApi(page);

    await page.goto(`${BASE}/profile`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(3000);

    const body = await page.content();
    expect(body).toContain("JARVIS Soul");
  });

  test("profile tab renders memory / coach memory section", async ({ page }) => {
    await devLoginViaApi(page);

    await page.goto(`${BASE}/profile`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(3000);

    const body = await page.content();
    const hasMemory =
      body.includes("Coach Memory") ||
      body.includes("Memory Review") ||
      body.includes("About You") ||
      body.includes("memories") ||
      body.includes("Memory");
    expect(hasMemory).toBe(true);
  });

  test("capability gaps screen loads without crashing", async ({ page }) => {
    await devLoginViaApi(page);

    await page.goto(`${BASE}/capability-gaps`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(2000);

    const body = await page.content();
    const hasContent =
      body.includes("Capability") ||
      body.includes("Gap") ||
      body.includes("No gaps") ||
      body.includes("Deflect") ||
      body.includes("Apology");
    expect(hasContent).toBe(true);
  });

  test("projects screen loads without crashing", async ({ page }) => {
    await devLoginViaApi(page);

    await page.goto(`${BASE}/projects`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(2000);

    const body = await page.content();
    const hasContent =
      body.includes("Projects") ||
      body.includes("App Build") ||
      body.includes("No project") ||
      body.includes("New Project");
    expect(hasContent).toBe(true);
  });
});
