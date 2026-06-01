import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import jwt from "jsonwebtoken";
import { registerDesktopConnectorRoutes } from "../../routes/desktopConnectorRoutes";
import {
  desktopConnectorInstallerSchema,
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
  const state = {
    desktopActive: false,
    shellAllowed: false,
  };
  const currentPermissions = {
    shell: false,
    file_write: false,
    notify: true,
    file_read: false,
    file_list: true,
    desktop_screenshot: false,
    desktop_read_screen: true,
    browser_local: false,
    allow_outside_root: false,
  };
  const calls = {
    createDaemonPairingCode: [] as string[],
    getDaemonPermissions: [] as string[],
    setDaemonPermissions: [] as Array<{ userId: string; perms: Record<string, boolean> }>,
    isDesktopDaemonActive: [] as string[],
    isDaemonActionAllowed: [] as Array<{ userId: string; action: string }>,
    sendDaemonOp: [] as Array<{ userId: string; op: unknown; timeoutMs?: number }>,
  };
  registerDesktopConnectorRoutes(app, {
    createDaemonPairingCode: async (userId) => {
      calls.createDaemonPairingCode.push(userId);
      return "PAIR1234";
    },
    getDaemonPermissions: async (userId) => {
      calls.getDaemonPermissions.push(userId);
      return { ...currentPermissions };
    },
    setDaemonPermissions: async (userId, perms) => {
      calls.setDaemonPermissions.push({ userId, perms });
      if (perms.shell === true) state.shellAllowed = true;
      return { shell: state.shellAllowed };
    },
    isDesktopDaemonActive: async (userId) => {
      calls.isDesktopDaemonActive.push(userId);
      return state.desktopActive;
    },
    isDaemonActionAllowed: async (userId, action) => {
      calls.isDaemonActionAllowed.push({ userId, action });
      return state.shellAllowed;
    },
    sendDaemonOp: async (userId, op, timeoutMs) => {
      calls.sendDaemonOp.push({ userId, op, timeoutMs });
      return { ok: true, data: { stdout: "JARVIS_DESKTOP_CONNECTOR_SHELL_OK" } };
    },
  });
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
    assert.equal(parsedSetup.pairCode, "PAIR1234");
    assert.deepEqual(calls.createDaemonPairingCode, ["user-1"]);
    assert.deepEqual(calls.getDaemonPermissions, ["user-1"]);
    assert.deepEqual(calls.setDaemonPermissions, [{
      userId: "user-1",
      perms: {
        ...currentPermissions,
        shell: true,
      },
    }]);
    assert.equal(parsedSetup.disclosure.includes("run shell commands"), true);

    const status = await request(port, "GET", `/api/desktop-connector/setup-session/${parsedSetup.setupId}`, undefined, token);
    assert.equal(status.status, 200);
    const parsedStatus = desktopConnectorStatusResponseSchema.parse(status.json);
    assert.equal(parsedStatus.setupId, parsedSetup.setupId);
    assert.equal(parsedStatus.connected, false);
    assert.equal(parsedStatus.stage, "waiting_for_connector");
    assert.deepEqual(calls.isDesktopDaemonActive, ["user-1"]);

    state.desktopActive = true;
    const connectedStatus = await request(port, "GET", `/api/desktop-connector/setup-session/${parsedSetup.setupId}`, undefined, token);
    assert.equal(connectedStatus.status, 200);
    const parsedConnectedStatus = desktopConnectorStatusResponseSchema.parse(connectedStatus.json);
    assert.equal(parsedConnectedStatus.connected, true);
    assert.equal(parsedConnectedStatus.stage, "connected");

    state.desktopActive = false;
    const disconnectedStatus = await request(port, "GET", `/api/desktop-connector/setup-session/${parsedSetup.setupId}`, undefined, token);
    assert.equal(disconnectedStatus.status, 200);
    const parsedDisconnectedStatus = desktopConnectorStatusResponseSchema.parse(disconnectedStatus.json);
    assert.equal(parsedDisconnectedStatus.connected, false);
    assert.equal(parsedDisconnectedStatus.stage, "needs_attention");

    const metadata = await request(port, "GET", "/api/desktop-connector/installer", undefined, token);
    assert.equal(metadata.status, 200);
    const parsedMetadata = desktopConnectorInstallerSchema.parse(metadata.json);
    assert.equal(parsedMetadata.url, "https://downloads.example.test/JarvisSetup.exe");
    assert.equal(parsedMetadata.version, "0.1.0");

    calls.sendDaemonOp.length = 0;
    const inactiveVerify = await request(port, "POST", "/api/desktop-connector/verify", {}, token);
    assert.equal(inactiveVerify.status, 409);
    assert.equal(inactiveVerify.json.ok, false);
    assert.deepEqual(calls.sendDaemonOp, []);

    state.desktopActive = true;
    const shellOkVerify = await request(port, "POST", "/api/desktop-connector/verify", {}, token);
    assert.equal(shellOkVerify.status, 200);
    assert.deepEqual(calls.isDaemonActionAllowed.at(-1), { userId: "user-1", action: "shell" });
    assert.deepEqual(calls.sendDaemonOp, [{
      userId: "user-1",
      op: { type: "shell", cmd: "Write-Output 'JARVIS_DESKTOP_CONNECTOR_SHELL_OK'", timeoutMs: 15000 },
      timeoutMs: 20000,
    }]);
    assert.equal(shellOkVerify.json.ok, true);
    assert.deepEqual(shellOkVerify.json.result, { ok: true, data: { stdout: "JARVIS_DESKTOP_CONNECTOR_SHELL_OK" } });

    calls.sendDaemonOp.length = 0;
    state.shellAllowed = false;
    const shellBlockedVerify = await request(port, "POST", "/api/desktop-connector/verify", {}, token);
    assert.equal(shellBlockedVerify.status, 403);
    assert.equal(shellBlockedVerify.json.ok, false);
    assert.deepEqual(calls.sendDaemonOp, []);

    console.log("OK: desktop connector setup routes expose setup session, status, and installer metadata");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
