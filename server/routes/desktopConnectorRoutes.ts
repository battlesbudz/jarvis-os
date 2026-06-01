import { randomBytes } from "node:crypto";
import type { Express, Request, Response } from "express";

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

type DaemonBridge = typeof import("../daemon/bridge");

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

function generateLocalPairingCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function loadDaemonBridge(): Promise<DaemonBridge | null> {
  try {
    // Lazy-load so route contract tests can mount this module without booting DB-backed daemon state.
    return await import("../daemon/bridge");
  } catch (error) {
    if (!process.env.DATABASE_URL && error instanceof Error && error.message.includes("DATABASE_URL is not set")) {
      return null;
    }
    throw error;
  }
}

async function createSetupPairingCode(userId: string): Promise<string> {
  const bridge = await loadDaemonBridge();
  if (!bridge) return generateLocalPairingCode();
  return bridge.createDaemonPairingCode(userId);
}

async function isSetupDaemonActive(userId: string): Promise<boolean> {
  const bridge = await loadDaemonBridge();
  return bridge?.isDesktopDaemonActive(userId) ?? false;
}

function buildStatusResponse(session: SetupSession, connected: boolean): DesktopConnectorStatusResponse {
  if (connected) {
    session.stage = "connected";
    session.lastSeenAt = new Date().toISOString();
    session.codexReady = true;
    session.watchdogReady = true;
  } else if (session.stage === "created") {
    session.stage = "waiting_for_connector";
  }

  return {
    setupId: session.setupId,
    stage: session.stage,
    connected,
    computerName: session.computerName,
    lastSeenAt: session.lastSeenAt,
    codexReady: session.codexReady,
    watchdogReady: session.watchdogReady,
    message: connected
      ? "Desktop connector is connected."
      : "Waiting for the Windows desktop connector to pair.",
  };
}

export function registerDesktopConnectorRoutes(app: Express): void {
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
      const pairCode = await createSetupPairingCode(userId);
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

      const connected = await isSetupDaemonActive(userId);
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

      const bridge = await loadDaemonBridge();
      if (!bridge?.isDesktopDaemonActive(userId)) {
        return res.status(409).json({ error: "Desktop daemon is not connected" });
      }

      const result = await bridge.sendDaemonOp(
        userId,
        { type: "shell", cmd: "Write-Output 'JARVIS_DESKTOP_CONNECTOR_SHELL_OK'", timeoutMs: 15000 } as any,
        20000,
      );

      res.json({ ok: result.ok !== false, result });
    } catch (error) {
      console.error("[DesktopConnector] verification failed:", error);
      res.status(500).json({ error: "Failed to verify desktop connector shell access" });
    }
  });
}
