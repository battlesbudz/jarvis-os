import type { Express, Request, Response } from "express";
import express from "express";
import * as crypto from "crypto";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { channelLinks } from "@shared/schema";
import { runCoachAgent } from "./coachAgent";
import { postSlackMessage, getSlackBotToken } from "./slackChannel";
import { buildPlanFromInputs } from "../routes";
import { SessionCache } from "../sessionCache";

// ── Per-user session ID store for Slack coach conversations ─────────────────
// Volatile in-process cache keyed by userId. Lost on server restart but the
// coach pipeline gracefully falls back to full history injection on cache miss,
// so there is no data loss — only a minor efficiency cost for the first turn
// after a restart.  Entries unused for 24 h are evicted automatically.
const slackCoachSessions = new SessionCache("slack");
slackCoachSessions.startSweep();

const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;

function verifySlackSignature(req: Request): boolean {
  // Fail closed: never accept Slack webhooks/commands without a configured
  // signing secret, otherwise an attacker could spoof inbound Slack events
  // and drive the coach agent as the linked user.
  if (!SLACK_SIGNING_SECRET) {
    console.error("[slack] rejecting request: SLACK_SIGNING_SECRET is not configured");
    return false;
  }
  const ts = req.header("x-slack-request-timestamp");
  const sig = req.header("x-slack-signature");
  if (!ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 60 * 5) return false;
  const raw = (req as any).rawBody?.toString("utf8") || "";
  const base = `v0:${ts}:${raw}`;
  const computed = "v0=" + crypto.createHmac("sha256", SLACK_SIGNING_SECRET).update(base).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(sig));
  } catch {
    return false;
  }
}

async function findUserBySlackId(teamId: string, slackUserId: string): Promise<string | null> {
  try {
    const rows = await db.select()
      .from(channelLinks)
      .where(and(eq(channelLinks.channel, "slack"), eq(channelLinks.address, `${teamId}:${slackUserId}`)))
      .limit(1);
    return rows[0]?.userId ?? null;
  } catch (err) {
    console.error("[slack] user lookup failed:", err);
    return null;
  }
}

export async function registerSlackUserLink(
  userId: string,
  teamId: string,
  slackUserId: string,
): Promise<void> {
  await db.insert(channelLinks).values({
    userId,
    channel: "slack",
    address: `${teamId}:${slackUserId}`,
    metadata: { teamId, slackUserId },
    lastSeenAt: new Date(),
  }).onConflictDoUpdate({
    target: [channelLinks.channel, channelLinks.address],
    set: { userId, metadata: { teamId, slackUserId }, lastSeenAt: new Date() },
  });
}

export function registerSlackWebhook(app: Express): void {
  // Events API (URL verification + message events)
  app.post(
    "/api/slack/events",
    express.json({
      verify: (req, _res, buf) => { (req as any).rawBody = buf; },
    }),
    async (req: Request, res: Response) => {
      if (!verifySlackSignature(req)) return res.status(401).send("invalid signature");
      const body = req.body || {};
      if (body.type === "url_verification") {
        return res.status(200).type("text/plain").send(body.challenge);
      }
      res.status(200).send("ok");

      if (body.type !== "event_callback") return;
      const ev = body.event || {};
      const teamId: string | undefined = body.team_id;
      const slackUserId: string | undefined = ev.user;
      if (!teamId || !slackUserId) return;
      if (ev.bot_id || ev.subtype) return;
      // Only handle DMs and app mentions
      if (ev.type !== "message" && ev.type !== "app_mention") return;
      if (ev.type === "message" && ev.channel_type !== "im") return;

      const userId = await findUserBySlackId(teamId, slackUserId);
      const text = String(ev.text || "").replace(/<@[A-Z0-9]+>/g, "").trim();

      if (!userId) {
        const tok = await db.select().from(channelLinks)
          .where(and(eq(channelLinks.channel, "slack")))
          .limit(1);
        const replyToken = tok[0] ? await getSlackBotToken(tok[0].userId) : null;
        if (replyToken) {
          await postSlackMessage(replyToken, ev.channel, "I don't recognize this Slack account. Open the GamePlan app and reconnect Slack from Profile → Connected Apps.");
        }
        return;
      }
      if (!text) return;

      const botToken = await getSlackBotToken(userId);
      if (!botToken) return;

      try {
        const storedSessionId = slackCoachSessions.get(userId);
        const { reply, sdkSessionId } = await runCoachAgent({ userId, userText: text, channelName: "Slack", sdkSessionId: storedSessionId });
        // Persist the session ID so the next turn can resume without a DB chat_history fetch.
        if (sdkSessionId) {
          slackCoachSessions.set(userId, sdkSessionId);
        }
        if (reply && reply.trim()) {
          await postSlackMessage(botToken, ev.channel, reply);
        }
      } catch (err) {
        console.error("[slack] coach error:", err);
        await postSlackMessage(botToken, ev.channel, "Sorry, I hit an error processing that. Please try again.");
      }
    },
  );

  // Slash commands: /jarvis plan|brain-dump|status [text...]
  app.post(
    "/api/slack/commands",
    express.urlencoded({
      extended: false,
      verify: (req, _res, buf) => { (req as any).rawBody = buf; },
    }),
    async (req: Request, res: Response) => {
      if (!verifySlackSignature(req)) return res.status(401).send("invalid signature");
      const teamId = String(req.body.team_id || "");
      const slackUserId = String(req.body.user_id || "");
      const text = String(req.body.text || "").trim();
      const responseUrl = String(req.body.response_url || "");

      const userId = await findUserBySlackId(teamId, slackUserId);
      if (!userId) {
        return res.json({ response_type: "ephemeral", text: "Your Slack isn't linked to a GamePlan account. Open the app → Profile → Connected Apps and reconnect." });
      }

      const [sub, ...rest] = text.split(/\s+/);
      const arg = rest.join(" ").trim();
      const subcommand = (sub || "status").toLowerCase();

      // Acknowledge synchronously; reply async via response_url so we don't time out
      res.json({ response_type: "ephemeral", text: `Working on \`${subcommand}\`...` });

      const respond = async (msg: string) => {
        if (!responseUrl) return;
        try {
          await fetch(responseUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ response_type: "ephemeral", text: msg }),
          });
        } catch (err) {
          console.error("[slack] response_url post failed:", err);
        }
      };

      try {
        if (subcommand === "plan") {
          const plan = await buildPlanFromInputs({ userId, brainDump: arg ? [{ text: arg }] : [] });
          const lines = plan.tasks.map((t, i) => `${i + 1}. *${t.title}* — ${t.priority}${t.time ? ` @ ${t.time}` : ""}`).join("\n");
          await respond(`*Today's plan*\n${lines}\n\n_${plan.reasoning}_`);
        } else if (subcommand === "brain-dump" || subcommand === "braindump") {
          if (!arg) { await respond("Add the thought after the command, e.g. `/jarvis brain-dump finish Q3 deck`."); return; }
          const braindumpSession = slackCoachSessions.get(userId);
          const braindumpResult = await runCoachAgent({ userId, userText: `Brain dump: ${arg}`, channelName: "Slack", sdkSessionId: braindumpSession });
          if (braindumpResult.sdkSessionId) slackCoachSessions.set(userId, braindumpResult.sdkSessionId);
          await respond(braindumpResult.reply);
        } else if (subcommand === "status") {
          const statusSession = slackCoachSessions.get(userId);
          const statusResult = await runCoachAgent({ userId, userText: arg || "What's the status of my day?", channelName: "Slack", sdkSessionId: statusSession });
          if (statusResult.sdkSessionId) slackCoachSessions.set(userId, statusResult.sdkSessionId);
          await respond(statusResult.reply);
        } else {
          await respond("Unknown subcommand. Try `/jarvis plan`, `/jarvis brain-dump <thought>`, or `/jarvis status`.");
        }
      } catch (err) {
        console.error("[slack] slash command error:", err);
        await respond("Sorry, I hit an error. Please try again.");
      }
    },
  );

  console.log("[slack] events + slash command webhooks mounted");
}
