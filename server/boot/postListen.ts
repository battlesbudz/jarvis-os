import { and, eq } from "drizzle-orm";
import { startHeartbeat } from "../heartbeat";
import { inboxItems, telegramLinks } from "@shared/schema";
import { startCuriosityScanner } from "../curiosityScanner";
import { db } from "../db";
import {
  deleteWebhook,
  ensureMiniAppMenuButton,
  ensureWebhook,
  getExpectedMiniAppUrl,
  getExpectedWebhookUrl,
  isTelegramConfigured,
} from "../integrations/telegram";
import { startIntegrationValidator } from "../intelligence/integrationValidator";
import { startMomentumExpiryScheduler } from "../momentumCoach";
import {
  runProactiveStartupCatchup,
  startEmailAlertScanner,
  startGithubCiAlertScanner,
  startProactiveScheduler,
  startTelegramPolling,
} from "../telegramRoutes";

const log = console.log;

async function alertTelegramUsersWebhookDown(): Promise<void> {
  try {
    const linked = await db.select({ userId: telegramLinks.userId }).from(telegramLinks);
    const uniqueUserIds = [...new Set(linked.map((r) => r.userId))];
    let alertedCount = 0;
    for (const userId of uniqueUserIds) {
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
        snippet: "Jarvis couldn't re-register the Telegram webhook - your bot may not receive messages. Tap 'Fix now' to open the health check in your profile.",
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
      console.warn("[Telegram] Webhook still down but all users already have a pending alert - skipping duplicate insert");
    }
  } catch (err) {
    console.error("[Telegram] Failed to send offline alert to users:", err);
  }
}

function startTelegramBoot(): void {
  if (!isTelegramConfigured()) return;

  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction) {
    const webhookUrl = getExpectedWebhookUrl();
    if (webhookUrl) {
      ensureWebhook(webhookUrl).then(({ reregistered }) => {
        console.log(`[Telegram] Production mode - webhook ${reregistered ? "re-registered" : "verified"} at ${webhookUrl}`);
      }).catch(err => {
        console.error("[Telegram] Failed to ensure webhook on boot:", err);
      });

      const miniAppUrl = getExpectedMiniAppUrl();
      if (miniAppUrl) {
        ensureMiniAppMenuButton(miniAppUrl).catch(err => {
          console.error("[Telegram] Failed to ensure Mini App menu button on boot:", err);
        });
        db.select({ chatId: telegramLinks.chatId })
          .from(telegramLinks)
          .then((links) => Promise.allSettled(
            links
              .map((link) => link.chatId)
              .filter((chatId): chatId is string => Boolean(chatId))
              .map((chatId) => ensureMiniAppMenuButton(miniAppUrl, chatId)),
          ))
          .then((results) => {
            const failed = results.filter((result) => result.status === "rejected").length;
            if (failed > 0) console.warn(`[Telegram] Mini App menu button failed for ${failed} linked chat(s)`);
          })
          .catch(err => {
            console.error("[Telegram] Failed to ensure linked-chat Mini App buttons on boot:", err);
          });
      }

      const WEBHOOK_CHECK_INTERVAL_MS = 30 * 60 * 1000;
      setInterval(() => {
        ensureWebhook(webhookUrl).then(({ healthy, reregistered }) => {
          if (reregistered) {
            console.warn("[Telegram] Periodic check: webhook was stale - re-registered successfully");
          } else if (!healthy) {
            console.error("[Telegram] Periodic check: webhook re-registration failed - bot may be offline");
            alertTelegramUsersWebhookDown();
          }
        }).catch(err => {
          console.error("[Telegram] Periodic webhook check threw:", err);
          alertTelegramUsersWebhookDown();
        });
      }, WEBHOOK_CHECK_INTERVAL_MS);
    } else {
      console.error("[Telegram] Production mode but no public base URL could be determined; cannot register webhook");
    }
    return;
  }

  if (!process.env.TELEGRAM_BOT_TOKEN_DEV) {
    console.warn(
      "[Telegram] Dev polling SKIPPED - set TELEGRAM_BOT_TOKEN_DEV as a Railway variable " +
      "(create a test bot via BotFather) to enable polling without conflicting with the production bot."
    );
    console.warn(
      "[Telegram] Dev mode - outbound sends SKIPPED " +
      "(set TELEGRAM_BOT_TOKEN_DEV to enable sending from the dev server)."
    );
  } else {
    deleteWebhook()
      .then(() => startTelegramPolling())
      .catch(err => {
        console.error("Failed to start Telegram polling:", err);
      });
  }
}

function logExternalChannelBoot(): void {
  console.warn(
    "[Discord] Native Discord startup disabled. Use the One Connector for Discord OAuth/actions; Telegram remains Jarvis-owned."
  );
}

function startProactiveEngines(): void {
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
  startGithubCiAlertScanner().catch(err => {
    console.error("Failed to start GitHub CI alert scanner:", err);
  });
  startCuriosityScanner().catch(err => {
    console.error("Failed to start curiosity scanner:", err);
  });
  startHeartbeat();
  startIntegrationValidator();
}

function startWorkspaceBoot(): void {
  import("../workspace/loader").then(({ initWorkspace, startWorkspaceWatcher }) => {
    initWorkspace().then(() => startWorkspaceWatcher());
  }).catch(err => {
    console.error("Failed to initialise workspace:", err);
  });

  import("../intelligence/skillWriter").then(({ startSkillWatcher }) => {
    startSkillWatcher();
  }).catch(err => {
    console.error("Failed to start skill watcher:", err);
  });
}

function startDiagnosticsBoot(): void {
  import("../agent/providers/healthCheck").then(({ runProviderHealthChecks }) => {
    runProviderHealthChecks().catch((err: Error) => {
      console.error("[ProviderHealth] Startup check threw unexpectedly:", err.message);
    });
  }).catch((err: Error) => {
    console.warn(
      "[ProviderHealth] Could not load health-check module - provider smoke tests did NOT run.",
      err?.message ?? err,
    );
  });

  setTimeout(() => {
    import("../doctor/doctorRoutes").then(({ runStartupDoctorScan }) => {
      runStartupDoctorScan().catch((err: Error) => {
        console.error("[Doctor] Startup scan error:", err.message);
      });
    }).catch((err: Error) => {
      console.warn("[Doctor] Could not load doctor module:", err.message);
    });
  }, 30_000);

  import("playwright").then(({ chromium }) => {
    chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] })
      .then((b) => b.close().then(() => log("[Browser] Chromium ready")))
      .catch((err: Error) => console.error("[Browser] Chromium unavailable - run `npx playwright install chromium`:", err.message.split("\n")[0]));
  }).catch(() => {});
}

export function startPostListenBoot(): void {
  startTelegramBoot();
  logExternalChannelBoot();
  startProactiveEngines();
  startWorkspaceBoot();
  startDiagnosticsBoot();
}
