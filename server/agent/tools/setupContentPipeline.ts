/**
 * Discord OS Phase 4C — setup_content_pipeline
 *
 * One-shot tool that wires up the full 3-stage content pipeline:
 *   Stage 1 (#alerts)   — trending topic research, fires on a daily cron
 *   Stage 2 (#research) — deep-dives the alerts, triggered via pipelineNext
 *   Stage 3 (#scripts)  — writes scripts per story, triggered via pipelineNext,
 *                          posts each as a separate message with ✅/❌ approval
 *
 * Stage 4 (#ideas — thumbnail concepts) fires automatically when the user
 * reacts ✅ to a script — no schedule row needed.
 */

import type { AgentTool } from "../types";
import { createSchedule, parseCronExpression } from "../../discord/schedules";
import { createDiscordChannel } from "../../discord/manager";

const NEVER_FIRES_CRON = "0 0 31 2 *";

export const setupContentPipelineTool: AgentTool = {
  name: "setup_content_pipeline",
  description:
    "Set up the full multi-stage Discord content pipeline for the user's niche. " +
    "Creates four Discord channels (#alerts, #research, #scripts, #ideas) and wires up " +
    "three chained schedule stages that run automatically every day:\n" +
    "  1. #alerts — searches YouTube trending + web for top stories in the user's niche\n" +
    "  2. #research — deep-dives each alert story with angles and supporting data\n" +
    "  3. #scripts — writes a short script per story; each is posted separately with " +
    "     ✅/❌ reactions; approving a script auto-generates thumbnail concepts in #ideas\n" +
    "Use this when the user says 'set up my content pipeline', 'create a content workflow', " +
    "'set up automated content creation', or similar.",
  parameters: {
    type: "object",
    properties: {
      niche: {
        type: "string",
        description:
          "The topic or niche for content research. " +
          "Examples: 'ADHD productivity', 'AI tools for developers', 'crypto trading'. " +
          "Used in all stage prompts to focus research.",
      },
      alertTime: {
        type: "string",
        description:
          "Natural language time for the daily alerts run. Default: '7am'. " +
          "Examples: '7am', '8:30am', '6pm'. The pipeline runs once per day at this time.",
      },
    },
    required: ["niche"],
  },

  async execute(args, ctx) {
    const { userId } = ctx;
    const niche = String(args.niche || "").trim();
    const alertTimeRaw = args.alertTime ? String(args.alertTime).trim() : "7am";

    if (!niche) {
      return {
        ok: false,
        content: "Please provide a niche or topic so I know what to research (e.g. 'ADHD productivity', 'AI tools').",
        label: "Missing niche",
      };
    }

    const alertCron = parseCronExpression(`every day at ${alertTimeRaw}`);
    const CHANNELS = ["alerts", "research", "scripts", "ideas"];

    // ── Create all four channels ───────────────────────────────────────────
    const channelDescriptions: Record<string, string> = {
      alerts:   "Daily trending topic alerts for your niche",
      research: "Deep-dive research briefs from today's alerts",
      scripts:  "AI-written scripts for each research story — react ✅ to approve",
      ideas:    "Thumbnail concept briefs for approved scripts",
    };

    for (const ch of CHANNELS) {
      await createDiscordChannel(userId, {
        channelName: ch,
        topic: channelDescriptions[ch],
        categoryName: "🧠 Jarvis Workspace",
      }).catch((err) =>
        console.warn(`[ContentPipeline] Channel creation warning for #${ch}:`, err),
      );
    }

    // ── Stage 3 — Scripts (created first so we have its ID for stage 2) ──
    const stage3 = await createSchedule(userId, {
      channelName: "scripts",
      label: `${niche} — Scripts`,
      cronExpression: NEVER_FIRES_CRON,
      prompt: `Here is the research brief for today's trending topics in ${niche}:

{{previousOutput}}

For each topic, write a short YouTube script in a direct, engaging, first-person style. Keep each script under 500 words. Open with a strong hook (a surprising fact or bold claim). Close with a clear call to action ("Follow for more", "Comment below", etc.).

IMPORTANT: Separate each script with exactly this delimiter on its own line (no spaces before or after):
---SCRIPT---

Do not include any text before the first script or after the last one. Start each script with the topic title as the first line.`,
    });

    // ── Stage 2 — Research (pipelineNext → stage3) ────────────────────────
    const stage2 = await createSchedule(userId, {
      channelName: "research",
      label: `${niche} — Research`,
      cronExpression: NEVER_FIRES_CRON,
      prompt: `Here are today's trending alerts for ${niche}:

{{previousOutput}}

For each topic, research the story more deeply: what happened, why audiences in the ${niche} space care about this, and 2-3 concrete content angles a creator could take. Include any relevant stats, quotes, or context you can find. Keep each entry to 4-6 focused bullet points. Use a clear header for each topic.`,
      pipelineNext: stage3.id,
    });

    // ── Stage 1 — Alerts (pipelineNext → stage2, fires on alertCron) ──────
    const stage1 = await createSchedule(userId, {
      channelName: "alerts",
      label: `${niche} — Daily Alerts`,
      cronExpression: alertCron,
      prompt: `Search YouTube for trending videos about "${niche}" published in the last 3 days, sorted by views per hour (use trending mode). Also search the web for the most discussed topics and stories in the ${niche} space right now. Combine both sources into a ranked list of the top 5-8 trending topics or stories. For each: title, why it's trending, key metric (views/hour or engagement signal), and a 1-sentence content angle. Format as a numbered list with clear headers.`,
      pipelineNext: stage2.id,
    });

    const summary = [
      `✅ Content pipeline created for **${niche}**!`,
      ``,
      `**Daily schedule:** Stage 1 fires at \`${alertCron}\` then the chain runs automatically.`,
      ``,
      `**Channels created:**`,
      `• #alerts — trending topics (fires at ${alertTimeRaw})`,
      `• #research — deep-dive research briefs`,
      `• #scripts — scripts per story (react ✅ to approve, ❌ to skip)`,
      `• #ideas — thumbnail concepts (auto-triggered on ✅)`,
      ``,
      `**Pipeline IDs:** stage1=\`${stage1.id}\`, stage2=\`${stage2.id}\`, stage3=\`${stage3.id}\``,
      ``,
      `To test it now: say "run my ${niche} alerts pipeline" and I'll trigger Stage 1 immediately.`,
    ].join("\n");

    return {
      ok: true,
      content: summary,
      label: `Content pipeline created: ${niche}`,
      detail: JSON.stringify({ stage1: stage1.id, stage2: stage2.id, stage3: stage3.id }),
    };
  },
};
