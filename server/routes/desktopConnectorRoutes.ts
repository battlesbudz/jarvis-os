import { randomBytes } from "node:crypto";
import type { Express, Request, Response } from "express";
import type { DaemonOp } from "../daemon/bridge";

import {
  DESKTOP_CONNECTOR_DISCLOSURE,
  type DesktopConnectorInstaller,
  type DesktopConnectorStage,
  type DesktopConnectorStatusResponse,
} from "../../shared/desktopConnectorSetup";
import { getPublicBaseUrl } from "../publicUrl";

const SETUP_SESSION_TTL_SEC = 900;
const DEFAULT_INSTALLER_URL = "https://gameplanjarvisai.up.railway.app/downloads/JarvisSetup.exe";
const DEFAULT_INSTALLER_VERSION = "0.1.0";

type DaemonOpResult = { ok: boolean; data?: unknown; error?: string };

export type DesktopConnectorRouteDeps = {
  createDaemonPairingCode: (userId: string) => Promise<string>;
  setDaemonPermissions: (userId: string, perms: Partial<Record<"shell", boolean>>) => Promise<unknown>;
  isDesktopDaemonActive: (userId: string) => boolean | Promise<boolean>;
  isDaemonActionAllowed: (userId: string, action: "shell") => boolean | Promise<boolean>;
  sendDaemonOp: (userId: string, op: DaemonOp, timeoutMs?: number) => Promise<DaemonOpResult>;
};

export const defaultDesktopConnectorRouteDeps: DesktopConnectorRouteDeps = {
  createDaemonPairingCode: async (userId) => {
    const { createDaemonPairingCode } = await import("../daemon/bridge");
    return createDaemonPairingCode(userId);
  },
  setDaemonPermissions: async (userId, perms) => {
    const { setDaemonPermissions } = await import("../daemon/bridge");
    return setDaemonPermissions(userId, perms);
  },
  isDesktopDaemonActive: async (userId) => {
    const { isDesktopDaemonActive } = await import("../daemon/bridge");
    return isDesktopDaemonActive(userId);
  },
  isDaemonActionAllowed: async (userId, action) => {
    const { isDaemonActionAllowed } = await import("../daemon/bridge");
    return isDaemonActionAllowed(userId, action);
  },
  sendDaemonOp: async (userId, op, timeoutMs) => {
    const { sendDaemonOp } = await import("../daemon/bridge");
    return sendDaemonOp(userId, op, timeoutMs);
  },
};

type SetupSession = {
  setupId: string;
  userId: string;
  pairCode: string;
  createdAt: number;
  expiresAt: number;
  stage: DesktopConnectorStage;
  computerName: string | null;
  lastSeenAt: string | null;
  codexReady: boolean;
  watchdogReady: boolean;
};

const setupSessions = new Map<string, SetupSession>();

function getUserId(req: Request, res: Response): string | null {
  const userId = (req as any).userId as string | undefined;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  return userId;
}

function getInstallerMetadata(): DesktopConnectorInstaller {
  const sha256 = process.env.JARVIS_WINDOWS_CONNECTOR_SHA256?.trim();
  return {
    url: process.env.JARVIS_WINDOWS_CONNECTOR_DOWNLOAD_URL?.trim() || DEFAULT_INSTALLER_URL,
    version: process.env.JARVIS_WINDOWS_CONNECTOR_VERSION?.trim() || DEFAULT_INSTALLER_VERSION,
    ...(sha256 ? { sha256 } : {}),
  };
}

function generateSetupId(): string {
  return `dc_${randomBytes(16).toString("hex")}`;
}

function buildStatusResponse(session: SetupSession, connected: boolean): DesktopConnectorStatusResponse {
  let stage = session.stage;
  if (connected) {
    stage = "connected";
    session.lastSeenAt = new Date().toISOString();
    session.codexReady = true;
    session.watchdogReady = true;
  } else {
    if (session.stage === "connected") {
      stage = "needs_attention";
    } else if (session.stage === "created") {
      stage = "waiting_for_connector";
    }
    session.codexReady = false;
    session.watchdogReady = false;
  }
  session.stage = stage;

  return {
    setupId: session.setupId,
    stage,
    connected,
    computerName: session.computerName,
    lastSeenAt: session.lastSeenAt,
    codexReady: session.codexReady,
    watchdogReady: session.watchdogReady,
    message: connected
      ? "Desktop connector is connected."
      : stage === "needs_attention"
        ? "Desktop connector was connected but is now offline."
        : "Waiting for the Windows desktop connector to pair.",
  };
}

export function registerDesktopConnectorRoutes(
  app: Express,
  deps: DesktopConnectorRouteDeps = defaultDesktopConnectorRouteDeps,
): void {
  app.get("/api/desktop-connector/installer", (req: Request, res: Response) => {
    const userId = getUserId(req, res);
    if (!userId) return;
    res.json(getInstallerMetadata());
  });

  app.post("/api/desktop-connector/setup-session", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req, res);
      if (!userId) return;

      const now = Date.now();
      const setupId = generateSetupId();
      const pairCode = await deps.createDaemonPairingCode(userId);
      // Single-disclosure commercial setup consent path; verify still enforces permissions.
      await deps.setDaemonPermissions(userId, { shell: true });
      const session: SetupSession = {
        setupId,
        userId,
        pairCode,
        createdAt: now,
        expiresAt: now + SETUP_SESSION_TTL_SEC * 1000,
        stage: "waiting_for_connector",
        computerName: null,
        lastSeenAt: null,
        codexReady: false,
        watchdogReady: false,
      };

      setupSessions.set(setupId, session);

      res.json({
        setupId,
        platform: "windows",
        pairCode,
        expiresInSec: SETUP_SESSION_TTL_SEC,
        serverUrl: getPublicBaseUrl(req),
        installer: getInstallerMetadata(),
        disclosure: DESKTOP_CONNECTOR_DISCLOSURE,
      });
    } catch (error) {
      console.error("[DesktopConnector] setup-session failed:", error);
      res.status(500).json({ error: "Failed to create desktop connector setup session" });
    }
  });

  app.get("/api/desktop-connector/setup-session/:setupId", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req, res);
      if (!userId) return;

      const setupId = String(req.params.setupId || "");
      const session = setupSessions.get(setupId);
      if (!session || session.userId !== userId) {
        return res.status(404).json({ error: "Setup session not found" });
      }

      if (session.expiresAt <= Date.now()) {
        setupSessions.delete(setupId);
        return res.status(410).json({ error: "Setup session expired" });
      }

      const connected = await deps.isDesktopDaemonActive(userId);
      res.json(buildStatusResponse(session, connected));
    } catch (error) {
      console.error("[DesktopConnector] setup-session status failed:", error);
      res.status(500).json({ error: "Failed to load desktop connector setup status" });
    }
  });

  app.post("/api/desktop-connector/verify", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req, res);
      if (!userId) return;

      if (!(await deps.isDesktopDaemonActive(userId))) {
        return res.status(409).json({ ok: false, error: "Desktop daemon is not connected" });
      }

      if (!(await deps.isDaemonActionAllowed(userId, "shell"))) {
        return res.status(403).json({
          ok: false,
          error: "Desktop daemon shell permission is disabled",
        });
      }

      const op = {
        type: "shell",
        cmd: "Write-Output 'JARVIS_DESKTOP_CONNECTOR_SHELL_OK'",
        timeoutMs: 15000,
      } satisfies DaemonOp;

      const result = await deps.sendDaemonOp(
        userId,
        op,
        20000,
      );

      res.json({ ok: result.ok !== false, result });
    } catch (error) {
      console.error("[DesktopConnector] verification failed:", error);
      res.status(500).json({ error: "Failed to verify desktop connector shell access" });
    }
  });
}
