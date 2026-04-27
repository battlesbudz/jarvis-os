import express from "express";
import type { Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { ensureTablesExist, db } from "./db";
import { registerTelegramWebhook, startProactiveScheduler, startTelegramPolling, startEmailAlertScanner, runProactiveStartupCatchup } from "./telegramRoutes";
import { startMomentumExpiryScheduler } from "./momentumCoach";
import { startHeartbeat } from "./heartbeat";
import { startJobQueueWorker } from "./agent/jobQueue";
import { isTelegramConfigured, logTelegramStatus, deleteWebhook, ensureWebhook, getExpectedWebhookUrl } from "./integrations/telegram";
import { startScheduler } from "./scheduler";
import { startTriageRunner, runStartupTriagePass } from "./inboxTriage";
import { startCuriosityScanner } from "./curiosityScanner";
import { startIntegrationValidator } from "./intelligence/integrationValidator";
import { initChannels } from "./channels";
import { registerWhatsAppWebhook } from "./channels/whatsappWebhook";
import { registerSlackWebhook } from "./channels/slackWebhook";
import { startDaemonBridge } from "./daemon/bridge";
import { bootAllBots as bootDiscordBots, bootSharedBot } from "./discord/manager";
import { telegramLinks, inboxItems } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";

async function alertTelegramUsersWebhookDown(): Promise<void> {
  try {
    const linked = await db.select({ userId: telegramLinks.userId }).from(telegramLinks);
    const uniqueUserIds = [...new Set(linked.map((r) => r.userId))];
    let alertedCount = 0;
    for (const userId of uniqueUserIds) {
      // Skip if a pending alert already exists — prevents inbox spam during prolonged outages.
      const existing = await db
        .select({ id: inboxItems.id })
        .from(inboxItems)
        .where(
          and(
            eq(inboxItems.userId, userId),
            eq(inboxItems.sourceType, "other"),
            eq(inboxItems.status, "pending"),
            eq(inboxItems.subject, "Telegram bot is offline")
          )
        )
        .limit(1);
      if (existing.length > 0) continue;

      const sourceId = `telegram_webhook_down:${userId}:${Date.now()}`;
      await db.insert(inboxItems).values({
        userId,
        sourceType: "other",
        sourceId,
        subject: "Telegram bot is offline",
        snippet: "Jarvis couldn't re-register the Telegram webhook — your bot may not receive messages. Tap 'Fix now' to open the health check in your profile.",
        jarvisReason: "Webhook re-registration failed",
        suggestedActions: [
          { label: "Fix now", actionType: "navigate_telegram_health" },
          { label: "Dismiss", actionType: "dismiss" },
        ],
        status: "pending",
      }).onConflictDoNothing();
      alertedCount++;
    }
    if (alertedCount > 0) {
      console.warn(`[Telegram] Sent offline alert to ${alertedCount} linked user(s)`);
    } else {
      console.warn("[Telegram] Webhook still down but all users already have a pending alert — skipping duplicate insert");
    }
  } catch (err) {
    console.error("[Telegram] Failed to send offline alert to users:", err);
  }
}

const app = express();
const log = console.log;

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

function setupCors(app: express.Application) {
  app.use((req, res, next) => {
    const origins = new Set<string>();

    if (process.env.REPLIT_DEV_DOMAIN) {
      origins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
    }

    if (process.env.REPLIT_DOMAINS) {
      process.env.REPLIT_DOMAINS.split(",").forEach((d) => {
        origins.add(`https://${d.trim()}`);
      });
    }

    const origin = req.header("origin");

    // Allow localhost origins for Expo web development (any port)
    const isLocalhost =
      origin?.startsWith("http://localhost:") ||
      origin?.startsWith("http://127.0.0.1:");

    if (origin && (origins.has(origin) || isLocalhost)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS",
      );
      res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.header("Access-Control-Allow-Credentials", "true");
    }

    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }

    next();
  });
}

function setupBodyParsing(app: express.Application) {
  app.use(
    express.json({
      limit: '50mb',
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  app.use(
    express.urlencoded({
      extended: false,
      verify: (req, _res, buf) => {
        // preserve raw body for signature-verifying webhooks (e.g. Slack slash commands)
        if (!(req as any).rawBody) (req as any).rawBody = buf;
      },
    }),
  );
}

function setupRequestLogging(app: express.Application) {
  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse: Record<string, unknown> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      if (!path.startsWith("/api")) return;

      const duration = Date.now() - start;

      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    });

    next();
  });
}

function getAppName(): string {
  try {
    const appJsonPath = path.resolve(process.cwd(), "app.json");
    const appJsonContent = fs.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}

function serveExpoManifest(platform: string, res: Response) {
  const manifestPath = path.resolve(
    process.cwd(),
    "static-build",
    platform,
    "manifest.json",
  );

  if (!fs.existsSync(manifestPath)) {
    return res
      .status(404)
      .json({ error: `Manifest not found for platform: ${platform}` });
  }

  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");

  const manifest = fs.readFileSync(manifestPath, "utf-8");
  res.send(manifest);
}

function serveLandingPage({
  req,
  res,
  landingPageTemplate,
  appName,
}: {
  req: Request;
  res: Response;
  landingPageTemplate: string;
  appName: string;
}) {
  const forwardedProto = req.header("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol || "https";
  const forwardedHost = req.header("x-forwarded-host");
  const host = forwardedHost || req.get("host");
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;

  log(`baseUrl`, baseUrl);
  log(`expsUrl`, expsUrl);

  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, baseUrl)
    .replace(/EXPS_URL_PLACEHOLDER/g, expsUrl)
    .replace(/APP_NAME_PLACEHOLDER/g, appName);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}

function configureExpoAndLanding(app: express.Application) {
  const templatePath = path.resolve(
    process.cwd(),
    "server",
    "templates",
    "landing-page.html",
  );
  const landingPageTemplate = fs.readFileSync(templatePath, "utf-8");
  const appName = getAppName();

  const webBuildDir = path.resolve(process.cwd(), "static-build", "web");
  const webIndexPath = path.join(webBuildDir, "index.html");

  log("Serving static Expo files with dynamic manifest routing");

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api")) {
      return next();
    }

    if (req.path !== "/" && req.path !== "/manifest") {
      return next();
    }

    const platform = req.header("expo-platform");
    if (platform && (platform === "ios" || platform === "android")) {
      return serveExpoManifest(platform, res);
    }

    if (req.path === "/") {
      // Serve the React Native Web build if it was produced by the build script
      if (fs.existsSync(webIndexPath)) {
        return res.sendFile(webIndexPath);
      }
      // Fall back to Expo Go landing page (dev / no web build)
      return serveLandingPage({
        req,
        res,
        landingPageTemplate,
        appName,
      });
    }

    next();
  });

  // Serve web build assets (/_expo/static/..., /assets/..., etc.)
  if (fs.existsSync(webBuildDir)) {
    app.use(express.static(webBuildDir));
  }

  app.use("/assets", express.static(path.resolve(process.cwd(), "assets")));
  app.use(express.static(path.resolve(process.cwd(), "static-build")));

  // SPA catch-all: for web build, serve index.html for any non-API, non-asset path
  // so that client-side Expo Router navigation works in Chrome
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/assets")) return next();
    if (fs.existsSync(webIndexPath)) {
      return res.sendFile(webIndexPath);
    }
    next();
  });

  log("Expo routing: Checking expo-platform header on / and /manifest");
}

function setupErrorHandler(app: express.Application) {
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    const error = err as {
      status?: number;
      statusCode?: number;
      message?: string;
    };

    const status = error.status || error.statusCode || 500;
    const message = error.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });
}

(async () => {
  await ensureTablesExist();

  // Seed first-party skill packs (idempotent — skips existing rows).
  // Awaited so the catalogue is populated before the first request arrives.
  try {
    const { seedDefaultPacks } = await import("./intelligence/behaviorStore");
    await seedDefaultPacks();
  } catch (err) {
    console.warn("[Startup] skill pack seeding failed (non-fatal):", err);
  }

  // Seed core always-on agents (Telegram bot, Discord bot, Discord channel agent)
  // for every existing user. Idempotent — skips agents that already exist.
  try {
    const { seedCoreAgentsForAllUsers } = await import("./agent/coreAgentSeed");
    await seedCoreAgentsForAllUsers();
  } catch (err) {
    console.warn("[Startup] core agent seeding failed (non-fatal):", err);
  }

  // Pre-warm lazily-imported modules so the first in-app message has no
  // cold-start delay from module loading + capability registry construction.
  // All imports are fire-and-forget (errors are non-fatal).
  setTimeout(() => {
    Promise.allSettled([
      import("./agent/tools/index"),
      import("./capabilities/index"),
      import("./lib/modelPrefs"),
      import("./intelligence/behaviorStore"),
      import("./intelligence/skillWriter"),
      import("./agent/tools/channelTools"),
    ]).then(() => {
      console.log("[Startup] pre-warming complete: agent modules loaded");
    }).catch(() => {});
  }, 2000);

  logTelegramStatus();

  setupCors(app);
  setupBodyParsing(app);
  setupRequestLogging(app);

  configureExpoAndLanding(app);

  registerTelegramWebhook(app);
  registerWhatsAppWebhook(app);
  registerSlackWebhook(app);

  const server = await registerRoutes(app);

  initChannels();
  startDaemonBridge(server);

  startScheduler();
  startTriageRunner();
  // Run one immediate triage pass 5s after startup to clear untriaged backlog
  setTimeout(() => runStartupTriagePass().catch(() => {}), 5000);
  // Sub-agent background worker — runs queued goal_decompose / research /
  // writing / planning / email jobs and writes deliverables for approval.
  startJobQueueWorker();

  setupErrorHandler(app);

  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`express server serving on port ${port}`);

      // Telegram-specific I/O (polling/webhook) only runs when Telegram is
      // configured — but proactive engines drive notifications across all
      // channels (telegram/whatsapp/slack/daemon) so they must run regardless.
      if (isTelegramConfigured()) {
        const isProduction = process.env.NODE_ENV === 'production';

        if (isProduction) {
          const webhookUrl = getExpectedWebhookUrl();
          if (webhookUrl) {
            ensureWebhook(webhookUrl).then(({ reregistered }) => {
              console.log(`[Telegram] Production mode — webhook ${reregistered ? 're-registered' : 'verified'} at ${webhookUrl}`);
            }).catch(err => {
              console.error("[Telegram] Failed to ensure webhook on boot:", err);
            });

            // Periodic health check: every 30 minutes, verify and auto-repair if needed.
            const WEBHOOK_CHECK_INTERVAL_MS = 30 * 60 * 1000;
            setInterval(() => {
              ensureWebhook(webhookUrl).then(({ healthy, reregistered }) => {
                if (reregistered) {
                  console.warn("[Telegram] Periodic check: webhook was stale — re-registered successfully");
                } else if (!healthy) {
                  console.error("[Telegram] Periodic check: webhook re-registration failed — bot may be offline");
                  alertTelegramUsersWebhookDown();
                }
              }).catch(err => {
                console.error("[Telegram] Periodic webhook check threw:", err);
                alertTelegramUsersWebhookDown();
              });
            }, WEBHOOK_CHECK_INTERVAL_MS);
          } else {
            console.error("[Telegram] Production mode but REPLIT_DOMAINS is not set — cannot register webhook");
          }
        } else {
          // Dev mode: only start polling if a dedicated dev bot token is set.
          // Without it, both dev and production would share the same bot —
          // Telegram delivers each message to exactly one endpoint, so they'd
          // race and the user would receive two replies for every message.
          if (!process.env.TELEGRAM_BOT_TOKEN_DEV) {
            console.warn(
              "[Telegram] ⚠ Dev polling SKIPPED — set TELEGRAM_BOT_TOKEN_DEV as a Replit secret " +
              "(create a test bot via BotFather) to enable polling without conflicting with the production bot."
            );
          } else {
            // Delete any previously-set webhook (e.g. from a production deploy)
            // before starting polling — Telegram only delivers to ONE endpoint,
            // so an active webhook silently swallows all getUpdates responses.
            deleteWebhook()
              .then(() => startTelegramPolling())
              .catch(err => {
                console.error("Failed to start Telegram polling:", err);
              });
          }
        }
      }

      // Boot Discord bots for users who have saved a bot token
      bootDiscordBots().catch(err => {
        console.error("Failed to boot Discord bots:", err);
      });

      // Boot the shared Jarvis Discord bot (DISCORD_BOT_TOKEN + DISCORD_CLIENT_ID)
      bootSharedBot().catch(err => {
        console.error("Failed to boot shared Discord bot:", err);
      });

      // Channel-agnostic proactive engines — iterate every user with any
      // linked channel (telegram/whatsapp/slack/daemon/discord) and route through
      // notifyUser() so WhatsApp/Slack/Discord-only users get the full experience.
      startProactiveScheduler().catch(err => {
        console.error("Failed to start proactive scheduler:", err);
      });
      runProactiveStartupCatchup().catch(err => {
        console.error("Failed to run proactive startup catchup:", err);
      });
      startMomentumExpiryScheduler();
      startEmailAlertScanner().catch(err => {
        console.error("Failed to start email alert scanner:", err);
      });
      startCuriosityScanner().catch(err => {
        console.error("Failed to start curiosity scanner:", err);
      });
      startHeartbeat();
      startIntegrationValidator();

      // Watch for newly crystallised skill files and hot-reload the cache.
      import("./intelligence/skillWriter").then(({ startSkillWatcher }) => {
        startSkillWatcher();
      }).catch(err => {
        console.error("Failed to start skill watcher:", err);
      });

      // Verify Playwright/Chromium is usable on startup — logs a warning if not.
      import("playwright").then(({ chromium }) => {
        chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--single-process"] })
          .then((b) => b.close().then(() => log("[Browser] Chromium ready ✓")))
          .catch((err: Error) => console.error("[Browser] Chromium unavailable — run `npx playwright install chromium`:", err.message.split("\n")[0]));
      }).catch(() => { /* playwright not installed — silently skip */ });
    },
  );
})();
