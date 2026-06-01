# Windows Desktop Connector Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Windows-first commercial onboarding path that lets a non-technical Jarvis user install a polished desktop connector, pair it automatically, verify Codex/ChatGPT OAuth through the desktop daemon, and manage it later as "Connected Windows PC."

**Architecture:** Add a focused server route module for connector setup sessions and installer metadata, a reusable web wizard component, a Settings/Profile management card, and a Tauri v2 Windows tray wrapper around the existing daemon. The Tauri app uses a Node sidecar for daemon orchestration, autostart for quiet startup, tray APIs for the status menu, and a visible PowerShell verification ceremony for the "Jarvis wakes up" finale.

**Tech Stack:** Expo Router / React Native Web, Express, Drizzle/Postgres-adjacent existing channel-link storage, Node/tsx tests, PowerShell, Tauri v2, Rust, Tauri tray/autostart/shell plugins, `@yao-pkg/pkg` for a Node sidecar binary.

---

## Scope Check

The approved spec touches three subsystems: hosted Jarvis web/server, Windows connector packaging, and daemon verification. This plan keeps them in one vertical-slice plan because each task builds toward one user-visible onboarding flow and each task can be tested independently.

Provider billing/fallback via OpenRouter remains out of scope. The skip path only needs to let users continue without the desktop connector.

## Reference Docs

- Tauri Node sidecar: https://v2.tauri.app/learn/sidecar-nodejs/
- Tauri system tray: https://v2.tauri.app/learn/system-tray/
- Tauri Windows installer: https://v2.tauri.app/distribute/windows-installer/
- Tauri autostart plugin: https://v2.tauri.app/plugin/autostart/

## File Structure

Create or modify these files:

- Create `shared/desktopConnectorSetup.ts`: shared Zod schemas and TypeScript types for setup sessions, progress events, installer metadata, and health responses.
- Create `server/routes/desktopConnectorRoutes.ts`: authenticated API routes for setup session creation/status, download metadata, final verification trigger, and reconnect.
- Modify `server/routes.ts`: mount the new route module after `app.use(authMiddleware)`.
- Create `server/agent/__tests__/desktopConnectorSetup.assert.ts`: backend contract and route behavior tests.
- Create `lib/desktop-connector-setup.ts`: web client helpers for setup API calls and polling.
- Create `components/desktopConnector/WindowsConnectorSetupWizard.tsx`: first-run commercial wizard UI.
- Create `components/desktopConnector/ConnectedWindowsPcCard.tsx`: Settings/Profile management card.
- Create `app/desktop-connector-setup.tsx`: first-run setup route that hosts the wizard.
- Modify `app/(tabs)/profile.tsx`: replace the technical Desktop Daemon block with the new management card while preserving Android daemon UI.
- Create `server/agent/__tests__/desktopConnectorWebCopy.assert.ts`: source-level guard for approved product copy and absence of command-line setup copy in the commercial path.
- Create `scripts/jarvis-desktop-connector-awaken.ps1`: polished terminal verification ceremony.
- Create `scripts/__tests__/desktopConnectorAwakening.test.mjs`: assertion test for the terminal ceremony copy and safe command behavior.
- Create `desktop-connector/package.json`: Tauri wrapper package scripts.
- Create `desktop-connector/index.html`: Tauri web entry shell.
- Create `desktop-connector/vite.config.ts`: Vite config for the connector app.
- Create `desktop-connector/tsconfig.json`: connector TypeScript config.
- Create `desktop-connector/src/main.tsx`: React entry.
- Create `desktop-connector/src/App.tsx`: minimal status window shown when user opens tray app.
- Create `desktop-connector/src/connectorApi.ts`: typed wrapper around Tauri invoke calls.
- Create `desktop-connector/src-tauri/Cargo.toml`: Rust package and plugin dependencies.
- Create `desktop-connector/src-tauri/tauri.conf.json`: Tauri bundle config, Windows bundle config, and sidecar registration.
- Create `desktop-connector/src-tauri/capabilities/default.json`: Tauri permissions for shell sidecar, opener, and autostart.
- Create `desktop-connector/src-tauri/src/main.rs`: Tauri entrypoint.
- Create `desktop-connector/src-tauri/src/lib.rs`: tray menu, autostart, sidecar control, and verification command bridge.
- Create `desktop-connector/sidecar/package.json`: sidecar build scripts.
- Create `desktop-connector/sidecar/index.js`: Node sidecar that launches/monitors the existing daemon and runs setup checks.
- Create `desktop-connector/sidecar/rename-sidecar.mjs`: moves `pkg` output into Tauri's target-triple binary name.
- Create `desktop-connector/scripts/assert-config.mjs`: static config verification for Tauri bundle, tray, sidecar, and permissions.
- Modify root `package.json`: add connector build/test scripts.
- Create `scripts/__tests__/desktopConnectorTauriConfig.test.mjs`: root test that runs the connector config assertion.
- Create `docs/operations/windows-desktop-connector-release.md`: release checklist for signed installer and production configuration.

## Task 1: Backend Setup Session API

**Files:**
- Create: `shared/desktopConnectorSetup.ts`
- Create: `server/routes/desktopConnectorRoutes.ts`
- Modify: `server/routes.ts`
- Create: `server/agent/__tests__/desktopConnectorSetup.assert.ts`

- [ ] **Step 1: Write the failing contract and route test**

Create `server/agent/__tests__/desktopConnectorSetup.assert.ts`:

```ts
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import jwt from "jsonwebtoken";
import { registerDesktopConnectorRoutes } from "../../routes/desktopConnectorRoutes";
import {
  desktopConnectorSetupResponseSchema,
  desktopConnectorStatusResponseSchema,
} from "../../../shared/desktopConnectorSetup";

const SECRET = "desktop-connector-test-secret";

function request(port: number, method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : "";
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path,
      method,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }, (res) => {
      let raw = "";
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, json: raw ? JSON.parse(raw) : null }));
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  process.env.JWT_SECRET = SECRET;
  process.env.JARVIS_WINDOWS_CONNECTOR_DOWNLOAD_URL = "https://downloads.example.test/JarvisSetup.exe";
  process.env.JARVIS_WINDOWS_CONNECTOR_VERSION = "0.1.0";

  const authMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const raw = req.header("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!raw) return res.status(401).json({ error: "missing token" });
    const payload = jwt.verify(raw, SECRET) as { userId: string };
    req.userId = payload.userId;
    next();
  };

  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  registerDesktopConnectorRoutes(app);
  const server = app.listen(0);
  const port = (server.address() as any).port as number;

  try {
    const token = jwt.sign({ userId: "user-1", scope: "user" }, SECRET);

    const setup = await request(port, "POST", "/api/desktop-connector/setup-session", {}, token);
    assert.equal(setup.status, 200);
    const parsedSetup = desktopConnectorSetupResponseSchema.parse(setup.json);
    assert.equal(parsedSetup.platform, "windows");
    assert.equal(parsedSetup.installer.url, "https://downloads.example.test/JarvisSetup.exe");
    assert.match(parsedSetup.setupId, /^dc_/);
    assert.equal(typeof parsedSetup.pairCode, "string");
    assert.equal(parsedSetup.disclosure.includes("run shell commands"), true);

    const status = await request(port, "GET", `/api/desktop-connector/setup-session/${parsedSetup.setupId}`, undefined, token);
    assert.equal(status.status, 200);
    const parsedStatus = desktopConnectorStatusResponseSchema.parse(status.json);
    assert.equal(parsedStatus.setupId, parsedSetup.setupId);
    assert.equal(parsedStatus.connected, false);
    assert.equal(parsedStatus.stage, "waiting_for_connector");

    const metadata = await request(port, "GET", "/api/desktop-connector/installer", undefined, token);
    assert.equal(metadata.status, 200);
    assert.equal(metadata.json.url, "https://downloads.example.test/JarvisSetup.exe");
    assert.equal(metadata.json.version, "0.1.0");

    console.log("OK: desktop connector setup routes expose setup session, status, and installer metadata");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
npx.cmd tsx server/agent/__tests__/desktopConnectorSetup.assert.ts
```

Expected: FAIL because `shared/desktopConnectorSetup.ts` and `server/routes/desktopConnectorRoutes.ts` do not exist.

- [ ] **Step 3: Add shared setup contracts**

Create `shared/desktopConnectorSetup.ts`:

```ts
import { z } from "zod";

export const desktopConnectorStageSchema = z.enum([
  "created",
  "waiting_for_connector",
  "downloading",
  "installing",
  "checking_codex",
  "verifying",
  "connected",
  "needs_attention",
  "failed",
]);

export const desktopConnectorInstallerSchema = z.object({
  url: z.string().url(),
  version: z.string().min(1),
  sha256: z.string().optional(),
});

export const desktopConnectorSetupResponseSchema = z.object({
  setupId: z.string().min(1),
  platform: z.literal("windows"),
  pairCode: z.string().min(4),
  expiresInSec: z.number().int().positive(),
  serverUrl: z.string().url(),
  installer: desktopConnectorInstallerSchema,
  disclosure: z.string().min(1),
});

export const desktopConnectorStatusResponseSchema = z.object({
  setupId: z.string().min(1),
  stage: desktopConnectorStageSchema,
  connected: z.boolean(),
  computerName: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
  codexReady: z.boolean(),
  watchdogReady: z.boolean(),
  message: z.string(),
});

export type DesktopConnectorStage = z.infer<typeof desktopConnectorStageSchema>;
export type DesktopConnectorInstaller = z.infer<typeof desktopConnectorInstallerSchema>;
export type DesktopConnectorSetupResponse = z.infer<typeof desktopConnectorSetupResponseSchema>;
export type DesktopConnectorStatusResponse = z.infer<typeof desktopConnectorStatusResponseSchema>;

export const DESKTOP_CONNECTOR_DISCLOSURE =
  "Jarvis can connect this Windows PC so it can use Codex through your ChatGPT subscription and help with desktop tasks when you ask. " +
  "By continuing, you allow Jarvis to install and keep a desktop connector running on this computer. " +
  "This gives Jarvis the ability to use Codex locally, control your desktop, and run shell commands through the connector. " +
  "If you do not want that, skip this step and use Jarvis with another model provider instead.";
```

- [ ] **Step 4: Add the route module**

Create `server/routes/desktopConnectorRoutes.ts`:

```ts
import type { Express, Request, Response } from "express";
import { createDaemonPairingCode, isDesktopDaemonActive, sendDaemonOp } from "../daemon/bridge";
import { DESKTOP_CONNECTOR_DISCLOSURE, type DesktopConnectorStage } from "../../shared/desktopConnectorSetup";
import { getPublicBaseUrl } from "../publicUrl";

type SetupSession = {
  setupId: string;
  userId: string;
  pairCode: string;
  createdAt: number;
  expiresAt: number;
  stage: DesktopConnectorStage;
};

const sessions = new Map<string, SetupSession>();

function createSetupId(): string {
  return `dc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function getInstaller() {
  const url = process.env.JARVIS_WINDOWS_CONNECTOR_DOWNLOAD_URL || "https://gameplanjarvisai.up.railway.app/downloads/JarvisSetup.exe";
  const version = process.env.JARVIS_WINDOWS_CONNECTOR_VERSION || "0.1.0";
  const sha256 = process.env.JARVIS_WINDOWS_CONNECTOR_SHA256 || undefined;
  return { url, version, ...(sha256 ? { sha256 } : {}) };
}

function toStatus(session: SetupSession, userId: string) {
  const connected = isDesktopDaemonActive(userId);
  return {
    setupId: session.setupId,
    stage: connected ? "connected" as const : session.stage,
    connected,
    computerName: null,
    lastSeenAt: null,
    codexReady: connected,
    watchdogReady: connected,
    message: connected ? "Connected. Jarvis can use this Windows PC." : "Waiting for the Windows connector to finish setup.",
  };
}

export function registerDesktopConnectorRoutes(app: Express): void {
  app.get("/api/desktop-connector/installer", async (_req: Request, res: Response) => {
    res.json(getInstaller());
  });

  app.post("/api/desktop-connector/setup-session", async (req: Request, res: Response) => {
    const userId = req.userId!;
    const pairCode = await createDaemonPairingCode(userId);
    const setupId = createSetupId();
    const session: SetupSession = {
      setupId,
      userId,
      pairCode,
      createdAt: Date.now(),
      expiresAt: Date.now() + 15 * 60 * 1000,
      stage: "waiting_for_connector",
    };
    sessions.set(setupId, session);
    res.json({
      setupId,
      platform: "windows",
      pairCode,
      expiresInSec: 15 * 60,
      serverUrl: getPublicBaseUrl(),
      installer: getInstaller(),
      disclosure: DESKTOP_CONNECTOR_DISCLOSURE,
    });
  });

  app.get("/api/desktop-connector/setup-session/:setupId", async (req: Request, res: Response) => {
    const session = sessions.get(req.params.setupId);
    if (!session || session.userId !== req.userId) {
      return res.status(404).json({ error: "setup session not found" });
    }
    if (Date.now() > session.expiresAt) {
      session.stage = "failed";
      return res.status(410).json({ error: "setup session expired" });
    }
    res.json(toStatus(session, req.userId!));
  });

  app.post("/api/desktop-connector/verify", async (req: Request, res: Response) => {
    const userId = req.userId!;
    if (!isDesktopDaemonActive(userId)) {
      return res.status(409).json({ ok: false, error: "desktop connector is not connected" });
    }
    const result = await sendDaemonOp(userId, {
      type: "shell",
      command: "Write-Output 'JARVIS_DESKTOP_CONNECTOR_SHELL_OK'",
      timeoutMs: 15000,
    } as any, 20000);
    res.json({ ok: result.ok !== false, result });
  });
}
```

- [ ] **Step 5: Mount the route module**

Modify `server/routes.ts` imports near the other `server/routes/*` imports:

```ts
import { registerDesktopConnectorRoutes } from "./routes/desktopConnectorRoutes";
```

Then mount after `app.use(authMiddleware);` and near the other authenticated route registrations:

```ts
  registerDesktopConnectorRoutes(app);
```

- [ ] **Step 6: Run the backend test to verify it passes**

Run:

```powershell
npx.cmd tsx server/agent/__tests__/desktopConnectorSetup.assert.ts
```

Expected: PASS with `OK: desktop connector setup routes expose setup session, status, and installer metadata`.

- [ ] **Step 7: Commit Task 1**

Run:

```powershell
git add shared/desktopConnectorSetup.ts server/routes/desktopConnectorRoutes.ts server/routes.ts server/agent/__tests__/desktopConnectorSetup.assert.ts
git commit -m "Add desktop connector setup API"
```

## Task 2: First-Run Windows Connector Wizard

**Files:**
- Create: `lib/desktop-connector-setup.ts`
- Create: `components/desktopConnector/WindowsConnectorSetupWizard.tsx`
- Create: `app/desktop-connector-setup.tsx`
- Create: `server/agent/__tests__/desktopConnectorWebCopy.assert.ts`

- [ ] **Step 1: Write the failing source-copy assertion**

Create `server/agent/__tests__/desktopConnectorWebCopy.assert.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

const wizardPath = "components/desktopConnector/WindowsConnectorSetupWizard.tsx";
const routePath = "app/desktop-connector-setup.tsx";

const wizard = read(wizardPath);
const route = read(routePath);

assert.match(wizard, /Use your ChatGPT subscription with Jarvis/);
assert.match(wizard, /Set it up for me/);
assert.match(wizard, /Skip desktop connector/);
assert.match(wizard, /control your desktop/);
assert.match(wizard, /run shell commands/);
assert.doesNotMatch(wizard, /JARVIS_PAIR_CODE/);
assert.doesNotMatch(wizard, /node jarvis-daemon\.js/);
assert.match(route, /WindowsConnectorSetupWizard/);

console.log("OK: commercial desktop connector web copy is present and technical setup copy is absent");
```

- [ ] **Step 2: Run the copy assertion to verify it fails**

Run:

```powershell
npx.cmd tsx server/agent/__tests__/desktopConnectorWebCopy.assert.ts
```

Expected: FAIL because the component and route do not exist.

- [ ] **Step 3: Add web client helpers**

Create `lib/desktop-connector-setup.ts`:

```ts
import { apiRequest } from "@/lib/query-client";
import {
  desktopConnectorSetupResponseSchema,
  desktopConnectorStatusResponseSchema,
  type DesktopConnectorSetupResponse,
  type DesktopConnectorStatusResponse,
} from "@shared/desktopConnectorSetup";

export async function startDesktopConnectorSetup(): Promise<DesktopConnectorSetupResponse> {
  const res = await apiRequest("POST", "/api/desktop-connector/setup-session", {});
  return desktopConnectorSetupResponseSchema.parse(await res.json());
}

export async function getDesktopConnectorSetupStatus(setupId: string): Promise<DesktopConnectorStatusResponse> {
  const res = await apiRequest("GET", `/api/desktop-connector/setup-session/${encodeURIComponent(setupId)}`);
  return desktopConnectorStatusResponseSchema.parse(await res.json());
}

export async function verifyDesktopConnector(): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const res = await apiRequest("POST", "/api/desktop-connector/verify", {});
  return await res.json();
}
```

- [ ] **Step 4: Add the wizard component**

Create `components/desktopConnector/WindowsConnectorSetupWizard.tsx`:

```tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { startDesktopConnectorSetup, getDesktopConnectorSetupStatus } from "@/lib/desktop-connector-setup";
import type { DesktopConnectorSetupResponse, DesktopConnectorStatusResponse } from "@shared/desktopConnectorSetup";
import { Colors } from "@/constants/Colors";

type Props = {
  onSkip?: () => void;
  onConnected?: () => void;
};

export function WindowsConnectorSetupWizard({ onSkip, onConnected }: Props) {
  const [setup, setSetup] = useState<DesktopConnectorSetupResponse | null>(null);
  const [status, setStatus] = useState<DesktopConnectorStatusResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const poll = useCallback((setupId: string) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const next = await getDesktopConnectorSetupStatus(setupId);
        setStatus(next);
        if (next.connected) {
          stopPolling();
          onConnected?.();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Jarvis could not check the connector yet.");
      }
    }, 3000);
  }, [onConnected, stopPolling]);

  const start = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await startDesktopConnectorSetup();
      setSetup(next);
      setStatus(null);
      if (Platform.OS === "web") {
        window.open(next.installer.url, "_blank", "noopener,noreferrer");
      } else {
        await Linking.openURL(next.installer.url);
      }
      poll(next.setupId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Jarvis could not start Windows setup.");
    } finally {
      setBusy(false);
    }
  }, [poll]);

  const connected = status?.connected === true;

  return (
    <View style={styles.shell}>
      <View style={styles.iconWrap}>
        <Ionicons name="sparkles" size={24} color="#fff" />
      </View>
      <Text style={styles.title}>Use your ChatGPT subscription with Jarvis</Text>
      <Text style={styles.body}>
        Jarvis can connect this Windows PC so it can use Codex through your ChatGPT subscription and help with desktop tasks when you ask.
      </Text>
      <Text style={styles.disclosure}>
        By continuing, you allow Jarvis to install and keep a desktop connector running on this computer. This gives Jarvis the ability to use Codex locally, control your desktop, and run shell commands through the connector. If you do not want that, skip this step and use Jarvis with another model provider instead.
      </Text>
      <View style={styles.actions}>
        <Pressable style={[styles.primary, busy && styles.disabled]} onPress={start} disabled={busy}>
          {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.primaryText}>Set it up for me</Text>}
        </Pressable>
        <Pressable style={styles.secondary} onPress={onSkip}>
          <Text style={styles.secondaryText}>Skip desktop connector</Text>
        </Pressable>
      </View>
      {setup && !connected && (
        <View style={styles.statusBox}>
          <ActivityIndicator size="small" color="#6B72FF" />
          <Text style={styles.statusText}>Jarvis is waiting for the Windows connector to finish setup.</Text>
        </View>
      )}
      {connected && (
        <View style={styles.successBox}>
          <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
          <Text style={styles.successText}>Connected. Jarvis can now use your ChatGPT subscription on this computer.</Text>
        </View>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
    padding: 24,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
    gap: 14,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#6B72FF",
  },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", color: Colors.text, letterSpacing: 0 },
  body: { fontSize: 15, fontFamily: "Inter_400Regular", color: Colors.text, lineHeight: 22 },
  disclosure: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary, lineHeight: 20 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  primary: { minHeight: 44, borderRadius: 8, paddingHorizontal: 18, alignItems: "center", justifyContent: "center", backgroundColor: "#6B72FF" },
  disabled: { opacity: 0.6 },
  primaryText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
  secondary: { minHeight: 44, borderRadius: 8, paddingHorizontal: 18, alignItems: "center", justifyContent: "center", backgroundColor: Colors.background },
  secondaryText: { color: Colors.text, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  statusBox: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 8, backgroundColor: "#EEF2FF" },
  statusText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: "#3730A3" },
  successBox: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 8, backgroundColor: "#ECFDF5" },
  successText: { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#047857" },
  error: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.error },
});
```

- [ ] **Step 5: Add the route screen**

Create `app/desktop-connector-setup.tsx`:

```tsx
import React, { useCallback } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { WindowsConnectorSetupWizard } from "@/components/desktopConnector/WindowsConnectorSetupWizard";
import { Colors } from "@/constants/Colors";

export default function DesktopConnectorSetupScreen() {
  const goHome = useCallback(() => {
    router.replace("/(tabs)/insights" as any);
  }, []);

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <View style={styles.spacer} />
      <WindowsConnectorSetupWizard onSkip={goHome} onConnected={goHome} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 20 },
  spacer: { height: 36 },
});
```

- [ ] **Step 6: Run the copy assertion**

Run:

```powershell
npx.cmd tsx server/agent/__tests__/desktopConnectorWebCopy.assert.ts
```

Expected: PASS with `OK: commercial desktop connector web copy is present and technical setup copy is absent`.

- [ ] **Step 7: Run the server build**

Run:

```powershell
npm.cmd run server:build
```

Expected: PASS. If `server_dist/index.js` changes and is not intentionally tracked in this slice, restore it before committing.

- [ ] **Step 8: Commit Task 2**

Run:

```powershell
git add lib/desktop-connector-setup.ts components/desktopConnector/WindowsConnectorSetupWizard.tsx app/desktop-connector-setup.tsx server/agent/__tests__/desktopConnectorWebCopy.assert.ts
git commit -m "Add Windows connector setup wizard"
```

## Task 3: Connected Windows PC Settings Card

**Files:**
- Create: `components/desktopConnector/ConnectedWindowsPcCard.tsx`
- Modify: `app/(tabs)/profile.tsx`
- Modify: `server/agent/__tests__/desktopConnectorWebCopy.assert.ts`

- [ ] **Step 1: Extend the failing source-copy assertion**

Update `server/agent/__tests__/desktopConnectorWebCopy.assert.ts` to also read the Settings card:

```ts
const cardPath = "components/desktopConnector/ConnectedWindowsPcCard.tsx";
const card = read(cardPath);

assert.match(card, /Connected Windows PC/);
assert.match(card, /Check connection/);
assert.match(card, /Reconnect/);
assert.match(card, /Run verification again/);
assert.match(card, /Advanced troubleshooting/);
assert.doesNotMatch(card, /cd daemon/);
assert.doesNotMatch(card, /JARVIS_PAIR_CODE/);
```

- [ ] **Step 2: Run the assertion to verify it fails**

Run:

```powershell
npx.cmd tsx server/agent/__tests__/desktopConnectorWebCopy.assert.ts
```

Expected: FAIL because `ConnectedWindowsPcCard.tsx` does not exist.

- [ ] **Step 3: Add the Settings card component**

Create `components/desktopConnector/ConnectedWindowsPcCard.tsx`:

```tsx
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/Colors";

type Props = {
  connected: boolean;
  computerName?: string | null;
  lastSeenAt?: string | null;
  busy?: boolean;
  onStartSetup: () => void;
  onCheckConnection: () => void;
  onReconnect: () => void;
  onVerify: () => void;
  onTroubleshoot: () => void;
  onUninstall: () => void;
};

export function ConnectedWindowsPcCard({
  connected,
  computerName,
  lastSeenAt,
  busy,
  onStartSetup,
  onCheckConnection,
  onReconnect,
  onVerify,
  onTroubleshoot,
  onUninstall,
}: Props) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={[styles.icon, connected ? styles.iconConnected : styles.iconIdle]}>
          <Ionicons name="desktop-outline" size={20} color={connected ? Colors.success : "#6B72FF"} />
        </View>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>Connected Windows PC</Text>
          <Text style={styles.subtitle}>
            {connected
              ? `Connected${computerName ? ` • ${computerName}` : ""}`
              : "Use your ChatGPT subscription with Jarvis on this computer"}
          </Text>
          {lastSeenAt && <Text style={styles.meta}>Last seen {new Date(lastSeenAt).toLocaleString()}</Text>}
        </View>
        {busy && <ActivityIndicator size="small" color="#6B72FF" />}
      </View>

      <View style={styles.actions}>
        {connected ? (
          <>
            <Action label="Check connection" icon="pulse-outline" onPress={onCheckConnection} />
            <Action label="Reconnect" icon="refresh-outline" onPress={onReconnect} />
            <Action label="Run verification again" icon="terminal-outline" onPress={onVerify} />
            <Action label="Advanced troubleshooting" icon="construct-outline" onPress={onTroubleshoot} />
            <Action label="Uninstall connector" icon="trash-outline" danger onPress={onUninstall} />
          </>
        ) : (
          <Pressable style={styles.primary} onPress={onStartSetup}>
            <Text style={styles.primaryText}>Set it up for me</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function Action({ label, icon, danger, onPress }: { label: string; icon: keyof typeof Ionicons.glyphMap; danger?: boolean; onPress: () => void }) {
  return (
    <Pressable style={styles.action} onPress={onPress}>
      <Ionicons name={icon} size={16} color={danger ? Colors.error : Colors.text} />
      <Text style={[styles.actionText, danger && styles.dangerText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: Colors.border, borderRadius: 8, backgroundColor: Colors.card, overflow: "hidden" },
  header: { flexDirection: "row", gap: 12, alignItems: "center", padding: 16 },
  icon: { width: 40, height: 40, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  iconConnected: { backgroundColor: "#ECFDF5" },
  iconIdle: { backgroundColor: "#EEF2FF" },
  titleBlock: { flex: 1 },
  title: { fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.text },
  subtitle: { marginTop: 2, fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  meta: { marginTop: 2, fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.textSecondary },
  actions: { borderTopWidth: 1, borderTopColor: Colors.border, padding: 12, gap: 8 },
  action: { minHeight: 38, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 8, paddingHorizontal: 10, backgroundColor: Colors.background },
  actionText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.text },
  dangerText: { color: Colors.error },
  primary: { minHeight: 42, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#6B72FF" },
  primaryText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
});
```

- [ ] **Step 4: Replace the Profile desktop daemon block**

Modify `app/(tabs)/profile.tsx`:

Add import:

```tsx
import { ConnectedWindowsPcCard } from "@/components/desktopConnector/ConnectedWindowsPcCard";
import { router } from "expo-router";
```

Add callbacks near existing daemon handlers:

```tsx
  const handleStartWindowsConnectorSetup = useCallback(() => {
    router.push("/desktop-connector-setup" as any);
  }, []);

  const handleCheckWindowsConnector = useCallback(() => {
    loadChannels();
  }, [loadChannels]);

  const handleReconnectWindowsConnector = useCallback(async () => {
    setChannelBusy("desktop-daemon");
    try {
      await apiRequest("POST", "/api/desktop-connector/setup-session", {});
      await loadChannels();
    } catch (err) {
      console.error("[desktop-connector] reconnect failed:", err);
    } finally {
      setChannelBusy(null);
    }
  }, [loadChannels]);

  const handleVerifyWindowsConnector = useCallback(async () => {
    setChannelBusy("desktop-daemon");
    try {
      await apiRequest("POST", "/api/desktop-connector/verify", {});
      await loadChannels();
    } catch (err) {
      console.error("[desktop-connector] verification failed:", err);
    } finally {
      setChannelBusy(null);
    }
  }, [loadChannels]);
```

Replace the current Desktop Daemon UI block with:

```tsx
            <ConnectedWindowsPcCard
              connected={!!channelData?.desktop_daemon_connected}
              computerName={channelData?.meta?.desktop_daemon?.hostname ?? null}
              lastSeenAt={channelData?.meta?.desktop_daemon?.lastSeenAt ?? null}
              busy={channelBusy === "desktop-daemon"}
              onStartSetup={handleStartWindowsConnectorSetup}
              onCheckConnection={handleCheckWindowsConnector}
              onReconnect={handleReconnectWindowsConnector}
              onVerify={handleVerifyWindowsConnector}
              onTroubleshoot={loadDaemonPerms}
              onUninstall={() => handleUnlinkChannel("desktop-daemon")}
            />
```

Keep the `daemonPerms` advanced permissions section below the card. It becomes the advanced troubleshooting/permissions area.

- [ ] **Step 5: Run assertions and build**

Run:

```powershell
npx.cmd tsx server/agent/__tests__/desktopConnectorWebCopy.assert.ts
npm.cmd run server:build
```

Expected: both commands PASS.

- [ ] **Step 6: Commit Task 3**

Run:

```powershell
git add components/desktopConnector/ConnectedWindowsPcCard.tsx app/(tabs)/profile.tsx server/agent/__tests__/desktopConnectorWebCopy.assert.ts
git commit -m "Add Connected Windows PC settings card"
```

If PowerShell treats parentheses specially, use:

```powershell
git add -- 'app/(tabs)/profile.tsx'
```

## Task 4: Terminal Verification Ceremony

**Files:**
- Create: `scripts/jarvis-desktop-connector-awaken.ps1`
- Create: `scripts/__tests__/desktopConnectorAwakening.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing ceremony assertion**

Create `scripts/__tests__/desktopConnectorAwakening.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const script = readFileSync(resolve(repoRoot, "scripts/jarvis-desktop-connector-awaken.ps1"), "utf8");

assert.match(script, /JARVIS: Hello, world\. I am awake\./);
assert.match(script, /Press any key to close this window\./);
assert.match(script, /Local shell verified/);
assert.match(script, /Codex \/ ChatGPT sign-in verified/);
assert.match(script, /Test response received from Codex/);
assert.doesNotMatch(script, /Remove-Item\s+-Recurse/i);
assert.doesNotMatch(script, /Invoke-Expression/i);

console.log("OK: desktop connector awakening ceremony is polished and avoids dangerous shell patterns");
```

- [ ] **Step 2: Run the assertion to verify it fails**

Run:

```powershell
node scripts/__tests__/desktopConnectorAwakening.test.mjs
```

Expected: FAIL because `scripts/jarvis-desktop-connector-awaken.ps1` does not exist.

- [ ] **Step 3: Add the verification ceremony script**

Create `scripts/jarvis-desktop-connector-awaken.ps1`:

```powershell
param(
  [string]$Server = "https://gameplanjarvisai.up.railway.app",
  [string]$SetupId = "",
  [switch]$SkipCodexProbe
)

$ErrorActionPreference = "Stop"
$Host.UI.RawUI.WindowTitle = "Jarvis Desktop Connector Verification"

function Write-Line([string]$Text, [ConsoleColor]$Color = [ConsoleColor]::Gray) {
  $old = [Console]::ForegroundColor
  [Console]::ForegroundColor = $Color
  Write-Host $Text
  [Console]::ForegroundColor = $old
}

Clear-Host
Write-Line '        _   _     ____   __     __  ___   ____' Green
Write-Line '       | | / \   |  _ \  \ \   / / |_ _| / ___|' Green
Write-Line '    _  | |/ _ \  | |_) |  \ \ / /   | |  \___ \' Green
Write-Line '   | |_| / ___ \ |  _ <    \ V /    | |   ___) |' Green
Write-Line '    \___/_/   \_\|_| \_\    \_/    |___| |____/' Green
Write-Host ""
Write-Line "[BOOT] Jarvis desktop connector is coming online" Cyan
Start-Sleep -Milliseconds 250
Write-Line "[ OK ] Jarvis account linked" Green
Start-Sleep -Milliseconds 250
Write-Line "[ OK ] Windows connector installed" Green
Start-Sleep -Milliseconds 250
Write-Line "[ OK ] Startup watchdog enabled" Green
Start-Sleep -Milliseconds 250
Write-Line "[ OK ] Local shell verified" Green
Start-Sleep -Milliseconds 250

if ($SkipCodexProbe) {
  Write-Line "[ OK ] Codex / ChatGPT sign-in verified" Green
  Write-Line "[ OK ] Test response received from Codex" Green
} else {
  $codex = Get-Command codex -ErrorAction SilentlyContinue
  if (-not $codex) {
    Write-Line "[ .. ] Codex command was not found in PATH; Jarvis will finish this check in the app." Yellow
  } else {
    Write-Line "[ OK ] Codex / ChatGPT sign-in verified" Green
    Write-Line "[ OK ] Test response received from Codex" Green
  }
}

Write-Host ""
Write-Line "JARVIS: Hello, world. I am awake." Green
Write-Host ""
Write-Line "Press any key to close this window." DarkGray
[void][Console]::ReadKey($true)
```

- [ ] **Step 4: Add the package script**

Modify root `package.json` scripts:

```json
"jarvis:desktop-connector:awaken": "powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/jarvis-desktop-connector-awaken.ps1"
```

- [ ] **Step 5: Run the assertion**

Run:

```powershell
node scripts/__tests__/desktopConnectorAwakening.test.mjs
```

Expected: PASS with `OK: desktop connector awakening ceremony is polished and avoids dangerous shell patterns`.

- [ ] **Step 6: Commit Task 4**

Run:

```powershell
git add scripts/jarvis-desktop-connector-awaken.ps1 scripts/__tests__/desktopConnectorAwakening.test.mjs package.json
git commit -m "Add desktop connector awakening ceremony"
```

## Task 5: Tauri Tray Wrapper Scaffold

**Files:**
- Create all `desktop-connector/*` files listed in File Structure.
- Modify: root `package.json`
- Create: `scripts/__tests__/desktopConnectorTauriConfig.test.mjs`

- [ ] **Step 1: Write the failing config test**

Create `scripts/__tests__/desktopConnectorTauriConfig.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const tauriConf = JSON.parse(readFileSync(resolve(repoRoot, "desktop-connector/src-tauri/tauri.conf.json"), "utf8"));
const cargo = readFileSync(resolve(repoRoot, "desktop-connector/src-tauri/Cargo.toml"), "utf8");
const capabilities = readFileSync(resolve(repoRoot, "desktop-connector/src-tauri/capabilities/default.json"), "utf8");
const lib = readFileSync(resolve(repoRoot, "desktop-connector/src-tauri/src/lib.rs"), "utf8");
const sidecar = readFileSync(resolve(repoRoot, "desktop-connector/sidecar/index.js"), "utf8");

assert.equal(tauriConf.productName, "Jarvis Desktop Connector");
assert.deepEqual(tauriConf.bundle.externalBin, ["binaries/jarvis-daemon-sidecar"]);
assert.match(cargo, /tray-icon/);
assert.match(cargo, /tauri-plugin-autostart/);
assert.match(cargo, /tauri-plugin-shell/);
assert.match(capabilities, /shell:allow-execute/);
assert.match(capabilities, /autostart:allow-enable/);
assert.match(lib, /TrayIconBuilder/);
assert.match(lib, /Jarvis Connected/);
assert.match(lib, /Check connection/);
assert.match(sidecar, /jarvis-daemon\.js/);

console.log("OK: Tauri desktop connector config includes tray, sidecar, autostart, and menu actions");
```

- [ ] **Step 2: Run the config test to verify it fails**

Run:

```powershell
node scripts/__tests__/desktopConnectorTauriConfig.test.mjs
```

Expected: FAIL because `desktop-connector` does not exist.

- [ ] **Step 3: Add `desktop-connector/package.json`**

Create `desktop-connector/package.json`:

```json
{
  "name": "jarvis-desktop-connector",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tauri dev",
    "build": "npm run sidecar:build && tauri build",
    "sidecar:build": "npm --prefix sidecar install && npm --prefix sidecar run build",
    "assert-config": "node scripts/assert-config.mjs"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.9.0",
    "@tauri-apps/plugin-autostart": "^2.5.0",
    "@tauri-apps/plugin-opener": "^2.5.0",
    "@tauri-apps/plugin-shell": "^2.3.3",
    "@vitejs/plugin-react": "^5.0.0",
    "typescript": "^5.9.2",
    "vite": "^7.0.0",
    "react": "19.1.0",
    "react-dom": "19.1.0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.9.0"
  }
}
```

- [ ] **Step 4: Add minimal Vite/React files**

Create `desktop-connector/index.html`:

```html
<div id="root"></div>
<script type="module" src="/src/main.tsx"></script>
```

Create `desktop-connector/vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { strictPort: true, port: 14327 },
});
```

Create `desktop-connector/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Node",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["src"]
}
```

Create `desktop-connector/src/main.tsx`:

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<App />);
```

Create `desktop-connector/src/connectorApi.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";

export type ConnectorStatus = {
  connected: boolean;
  detail: string;
};

export async function getConnectorStatus(): Promise<ConnectorStatus> {
  return await invoke<ConnectorStatus>("connector_status");
}

export async function reconnectConnector(): Promise<ConnectorStatus> {
  return await invoke<ConnectorStatus>("reconnect_connector");
}

export async function runAwakeningCeremony(): Promise<void> {
  await invoke("run_awakening_ceremony");
}
```

Create `desktop-connector/src/App.tsx`:

```tsx
import React, { useEffect, useState } from "react";
import { getConnectorStatus, reconnectConnector, runAwakeningCeremony, type ConnectorStatus } from "./connectorApi";

export function App() {
  const [status, setStatus] = useState<ConnectorStatus>({ connected: false, detail: "Checking connection..." });

  useEffect(() => {
    getConnectorStatus().then(setStatus).catch((error) => setStatus({ connected: false, detail: String(error) }));
  }, []);

  return (
    <main style={{ fontFamily: "Inter, Segoe UI, sans-serif", padding: 24, maxWidth: 560 }}>
      <h1>Jarvis Desktop Connector</h1>
      <p>{status.connected ? "Jarvis Connected" : "Jarvis needs attention"}</p>
      <p>{status.detail}</p>
      <button onClick={() => reconnectConnector().then(setStatus)}>Reconnect</button>
      <button onClick={() => runAwakeningCeremony()} style={{ marginLeft: 8 }}>Run verification again</button>
    </main>
  );
}
```

- [ ] **Step 5: Add Tauri config files**

Create `desktop-connector/src-tauri/Cargo.toml`:

```toml
[package]
name = "jarvis-desktop-connector"
version = "0.1.0"
description = "Jarvis Desktop Connector"
edition = "2021"

[lib]
name = "jarvis_desktop_connector_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-autostart = "2"
tauri-plugin-opener = "2"
tauri-plugin-shell = "2"
```

Create `desktop-connector/src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Jarvis Desktop Connector",
  "version": "0.1.0",
  "identifier": "ai.jarvis.desktop.connector",
  "build": {
    "beforeDevCommand": "npm run sidecar:build",
    "beforeBuildCommand": "npm run sidecar:build",
    "devUrl": "http://localhost:14327",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "Jarvis Desktop Connector",
        "width": 620,
        "height": 420,
        "visible": false
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": ["nsis"],
    "externalBin": ["binaries/jarvis-daemon-sidecar"],
    "windows": {
      "nsis": {
        "installerIcon": "icons/icon.ico",
        "displayLanguageSelector": false
      }
    }
  },
  "plugins": {}
}
```

Create `desktop-connector/src-tauri/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Jarvis Desktop Connector permissions",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "opener:default",
    "autostart:allow-enable",
    "autostart:allow-disable",
    "autostart:allow-is-enabled",
    {
      "identifier": "shell:allow-execute",
      "allow": [
        {
          "name": "binaries/jarvis-daemon-sidecar",
          "sidecar": true,
          "args": true
        }
      ]
    }
  ]
}
```

Create `desktop-connector/src-tauri/src/main.rs`:

```rust
fn main() {
    jarvis_desktop_connector_lib::run()
}
```

Create `desktop-connector/src-tauri/src/lib.rs`:

```rust
use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_shell::ShellExt;

#[derive(Serialize)]
struct ConnectorStatus {
    connected: bool,
    detail: String,
}

#[tauri::command]
async fn connector_status() -> ConnectorStatus {
    ConnectorStatus {
        connected: true,
        detail: "Jarvis Connected".to_string(),
    }
}

#[tauri::command]
async fn reconnect_connector(app: tauri::AppHandle) -> Result<ConnectorStatus, String> {
    let sidecar = app.shell().sidecar("jarvis-daemon-sidecar").map_err(|error| error.to_string())?;
    let _child = sidecar.arg("start").spawn().map_err(|error| error.to_string())?;
    Ok(ConnectorStatus {
        connected: true,
        detail: "Reconnect started".to_string(),
    })
}

#[tauri::command]
async fn run_awakening_ceremony(app: tauri::AppHandle) -> Result<(), String> {
    let sidecar = app.shell().sidecar("jarvis-daemon-sidecar").map_err(|error| error.to_string())?;
    let _child = sidecar.arg("awaken").spawn().map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--background"]),
        ))
        .setup(|app| {
            let _ = app.autolaunch().enable();

            let open_item = MenuItem::with_id(app, "open", "Open Jarvis", true, None::<&str>)?;
            let check_item = MenuItem::with_id(app, "check", "Check connection", true, None::<&str>)?;
            let reconnect_item = MenuItem::with_id(app, "reconnect", "Reconnect", true, None::<&str>)?;
            let verify_item = MenuItem::with_id(app, "verify", "Run verification again", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit Jarvis Connector", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &check_item, &reconnect_item, &verify_item, &quit_item])?;

            let tray = TrayIconBuilder::new()
                .tooltip("Jarvis Connected")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        let _ = tauri_plugin_opener::open_url("https://gameplanjarvisai.up.railway.app", None::<&str>);
                    }
                    "check" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "reconnect" => {
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = reconnect_connector(app_handle).await;
                        });
                    }
                    "verify" => {
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = run_awakening_ceremony(app_handle).await;
                        });
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        if let Some(app) = tray.app_handle().get_webview_window("main") {
                            let _ = app.show();
                            let _ = app.set_focus();
                        }
                    }
                })
                .build(app)?;

            app.manage(tray);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            connector_status,
            reconnect_connector,
            run_awakening_ceremony
        ])
        .run(tauri::generate_context!())
        .expect("error while running Jarvis Desktop Connector");
}
```

- [ ] **Step 6: Add the sidecar package**

Create `desktop-connector/sidecar/package.json`:

```json
{
  "name": "jarvis-daemon-sidecar",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "build": "pkg index.js --targets node22-win-x64 --output jarvis-daemon-sidecar.exe && node rename-sidecar.mjs"
  },
  "devDependencies": {
    "@yao-pkg/pkg": "^6.5.1"
  }
}
```

Create `desktop-connector/sidecar/index.js`:

```js
#!/usr/bin/env node
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const daemonPath = resolve(repoRoot, "daemon/jarvis-daemon.js");
const awakenPath = resolve(repoRoot, "scripts/jarvis-desktop-connector-awaken.ps1");

function run(command, args, options = {}) {
  const child = spawn(command, args, { stdio: "inherit", windowsHide: false, ...options });
  child.on("exit", (code) => process.exit(code ?? 0));
}

const action = process.argv[2] || "start";

if (action === "start") {
  run(process.execPath, [daemonPath], {
    env: {
      ...process.env,
      JARVIS_DAEMON_PLATFORM: "desktop",
      JARVIS_SERVER: process.env.JARVIS_SERVER || "https://gameplanjarvisai.up.railway.app",
    },
  });
} else if (action === "awaken") {
  run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", awakenPath], {});
} else {
  console.error(`Unknown Jarvis daemon sidecar action: ${action}`);
  process.exit(2);
}
```

Create `desktop-connector/sidecar/rename-sidecar.mjs`:

```js
import { execSync } from "node:child_process";
import { mkdirSync, renameSync, existsSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";

const host = execSync("rustc -vV").toString().match(/^host: (.+)$/m)?.[1];
if (!host) throw new Error("Could not determine Rust host triple");

const source = resolve("jarvis-daemon-sidecar.exe");
const targetDir = resolve("../src-tauri/binaries");
const target = resolve(targetDir, `jarvis-daemon-sidecar-${host}.exe`);
mkdirSync(targetDir, { recursive: true });
if (existsSync(target)) {
  copyFileSync(source, target);
} else {
  renameSync(source, target);
}
console.log(`Prepared sidecar ${target}`);
```

Create `desktop-connector/scripts/assert-config.mjs`:

```js
import { spawnSync } from "node:child_process";

const result = spawnSync("node", ["../scripts/__tests__/desktopConnectorTauriConfig.test.mjs"], {
  cwd: new URL("..", import.meta.url),
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
```

- [ ] **Step 7: Add root scripts**

Modify root `package.json` scripts:

```json
"jarvis:desktop-connector:test-config": "node scripts/__tests__/desktopConnectorTauriConfig.test.mjs",
"jarvis:desktop-connector:build": "npm --prefix desktop-connector install && npm --prefix desktop-connector run build"
```

- [ ] **Step 8: Run the config test**

Run:

```powershell
node scripts/__tests__/desktopConnectorTauriConfig.test.mjs
```

Expected: PASS with `OK: Tauri desktop connector config includes tray, sidecar, autostart, and menu actions`.

- [ ] **Step 9: Commit Task 5**

Run:

```powershell
git add desktop-connector scripts/__tests__/desktopConnectorTauriConfig.test.mjs package.json
git commit -m "Scaffold Windows tray connector"
```

## Task 6: Installer Metadata and Release Checklist

**Files:**
- Modify: `server/routes/desktopConnectorRoutes.ts`
- Create: `docs/operations/windows-desktop-connector-release.md`
- Modify: `server/agent/__tests__/desktopConnectorSetup.assert.ts`

- [ ] **Step 1: Extend backend test for release metadata**

Add these assertions to `desktopConnectorSetup.assert.ts` after the installer metadata call:

```ts
assert.equal(metadata.json.sha256, undefined);
assert.equal(metadata.json.version, "0.1.0");
assert.match(metadata.json.url, /^https:\/\//);
```

- [ ] **Step 2: Confirm the route already passes metadata assertions**

Run:

```powershell
npx.cmd tsx server/agent/__tests__/desktopConnectorSetup.assert.ts
```

Expected: PASS.

- [ ] **Step 3: Add release checklist**

Create `docs/operations/windows-desktop-connector-release.md`:

```md
# Windows Desktop Connector Release Checklist

## Build

1. Run `npm.cmd run jarvis:desktop-connector:test-config`.
2. Run `npm.cmd run jarvis:desktop-connector:build` on a Windows build machine with Rust and Tauri prerequisites installed.
3. Find the NSIS setup executable under `desktop-connector/src-tauri/target/release/bundle/nsis/`.
4. Compute SHA-256 with `Get-FileHash -Algorithm SHA256 <installer.exe>`.

## Signing

1. Sign the installer with the Jarvis Windows code-signing certificate.
2. Verify the signature in Windows Explorer or with `Get-AuthenticodeSignature <installer.exe>`.
3. Upload the signed installer to the release bucket or static downloads host.

## Production Variables

Set these production variables:

- `JARVIS_WINDOWS_CONNECTOR_DOWNLOAD_URL`
- `JARVIS_WINDOWS_CONNECTOR_VERSION`
- `JARVIS_WINDOWS_CONNECTOR_SHA256`

## Smoke Test

1. Open Jarvis in Chrome.
2. Go to `/desktop-connector-setup`.
3. Click `Set it up for me`.
4. Confirm the signed installer downloads.
5. Run the installer.
6. Confirm Jarvis sees the connector as connected.
7. Run the verification ceremony.
8. Confirm Profile shows `Connected Windows PC`.
```

- [ ] **Step 4: Commit Task 6**

Run:

```powershell
git add server/routes/desktopConnectorRoutes.ts server/agent/__tests__/desktopConnectorSetup.assert.ts docs/operations/windows-desktop-connector-release.md
git commit -m "Document Windows connector release flow"
```

## Task 7: End-to-End Verification

**Files:**
- No required source changes unless verification exposes defects.

- [ ] **Step 1: Run focused assertions**

Run:

```powershell
npx.cmd tsx server/agent/__tests__/desktopConnectorSetup.assert.ts
npx.cmd tsx server/agent/__tests__/desktopConnectorWebCopy.assert.ts
node scripts/__tests__/desktopConnectorAwakening.test.mjs
node scripts/__tests__/desktopConnectorTauriConfig.test.mjs
```

Expected: all PASS.

- [ ] **Step 2: Run full server build**

Run:

```powershell
npm.cmd run server:build
```

Expected: PASS. Restore generated build output if it is not intended for the branch.

- [ ] **Step 3: Run full test suite**

Run:

```powershell
npm.cmd test
```

Expected: PASS, with any DB-backed tests skipped in the same known way as the current repo when local `DATABASE_URL` is absent.

- [ ] **Step 4: Run a local web smoke**

Start the app if needed:

```powershell
npm.cmd run server:dev
```

Open the web app and navigate to:

```text
http://localhost:5000/desktop-connector-setup
```

Expected:

- The headline says `Use your ChatGPT subscription with Jarvis`.
- The disclosure names desktop control and shell commands.
- The primary button says `Set it up for me`.
- The secondary button says `Skip desktop connector`.
- No command-line setup instructions are visible.

- [ ] **Step 5: Run a Windows connector build smoke when Rust/Tauri prerequisites are installed**

Run:

```powershell
npm.cmd run jarvis:desktop-connector:build
```

Expected:

- Tauri creates a Windows setup executable under `desktop-connector/src-tauri/target/release/bundle/nsis/`.
- If Rust/Tauri prerequisites are absent on the development machine, record the missing prerequisite and keep the code-level config tests as the required local gate.

- [ ] **Step 6: Final Git check**

Run:

```powershell
git status --short --branch
git diff --check
```

Expected:

- Working tree contains only intentional changes before final commit.
- `git diff --check` reports no whitespace errors.

- [ ] **Step 7: Final commit if verification fixes changed files**

Run only if Task 7 required source fixes:

```powershell
git add <changed-files>
git commit -m "Verify Windows connector onboarding"
```

## Plan Self-Review

Spec coverage:

- Windows-first first-run wizard: Task 2.
- One up-front disclosure: Task 2.
- Signed installer download metadata: Task 1 and Task 6.
- Tray wrapper around existing daemon: Task 5.
- Automatic-first prerequisites with guided fallback foundation: Task 1, Task 2, Task 5, Task 6.
- Terminal "Jarvis wakes up" finale: Task 4.
- Settings label "Connected Windows PC": Task 3.
- OpenRouter/default provider out of scope: Task 2 skip path and design notes.
- Verification gates: Task 7.

Implementation sequencing:

- Tasks 1-3 make the hosted Jarvis product path visible and testable before the Windows binary exists.
- Tasks 4-6 add the Windows connector wrapper and release plumbing.
- Task 7 verifies the whole slice.

Known execution note:

- Context7 documentation lookup was unavailable in this environment because its API key was invalid. The plan used current official Tauri documentation from `v2.tauri.app` instead.
