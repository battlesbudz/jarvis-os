import "../scripts/load-env.mjs";
import "./agent/providers/envAliases";
import "./agent/openaiChatRouterPatch";
import express from "express";
import { registerRoutes } from "./routes";
import { ensureTablesExist } from "./db";
import { registerTelegramWebhook } from "./telegramRoutes";
import { logTelegramStatus } from "./integrations/telegram";
import { registerWhatsAppWebhook } from "./channels/whatsappWebhook";
import { registerSlackWebhook } from "./channels/slackWebhook";
import { registerTelegramCodexProxy } from "./telegramCodexProxy";
import {
  configureExpoAndLanding,
  setupBodyParsing,
  setupCors,
  setupErrorHandler,
  setupRequestLogging,
} from "./boot/httpApp";
import { runPreListenBoot } from "./boot/preListen";
import { registerRealtimeBoot } from "./boot/realtime";
import { startWorkerBoot } from "./boot/workers";
import { startPostListenBoot } from "./boot/postListen";
import { verifyDatabaseTablesBeforeListen } from "./boot/databaseBoot";

const app = express();
const log = console.log;

function startRuntimeBootAfterListen(): void {
  try {
    startWorkerBoot();
    startPostListenBoot();
  } catch (err) {
    console.error("[Startup] post-listen boot tasks crashed unexpectedly:", err);
  }
}

(async () => {
  logTelegramStatus();

  setupCors(app);
  setupBodyParsing(app);
  setupRequestLogging(app);
  registerTelegramCodexProxy(app);

  configureExpoAndLanding(app);

  registerTelegramWebhook(app);
  registerWhatsAppWebhook(app);
  registerSlackWebhook(app);

  await verifyDatabaseTablesBeforeListen({ ensureTablesExist });
  await runPreListenBoot();

  const server = await registerRoutes(app);

  registerRealtimeBoot(app, server);
  setupErrorHandler(app);

  const port = parseInt(process.env.PORT || "5000", 10);
  const host = process.env.HOST || (process.platform === "win32" ? "127.0.0.1" : "0.0.0.0");
  server.listen(
    {
      port,
      host,
      ...(process.platform === "win32" ? {} : { reusePort: true }),
    },
    () => {
      log(`express server serving on ${host}:${port}`);
      startRuntimeBootAfterListen();
    },
  );
})().catch((err) => {
  console.error("[Startup] fatal boot failure:", err);
  process.exit(1);
});
