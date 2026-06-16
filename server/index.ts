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

const app = express();
const log = console.log;

async function verifyDatabaseTablesInBackground(): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await ensureTablesExist();
      return;
    } catch (err) {
      lastErr = err;
      const delayMs = attempt * 2000;
      console.warn(`[Startup] database table verification failed (attempt ${attempt}/5); retrying in ${delayMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  console.error("[Startup] database table verification failed after retries; continuing with existing schema", lastErr);
}

async function startRuntimeBootAfterListen(): Promise<void> {
  await verifyDatabaseTablesInBackground();
  await runPreListenBoot();
  startWorkerBoot();
  startPostListenBoot();
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
      startRuntimeBootAfterListen().catch((err) => {
        console.error("[Startup] runtime boot tasks crashed unexpectedly:", err);
      });
    },
  );
})();
