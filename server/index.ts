import express from "express";
import type { Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { ensureTablesExist } from "./db";
import { registerTelegramWebhook, startProactiveScheduler, startTelegramPolling, startEmailAlertScanner, runProactiveStartupCatchup } from "./telegramRoutes";
import { startMomentumExpiryScheduler } from "./momentumCoach";
import { startHeartbeat } from "./heartbeat";
import { startJobQueueWorker } from "./agent/jobQueue";
import { isTelegramConfigured, logTelegramStatus, setWebhook, deleteWebhook } from "./integrations/telegram";
import { startScheduler } from "./scheduler";
import { initChannels } from "./channels";
import { registerWhatsAppWebhook } from "./channels/whatsappWebhook";
import { registerSlackWebhook } from "./channels/slackWebhook";
import { startDaemonBridge } from "./daemon/bridge";
import { bootAllBots as bootDiscordBots } from "./discord/manager";
import * as fs from "fs";
import * as path from "path";

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
      return serveLandingPage({
        req,
        res,
        landingPageTemplate,
        appName,
      });
    }

    next();
  });

  app.use("/assets", express.static(path.resolve(process.cwd(), "assets")));
  app.use(express.static(path.resolve(process.cwd(), "static-build")));

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
          const domain = (process.env.REPLIT_DOMAINS || '').split(',')[0]?.trim();
          if (domain) {
            const webhookUrl = `https://${domain}/api/telegram/webhook`;
            setWebhook(webhookUrl).then(() => {
              console.log(`[Telegram] Production mode — webhook active at ${webhookUrl}`);
            }).catch(err => {
              console.error("[Telegram] Failed to set webhook:", err);
            });
          } else {
            console.error("[Telegram] Production mode but REPLIT_DOMAINS is not set — cannot register webhook");
          }
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

      // Boot Discord bots for users who have saved a bot token
      bootDiscordBots().catch(err => {
        console.error("Failed to boot Discord bots:", err);
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
      startHeartbeat();
    },
  );
})();
