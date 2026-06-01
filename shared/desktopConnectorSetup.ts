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

const desktopConnectorSetupIdSchema = z.string().regex(/^dc_/);

export const desktopConnectorSetupResponseSchema = z.object({
  setupId: desktopConnectorSetupIdSchema,
  platform: z.literal("windows"),
  pairCode: z.string().min(4),
  expiresInSec: z.number().int().positive(),
  serverUrl: z.string().url(),
  installer: desktopConnectorInstallerSchema,
  disclosure: z.string().min(1),
});

export const desktopConnectorStatusResponseSchema = z.object({
  setupId: desktopConnectorSetupIdSchema,
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
