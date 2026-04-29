import { db } from "../db";
import { eq, and, sql, gte, asc } from "drizzle-orm";
import * as schema from "@shared/schema";
import type { SubAgentType } from "./subagents";
import { runSubAgent } from "./subagents";
import { runGoalDecomposition } from "./goalDecomposer";
import { runNamedAgent } from "./runNamedAgent";
import { runWeeklyPatternJob } from "../memory/weeklyJob";
import { getValidGoogleTokens } from "../userTokenStore";
import type { ToolContext } from "./types";
import { notifyUser, getChannel } from "../channels/registry";
import { postToDiscordChannelById, sendToDiscordUser, sendFileToDiscordChannel, sendFileToDiscordUser } from "../discord/manager";
import type { ChannelSendOpts } from "../channels/types";
import { _notifyJobCompleteCore } from "./notifyJobCompleteCore";
export type { NotifyJobCompleteDeps } from "./notifyJobCompleteCore";
export { _notifyJobCompleteCore };
import { onWorkflowJobComplete, onWorkflowJobFail } from "./workflowEngine";
import { emit as diagEmit } from "../diagnostics/diagnosticsService";
import { logSystemError } from "./errorLogger";
import { submitAgentJob as _submitAgentJob, getModelForJobType as _getModelForJobType, type SubmitJobInput, type AgentJobType as _AgentJobType } from "./jobClient";
import { runAgent } from "./harness";
import { verifyJobOutput } from "./orchestrator";
import { readRecentErrorsTool, listSourceFilesTool, readSourceFileTool, proposeCodeChangeTool } from "./tools/selfEditTools";
import { fetchCalendarTool } from "./tools/calendar";
import { researchHasSourceUrls } from "./researchUtils";
import { markdownToPdfBuffer } from "./tools/exportPdf";
import { createDriveBinaryFile } from "../integrations/googleDrive";

// Re-export from the shared client so existing callers don't break.
export type AgentJobType = _AgentJobType;
export type { SubmitJobInput };
export const submitAgentJob = _submitAgentJob;
export const getModelForJobType = _getModelForJobType;

async function notifyJobComplete(
  userId: string,
  agentType: AgentJobType,
  title: string,
  body: string,
  originChannel?: string,
  originDiscordChannelId?: string,
  opts: ChannelSendOpts = {},
): Promise<void> {
  const text = `Jarvis (${agentType}): ${title}\n\n${body}`;
  // Normalise for comparison — ctx.channel values like "Discord #general",
  // "Discord", "Telegram" must all be matched case-insensitively.
  const origin = (originChannel ?? "").toLowerCase();

  // Discord's maximum file size for non-Nitro servers.
  const DISCORD_MAX_FILE_BYTES = 25 * 1024 * 1024;

  /**
   * Send file attachments from opts to a Discord channel or DM.
   * Documents and files are uploaded as Discord attachments; if a PDF exceeds
   * the 25 MB limit a text fallback note is posted instead.
   */
  async function sendDiscordAttachments(channelId: string | null): Promise<void> {
    const { attachmentToBuffer, imageFilename } = await import("../channels/attachmentHelpers");
    const attachments = opts.attachments || [];
    for (const att of attachments) {
      if (att.kind === "document") {
        // `document` attachments carry a Buffer/string in `content`.
        const fileContent = Buffer.isBuffer(att.content)
          ? att.content
          : Buffer.from(att.content as string);

        if (fileContent.length > DISCORD_MAX_FILE_BYTES) {
          const sizeMb = (fileContent.length / 1024 / 1024).toFixed(1);
          // Include the Drive link when available so the user can access the file.
          const driveClause = att.driveLink
            ? ` You can also open it directly on Google Drive: ${att.driveLink}`
            : " You can download the full report from your Jarvis inbox or Google Drive.";
          const sizeNote =
            `⚠️ The generated PDF (${sizeMb} MB) exceeds Discord's 25 MB file size limit and could not be attached directly.${driveClause}`;
          if (channelId) {
            await postToDiscordChannelById(userId, channelId, sizeNote).catch(() => {});
          } else {
            await sendToDiscordUser(userId, sizeNote).catch(() => {});
          }
          continue;
        }

        const sent = channelId
          ? await sendFileToDiscordChannel(userId, channelId, att.filename, fileContent, att.caption).catch(() => false)
          : await sendFileToDiscordUser(userId, att.filename, fileContent, att.caption).catch(() => false);
        if (!sent) {
          console.warn(`[JobQueue] Discord document attachment failed — userId=${userId} file=${att.filename}`);
        }
      } else if (att.kind === "file") {
        // `file` attachments carry their content via `url` or `data`, not `content`.
        const buf = await attachmentToBuffer(att).catch(() => null);
        if (!buf) {
          console.warn(`[JobQueue] Discord file attachment ${att.filename} had no usable source — skipping`);
          continue;
        }
        if (buf.length > DISCORD_MAX_FILE_BYTES) {
          const sizeMb = (buf.length / 1024 / 1024).toFixed(1);
          const sizeNote = `⚠️ The file ${att.filename} (${sizeMb} MB) exceeds Discord's 25 MB limit and could not be attached directly. You can download it from your Jarvis inbox.`;
          if (channelId) {
            await postToDiscordChannelById(userId, channelId, sizeNote).catch(() => {});
          } else {
            await sendToDiscordUser(userId, sizeNote).catch(() => {});
          }
          continue;
        }
        const sent = channelId
          ? await sendFileToDiscordChannel(userId, channelId, att.filename, buf, att.caption).catch(() => false)
          : await sendFileToDiscordUser(userId, att.filename, buf, att.caption).catch(() => false);
        if (!sent) {
          console.warn(`[JobQueue] Discord file attachment failed — userId=${userId} file=${att.filename}`);
        }
      } else if (att.kind === "image") {
        // Resolve image to a buffer and send as a Discord file upload.
        const buf = await attachmentToBuffer(att).catch(() => null);
        if (buf) {
          const imgName = imageFilename(att.mimeType);
          const sent = channelId
            ? await sendFileToDiscordChannel(userId, channelId, imgName, buf, att.caption).catch(() => false)
            : await sendFileToDiscordUser(userId, imgName, buf, att.caption).catch(() => false);
          if (!sent) console.warn(`[JobQueue] Discord image attachment failed — userId=${userId}`);
        }
      }
      // markdown attachments are already merged into the text body before this point
    }
  }

  try {
    if (origin.startsWith("discord")) {
      // Route back to the originating Discord channel + in_app inbox.
      // Telegram (and any other external channel) is intentionally NOT notified.
      const notified: string[] = [];
      if (originDiscordChannelId) {
        const sent = await postToDiscordChannelById(userId, originDiscordChannelId, text);
        if (sent) {
          notified.push(`discord:channel:${originDiscordChannelId}`);
          await sendDiscordAttachments(originDiscordChannelId);
        } else {
          // Channel post failed (bot lost access etc.) — fall back to DM.
          const dmSent = await sendToDiscordUser(userId, text);
          if (dmSent) {
            notified.push("discord:dm");
            await sendDiscordAttachments(null);
          }
        }
      } else {
        // No specific channel ID stored — deliver via user's Discord DM.
        const dmSent = await sendToDiscordUser(userId, text);
        if (dmSent) {
          notified.push("discord:dm");
          await sendDiscordAttachments(null);
        }
      }
      // Always surface the result in the in-app inbox as well (with attachments if any).
      const inAppCh = getChannel("in_app");
      if (inAppCh) {
        await inAppCh.sendMessage(userId, text, { notificationType: "approval_request", ...opts }).catch(() => {});
        notified.push("in_app");
      }
      console.log(`[JobQueue] notifyJobComplete originChannel=${originChannel} → [${notified.join(", ") || "none"}]`);
      return;
    }

    if (origin === "telegram") {
      // Telegram-originated jobs go to Telegram + in_app only.
      // We call the channels directly rather than notifyUser to avoid the
      // registry's cross-channel fallback routing (which could reach Discord).
      const notified: string[] = [];
      const telegramCh = getChannel("telegram");
      if (telegramCh) {
        const r = await telegramCh.sendMessage(userId, text, { notificationType: "approval_request", ...opts }).catch(() => ({ ok: false as const }));
        if (r.ok) notified.push("telegram");
      }
      const inAppCh = getChannel("in_app");
      if (inAppCh) {
        await inAppCh.sendMessage(userId, text, { notificationType: "approval_request", ...opts }).catch(() => {});
        notified.push("in_app");
      }
      console.log(`[JobQueue] notifyJobComplete originChannel=${originChannel} → [${notified.join(", ") || "none"}]`);
      return;
    }

    if (origin === "app" || origin === "coach" || origin === "appchat" || origin === "voice") {
      // In-app (or voice) only — no external channel notification.
      const inAppCh = getChannel("in_app");
      if (inAppCh) {
        await inAppCh.sendMessage(userId, text, { notificationType: "approval_request", ...opts }).catch(() => {});
      }
      console.log(`[JobQueue] notifyJobComplete originChannel=${originChannel} → [in_app]`);
      return;
    }

    // Absent or unrecognised origin (proactive/scheduled jobs such as weekly_pattern,
    // morning brief, heartbeat) → use the user's configured channel preferences as before.
    const results = await notifyUser(userId, "approval_request", text, opts);
    const delivered = results.filter((r) => r.result.ok).map((r) => r.channel).join(", ");
    console.log(`[JobQueue] notifyJobComplete originChannel=${originChannel || "none"} → [${delivered || "none"}]`);
  } catch (err) {
    console.error("[JobQueue] notify failed:", err);
  }
}

// ── Research notification coordinator ────────────────────────────────────────
// Research jobs queued in the same 60-second window belong to the same
// "batch" (typically one user message that caused the coach to queue multiple
// jobs). We group them by finding an existing batch whose anchor createdAt is
// within 60 seconds of the incoming job's createdAt (true sliding window, not
// a floor-divided bucket, so minute-boundary jobs are handled correctly).
//
// When a research job completes it registers itself with the coordinator. The
// coordinator waits up to NOTIFICATION_FLUSH_DELAY_MS for more sibling jobs
// to complete. Once the timer fires it also queries the DB for any sibling
// research jobs that completed in that window but were not registered
// (e.g. processed in parallel or before a restart). It then sends exactly ONE
// notification for the whole batch.
//
// Safety guarantee: the timer always fires (even if siblings fail/cancel),
// so no completed research job is ever left without a notification.

interface BatchedResearchJob {
  title: string;
  body: string;
  /** DB agent_jobs.id — used to locate the deliverable for consolidation. */
  jobId?: string;
  /** Whether this job's prompt explicitly requested a PDF or Word document. */
  promptedPdf?: boolean;
  /** Originating channel (e.g. "Discord #general") for most-common-origin routing. */
  originChannel?: string;
  /** Discord channel ID for direct-channel routing when origin is Discord. */
  originDiscordChannelId?: string;
}

interface BatchedResearchNotification {
  userId: string;
  /** createdAt of the first job in this batch (ms since epoch). Used for window matching. */
  anchorTime: number;
  /** Each job's content, origin info (for routing), and PDF metadata (for consolidation). */
  jobs: BatchedResearchJob[];
  timer: ReturnType<typeof setTimeout>;
}

/** key: `${userId}:research:${anchorTime}` */
const researchNotificationBatches = new Map<string, BatchedResearchNotification>();

/**
 * Tracks anchor times of already-flushed research batches per user so that
 * late-completing siblings in the same window are suppressed rather than
 * triggering a second notification.
 * Map: userId → [{anchorTime, flushedAt}]
 */
const flushedResearchBatches = new Map<string, Array<{ anchorTime: number; flushedAt: number }>>();

/** True sibling window — must match the guard in queueBackgroundJob. */
const SIBLING_WINDOW_MS = 60 * 1000;

/** How long we keep flushed-batch records to suppress late arrivals. */
const FLUSHED_BATCH_TTL_MS = 10 * 60 * 1000;

/**
 * How long we wait after the first job in a batch completes before flushing.
 * Long enough for a sibling completing seconds later to join; short enough
 * that the user doesn't wait excessively after a solo research job finishes.
 */
const NOTIFICATION_FLUSH_DELAY_MS = 30 * 1000;

async function flushResearchBatch(key: string): Promise<void> {
  const batch = researchNotificationBatches.get(key);
  if (!batch) return;
  researchNotificationBatches.delete(key);

  const { userId, anchorTime, jobs } = batch;
  if (jobs.length === 0) return;

  // Before sending, query the DB for sibling research jobs that completed in
  // the same ±60 s window but were never registered with the in-memory
  // coordinator (e.g. processed in a parallel worker tick or a prior restart).
  // Merge any extras into the total count so the combined notification is
  // accurate. This is best-effort — failures fall through safely.
  let allSiblingJobIds: string[] = jobs.filter((j) => j.jobId).map((j) => j.jobId!);
  try {
    const windowStart = new Date(anchorTime - SIBLING_WINDOW_MS);
    const windowEnd   = new Date(anchorTime + SIBLING_WINDOW_MS);
    const allSiblings = await db
      .select({ id: schema.agentJobs.id, title: schema.agentJobs.title })
      .from(schema.agentJobs)
      .where(
        and(
          eq(schema.agentJobs.userId, userId),
          eq(schema.agentJobs.agentType, "research"),
          eq(schema.agentJobs.status, "complete"),
          gte(schema.agentJobs.createdAt, windowStart),
          sql`${schema.agentJobs.createdAt} <= ${windowEnd}`,
        ),
      );
    const knownIds = new Set(allSiblingJobIds);
    const knownTitles = new Set(jobs.map((j) => j.title));
    for (const row of allSiblings) {
      const t = row.title ?? "";
      if (!knownTitles.has(t)) {
        jobs.push({ title: t, body: "", jobId: row.id });
        knownTitles.add(t);
      }
      if (row.id && !knownIds.has(row.id)) {
        allSiblingJobIds.push(row.id);
        knownIds.add(row.id);
      }
    }
  } catch {
    // Non-fatal: flush with only the in-memory jobs.
  }

  // Record this window as flushed so any late-completing siblings are suppressed.
  const now = Date.now();
  const userFlushed = flushedResearchBatches.get(userId) ?? [];
  // Evict stale entries before appending.
  const fresh = userFlushed.filter((f) => now - f.flushedAt < FLUSHED_BATCH_TTL_MS);
  fresh.push({ anchorTime, flushedAt: now });
  flushedResearchBatches.set(userId, fresh);

  // ── Resolve most-common originating channel for routing ──────────────────
  // Ensures the single batched notification goes to the right channel even if
  // a few sibling jobs somehow came from a different channel.
  const originCounts = new Map<string, number>();
  for (const j of jobs) {
    if (j.originChannel) {
      const originKey = j.originChannel.toLowerCase();
      originCounts.set(originKey, (originCounts.get(originKey) ?? 0) + 1);
    }
  }
  let batchOriginChannel: string | undefined;
  let batchOriginDiscordChannelId: string | undefined;
  if (originCounts.size > 0) {
    let maxCount = 0;
    for (const [ch, count] of originCounts.entries()) {
      if (count > maxCount) { maxCount = count; batchOriginChannel = ch; }
    }
    // When the winning origin is Discord, find the Discord channel ID from the
    // first matching job (most common when there are multiple distinct IDs).
    if (batchOriginChannel?.startsWith("discord")) {
      const discordJobs = jobs.filter(j => j.originChannel?.toLowerCase().startsWith("discord") && j.originDiscordChannelId);
      batchOriginDiscordChannelId = discordJobs[0]?.originDiscordChannelId;
    }
  }

  // ── Consolidate sibling deliverables into ONE ────────────────────────────
  // When multiple research jobs were queued for the same request, each one
  // inserted its own deliverable. Merge them into a single deliverable so
  // the inbox shows one item, not N.
  let mergedDeliverableId: string | null = null;
  let mergedTitle = jobs[0].title;
  let mergedBody = "";
  const wantsPdf = jobs.some((j) => j.promptedPdf);

  if (allSiblingJobIds.length > 0) {
    try {
      const siblingDeliverables = await db
        .select()
        .from(schema.deliverables)
        .where(
          and(
            eq(schema.deliverables.userId, userId),
            sql`${schema.deliverables.jobId} = ANY(${allSiblingJobIds})`,
          ),
        )
        .orderBy(asc(schema.deliverables.createdAt));

      if (siblingDeliverables.length > 1) {
        // Merge all bodies into one consolidated report
        const sections = siblingDeliverables.map((d, i) => {
          const heading = d.title && d.title !== siblingDeliverables[0].title
            ? `\n\n---\n\n## ${d.title}\n\n`
            : i === 0 ? "" : "\n\n---\n\n";
          return `${heading}${d.body || ""}`;
        });
        mergedBody = sections.join("").trim();
        mergedTitle = `Research: ${siblingDeliverables[0].title}`;
        // Update the first deliverable with merged content
        const firstId = siblingDeliverables[0].id;
        await db
          .update(schema.deliverables)
          .set({ title: mergedTitle, body: mergedBody, summary: `Consolidated from ${siblingDeliverables.length} research threads.` })
          .where(eq(schema.deliverables.id, firstId));
        mergedDeliverableId = firstId;
        // Point all sibling jobs' result.deliverableId to the merged deliverable
        // so job-level views don't end up with stale / deleted IDs.
        for (const d of siblingDeliverables.slice(1)) {
          try {
            const [sibJob] = await db
              .select()
              .from(schema.agentJobs)
              .where(eq(schema.agentJobs.id, d.jobId ?? ""))
              .limit(1);
            if (sibJob) {
              const currentResult = (sibJob.result as Record<string, unknown>) ?? {};
              await db
                .update(schema.agentJobs)
                .set({ result: { ...currentResult, deliverableId: firstId, mergedInto: firstId } })
                .where(eq(schema.agentJobs.id, sibJob.id));
            }
          } catch {
            // Non-fatal — stale pointer is cosmetic
          }
          await db.delete(schema.deliverables).where(eq(schema.deliverables.id, d.id));
        }
        console.log(`[JobQueue] consolidated ${siblingDeliverables.length} research deliverables → ${firstId}`);
      } else if (siblingDeliverables.length === 1) {
        mergedDeliverableId = siblingDeliverables[0].id;
        mergedBody = siblingDeliverables[0].body || "";
        mergedTitle = siblingDeliverables[0].title || mergedTitle;
      }
    } catch (mergeErr) {
      console.error("[JobQueue] deliverable merge failed (non-fatal):", mergeErr);
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  // ── Optional PDF generation from merged body ──────────────────────────────
  // If any sibling job's prompt requested a PDF, generate ONE PDF from the
  // consolidated body and deliver it as a channel attachment.
  const notifyOpts: ChannelSendOpts = {};
  let pdfNote = "";
  let batchDriveLink: string | undefined;

  if (wantsPdf && mergedBody) {
    try {
      const pdfBuffer = await markdownToPdfBuffer(mergedTitle, mergedBody);
      const filename = mergedTitle.replace(/[^A-Za-z0-9._\- ]+/g, "_").slice(0, 80).trim() + ".pdf";
      console.log(`[JobQueue] generated consolidated PDF for batch anchorTime=${anchorTime} size=${pdfBuffer.length}B`);

      // Attempt Drive upload so the link is available for oversized-file fallbacks.
      let driveLink: string | undefined;
      try {
        const tokens = await getValidGoogleTokens(userId).catch(() => []);
        const googleAccessToken = tokens?.[0] || null;
        if (googleAccessToken) {
          const driveFile = await createDriveBinaryFile(googleAccessToken, filename, pdfBuffer, "application/pdf");
          driveLink = driveFile.webViewLink || undefined;
          batchDriveLink = driveLink;
          pdfNote = `\n\n📄 PDF attached and saved to Google Drive: ${driveLink}`;
          console.log(`[JobQueue] research batch PDF → Drive: ${driveLink}`);
        } else {
          pdfNote = `\n\n📄 PDF attached (${filename}).`;
        }
      } catch (driveErr) {
        const driveMsg = driveErr instanceof Error ? driveErr.message : String(driveErr);
        console.error(`[JobQueue] research batch PDF Drive upload failed:`, driveMsg);
        pdfNote = `\n\n📄 PDF attached (Drive upload failed: ${driveMsg}).`;
      }

      notifyOpts.attachments = [
        {
          kind: "document",
          filename,
          content: pdfBuffer,
          caption: mergedTitle,
          mimeType: "application/pdf",
          driveLink,
        },
      ];
    } catch (pdfErr) {
      const pdfMsg = pdfErr instanceof Error ? pdfErr.message : String(pdfErr);
      console.error("[JobQueue] batch PDF generation failed:", pdfMsg);
      pdfNote = `\n\n⚠️ PDF generation failed — here is the markdown version instead.`;
      // Attach the merged markdown as a .md file so the user still receives
      // the full content in the channel even when PDF rendering fails.
      if (mergedBody) {
        const mdFilename = mergedTitle.replace(/[^A-Za-z0-9._\- ]+/g, "_").slice(0, 80).trim() + ".md";
        notifyOpts.attachments = [
          {
            kind: "document",
            filename: mdFilename,
            content: mergedBody,
            caption: `${mergedTitle} (PDF failed — markdown fallback)`,
            mimeType: "text/markdown",
          },
        ];
      }
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  // Persist the Drive link on the deliverable so the app can surface it.
  if (batchDriveLink && mergedDeliverableId) {
    await db
      .update(schema.deliverables)
      .set({ driveLink: batchDriveLink })
      .where(eq(schema.deliverables.id, mergedDeliverableId))
      .catch((e) => console.error("[JobQueue] failed to save driveLink on deliverable:", e));
  }

  const bodiedJobs = jobs.filter((j) => j.body);
  const notifyBody = (bodiedJobs[0]?.body ?? jobs[0].body) + pdfNote;

  const hasPdfAttachment = (notifyOpts.attachments?.length ?? 0) > 0;
  console.log(
    `[JobQueue] research batch flush: ${jobs.length} job(s), deliverable=${mergedDeliverableId ?? "none"}, pdf=${hasPdfAttachment} → userId=${userId}`,
  );

  if (jobs.length === 1) {
    await notifyJobComplete(userId, "research", mergedTitle, notifyBody, batchOriginChannel, batchOriginDiscordChannelId, notifyOpts);
  } else {
    const combinedTitle = `Research complete (${jobs.length} results) — ${mergedTitle}`;
    console.log(`[JobQueue] flushing batched research notification: ${jobs.length} job(s) → userId=${userId} batchOriginChannel=${batchOriginChannel || "none"}`);
    await notifyJobComplete(userId, "research", combinedTitle, notifyBody, batchOriginChannel, batchOriginDiscordChannelId, notifyOpts);
  }
}

/**
 * Register a completed research job with the notification coordinator.
 * Uses true sliding-window matching (±60 s on actual createdAt ms) so
 * minute-boundary jobs are correctly batched together.
 *
 * If the sibling window was already flushed (notification already sent), the
 * late arrival is suppressed to prevent a second notification for the same
 * research request.
 */
function scheduleResearchNotification(
  userId: string,
  createdAt: Date,
  deliverableTitle: string,
  notifyBody: string,
  originChannel?: string,
  originDiscordChannelId?: string,
  jobId?: string,
  promptedPdf?: boolean,
): void {
  const newTime = createdAt.getTime();
  const now = Date.now();

  // Check whether a batch for this window was already flushed (notification sent).
  const userFlushed = flushedResearchBatches.get(userId) ?? [];
  const alreadyFlushed = userFlushed.some(
    (f) =>
      Math.abs(f.anchorTime - newTime) <= SIBLING_WINDOW_MS &&
      now - f.flushedAt < FLUSHED_BATCH_TTL_MS,
  );
  if (alreadyFlushed) {
    console.log(
      `[JobQueue] suppressing late research notification (batch already sent) for userId=${userId} title="${deliverableTitle.slice(0, 60)}"`,
    );
    return;
  }

  // Find an existing pending batch for this user whose anchor is within 60 s.
  for (const [key, batch] of researchNotificationBatches.entries()) {
    if (batch.userId !== userId) continue;
    if (Math.abs(batch.anchorTime - newTime) <= SIBLING_WINDOW_MS) {
      batch.jobs.push({ title: deliverableTitle, body: notifyBody, originChannel, originDiscordChannelId, jobId, promptedPdf });
      // Debounce: extend the flush timer so it fires after the last arrival.
      clearTimeout(batch.timer);
      batch.timer = setTimeout(() => flushResearchBatch(key).catch((e) =>
        console.error("[JobQueue] flushResearchBatch failed:", e),
      ), NOTIFICATION_FLUSH_DELAY_MS);
      return;
    }
  }

  // No matching batch — start a new one. Per-job origin is tracked so that
  // flushResearchBatch can compute the most-common origin across all siblings.
  const key = `${userId}:research:${newTime}`;
  const timer = setTimeout(() => flushResearchBatch(key).catch((e) =>
    console.error("[JobQueue] flushResearchBatch failed:", e),
  ), NOTIFICATION_FLUSH_DELAY_MS);
  researchNotificationBatches.set(key, {
    userId,
    anchorTime: newTime,
    jobs: [{ title: deliverableTitle, body: notifyBody, originChannel, originDiscordChannelId, jobId, promptedPdf }],
    timer,
  });
}

/**
 * Notify the user that a sub-agent job completed.
 * Research jobs are batched within a 60-second sibling window — exactly one
 * notification is sent per batch via a debounced coordinator.
 * All other agent types receive an immediate individual notification.
 * Both paths respect the originChannel stored in job.input to avoid
 * cross-channel leakage (e.g. Discord research should not notify Telegram).
 */
async function notifySubAgentJobComplete(
  job: typeof schema.agentJobs.$inferSelect,
  deliverableTitle: string,
  notifyBody: string,
  jobId?: string,
  promptedPdf?: boolean,
  opts: ChannelSendOpts = {},
): Promise<void> {
  const jobInput = (job.input as Record<string, unknown>) ?? {};
  const originChannel = typeof jobInput.originChannel === "string" ? jobInput.originChannel : undefined;
  const originDiscordChannelId = typeof jobInput.originDiscordChannelId === "string" ? jobInput.originDiscordChannelId : undefined;

  if (job.agentType !== "research" || !job.createdAt) {
    await notifyJobComplete(job.userId, job.agentType as AgentJobType, deliverableTitle, notifyBody, originChannel, originDiscordChannelId, opts);
    return;
  }
  scheduleResearchNotification(job.userId, new Date(job.createdAt), deliverableTitle, notifyBody, originChannel, originDiscordChannelId, jobId, promptedPdf);
}
// ─────────────────────────────────────────────────────────────────────────────

const TICK_MS = 15 * 1000;
const MAX_JOB_DURATION_MS = 5 * 60 * 1000;

let workerRunning = false;
let workerStarted = false;
let stopRequested = false;

async function claimNextJob(): Promise<typeof schema.agentJobs.$inferSelect | null> {
  // Pick the oldest queued job whose user has no currently-running job.
  // Use a single SQL CTE so the claim is atomic across worker restarts.
  // Important: raw SQL returns column names verbatim (snake_case), so we
  // claim the id here, then do a typed Drizzle select to get a properly
  // mapped camelCase row.
  const claimed = await db.execute<{ id: string }>(sql`
    WITH busy_users AS (
      SELECT DISTINCT user_id FROM agent_jobs WHERE status IN ('running', 'cancelling')
    ),
    candidate AS (
      SELECT id FROM agent_jobs
      WHERE status = 'queued'
        AND user_id NOT IN (SELECT user_id FROM busy_users)
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE agent_jobs SET status = 'running', started_at = NOW()
    WHERE id IN (SELECT id FROM candidate)
    RETURNING id
  `);
  const claimedId = claimed.rows?.[0]?.id;
  if (!claimedId) return null;

  const [row] = await db
    .select()
    .from(schema.agentJobs)
    .where(eq(schema.agentJobs.id, claimedId))
    .limit(1);
  return row || null;
}

async function failJob(jobId: string, message: string, userId?: string): Promise<void> {
  try {
    await db
      .update(schema.agentJobs)
      .set({ status: "failed", error: message.slice(0, 2000), completedAt: new Date() })
      .where(eq(schema.agentJobs.id, jobId));
  } catch (err) {
    console.error(`[JobQueue] failJob ${jobId} write failed:`, err);
  }
  diagEmit({
    userId,
    subsystem: "job_queue",
    severity: "error",
    message: `Job ${jobId} failed: ${message.slice(0, 200)}`,
    metadata: { jobId },
  }).catch(() => {});
}

async function completeJob(
  jobId: string,
  payload: { result: Record<string, unknown>; turns: number; toolCallsCount: number },
): Promise<void> {
  await db
    .update(schema.agentJobs)
    .set({
      status: "complete",
      result: payload.result,
      turns: payload.turns,
      toolCallsCount: payload.toolCallsCount,
      completedAt: new Date(),
    })
    .where(eq(schema.agentJobs.id, jobId));
}

async function processJob(job: typeof schema.agentJobs.$inferSelect): Promise<void> {
  console.log(`[JobQueue] running job ${job.id} type=${job.agentType} user=${job.userId}`);

  const watchdog = setTimeout(() => {
    console.warn(`[JobQueue] job ${job.id} exceeded ${MAX_JOB_DURATION_MS}ms (still running)`);
  }, MAX_JOB_DURATION_MS);

  try {
    // Extract origin channel stored at queue time — used to route the completion
    // notification back to the right channel rather than spamming all channels.
    const jobInput = (job.input as Record<string, unknown>) ?? {};
    const originChannel = typeof jobInput.originChannel === "string" ? jobInput.originChannel : undefined;
    const originDiscordChannelId = typeof jobInput.originDiscordChannelId === "string" ? jobInput.originDiscordChannelId : undefined;

    // Helper: fire the workflow hook if this job belongs to a workflow step.
    const wfId    = jobInput.workflowId    as string | undefined;
    const wfStep  = jobInput.workflowStepIndex as number | undefined;
    const hasWorkflow = !!wfId && wfStep !== undefined;

    if (job.agentType === "weekly_pattern") {
      const result = await runWeeklyPatternJob(job.userId);
      await completeJob(job.id, {
        result: { weekOf: result.weekOf, patterns: result.patternCount, promoted: result.promotedMemories },
        turns: 1,
        toolCallsCount: 0,
      });
      diagEmit({
        userId: job.userId,
        subsystem: "job_queue",
        severity: "info",
        message: `Job ${job.id} (weekly_pattern) completed — ${result.patternCount} patterns`,
        metadata: { jobId: job.id, agentType: job.agentType, recovery: true },
      }).catch(() => {});
      console.log(`[JobQueue] complete weekly_pattern job ${job.id} → ${result.patternCount} patterns`);
      const weeklyMsg = result.driveLink
        ? `${result.patternCount} pattern(s) identified, ${result.promotedMemories} promoted to long-term memory.\n${result.summary}\n\n📁 Saved to Google Drive: ${result.driveLink}`
        : `${result.patternCount} pattern(s) identified, ${result.promotedMemories} promoted to long-term memory.\n${result.summary}`;
      await notifyJobComplete(
        job.userId,
        "weekly_pattern",
        `Weekly review (${result.weekOf})`,
        weeklyMsg,
      );
      if (hasWorkflow) {
        await onWorkflowJobComplete(wfId!, wfStep!, job.id, result.summary || weeklyMsg).catch((e) =>
          console.error("[JobQueue] workflow hook failed:", e),
        );
      }
      return;
    }

    // ── Named-agent task (orchestrator-dispatched) ─────────────────────────
    if (job.agentType === "named_agent_task") {
      const input = (job.input as Record<string, unknown>) ?? {};
      const namedAgentId = String(input.namedAgentId ?? "");
      const agentName = String(input.agentName ?? "Agent");
      const iterationCount = typeof input.iterationCount === "number" ? input.iterationCount : 0;
      // Optional per-request model override from the orchestrator.
      const namedAgentModel = typeof input.model === "string" ? input.model : undefined;

      if (!namedAgentId) throw new Error("named_agent_task job missing namedAgentId");

      console.log(
        `[JobQueue] named_agent_task agent=${agentName}(${namedAgentId}) iteration=${iterationCount + 1}`,
      );

      const result = await runNamedAgent({
        agentId: namedAgentId,
        userId: job.userId,
        userMessage: job.prompt,
        platform: "orchestrator",
        initiatedBy: "jarvis",
        model: namedAgentModel,
      });

      await completeJob(job.id, {
        result: {
          output: result.reply,
          agentId: namedAgentId,
          agentName,
          iterationCount,
        },
        turns: result.turns,
        toolCallsCount: result.toolCalls?.length ?? 0,
      });

      console.log(
        `[JobQueue] named_agent_task complete: agent=${agentName} job=${job.id} ` +
          `turns=${result.turns} iteration=${iterationCount + 1}`,
      );

      const snippet = result.reply.slice(0, 280);
      await notifyJobComplete(
        job.userId,
        "named_agent_task",
        `${agentName} — ${job.title}`,
        `Iteration ${iterationCount + 1} complete. Review output and approve or request a revision.\n\n${snippet}${result.reply.length > 280 ? "…" : ""}`,
        originChannel,
        originDiscordChannelId,
      );

      if (hasWorkflow) {
        await onWorkflowJobComplete(wfId!, wfStep!, job.id, result.reply.slice(0, 1200)).catch((e) =>
          console.error("[JobQueue] workflow hook failed:", e),
        );
      }
      return;
    }

    // ── Custom user-defined agent ──────────────────────────────────────────────
    if (job.agentType === "custom_agent") {
      const input = (job.input as Record<string, unknown>) ?? {};
      const customAgentId = String(input.customAgentId ?? "");

      if (!customAgentId) throw new Error("custom_agent job missing customAgentId");

      const { db: _db } = await import("../db");
      const { customAgents } = await import("@shared/schema");
      const { eq: _eq } = await import("drizzle-orm");

      const [agentDef] = await _db
        .select()
        .from(customAgents)
        .where(_eq(customAgents.id, customAgentId))
        .limit(1);

      if (!agentDef) throw new Error(`Custom agent ${customAgentId} not found`);

      const tokens = await getValidGoogleTokens(job.userId).catch(() => []);
      const googleAccessToken = tokens?.[0] || null;
      const ctx: ToolContext = {
        userId: job.userId,
        googleAccessToken,
        channel: `JobQueue/custom_agent`,
        state: { pendingAttachments: [] },
      };

      const modelOverride = typeof input.model === "string"
        ? input.model
        : agentDef.model ?? undefined;

      let customSub = await runSubAgent({
        agentType: agentDef.baseType as SubAgentType,
        prompt: job.prompt,
        defaultTitle: job.title,
        context: ctx,
        model: modelOverride,
        extraSystemPrompt: agentDef.extraPrompt ?? undefined,
      });

      // ── Claude Opus verification loop (custom_agent) ──────────────────────
      const MAX_CUSTOM_VERIFY_RETRIES = 2;
      let customVerificationPassed: boolean | null = null;
      let customVerificationRetries = 0;
      {
        const { getModel } = await import("../lib/modelPrefs");
        const orchModel = await getModel(job.userId, "orchestrator");
        let correctionContext: string | undefined;

        for (let attempt = 0; attempt <= MAX_CUSTOM_VERIFY_RETRIES; attempt++) {
          const verification = await verifyJobOutput({
            agentType: "custom_agent",
            originalPrompt: job.prompt,
            result: customSub.body,
            orchestratorModel: orchModel,
            correctionContext,
          });

          if (verification.passed === true) {
            customVerificationPassed = true;
            break;
          }

          if (verification.passed === null) {
            // Verifier timed out or errored — fail-open: deliver as-is, status unknown
            customVerificationPassed = null;
            console.log(
              `[JobQueue] verify unknown (timeout/error) for custom_agent job ${job.id} — delivering with null status: ${verification.reason}`,
            );
            break;
          }

          // passed === false: content rejected — retry if attempts remain
          correctionContext = verification.reason;
          if (attempt < MAX_CUSTOM_VERIFY_RETRIES) {
            customVerificationRetries++;
            console.log(
              `[JobQueue] verify retry ${attempt + 1}/${MAX_CUSTOM_VERIFY_RETRIES} for custom_agent job ${job.id}: ${verification.reason}`,
            );
            const revisedPrompt =
              `${job.prompt}\n\n` +
              `[Previous attempt was rejected for: ${correctionContext}. Please address this in your response.]`;
            customSub = await runSubAgent({
              agentType: agentDef.baseType as SubAgentType,
              prompt: revisedPrompt,
              defaultTitle: job.title,
              context: ctx,
              model: modelOverride,
              extraSystemPrompt: agentDef.extraPrompt ?? undefined,
            });
          } else {
            customVerificationPassed = false;
            console.log(
              `[JobQueue] verify exhausted for custom_agent job ${job.id} after ${MAX_CUSTOM_VERIFY_RETRIES} retries — delivering best result`,
            );
          }
        }
      }
      customSub.meta.verificationPassed = customVerificationPassed;
      customSub.meta.verificationRetries = customVerificationRetries;
      // ─────────────────────────────────────────────────────────────────────

      const sub = customSub;

      const { db: __db } = await import("../db");
      const { deliverables: _deliverables } = await import("@shared/schema");

      const inserted = await __db
        .insert(_deliverables)
        .values({
          userId: job.userId,
          jobId: job.id,
          agentType: "custom_agent",
          type: sub.type,
          title: `[${agentDef.name}] ${sub.title}`,
          summary: sub.summary,
          body: sub.body,
          meta: { ...sub.meta, customAgentId, customAgentName: agentDef.name },
        })
        .returning({ id: _deliverables.id });

      const deliverableId = inserted[0]?.id || "";

      await completeJob(job.id, {
        result: { deliverableId, type: sub.type, title: sub.title, customAgentId },
        turns: sub.turns,
        toolCallsCount: sub.toolCallsCount,
      });

      console.log(
        `[JobQueue] complete custom_agent job ${job.id} agent="${agentDef.name}" deliverable=${deliverableId}`,
      );

      const notifyMsg = `${sub.summary || "Ready for review"} — open Inbox to review.`;
      await notifyJobComplete(
        job.userId,
        "custom_agent",
        `${agentDef.name}: ${sub.title}`,
        notifyMsg,
        originChannel,
        originDiscordChannelId,
      );

      if (hasWorkflow) {
        const wfOutput = `${sub.title}\n\n${sub.summary || ""}\n\n${sub.body?.slice(0, 1200) || ""}`.trim();
        await onWorkflowJobComplete(wfId!, wfStep!, job.id, wfOutput).catch((e) =>
          console.error("[JobQueue] workflow hook failed:", e),
        );
      }
      return;
    }

    if (job.agentType === "goal_decompose") {
      const result = await runGoalDecomposition(job);
      await completeJob(job.id, {
        result: { goalTreeId: result.goalTreeId, phases: result.phaseCount },
        turns: result.turns,
        toolCallsCount: result.toolCallsCount,
      });
      diagEmit({
        userId: job.userId,
        subsystem: "job_queue",
        severity: "info",
        message: `Job ${job.id} (goal_decompose) completed — ${result.phaseCount} phases`,
        metadata: { jobId: job.id, agentType: job.agentType, recovery: true },
      }).catch(() => {});
      console.log(`[JobQueue] complete goal_decompose job ${job.id} → tree ${result.goalTreeId}`);
      const goalMsg = `Goal broken into ${result.phaseCount} phase(s). Open the Goals tab to review.`;
      await notifyJobComplete(job.userId, "goal_decompose", job.title, goalMsg, originChannel, originDiscordChannelId);
      if (hasWorkflow) {
        await onWorkflowJobComplete(wfId!, wfStep!, job.id, goalMsg).catch((e) =>
          console.error("[JobQueue] workflow hook failed:", e),
        );
      }
      return;
    }

    // ── General-purpose diagnostic agent (e.g. auto-debug from IntegrationValidator) ─
    if (job.agentType === "general") {
      const generalCtx: ToolContext = {
        userId: job.userId,
        googleAccessToken: null,
        channel: `JobQueue/general`,
        state: { pendingAttachments: [] },
      };

      const debugTools = [
        readRecentErrorsTool,
        listSourceFilesTool,
        readSourceFileTool,
        proposeCodeChangeTool,
      ];

      const result = await runAgent({
        messages: [
          {
            role: "system",
            content: `You are Jarvis, an AI assistant running a background diagnostic task.
The user is NOT present in this conversation. Your job is to investigate an error, diagnose the root
cause, and either propose a code fix or send a plain-English diagnosis to the user's inbox.

Always conclude by either calling propose_code_change (if a targeted code fix is appropriate) or by
writing a clear inbox message explaining what is broken and what the user should do.`,
          },
          { role: "user", content: job.prompt },
        ],
        tools: debugTools,
        context: generalCtx,
        maxTurns: 8,
      });

      await completeJob(job.id, {
        result: { output: result.reply, agentType: "general" },
        turns: result.turns,
        toolCallsCount: result.toolCalls?.length ?? 0,
      });

      console.log(`[JobQueue] complete general job ${job.id} turns=${result.turns}`);

      const generalReply = result.reply?.trim()
        ? result.reply.slice(0, 3000)
        : "Auto-debug ran but produced no summary. Please check the Proposals tab or review recent error logs for details.";
      await notifyJobComplete(job.userId, "general", job.title, generalReply, originChannel, originDiscordChannelId);

      if (hasWorkflow) {
        await onWorkflowJobComplete(wfId!, wfStep!, job.id, generalReply).catch((e) =>
          console.error("[JobQueue] workflow hook failed:", e),
        );
      }
      return;
    }

    // ── Morning brief agent ──────────────────────────────────────────────────
    if (job.agentType === "morning_brief") {
      const briefTokens = await getValidGoogleTokens(job.userId).catch(() => []);
      const briefGoogleToken = briefTokens?.[0] || null;
      const briefCtx: ToolContext = {
        userId: job.userId,
        googleAccessToken: briefGoogleToken,
        channel: `JobQueue/morning_brief`,
        state: { pendingAttachments: [] },
      };
      const briefTools = briefGoogleToken ? [fetchCalendarTool] : [];
      const briefModelOverride = typeof jobInput.model === "string" ? jobInput.model : undefined;

      const briefResult = await runAgent({
        messages: [
          {
            role: "system",
            content: `You are Jarvis, generating an on-demand morning briefing for the user. The user is NOT in this conversation.

Your job: produce a concise, actionable briefing they can act on immediately.

Structure your response as follows (plain markdown, no extra headers):

## ☀️ Morning Briefing

**Today at a glance** — 2-3 sentences summarising the key focus for the day.

**Calendar** — if you called fetch_calendar, list upcoming events for today/tomorrow. If no calendar is connected, skip this section.

**Goals & priorities** — Summarise what the user should focus on. If no specific goals are in the prompt, suggest a general productivity focus.

**Quick wins** — 2-3 small, specific actions the user can complete today.

Keep the whole briefing under 300 words. Be warm but direct. No filler phrases.`,
          },
          { role: "user", content: job.prompt },
        ],
        tools: briefTools,
        context: briefCtx,
        maxTurns: 4,
        model: briefModelOverride,
      });

      await completeJob(job.id, {
        result: { output: briefResult.reply, agentType: "morning_brief" },
        turns: briefResult.turns,
        toolCallsCount: briefResult.toolCalls?.length ?? 0,
      });

      console.log(`[JobQueue] complete morning_brief job ${job.id} turns=${briefResult.turns}`);

      const briefReply = briefResult.reply?.trim()
        ? briefResult.reply.slice(0, 3000)
        : "Your morning briefing is ready. No summary was produced — please try again.";
      await notifyJobComplete(job.userId, "morning_brief", job.title, briefReply, originChannel, originDiscordChannelId);

      if (hasWorkflow) {
        await onWorkflowJobComplete(wfId!, wfStep!, job.id, briefReply).catch((e) =>
          console.error("[JobQueue] workflow hook failed:", e),
        );
      }
      return;
    }

    // Sub-agent run
    const tokens = await getValidGoogleTokens(job.userId).catch(() => []);
    const googleAccessToken = tokens?.[0] || null;
    const ctx: ToolContext = {
      userId: job.userId,
      googleAccessToken,
      channel: `JobQueue/${job.agentType}`,
      state: { pendingAttachments: [] },
    };

    // Per-type model routing is handled at orchestrator-controlled spawn points
    // (queue_background_job, spawn_subagent) via getModelForJobType(). The model
    // arrives here via job.input.model. Other callers that omit input.model
    // preserve the original resolution path inside runSubAgent.
    const subAgentModelOverride = typeof jobInput.model === "string" ? jobInput.model : undefined;

    let sub = await runSubAgent({
      agentType: job.agentType as SubAgentType,
      prompt: job.prompt,
      defaultTitle: job.title,
      context: ctx,
      model: subAgentModelOverride,
    });

    // ── Claude Opus verification loop ─────────────────────────────────────────
    // Applies to user-facing deliverable types only. Skipped for system jobs
    // (weekly_pattern, named_agent_task, morning_brief, goal_decompose) which
    // are handled separately above with their own structured validation.
    const VERIFY_AGENT_TYPES = ["research", "writing", "planning", "email"];
    const MAX_JOB_VERIFY_RETRIES = 2;
    let verificationPassed: boolean | null = null;
    let verificationRetries = 0;

    if (VERIFY_AGENT_TYPES.includes(job.agentType)) {
      const { getModel } = await import("../lib/modelPrefs");
      const orchModel = await getModel(job.userId, "orchestrator");
      let correctionContext: string | undefined;

      for (let attempt = 0; attempt <= MAX_JOB_VERIFY_RETRIES; attempt++) {
        const verification = await verifyJobOutput({
          agentType: job.agentType,
          originalPrompt: job.prompt,
          result: sub.body,
          orchestratorModel: orchModel,
          correctionContext,
        });

        if (verification.passed === true) {
          verificationPassed = true;
          break;
        }

        if (verification.passed === null) {
          // Verifier timed out or errored — fail-open: deliver as-is, status unknown
          verificationPassed = null;
          console.log(
            `[JobQueue] verify unknown (timeout/error) for job ${job.id} — delivering with null status: ${verification.reason}`,
          );
          break;
        }

        // passed === false: content rejected — retry if attempts remain
        correctionContext = verification.reason;
        if (attempt < MAX_JOB_VERIFY_RETRIES) {
          verificationRetries++;
          console.log(
            `[JobQueue] verify retry ${attempt + 1}/${MAX_JOB_VERIFY_RETRIES} for job ${job.id} (${job.agentType}): ${verification.reason}`,
          );
          const revisedPrompt =
            `${job.prompt}\n\n` +
            `[Previous attempt was rejected for: ${correctionContext}. Please address this in your response.]`;
          sub = await runSubAgent({
            agentType: job.agentType as SubAgentType,
            prompt: revisedPrompt,
            defaultTitle: job.title,
            context: ctx,
            model: subAgentModelOverride,
          });
        } else {
          verificationPassed = false;
          console.log(
            `[JobQueue] verify exhausted for job ${job.id} after ${MAX_JOB_VERIFY_RETRIES} retries — delivering best result`,
          );
        }
      }
    }

    // Attach verification outcome to meta so the UI can surface a badge.
    sub.meta.verificationPassed = verificationPassed;
    sub.meta.verificationRetries = verificationRetries;
    // ─────────────────────────────────────────────────────────────────────────

    if (job.agentType === "research" && !researchHasSourceUrls(sub.body)) {
      sub.meta.noSourceUrls = true;
      const NO_SOURCES_BANNER =
        "> ⚠️ **No cited sources.** This result does not contain a ## Sources section with real URLs. " +
        "The research agent may not have performed a live web search. Verify any claims before acting on them.\n\n";
      sub.body = NO_SOURCES_BANNER + sub.body;
      sub.summary = "⚠️ No cited sources — " + sub.summary;
    }

    // ── Format request detection ──────────────────────────────────────────────
    // Detect whether the user explicitly asked for a PDF or Word document.
    // "word"/"docx" requests are also mapped to PDF (best available format).
    // For research jobs: the batch coordinator (flushResearchBatch) generates
    // ONE consolidated PDF from all sibling results — no per-job PDF here.
    // For writing jobs: generate immediately since they are not batched.
    const promptLower = (job.prompt || "").toLowerCase();
    const wantsPdf = /\b(pdf|word|docx|as pdf|in pdf|export pdf|save pdf|generate pdf|as word|in word)\b/.test(promptLower);

    let pdfNote = "";

    if (wantsPdf && job.agentType === "writing") {
      // Writing jobs are individual — generate PDF right here.
      try {
        const pdfBuffer = await markdownToPdfBuffer(sub.title, sub.body);
        const filename = sub.title.replace(/[^A-Za-z0-9._\- ]+/g, "_").slice(0, 80).trim() + ".pdf";
        sub.meta.pdfGenerated = true;
        sub.meta.pdfFilename = filename;

        let driveLink: string | null = null;
        if (googleAccessToken) {
          try {
            const driveFile = await createDriveBinaryFile(
              googleAccessToken,
              filename,
              pdfBuffer,
              "application/pdf",
            );
            driveLink = driveFile.webViewLink || null;
            sub.meta.pdfDriveLink = driveLink;
            pdfNote = `\n\n📄 PDF attached and saved to Google Drive: ${driveLink}`;
            console.log(`[JobQueue] writing job ${job.id} PDF → Drive: ${driveLink}`);
          } catch (driveErr) {
            const driveMsg = driveErr instanceof Error ? driveErr.message : String(driveErr);
            console.error(`[JobQueue] writing PDF Drive upload failed for job ${job.id}:`, driveMsg);
            pdfNote = `\n\n📄 PDF attached (Drive upload failed: ${driveMsg}).`;
          }
        } else {
          pdfNote = `\n\n📄 PDF attached.`;
        }

        // Attach PDF for channel delivery (driveLink included so oversized-file
        // fallback in Discord/other channels can reference the stored copy).
        ctx.state.pendingAttachments.push({
          kind: "document",
          filename,
          content: pdfBuffer,
          caption: sub.title,
          mimeType: "application/pdf",
          driveLink: driveLink ?? undefined,
        });
      } catch (pdfErr) {
        const pdfMsg = pdfErr instanceof Error ? pdfErr.message : String(pdfErr);
        console.error(`[JobQueue] writing PDF generation failed for job ${job.id}:`, pdfMsg);
        pdfNote = `\n\n⚠️ PDF generation failed — here is the markdown version instead. (${pdfMsg})`;
        sub.meta.pdfError = pdfMsg;
      }
    }
    // Research jobs: wantsPdf is passed to the batch coordinator, which
    // generates ONE consolidated PDF from all sibling deliverables.
    // ─────────────────────────────────────────────────────────────────────────

    const inserted = await db
      .insert(schema.deliverables)
      .values({
        userId: job.userId,
        jobId: job.id,
        agentType: job.agentType,
        type: sub.type,
        title: sub.title,
        summary: sub.summary,
        body: sub.body,
        meta: sub.meta,
        driveLink: (sub.meta?.pdfDriveLink as string | undefined) ?? null,
      })
      .returning({ id: schema.deliverables.id });

    const deliverableId = inserted[0]?.id || "";
    await completeJob(job.id, {
      result: { deliverableId, type: sub.type, title: sub.title },
      turns: sub.turns,
      toolCallsCount: sub.toolCallsCount,
    });
    diagEmit({
      userId: job.userId,
      subsystem: "job_queue",
      severity: "info",
      message: `Job ${job.id} (${job.agentType}) completed — deliverable ${deliverableId}`,
      metadata: { jobId: job.id, agentType: job.agentType, recovery: true },
    }).catch(() => {});
    console.log(`[JobQueue] complete ${job.agentType} job ${job.id} → deliverable ${deliverableId}`);
    const subNotifyMsg = `${sub.summary || "Ready for review"} — open Inbox to approve, edit, or discard.${pdfNote}`;

    // For writing jobs with PDF attachments, forward those attachments in the notification.
    // Research jobs: the batch coordinator handles attachments at flush time.
    const subNotifyOpts: ChannelSendOpts = {};
    if (job.agentType !== "research" && ctx.state.pendingAttachments && ctx.state.pendingAttachments.length > 0) {
      subNotifyOpts.attachments = ctx.state.pendingAttachments as ChannelSendOpts["attachments"];
    }

    // Use sibling-aware notification: if another job from the same batch is
    // still running, defer so the last one to finish sends one notification.
    await notifySubAgentJobComplete(job, sub.title, subNotifyMsg, job.id, wantsPdf && job.agentType === "research", subNotifyOpts);
    if (hasWorkflow) {
      const wfOutput = `${sub.title}\n\n${sub.summary || ""}\n\n${sub.body?.slice(0, 1200) || ""}`.trim();
      await onWorkflowJobComplete(wfId!, wfStep!, job.id, wfOutput).catch((e) =>
        console.error("[JobQueue] workflow hook failed:", e),
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[JobQueue] job ${job.id} failed:`, err);

    const jobInput = (job.input as Record<string, unknown>) ?? {};
    const retryCount = typeof jobInput.retryCount === "number" ? jobInput.retryCount : 0;
    const MAX_RETRIES = 2;

    // Log persistent errors to system_error_log for Jarvis self-debugging
    logSystemError({
      source: `jobQueue/${job.agentType}`,
      message: msg,
      error: err,
      level: "error",
      context: { jobId: job.id, agentType: job.agentType, retryCount },
      userId: job.userId,
    }).catch(() => {});

    if (retryCount < MAX_RETRIES) {
      const nextRetry = retryCount + 1;
      console.log(`[JobQueue] re-queuing job ${job.id} (attempt ${nextRetry}/${MAX_RETRIES}) after error: ${msg}`);
      try {
        await db
          .update(schema.agentJobs)
          .set({
            status: "queued",
            startedAt: null,
            error: `Retry ${nextRetry}/${MAX_RETRIES}: ${msg}`.slice(0, 2000),
            input: { ...jobInput, retryCount: nextRetry },
          })
          .where(eq(schema.agentJobs.id, job.id));
      } catch (retryErr) {
        console.error(`[JobQueue] failed to re-queue job ${job.id}:`, retryErr);
        await failJob(job.id, msg, job.userId);
      }
    } else {
      console.log(`[JobQueue] permanently failing job ${job.id} after ${MAX_RETRIES + 1} total attempts`);
      await failJob(job.id, msg, job.userId);
      // Fail the workflow step if applicable.
      const wfId2   = jobInput.workflowId    as string | undefined;
      const wfStep2 = jobInput.workflowStepIndex as number | undefined;
      if (wfId2 && wfStep2 !== undefined) {
        await onWorkflowJobFail(wfId2, wfStep2, msg).catch((e) =>
          console.error("[JobQueue] workflow fail hook failed:", e),
        );
      }
    }
  } finally {
    clearTimeout(watchdog);
  }
}

async function tick(): Promise<void> {
  // Drain a few jobs per tick so multiple users don't starve each other.
  for (let i = 0; i < 5; i++) {
    const job = await claimNextJob();
    if (!job) return;
    // Run the job but don't block the tick — let it run in parallel for
    // different users (the SQL claim already enforces one-per-user).
    processJob(job).catch((err) => {
      console.error(`[JobQueue] processJob threw for ${job.id}:`, err);
    });
  }
}

/**
 * Recover any jobs that were running when the process died — return
 * them to the queue so the restarted worker picks them up.
 */
async function recoverStaleJobs(): Promise<void> {
  try {
    // Jobs stuck in 'running' when the process died — re-queue them.
    const requeued = await db
      .update(schema.agentJobs)
      .set({ status: "queued", startedAt: null })
      .where(eq(schema.agentJobs.status, "running"))
      .returning({ id: schema.agentJobs.id });
    if (requeued.length > 0) {
      console.log(`[JobQueue] recovered ${requeued.length} stale running job(s) from previous process`);
    }
    // Jobs in 'cancelling' when the process died — mark them cancelled since
    // the user already requested cancellation and the worker is gone.
    const cancelled = await db
      .update(schema.agentJobs)
      .set({ status: "cancelled", completedAt: new Date() })
      .where(eq(schema.agentJobs.status, "cancelling"))
      .returning({ id: schema.agentJobs.id });
    if (cancelled.length > 0) {
      console.log(`[JobQueue] cancelled ${cancelled.length} stale cancelling job(s) from previous process`);
    }
  } catch (err) {
    console.error("[JobQueue] recoverStaleJobs failed:", err);
  }
}

export function startJobQueueWorker(): void {
  if (workerStarted) return;
  workerStarted = true;
  stopRequested = false;

  recoverStaleJobs().catch((err) => console.error("[JobQueue] recover error:", err));

  const loop = async () => {
    if (stopRequested) return;
    if (workerRunning) {
      setTimeout(loop, TICK_MS);
      return;
    }
    workerRunning = true;
    try {
      await tick();
    } catch (err) {
      console.error("[JobQueue] tick error:", err);
    } finally {
      workerRunning = false;
      setTimeout(loop, TICK_MS);
    }
  };

  setTimeout(loop, 5000);
  console.log(`[JobQueue] worker started — polling every ${TICK_MS / 1000}s`);
}

export function stopJobQueueWorker(): void {
  stopRequested = true;
}
