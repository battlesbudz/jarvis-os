/**
 * Transcript Job Tracker
 *
 * Manages async Supadata transcript jobs for long videos (3+ hours) that take
 * 5–10 minutes to process. Jobs are stored in the transcript_jobs table.
 * The background poller checks for completions every 30 seconds and notifies
 * the user when their transcript is ready.
 */

import { db } from "../db";
import { transcriptJobs } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import type { TranscriptResponse } from "youtube-transcript";
import type { TranscriptJob } from "@shared/schema";

/** Start a new async Supadata transcript job in the DB. */
export async function startSupadataJob(
  userId: string,
  videoId: string,
  supadataJobId: string
): Promise<void> {
  await db.insert(transcriptJobs).values({
    userId,
    videoId,
    supadataJobId,
    status: "pending",
  });
  console.log(`[transcriptJobTracker] Started async job ${supadataJobId} for video ${videoId} (user=${userId})`);
}

/**
 * Check whether a previously-started async job has already completed and
 * return the cached segments if so. Returns null if no completed job found.
 */
export async function getCompletedTranscript(
  userId: string,
  videoId: string
): Promise<TranscriptResponse[] | null> {
  const rows = await db
    .select()
    .from(transcriptJobs)
    .where(
      and(
        eq(transcriptJobs.userId, userId),
        eq(transcriptJobs.videoId, videoId),
        eq(transcriptJobs.status, "completed")
      )
    )
    .limit(1);

  if (rows.length === 0 || !rows[0].result) return null;

  try {
    const segments = JSON.parse(rows[0].result) as TranscriptResponse[];
    console.log(`[transcriptJobTracker] Found completed cached job for ${videoId} (user=${userId}) — ${segments.length} segs`);
    return segments;
  } catch {
    return null;
  }
}

/**
 * Cancel all pending transcript jobs for a user.
 * Called when the user presses Stop — prevents the background poller from
 * completing and notifying the user for a job they already cancelled.
 * Returns the number of rows updated.
 */
export async function cancelUserTranscriptJobs(userId: string): Promise<number> {
  const result = await db
    .update(transcriptJobs)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      and(
        eq(transcriptJobs.userId, userId),
        eq(transcriptJobs.status, "pending")
      )
    );
  return (result as unknown as { rowCount?: number }).rowCount ?? 0;
}

/**
 * Poll a single job row, check its Supadata status, and update DB on completion.
 * Returns the completed segments if the job finished, or null if still pending/failed.
 */
async function checkAndFinishJob(row: TranscriptJob): Promise<TranscriptResponse[] | null> {
  try {
    const { Supadata } = await import("@supadata/js");
    const apiKey = process.env.SUPADATA_API_KEY;
    if (!apiKey) return null;

    const client = new Supadata({ apiKey });
    const job = await client.transcript.getJobStatus(row.supadataJobId);

    if (job.status === "completed" && job.result) {
      const content = job.result.content;
      let segments: TranscriptResponse[];

      if (typeof content === "string") {
        segments = [{ text: content.trim(), offset: 0, duration: 0, lang: job.result.lang ?? "en" }];
      } else if (Array.isArray(content) && content.length > 0) {
        segments = content.map((chunk) => ({
          text: chunk.text,
          offset: chunk.offset,
          duration: chunk.duration,
          lang: (chunk as { lang?: string }).lang ?? job.result?.lang ?? "en",
        }));
      } else {
        segments = [];
      }

      await db
        .update(transcriptJobs)
        .set({
          status: "completed",
          result: JSON.stringify(segments),
          updatedAt: new Date(),
        })
        .where(eq(transcriptJobs.id, row.id));

      console.log(`[transcriptJobTracker] Job ${row.supadataJobId} completed — ${segments.length} segs for video ${row.videoId}`);
      return segments;
    }

    if (job.status === "failed") {
      await db
        .update(transcriptJobs)
        .set({
          status: "failed",
          updatedAt: new Date(),
        })
        .where(eq(transcriptJobs.id, row.id));

      console.warn(`[transcriptJobTracker] Job ${row.supadataJobId} failed for video ${row.videoId}`);
      return null;
    }

    return null;
  } catch (err) {
    console.warn(
      `[transcriptJobTracker] Error checking job ${row.supadataJobId}: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

/**
 * Background poller: runs every 30 seconds, checks all pending jobs,
 * caches completed transcripts, and notifies users.
 */
export function runBackgroundPoller(): void {
  const POLL_INTERVAL_MS = 30_000;

  const poll = async () => {
    try {
      const pending = await db
        .select()
        .from(transcriptJobs)
        .where(eq(transcriptJobs.status, "pending"));

      if (pending.length === 0) return;

      console.log(`[transcriptJobTracker] Polling ${pending.length} pending job(s)`);

      for (const row of pending) {
        const segments = await checkAndFinishJob(row);
        if (!segments || segments.length === 0) continue;

        try {
          const { storeCachedTranscript } = await import("./transcriptCache");
          storeCachedTranscript(row.videoId, segments, "supadata");
        } catch (cacheErr) {
          console.warn(`[transcriptJobTracker] Failed to update transcript cache: ${cacheErr instanceof Error ? cacheErr.message : String(cacheErr)}`);
        }

        try {
          const { notifyUser } = await import("../channels");
          await notifyUser(
            row.userId,
            "general",
            `✅ Your transcript for that video is ready! Just ask me to summarize it or answer questions about it — I've already loaded it.`
          );
          console.log(`[transcriptJobTracker] Notified user ${row.userId} — transcript ready for ${row.videoId}`);
        } catch (notifyErr) {
          console.warn(`[transcriptJobTracker] Failed to notify user ${row.userId}: ${notifyErr instanceof Error ? notifyErr.message : String(notifyErr)}`);
        }
      }
    } catch (err) {
      console.warn(`[transcriptJobTracker] Poll cycle error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  setInterval(poll, POLL_INTERVAL_MS);
  console.log("[transcriptJobTracker] Background poller started (30s interval)");
}
