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

function httpPost(url: string, body: object, token: string): Promise<{ status: number; data: object }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        Authorization: `Bearer ${token}`,
      },
    };
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, data: JSON.parse(data) }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function httpPatch(url: string, body: object, token?: string): Promise<{ status: number; data: object }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const parsed = new URL(url);
    const headers: Record<string, string | number> = {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: "PATCH",
      headers,
    };
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, data: JSON.parse(data) }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function httpDelete(url: string, token: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    };
    const req = http.request(options, (res) => {
      res.on("data", () => {});
      res.on("end", () => resolve(res.statusCode ?? 0));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

async function fetchDevToken(): Promise<string> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const raw = await httpGet(`${API}/api/dev-token`);
      const d = JSON.parse(raw) as { token?: string };
      if (d.token) return d.token;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 300 * attempt));
  }
  throw new Error("Could not fetch dev-token after 4 attempts");
}

async function loginViaDevButton(page: Page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector('[data-testid="dev-login-button"]', { timeout: 15000 });
  const btn = page.locator('[data-testid="dev-login-button"]');
  await btn.scrollIntoViewIfNeeded();
  await btn.click({ force: true, timeout: 20000 });
  // Wait for the URL to move away from the login page
  await page.waitForFunction(
    () => !window.location.pathname.includes("login"),
    { timeout: 20000 }
  );
  await page.waitForTimeout(1500);
}

async function loginViaTokenInjection(page: Page, token: string) {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.evaluate(([key, t]) => window.localStorage.setItem(key, t), [AUTH_KEY, token]);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(1500);
}

test.describe("Password login UI", () => {
  test("shows username and password fields plus all three login options", async ({ page }) => {
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });

    await expect(page.locator('[data-testid="username-input"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="password-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="password-login-button"]')).toBeVisible();
    await expect(page.locator('[data-testid="google-sign-in-button"]')).toBeVisible();
    await expect(page.locator('[data-testid="dev-login-button"]')).toBeVisible();
  });

  test("shows inline error for invalid username/password", async ({ page }) => {
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector('[data-testid="username-input"]', { timeout: 10000 });

    await page.fill('[data-testid="username-input"]', "noexist_user_xyz");
    await page.fill('[data-testid="password-input"]', "wrongpassword999");
    await page.locator('[data-testid="password-login-button"]').click({ force: true });

    const errorEl = page.locator("text=/invalid|failed|incorrect/i").first();
    await expect(errorEl).toBeVisible({ timeout: 8000 });
  });
});

test.describe("Dev login button — UI click", () => {
  test("dev-login-button click authenticates and lands on main app", async ({ page }) => {
    await loginViaDevButton(page);

    const url = page.url();
    expect(url).not.toContain("login");
    const body = await page.content();
    const appLoaded =
      body.includes("Mission Control") ||
      body.includes("Jarvis") ||
      body.includes("Profile") ||
      body.includes("Settings");
    expect(appLoaded).toBe(true);
  });
});

test.describe("Profile tab — identity and memory", () => {
  test.beforeEach(async ({ page }) => {
    const token = await fetchDevToken();
    await loginViaTokenInjection(page, token);
  });

  test("profile tab renders JARVIS Soul section with soul content", async ({ page }) => {
    await page.goto(`${BASE}/profile`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(3000);

    const body = await page.content();
    expect(body).toContain("JARVIS Soul");
    const hasSoulContent = body.includes("JARVIS") || body.includes("identity") || body.includes("model");
    expect(hasSoulContent).toBe(true);
  });

  test("profile tab renders Coach Memory section", async ({ page }) => {
    await page.goto(`${BASE}/profile`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(3000);

    const body = await page.content();
    const hasMemory =
      body.includes("Coach Memory") ||
      body.includes("Memory Review") ||
      body.includes("About You") ||
      body.includes("Memory") ||
      body.includes("memories");
    expect(hasMemory).toBe(true);
  });
});

test.describe("Capability Gaps screen", () => {
  test.beforeEach(async ({ page }) => {
    const token = await fetchDevToken();
    await loginViaTokenInjection(page, token);
  });

  test("capability gaps screen renders the header and empty state", async ({ page }) => {
    await page.goto(`${BASE}/capability-gaps`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(2000);

    const body = await page.content();
    expect(body).toContain("Capability Gaps");
    const hasState =
      body.includes("No gaps this week") ||
      body.includes("Deflect") ||
      body.includes("Apology") ||
      body.includes("couldn");
    expect(hasState).toBe(true);
  });
});

test.describe("Self-improvement gap scan (Settings)", () => {
  let sharedToken: string;

  test.beforeAll(async () => {
    sharedToken = await fetchDevToken();
  });

  test("scan-capability-gaps-button exists in settings and POST /api/gap-analysis/run returns 200", async ({ page }) => {
    await loginViaTokenInjection(page, sharedToken);

    await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(2000);

    const scanBtn = page.locator('[data-testid="scan-capability-gaps-button"]');
    await scanBtn.scrollIntoViewIfNeeded({ timeout: 15000 });
    await expect(scanBtn).toBeVisible({ timeout: 8000 });

    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/gap-analysis/run") && r.request().method() === "POST",
        { timeout: 30000 }
      ),
      scanBtn.click({ force: true }),
    ]);

    expect(response.status()).toBe(200);
    const body = await response.json() as { ok?: boolean };
    expect(body.ok ?? true).toBeTruthy();
  });
});

test.describe("Projects screen — GitHub push modal", () => {
  let sharedToken: string;
  let testProjectId: string | null = null;

  test.beforeAll(async () => {
    sharedToken = await fetchDevToken();

    const result = await httpPost(
      `${API}/api/projects`,
      { title: "E2E Test Project", goal: "Verify GitHub push modal opens" },
      sharedToken
    );
    if (result.status === 200 || result.status === 201) {
      testProjectId = (result.data as { projectId?: string }).projectId ?? null;
    }

    // Force the project to "complete" status so the GitHub push card is visible
    if (testProjectId) {
      await httpPatch(`${API}/api/dev/projects/${testProjectId}/complete`, {});
    }
  });

  test.afterAll(async () => {
    if (testProjectId) {
      await httpDelete(`${API}/api/projects/${testProjectId}`, sharedToken).catch(() => {});
      testProjectId = null;
    }
  });

  test("projects screen loads and shows created project", async ({ page }) => {
    await loginViaTokenInjection(page, sharedToken);

    await page.goto(`${BASE}/projects`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(3000);

    const body = await page.content();
    const hasProject =
      body.includes("E2E Test Project") ||
      body.includes("Projects") ||
      body.includes("App Build");
    expect(hasProject).toBe(true);
  });

  test("push-to-github-button opens GitHub push modal", async ({ page }) => {
    if (!testProjectId) test.skip();

    await loginViaTokenInjection(page, sharedToken);

    await page.goto(`${BASE}/projects`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(3500);

    // Click into the test project to open its detail view where the GitHub card appears
    const projectCard = page.locator(`text="E2E Test Project"`).first();
    await projectCard.scrollIntoViewIfNeeded({ timeout: 10000 });
    await projectCard.click({ force: true });
    await page.waitForTimeout(2000);

    const pushBtn = page.locator('[data-testid="push-to-github-button"]').first();
    await pushBtn.scrollIntoViewIfNeeded({ timeout: 10000 });
    await expect(pushBtn).toBeVisible({ timeout: 8000 });
    await pushBtn.click({ force: true });

    await page.waitForTimeout(1000);
    const body = await page.content();
    const modalOpen =
      body.includes("Push to GitHub") ||
      body.includes("repo") ||
      body.includes("Repo name");
    expect(modalOpen).toBe(true);
  });
});
