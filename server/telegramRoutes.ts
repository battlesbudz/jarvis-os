import type { Express, Request, Response } from "express";
import { db } from "./db";
import { eq, and, desc, sql, gte, lte } from "drizzle-orm";
import * as schema from "@shared/schema";
import { sendMessage, sendLongMessage, sendMessageWithButtons, sendTelegramDocument, sendPhoto, sendVoice, sendChatAction, answerCallbackQuery, isTelegramConfigured, getUpdates, downloadTelegramFile, downloadTelegramFileBuffer, getWebhookHealth, ensureWebhook, getExpectedWebhookUrl, sendMessageGetId, editMessage, buildVoiceCallKeyboard } from "./integrations/telegram";
import { attachmentToBuffer, collectMarkdownExtras } from "./channels/attachmentHelpers";
import { outboundMiddleware } from "./channels/outboundMiddleware";
import type { ChannelAttachment } from "./channels/types";
import { isIngestableDocument, extractTelegramDocument, buildDocumentContextBlock } from "./telegramDocumentExtractor";
import { getUserTtsPrefs, setUserTtsPref, speakToUser, getUserTtsChannels, setTtsChannels, ELEVENLABS_VOICES } from "./agent/tools/tts";
import { notifyUser, getChannel } from "./channels/registry";
import type { NotificationType } from "@shared/schema";
import { startMomentumSession, handleMomentumDone, hasMomentumSessionToday, startMomentumExpiryScheduler } from "./momentumCoach";
import { getRecentEmailCommitments, getEmailsSince, getStarredFollowUpEmails, gmailModifyMessage } from "./integrations/gmail";
import { getGoogleCalendarEvents } from "./integrations/googleCalendar";
import { getValidGoogleTokens, getUserTokens, refreshGoogleToken } from "./userTokenStore";
import { buildGmailSourceId, gmailMessageIdExistsForUser } from "./utils/gmailSourceId";
import { tavilySearch, formatSearchResults } from "./integrations/search";
import { logInteraction, getRecentInteractions, formatInteractionTimeline } from "./interactionLog";
import { extractAndStore } from "./memory/extractor";
import { getSoulPromptBlock } from "./memory/soul";
import { runAgent } from "./agent/harness";
import { telegramCoachTools } from "./agent/tools";
import { runCoachAgent } from "./channels/coachAgent";
import { routeToNamedAgent } from "./agent/runNamedAgent";
import { completePairing as completeDiscordPairing } from "./discord/manager";
import { getSession as getCoachSession, setSession as setCoachSession } from "./channels/sessionStore";
import OpenAI from "openai";
import { claimAndMark } from "./lib/proactiveDedup";
import { routeSlashCommand, registerTelegramBotCommands, SLASH_COMMANDS } from "./channels/slashCommandRouter";
import { getActiveRunForUser, activeCoachRuns } from "./runRegistry";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

function generateLinkCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}


/**
 * Deliver the reply and any attachments from a named-agent result to a Telegram chat.
 * Mirrors the attachment-delivery logic used by the coach agent path so that
 * images, documents, and files produced by MCP tool calls are not silently dropped.
 *
 * Design notes:
 * - Model-generated text is NOT sent with parse_mode:"Markdown" to avoid parse
 *   errors on unescaped characters. sendLongMessage handles chunking at 4096 chars.
 * - Text is only cleared (and logged) after a confirmed successful send; if sending
 *   text before media fails, text is sent again after media so it is never lost.
 * - agentLabel is sent as a separate plain-text header when provided.
 */
async function deliverNamedAgentResult(
  chatId: string,
  userId: string,
  agentLabel: string | null,
  result: { reply: string; attachments?: ChannelAttachment[] },
  placeholderMsgId?: number | null,
): Promise<void> {
  const atts = result.attachments ?? [];
  const mediaAttsCount = atts.filter((a) => a.kind !== "markdown").length;

  // Merge markdown attachments into the text reply (no binary payload to send).
  const markdownExtra = collectMarkdownExtras(atts);
  // Only use the fallback apology when nothing at all was produced — if binary
  // attachments were generated, omit the apology so the user isn't confused.
  let textReply = result.reply
    || (mediaAttsCount === 0 ? "Sorry, the agent couldn't respond right now." : "");
  if (markdownExtra) {
    textReply = textReply ? `${textReply}\n\n${markdownExtra}` : markdownExtra;
  }

  // Run outbound middleware (agent-name prefix, length limiter, whitespace cleaner).
  const processedText = await outboundMiddleware.run({
    text: textReply,
    platform: "telegram",
    userId,
    agentName: agentLabel ?? undefined,
  });
  // Middleware may cancel the send (e.g. empty reply guard made nothing useful).
  // In that case still send the label as a header so media attachments have context.
  if (processedText === null && agentLabel && atts.filter((a) => a.kind !== "markdown").length > 0) {
    try { await sendMessage(chatId, `${agentLabel}:`); } catch (_) { /* non-blocking */ }
  }
  textReply = processedText ?? "";

  // Non-markdown attachments need text sent first so ordering is natural (text → media).
  const mediaAtts = atts.filter((a) => a.kind !== "markdown");
  let textSent = false;
  if (mediaAtts.length > 0 && textReply.trim()) {
    try {
      await deliverCoachText(chatId, textReply, placeholderMsgId ?? null);
      // Placeholder consumed — clear so we don't reuse it below.
      placeholderMsgId = null;
      logInteraction(userId, "telegram", "outbound", textReply).catch(() => {});
      textSent = true;
    } catch (sendErr) {
      console.error("[Telegram] named agent: failed to send text before attachment:", sendErr);
      // text not sent — will retry after media below
    }
  }

  // Deliver binary attachments produced by the agent.
  for (const att of mediaAtts) {
    if (att.kind === "document") {
      const ok = await sendTelegramDocument(chatId, att.filename, att.content, att.caption, att.mimeType);
      console.log(`[Telegram] named agent: delivered document ${att.filename} ok=${ok}`);
    } else if (att.kind === "image") {
      try {
        const buf = await attachmentToBuffer(att);
        if (buf) {
          const ok = await sendPhoto(chatId, buf, att.caption);
          console.log(`[Telegram] named agent: delivered image ok=${ok}`);
        } else {
          console.warn("[Telegram] named agent: image attachment had no usable source — skipping");
        }
      } catch (imgErr) {
        console.warn("[Telegram] named agent: image send failed (non-blocking):", imgErr);
      }
    } else if (att.kind === "file") {
      try {
        const buf = await attachmentToBuffer(att);
        if (buf) {
          const ok = await sendTelegramDocument(chatId, att.filename, buf, att.caption, att.mimeType);
          console.log(`[Telegram] named agent: delivered file ${att.filename} ok=${ok}`);
        } else {
          console.warn(`[Telegram] named agent: file ${att.filename} had no usable source — skipping`);
        }
      } catch (fileErr) {
        console.warn(`[Telegram] named agent: file ${att.filename} send failed (non-blocking):`, fileErr);
      }
    }
  }

  // Send text that hasn't been sent yet — either because there were no media
  // attachments, or because the pre-media send failed.
  if (!textSent && textReply.trim()) {
    await deliverCoachText(chatId, textReply, placeholderMsgId ?? null);
    logInteraction(userId, "telegram", "outbound", textReply).catch(() => {});
  }
}

/**
 * Deliver the final text reply to Telegram, reusing a placeholder message when
 * one was sent at the start of the turn (streaming mode). If the text fits in a
 * single message the placeholder is edited in-place; overflow chunks are sent as
 * additional messages so long replies still reach the user in full.
 */
async function deliverCoachText(
  chatId: string,
  text: string,
  placeholderMsgId: number | null,
): Promise<void> {
  if (!text.trim()) return;
  if (placeholderMsgId) {
    // Edit the placeholder with the first 4096 chars, send overflow chunks separately.
    const first = text.slice(0, 4096);
    await editMessage(chatId, placeholderMsgId, first);
    if (text.length > 4096) {
      // sendLongMessage handles chunking for the overflow portion.
      await sendLongMessage(chatId, text.slice(4096));
    }
  } else {
    await sendLongMessage(chatId, text);
  }
}

async function handleCoachReply(userId: string, chatId: string, userText: string, imageUrl?: string): Promise<void> {
  // Pre-fetch TTS prefs — used to decide between streaming (text) and voice paths.
  const ttsPrefs = await getUserTtsPrefs(userId).catch(() => ({ enabled: false, voice: "" as string }));

  // Send an immediate typing indicator so the user knows the message was received.
  sendChatAction(chatId, "typing").catch(() => {});

  // Refresh the typing indicator every 4 seconds while the LLM is working
  // (Telegram clears it automatically after ~5 s).
  const typingInterval = setInterval(() => {
    sendChatAction(chatId, "typing").catch(() => {});
  }, 4000);

  // ── Streaming strategy (non-TTS only) ────────────────────────────────────────
  // Send a "Working on it…" placeholder immediately so the user sees something
  // within <1 second. As the LLM produces tokens we edit that message in-place
  // at a self-adjusting interval that starts at 3 s (≤20 edits/min, safely within
  // Telegram's undocumented rate limit). If Telegram returns a 429 flood-wait the
  // interval backs off to at least the requested retry_after; on sustained success
  // it gradually recovers toward the 3 s baseline so users get responsive updates.
  //
  // TTS users are excluded — their reply will be sent as a voice bubble, so
  // we keep the typing indicator alone and skip the placeholder flow.
  let placeholderMsgId: number | null = null;
  let streamBuf = "";
  let lastEditAt = 0;
  // Self-adjusting interval: starts at a safe 3 s, backs off on 429, recovers on success.
  // The max is 60 s so we always fully honour Telegram's retry_after instruction even
  // on long flood-wait windows (Telegram can legitimately request up to 60 s or more).
  const STREAM_INTERVAL_BASE_MS = 3000;
  const STREAM_INTERVAL_MAX_MS = 60000;
  let streamIntervalMs = STREAM_INTERVAL_BASE_MS;
  let ttsStillThinkingTimer: ReturnType<typeof setTimeout> | null = null;
  // Guard: once the final reply delivery begins we must stop any in-flight
  // token edits from overwriting the completed message (e.g. leaving " ▌").
  let streamClosed = false;

  let onToken: ((chunk: string) => void) | undefined;

  if (!ttsPrefs.enabled) {
    placeholderMsgId = await sendMessageGetId(chatId, "Working on it…").catch(() => null);
    onToken = (chunk: string) => {
      if (streamClosed) return;
      streamBuf += chunk;
      const now = Date.now();
      // Only edit once we have a meaningful snippet (≥10 chars) and the interval has elapsed.
      if (placeholderMsgId && now - lastEditAt >= streamIntervalMs && streamBuf.trim().length >= 10) {
        const msgId = placeholderMsgId;
        editMessage(chatId, msgId, streamBuf + " ▌").then((result) => {
          if (!result.ok && result.retryAfter !== undefined) {
            // 429 flood-wait: honour Telegram's requested delay plus a small buffer.
            const backoffMs = result.retryAfter * 1000 + 500;
            const prev = streamIntervalMs;
            streamIntervalMs = Math.min(Math.max(streamIntervalMs, backoffMs), STREAM_INTERVAL_MAX_MS);
            if (streamIntervalMs !== prev) {
              console.warn(
                `[Telegram] stream interval backed off: ${prev}ms → ${streamIntervalMs}ms (retryAfter=${result.retryAfter}s, chatId=${chatId})`,
              );
            }
          } else if (result.ok && streamIntervalMs > STREAM_INTERVAL_BASE_MS) {
            // Sustained success: nudge interval 10% back toward the baseline.
            const prev = streamIntervalMs;
            streamIntervalMs = Math.max(STREAM_INTERVAL_BASE_MS, Math.round(streamIntervalMs * 0.9));
            if (streamIntervalMs !== prev) {
              console.log(
                `[Telegram] stream interval recovering: ${prev}ms → ${streamIntervalMs}ms (chatId=${chatId})`,
              );
            }
          }
        }).catch(() => {});
        lastEditAt = now;
      }
    };
  } else {
    // TTS fallback: keep the "still working" timer so voice users aren't left in silence.
    ttsStillThinkingTimer = setTimeout(async () => {
      try { await sendMessage(chatId, "Still working on it…"); } catch { /* non-blocking */ }
    }, 15000);
  }

  const clearTimers = () => {
    clearInterval(typingInterval);
    if (ttsStillThinkingTimer !== null) clearTimeout(ttsStillThinkingTimer);
  };

  try {
    // Check if this Telegram chatId is assigned to a named agent first.
    // Pass onToken so named-agent replies also stream into the placeholder.
    const namedResult = await routeToNamedAgent(userId, "telegram", chatId, userText, undefined, onToken).catch(() => null);
    if (namedResult !== null) {
      streamClosed = true;
      clearTimers();
      await deliverNamedAgentResult(chatId, userId, null, namedResult, placeholderMsgId);
      return;
    }

    // Edit the placeholder with a heartbeat status during long Android runs.
    // Only fires when the placeholder has not yet received any streamed tokens
    // (mirrors the Discord pattern: if streaming content is already visible,
    // the user can see progress without an additional status edit).
    const onProgressMessage = (msg: string) => {
      if (placeholderMsgId && !streamBuf) {
        editMessage(chatId, placeholderMsgId, `⏳ ${msg}`).catch(() => {});
      }
    };

    const storedSessionId = await getCoachSession(userId, "Telegram");
    const { reply, attachments, sdkSessionId } = await runCoachAgent({
      userId,
      userText,
      channelName: "Telegram",
      imageUrl,
      sdkSessionId: storedSessionId,
      onToken,
      onProgressMessage,
    });

    if (sdkSessionId) {
      setCoachSession(userId, "Telegram", sdkSessionId);
    }

    // Collect markdown attachments and append to the text reply so they are
    // delivered inline (markdown attachments have no binary payload to send separately).
    const markdownExtra = collectMarkdownExtras(attachments);
    const rawTextReply = markdownExtra ? (reply ? `${reply}\n\n${markdownExtra}` : markdownExtra) : reply;

    // Apply outbound middleware (whitespace cleaner, length limiter, empty-reply guard).
    const coachProcessed = await outboundMiddleware.run({
      text: rawTextReply,
      platform: "telegram",
      userId,
    });
    // Fall back to the streamed buffer if rawReply was empty but tokens arrived.
    let textReply = coachProcessed ?? (streamBuf.trim().length > 0 ? streamBuf : "");

    // Close the stream before delivery — prevents any late fire-and-forget
    // token edits from overwriting the final formatted message.
    streamClosed = true;

    // Stop typing indicator — the reply is ready.
    clearTimers();

    // Non-markdown attachments (images, documents, files) require text to be
    // sent first so message ordering is natural (text → media).
    const mediaAtts = attachments.filter((a) => a.kind !== "markdown");

    if (mediaAtts.length > 0 && textReply && textReply.trim()) {
      if (!ttsPrefs.enabled) {
        try {
          await deliverCoachText(chatId, textReply, placeholderMsgId);
          // Placeholder consumed — don't reuse for anything else.
          placeholderMsgId = null;
        } catch (sendErr) {
          console.error("[Telegram] failed to send text before attachment:", sendErr);
        }
        logInteraction(userId, "telegram", "outbound", textReply).catch(() => {});
      }
      textReply = "";
    }

    for (const att of mediaAtts) {
      if (att.kind === "document") {
        const ok = await sendTelegramDocument(chatId, att.filename, att.content, att.caption, att.mimeType);
        console.log(`[Telegram] Delivered document attachment ${att.filename} ok=${ok}`);
      } else if (att.kind === "image") {
        try {
          const buf = await attachmentToBuffer(att);
          if (buf) {
            const ok = await sendPhoto(chatId, buf, att.caption);
            console.log(`[Telegram] Delivered image attachment ok=${ok}`);
          } else {
            console.warn("[Telegram] image attachment had no usable source — skipping");
          }
        } catch (imgErr) {
          console.warn("[Telegram] image attachment send failed (non-blocking):", imgErr);
        }
      } else if (att.kind === "file") {
        try {
          const buf = await attachmentToBuffer(att);
          if (buf) {
            const ok = await sendTelegramDocument(chatId, att.filename, buf, att.caption, att.mimeType);
            console.log(`[Telegram] Delivered file attachment ${att.filename} ok=${ok}`);
          } else {
            console.warn(`[Telegram] file attachment ${att.filename} had no usable source — skipping`);
          }
        } catch (fileErr) {
          console.warn(`[Telegram] file attachment ${att.filename} send failed (non-blocking):`, fileErr);
        }
      }
    }

    if (textReply && textReply.trim()) {
      if (ttsPrefs.enabled) {
        // Auto-voice mode: send as round audio bubble, fall back to text if TTS fails.
        console.log(`[Telegram] TTS mode active — converting reply to voice for user=${userId}`);
        const voiceResult = await speakToUser(userId, textReply, ttsPrefs.voice).catch((e) => ({
          ok: false,
          error: String(e),
        }));
        if (!voiceResult.ok) {
          console.warn(`[Telegram] TTS failed (${voiceResult.error}), falling back to text`);
          await sendMessage(chatId, textReply);
        }
        logInteraction(userId, "telegram", "outbound", textReply).catch(() => {});
      } else {
        await deliverCoachText(chatId, textReply, placeholderMsgId);
        logInteraction(userId, "telegram", "outbound", textReply).catch(() => {});
      }
    }

    extractProfileFromTelegram(userId, userText).catch(err => {
      console.error("[Profile] Telegram extraction error:", err);
    });
    return;
  } catch (error) {
    streamClosed = true;
    clearTimers();
    console.error("Error handling Telegram coach reply:", error);
    // If we have a placeholder, update it with the error message instead of sending
    // a separate message (avoids leaving an orphaned "Working on it…" bubble).
    if (placeholderMsgId) {
      await editMessage(chatId, placeholderMsgId, "Sorry, I encountered an error. Please try again.").catch(() => {
        sendMessage(chatId, "Sorry, I encountered an error. Please try again.").catch(() => {});
      });
    } else {
      await sendMessage(chatId, "Sorry, I encountered an error. Please try again.");
    }
    return;
  }
}

async function isReplyToProactiveQuestion(userText: string, question: string): Promise<boolean> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{
        role: "user",
        content: `Is the following user message a reply to (or related to) this question? Only answer "yes" or "no".

Question that was asked: "${question}"
User's message: "${userText}"

Answer (yes/no):`,
      }],
      max_completion_tokens: 10,
    });
    const answer = (response.choices[0]?.message?.content || '').trim().toLowerCase();
    return answer.startsWith('yes');
  } catch {
    return false;
  }
}

async function extractProfileFromTelegram(userId: string, userText: string): Promise<void> {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const unanswered = await db.select()
      .from(schema.proactiveQuestionsSent)
      .where(
        and(
          eq(schema.proactiveQuestionsSent.userId, userId),
          sql`${schema.proactiveQuestionsSent.answeredAt} IS NULL`,
          sql`${schema.proactiveQuestionsSent.sentAt} > ${twentyFourHoursAgo}`
        )
      )
      .orderBy(desc(schema.proactiveQuestionsSent.sentAt))
      .limit(1);

    let contextHint: string | undefined;
    if (unanswered.length > 0) {
      const mostRecent = unanswered[0];
      const isReply = await isReplyToProactiveQuestion(userText, mostRecent.question);
      if (isReply) {
        await db.update(schema.proactiveQuestionsSent)
          .set({ answeredAt: new Date() })
          .where(eq(schema.proactiveQuestionsSent.id, mostRecent.id));
        contextHint = `User is answering proactive question: "${mostRecent.question}"`;
        console.log(`[Profile] Marked proactive question as answered: ${mostRecent.id}`);
      }
    }

    await extractAndStore({
      userId,
      source: userText,
      sourceType: "telegram",
      contextHint,
    });
  } catch (err) {
    console.error("[Profile/Telegram] Extraction error:", err);
  }
}

async function handleCallbackQuery(callbackQuery: any): Promise<void> {
  const queryId: string = callbackQuery.id;
  const data: string = callbackQuery.data || "";
  const chatId: string | undefined = callbackQuery.message?.chat?.id?.toString();
  if (!chatId) {
    await answerCallbackQuery(queryId);
    return;
  }

  if (data.startsWith("momentum_done:")) {
    const parts = data.split(":");
    const claimedUserId: string = parts[1] ?? "";
    const stepIndex = parseInt(parts[2] ?? "0", 10);

    const links = await db
      .select({ userId: schema.telegramLinks.userId })
      .from(schema.telegramLinks)
      .where(eq(schema.telegramLinks.chatId, chatId))
      .limit(1);

    if (links.length === 0 || links[0].userId !== claimedUserId) {
      await answerCallbackQuery(queryId, "Session not found — please re-link your account.");
      console.warn(`[Momentum] Ownership mismatch: claimed=${claimedUserId}, actual=${links[0]?.userId ?? "none"}, chatId=${chatId}`);
      return;
    }

    await answerCallbackQuery(queryId, "Got it! +XP incoming...");
    await handleMomentumDone(claimedUserId, chatId, stepIndex);
    return;
  }

  if (data === 'voice_dismiss') {
    await answerCallbackQuery(queryId, "Got it — reply any time to keep the conversation going.");
    return;
  }

  if (data.startsWith("merge_pr:")) {
    const rest = data.slice("merge_pr:".length);
    const lastColon = rest.lastIndexOf(":");
    const fullRepo = lastColon >= 0 ? rest.slice(0, lastColon) : rest;
    const prNumber = lastColon >= 0 ? parseInt(rest.slice(lastColon + 1), 10) : 0;

    const links = await db
      .select({ userId: schema.telegramLinks.userId })
      .from(schema.telegramLinks)
      .where(eq(schema.telegramLinks.chatId, chatId))
      .limit(1);
    if (links.length === 0) {
      await answerCallbackQuery(queryId, "Session not found.");
      return;
    }
    const mergeUserId = links[0].userId;
    await answerCallbackQuery(queryId, "⏳ Merging...");
    try {
      const { getGitHubSettings, getPR, mergePR } = await import("./integrations/github");
      const settings = await getGitHubSettings(mergeUserId);
      if (!settings.pat) {
        await sendMessage(chatId, "❌ GitHub not connected — add a token in Settings → GitHub.");
        return;
      }
      const [repoOwner, repoName] = fullRepo.split("/") as [string, string];
      const pr = await getPR(settings.pat, repoOwner ?? "", repoName ?? "", prNumber);
      if (!pr) {
        await sendMessage(chatId, `❌ PR #${prNumber} not found in ${fullRepo}.`);
        return;
      }
      if (pr.ciStatus === "fail") {
        await sendMessage(chatId, `❌ Cannot merge PR #${prNumber} — CI is failing.`);
        return;
      }
      if (pr.ciStatus === "pending") {
        await sendMessage(chatId, `⏳ Cannot merge PR #${prNumber} — CI checks still running.`);
        return;
      }
      const result = await mergePR(settings.pat, repoOwner, repoName, prNumber);
      await sendMessage(
        chatId,
        result.ok
          ? `✅ PR #${prNumber} merged in ${fullRepo}. ${result.message}`
          : `❌ Failed to merge PR #${prNumber}: ${result.message}`,
      );
    } catch (err) {
      await sendMessage(chatId, "❌ Merge failed — please check your GitHub settings.");
      console.error("[Telegram merge_pr callback]", err);
    }
    return;
  }

  await answerCallbackQuery(queryId);
}

async function processUpdate(update: any): Promise<void> {
  try {
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query).catch(err =>
        console.error("[Telegram] callback_query error:", err)
      );
      return;
    }

    if (update.my_chat_member) {
      const chatMember = update.my_chat_member;
      const chat = chatMember.chat;
      const status = chatMember.new_chat_member?.status;
      if ((chat.type === 'group' || chat.type === 'supergroup') && (status === 'member' || status === 'administrator')) {
        const fromUserId = chatMember.from?.id?.toString();
        if (fromUserId) {
          try {
            const link = await db.select().from(schema.telegramLinks).where(
              sql`${schema.telegramLinks.chatId} = ${fromUserId}`
            ).limit(1);
            if (link[0]) {
              const currentGroups = (link[0].groupChatIds as string[]) || [];
              const chatIdStr = chat.id.toString();
              if (!currentGroups.includes(chatIdStr)) {
                currentGroups.push(chatIdStr);
                await db.update(schema.telegramLinks)
                  .set({ groupChatIds: currentGroups })
                  .where(eq(schema.telegramLinks.userId, link[0].userId));
              }
            }
          } catch (err) {
            console.error("Error handling group join:", err);
          }
        }
      }
      return;
    }

    const message = update.message;
    if (!message) return;
    if (!message.text && !message.photo && !message.document && !message.voice && !message.audio && !message.video_note && !message.video) return;

    const chatId = message.chat.id.toString();
    const chatType = message.chat.type;

    let imageUrl: string | undefined;
    let text = message.text?.trim() || message.caption?.trim() || '';

    // Inject context when the user replies to a specific Jarvis message, so the
    // agent knows what the reply is referring to without needing conversation history.
    const repliedToText = (message.reply_to_message as { text?: string } | undefined)?.text?.trim();
    if (repliedToText && text) {
      const preview = repliedToText.length > 600 ? repliedToText.slice(0, 600) + '…' : repliedToText;
      text = `[Replying to Jarvis's message: "${preview}"]\n\n${text}`;
    }

    if (message.photo) {
      const largest = message.photo[message.photo.length - 1];
      const downloaded = await downloadTelegramFile(largest.file_id).catch(() => null);
      if (downloaded) imageUrl = downloaded;
    } else if (message.document && message.document.mime_type?.startsWith('image/')) {
      const downloaded = await downloadTelegramFile(message.document.file_id).catch(() => null);
      if (downloaded) imageUrl = downloaded;
    }

    let audioFileId = message.voice?.file_id || message.audio?.file_id || message.video_note?.file_id;
    if (!audioFileId && message.document && message.document.mime_type?.startsWith('audio/')) {
      audioFileId = message.document.file_id;
    }
    if (audioFileId && !text) {
      try {
        const file = await downloadTelegramFileBuffer(audioFileId);
        if (!file) {
          await sendMessage(chatId, "Sorry, I couldn't download that voice message. Could you try again or type it out?");
          return;
        }
        const { speechToText, detectAudioFormat } = await import('./replit_integrations/audio/client');
        const format = detectAudioFormat(file.buffer);
        const transcript = await speechToText(file.buffer, format);
        if (!transcript || !transcript.trim()) {
          await sendMessage(chatId, "Sorry, I couldn't make out what you said. Could you try again or type it out?");
          return;
        }
        text = transcript.trim();
        const preview = text.length > 100 ? text.slice(0, 100) + '...' : text;
        await sendMessage(chatId, `(🎤 Voice: "${preview}")`);
      } catch (err) {
        console.error('[Telegram] Voice transcription failed:', err);
        await sendMessage(chatId, "Sorry, I couldn't understand that voice message. Could you try again or type it out?");
        return;
      }
    }

    const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
    let videoFileId: string | undefined;
    let videoFileSize: number | undefined;
    if (message.video) {
      videoFileId = message.video.file_id;
      videoFileSize = message.video.file_size;
    } else if (message.document && message.document.mime_type?.startsWith('video/')) {
      videoFileId = message.document.file_id;
      videoFileSize = message.document.file_size;
    }
    if (videoFileId && !text) {
      if (videoFileSize && videoFileSize > MAX_VIDEO_BYTES) {
        await sendMessage(
          chatId,
          "This video is too large for me to download via Telegram (max 20 MB). " +
          "Here are two ways I can still transcribe it:\n\n" +
          "1. **YouTube link** — if it's on YouTube, share the URL and I'll handle it natively.\n" +
          "2. **Direct download link** — upload the file to Google Drive (or Dropbox) and share the link with me. " +
          "I'll download and transcribe it using Google's File API (up to 500 MB)."
        );
        return;
      }
      try {
        const file = await downloadTelegramFileBuffer(videoFileId);
        if (!file) {
          await sendMessage(chatId, "Sorry, I couldn't download that video. Could you try again or share the YouTube URL instead?");
          return;
        }
        const { speechToText, detectAudioFormat } = await import('./replit_integrations/audio/client');
        const format = detectAudioFormat(file.buffer);
        const transcript = await speechToText(file.buffer, format === 'unknown' ? 'mp4' : format);
        if (!transcript || !transcript.trim()) {
          await sendMessage(chatId, "Sorry, I couldn't transcribe that video. Could you try again or type it out?");
          return;
        }
        text = transcript.trim();
        const preview = text.length > 100 ? text.slice(0, 100) + '...' : text;
        await sendMessage(chatId, `(📹 Video transcript: "${preview}")`);
      } catch (err) {
        console.error('[Telegram] Video transcription failed:', err);
        await sendMessage(chatId, "Sorry, I couldn't transcribe that video. Could you try again or share the YouTube URL instead?");
        return;
      }
    }

    if (message.document && isIngestableDocument(message.document.mime_type, message.document.file_name)) {
      const doc = message.document;
      const filename = doc.file_name || 'document';
      await sendMessage(chatId, `Got it — reading "${filename}" now...`);
      const result = await extractTelegramDocument(
        doc.file_id,
        doc.mime_type || 'text/plain',
        filename,
        doc.file_size,
      );
      if ('error' in result) {
        await sendMessage(chatId, result.error);
        return;
      }
      const contextBlock = buildDocumentContextBlock(result);
      text = text
        ? `${contextBlock}\n\n${text}`
        : contextBlock;
    }

    if (!text && !imageUrl) return;

    if (chatType === 'group' || chatType === 'supergroup') {
      if (!text) return;
      try {
        const links = await db.select().from(schema.telegramLinks).where(
          sql`${schema.telegramLinks.groupChatIds}::jsonb @> ${JSON.stringify([chatId])}::jsonb`
        );
        for (const link of links) {
          await db.insert(schema.telegramGroupMessages).values({
            userId: link.userId,
            chatId,
            chatTitle: message.chat.title || '',
            fromUser: message.from?.first_name || message.from?.username || 'Unknown',
            text: text.slice(0, 500),
            messageDate: new Date(message.date * 1000),
          });
        }
      } catch (err) {
        console.error("Error storing group message:", err);
      }
      return;
    }

    if (text.startsWith('/start ') || (text.length === 6 && /^[A-Z0-9]+$/.test(text))) {
      const code = text.startsWith('/start ') ? text.slice(7).trim() : text;
      try {
        const codeRows = await db.select().from(schema.telegramLinkCodes).where(eq(schema.telegramLinkCodes.code, code));
        if (codeRows.length === 0) {
          await sendMessage(chatId, "Invalid or expired link code. Please generate a new one from the app.");
          return;
        }
        const { userId } = codeRows[0];
        const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
        if (codeRows[0].createdAt < thirtyMinAgo) {
          await db.delete(schema.telegramLinkCodes).where(eq(schema.telegramLinkCodes.code, code));
          await sendMessage(chatId, "This link code has expired. Please ask Jarvis to connect Telegram again or use Profile → Connections to get a new one.");
          return;
        }
        // Remove any stale links from other accounts that claimed this chatId
        await db.delete(schema.telegramLinks).where(
          and(eq(schema.telegramLinks.chatId, chatId), sql`${schema.telegramLinks.userId} != ${userId}`)
        );
        await db.insert(schema.telegramLinks)
          .values({ userId, chatId, username: message.from?.username || message.from?.first_name || null })
          .onConflictDoUpdate({
            target: schema.telegramLinks.userId,
            set: { chatId, username: message.from?.username || message.from?.first_name || null, linkedAt: new Date() },
          });
        await db.delete(schema.telegramLinkCodes).where(eq(schema.telegramLinkCodes.code, code));
        await sendMessage(chatId, "✅ You're connected to GamePlan! Jarvis will send you morning check-ins and you can chat anytime right here.");
        console.log(`[Telegram] Linked user ${userId} to chat ${chatId}`);
      } catch (err) {
        console.error("Error linking Telegram:", err);
        await sendMessage(chatId, "Something went wrong linking your account. Please try again.");
      }
      return;
    }

    if (text === '/start') {
      await sendMessage(chatId, "Welcome to GamePlan Coach! To connect your account, generate a link code from the GamePlan app (Profile → Connected Apps → Telegram), then send it here.");
      return;
    }

    try {
      const link = await db.select().from(schema.telegramLinks).where(eq(schema.telegramLinks.chatId, chatId)).limit(1);
      if (link.length === 0) {
        await sendMessage(chatId, "Your Telegram isn't linked to a GamePlan account yet. Open the app, go to Profile > Connected Apps > Telegram, and send the link code here.");
        return;
      }

      // ── Stop-intent detection ──────────────────────────────────────────
      // If the user sends a stop/cancel intent while a task is running, abort it
      // immediately instead of queuing the message as a normal chat turn.
      if (text && /^(stop|cancel|abort|enough|quit|nevermind|stop it|please stop)\.?$/i.test(text.trim())) {
        const linkedUserId = link[0].userId;
        const activeRun = getActiveRunForUser(linkedUserId);
        if (activeRun) {
          activeRun.controller.abort();
          activeCoachRuns.delete(activeRun.runId);
          await sendMessage(chatId, "Stopping — cancelled the current task.");
        } else {
          await sendMessage(chatId, "Nothing is currently running.");
        }
        return;
      }

      // ── Project question reply-thread routing ─────────────────────────
      // If this message is a Telegram reply and the replied-to message_id
      // matches a pending question stored in questionMeta, auto-answer it.
      const replyToMsgId = (message.reply_to_message as { message_id?: number } | undefined)?.message_id;
      if (replyToMsgId && text && link.length > 0) {
        try {
          const { answerProjectQuestion } = await import("./agent/projectRunner");
          const pendingProjects = await db
            .select()
            .from(schema.jarvisProjects)
            .where(
              and(
                eq(schema.jarvisProjects.userId, link[0].userId),
                eq(schema.jarvisProjects.status, "waiting_for_input"),
              ),
            );
          const matched = pendingProjects.find((p) => {
            const meta = p.questionMeta as Record<string, unknown> | null | undefined;
            return meta?.telegramMessageId === replyToMsgId && meta?.telegramChatId === chatId;
          });
          if (matched) {
            await answerProjectQuestion(matched.id, text);
            await sendMessage(chatId, `✅ Got it! Resuming project *${matched.title ?? matched.id.slice(0, 8)}*...`, { parse_mode: "Markdown" });
            return;
          }
        } catch (replyErr) {
          console.error("[Telegram] project reply routing error:", replyErr);
        }
      }

      // ── Discord pairing via Telegram ──────────────────────────────────
      // Reuses the same approval UX: user DMs Discord bot → gets 6-char code →
      // sends "approve XXXXXX" (or "pair discord XXXXXX") here to confirm.
      const approveMatch = text?.match(/^(?:approve|pair\s+discord)\s+([A-Z0-9]{6})$/i);
      if (approveMatch) {
        const pairCode = approveMatch[1].toUpperCase();
        const pairResult = await completeDiscordPairing(link[0].userId, pairCode).catch((e) => ({ ok: false as const, error: String(e) }));
        if (pairResult.ok) {
          await sendMessage(chatId, `✅ Discord account linked${pairResult.discordUsername ? ` as ${pairResult.discordUsername}` : ""}! You can now chat with Jarvis directly from Discord.`);
        } else {
          await sendMessage(chatId, `❌ Discord pairing failed: ${pairResult.error || "Invalid or expired code — please DM your Discord bot to get a fresh code."}`);
        }
        return;
      }

      // ── /tts commands ─────────────────────────────────────────────────
      // /tts on|off|status|voice <name>  — per-user TTS toggle
      if (text.startsWith("/tts")) {
        const userId = link[0].userId;
        const parts = text.trim().split(/\s+/);
        const sub = (parts[1] || "").toLowerCase();

        if (sub === "on") {
          await setUserTtsPref(userId, { enabled: true });
          const current = await getUserTtsChannels(userId);
          if (!current.includes("telegram")) await setTtsChannels(userId, [...current, "telegram"]);
          await sendMessage(chatId, "Voice mode is now ON — Jarvis will send voice notes instead of text. Send /tts off to switch back.");
        } else if (sub === "off") {
          await setUserTtsPref(userId, { enabled: false });
          const current = await getUserTtsChannels(userId);
          await setTtsChannels(userId, current.filter(c => c !== "telegram"));
          await sendMessage(chatId, "Voice mode is now OFF — back to text replies.");
        } else if (sub === "voice" && parts[2]) {
          const openaiVoices = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];
          const v = parts[2].toLowerCase();
          const elevenKey = Object.keys(ELEVENLABS_VOICES).find(k => k.toLowerCase() === v);
          if (openaiVoices.includes(v)) {
            await setUserTtsPref(userId, { voice: v });
            await sendMessage(chatId, `Voice set to "${v}". Send /tts on to enable voice mode.`);
          } else if (elevenKey) {
            const voiceId = ELEVENLABS_VOICES[elevenKey];
            await setUserTtsPref(userId, { voice: voiceId });
            await sendMessage(chatId, `Voice set to "${elevenKey}" (ElevenLabs). Send /tts on to enable voice mode.`);
          } else {
            const allVoices = [...openaiVoices, ...Object.keys(ELEVENLABS_VOICES)].join(", ");
            await sendMessage(chatId, `Unknown voice "${v}". Available voices: ${allVoices}`);
          }
        } else {
          const prefs = await getUserTtsPrefs(userId);
          const elevenName = Object.entries(ELEVENLABS_VOICES).find(([, id]) => id === prefs.voice)?.[0];
          const voiceLabel = elevenName ? `${elevenName} (ElevenLabs)` : prefs.voice;
          const openaiList = "alloy, echo, fable, onyx, nova, shimmer";
          const elevenList = Object.keys(ELEVENLABS_VOICES).join(", ");
          await sendMessage(
            chatId,
            `Voice mode: ${prefs.enabled ? "ON" : "OFF"} | Voice: ${voiceLabel}\n\nCommands:\n/tts on — enable voice replies\n/tts off — disable voice replies\n/tts voice <name> — change voice\n\nOpenAI voices: ${openaiList}\nElevenLabs voices: ${elevenList}`,
          );
        }
        return;
      }

      // ── /reset_budget command (owner-only) ────────────────────────────────
      if (text.startsWith("/reset_budget") || text.startsWith("/reset_circuit_breaker")) {
        const userId = link[0].userId;
        const { isIntegrationOwner } = await import("./integrationOwner");
        if (!(await isIntegrationOwner(userId))) {
          await sendMessage(chatId, "⛔ This command is only available to the Jarvis owner.");
          return;
        }
        const { resetCircuitBreaker, writeBudgetSummary } = await import("./agent/safeWritePolicy");
        await resetCircuitBreaker();
        const summary = await writeBudgetSummary();
        await sendMessage(chatId, `✅ Write counter reset. Current status: ${summary}`);
        return;
      }

      // ── /agent and /ask commands (Telegram parity with Discord) ───────────
      if (text.startsWith("/agent") || text.startsWith("/ask")) {
        const userId = link[0].userId;
        const parts = text.trim().split(/\s+/);
        const cmd = parts[0]; // "/agent" or "/ask"

        try {
          const {
            listAgents, createAgent, assignChannel, removeChannel,
            enableAgent, disableAgent, deleteAgent, updateAgent,
          } = await import("./agent/agentManager");
          const { runNamedAgent } = await import("./agent/runNamedAgent");
          const { runCouncil } = await import("./agent/council");
          const { readAgentMemories, clearAgentMemory } = await import("./agent/agentMemory");
          const { listPendingGates } = await import("./agent/agentApproval");

          // /ask <agentName> <question...>
          if (cmd === "/ask") {
            const agentName = parts[1] ?? "";
            const question = parts.slice(2).join(" ");
            if (!agentName || !question) {
              await sendMessage(chatId, "Usage: /ask <agent-name> <your question>");
              return;
            }
            const agents = await listAgents(userId);
            const agent = agents.find((a) => a.name.toLowerCase() === agentName.toLowerCase());
            if (!agent) {
              await sendMessage(chatId, `Agent "${agentName}" not found. Use /agent list to see your agents.`);
              return;
            }
            const result = await runNamedAgent({ agentId: agent.id, userId, userMessage: question, platform: "telegram" });
            await deliverNamedAgentResult(chatId, userId, agent.name, result);
            return;
          }

          const sub = (parts[1] ?? "").toLowerCase();

          if (!sub || sub === "help") {
            await sendMessage(chatId,
              `*Agent commands* (also: /agents)\n\n` +
              `/agents list — your named agents\n` +
              `/agents run <name> <message> — run a named agent\n` +
              `/agents council <question> — ask all agents\n` +
              `/agents create <name> <role> — create named agent\n` +
              `/agents assign <name> — assign this chat\n` +
              `/agents unassign <name> — remove this chat from agent\n` +
              `/agents disable <name> — disable agent\n` +
              `/agents enable <name> — enable agent\n` +
              `/agents delete <name> — delete agent\n` +
              `/agents memory <name> — show memories\n` +
              `/agents clear-memory <name> — wipe memories\n` +
              `/agents approvals — pending approvals\n` +
              `/ask <name> <question> — quick query\n\n` +
              `*Custom sub-agents:*\n` +
              `/agent <slug> <prompt> — run a custom agent (manage in Profile → Custom Agents)`,
              { parse_mode: "Markdown" },
            );
            return;
          }

          if (sub === "list") {
            const agents = await listAgents(userId, true);
            if (agents.length === 0) {
              await sendMessage(chatId, "You have no agents. Create one with /agent create <name> <role>");
              return;
            }
            const lines = agents.map((a) => {
              const icon = a.isActive ? "🟢" : "🔴";
              return `${icon} *${a.name}* (${a.role})`;
            });
            await sendMessage(chatId, `*Your Agents (${agents.length})*\n${lines.join("\n")}`, { parse_mode: "Markdown" });
            return;
          }

          if (sub === "run" || sub === "ask") {
            const agentName = parts[2] ?? "";
            const message = parts.slice(3).join(" ");
            if (!agentName || !message) {
              await sendMessage(chatId, `Usage: /agent ${sub} <name> <message>`);
              return;
            }
            const agents = await listAgents(userId);
            const agent = agents.find((a) => a.name.toLowerCase() === agentName.toLowerCase());
            if (!agent) { await sendMessage(chatId, `Agent "${agentName}" not found.`); return; }
            const result = await runNamedAgent({ agentId: agent.id, userId, userMessage: message, platform: "telegram" });
            await deliverNamedAgentResult(chatId, userId, agent.name, result);
            return;
          }

          if (sub === "council") {
            const question = parts.slice(2).join(" ");
            if (!question) { await sendMessage(chatId, "Usage: /agent council <question>"); return; }
            const result = await runCouncil(userId, question);
            if (result.agentCount === 0) { await sendMessage(chatId, "No active agents found. Create one first."); return; }
            await sendMessage(chatId, `*Council (${result.succeededCount}/${result.agentCount}):*\n${result.synthesis.slice(0, 4000)}`, { parse_mode: "Markdown" });
            return;
          }

          if (sub === "create") {
            const name = parts[2] ?? "";
            const role = parts[3] ?? "custom";
            if (!name) { await sendMessage(chatId, "Usage: /agent create <name> <role>"); return; }
            const agentId = await createAgent(userId, { name, role, platforms: ["telegram"] });
            await sendMessage(chatId, `✅ Created *${name}* (${role}) — ID: \`${agentId}\``, { parse_mode: "Markdown" });
            return;
          }

          if (sub === "assign") {
            const name = parts[2] ?? "";
            if (!name) { await sendMessage(chatId, "Usage: /agents assign <name>"); return; }
            const agents = await listAgents(userId, true);
            const agent = agents.find((a) => a.name.toLowerCase() === name.toLowerCase());
            if (!agent) { await sendMessage(chatId, `Agent "${name}" not found.`); return; }
            await assignChannel(agent.id, "telegram", String(chatId));
            await sendMessage(chatId, `✅ This chat is now assigned to *${name}*.`, { parse_mode: "Markdown" });
            return;
          }

          if (sub === "unassign") {
            const name = parts[2] ?? "";
            if (!name) { await sendMessage(chatId, "Usage: /agents unassign <name>"); return; }
            const agents = await listAgents(userId, true);
            const agent = agents.find((a) => a.name.toLowerCase() === name.toLowerCase());
            if (!agent) { await sendMessage(chatId, `Agent "${name}" not found.`); return; }
            await removeChannel(agent.id, "telegram", String(chatId));
            await sendMessage(chatId, `✅ This chat has been removed from *${name}*.`, { parse_mode: "Markdown" });
            return;
          }

          if (sub === "disable") {
            const name = parts[2] ?? "";
            const agents = await listAgents(userId, true);
            const agent = agents.find((a) => a.name.toLowerCase() === name.toLowerCase());
            if (!agent) { await sendMessage(chatId, `Agent "${name}" not found.`); return; }
            await disableAgent(agent.id);
            await sendMessage(chatId, `🔴 Agent *${name}* has been disabled.`, { parse_mode: "Markdown" });
            return;
          }

          if (sub === "enable") {
            const name = parts[2] ?? "";
            const agents = await listAgents(userId, true);
            const agent = agents.find((a) => a.name.toLowerCase() === name.toLowerCase());
            if (!agent) { await sendMessage(chatId, `Agent "${name}" not found.`); return; }
            await enableAgent(agent.id);
            await sendMessage(chatId, `🟢 Agent *${name}* has been re-enabled.`, { parse_mode: "Markdown" });
            return;
          }

          if (sub === "delete") {
            const name = parts[2] ?? "";
            const agents = await listAgents(userId, true);
            const agent = agents.find((a) => a.name.toLowerCase() === name.toLowerCase());
            if (!agent) { await sendMessage(chatId, `Agent "${name}" not found.`); return; }
            await deleteAgent(agent.id);
            await sendMessage(chatId, `🗑️ Agent *${name}* has been permanently deleted.`, { parse_mode: "Markdown" });
            return;
          }

          if (sub === "set-permission") {
            const name = parts[2] ?? "";
            const perm = parts[3] ?? "";
            const val = (parts[4] ?? "").toLowerCase();
            const enabled = val === "on" || val === "true" || val === "1";
            const agents = await listAgents(userId, true);
            const agent = agents.find((a) => a.name.toLowerCase() === name.toLowerCase());
            if (!agent || !perm) { await sendMessage(chatId, "Usage: /agent set-permission <name> <perm> on|off"); return; }
            const currentPerms = { ...(agent.permissions ?? schema.DEFAULT_AGENT_PERMISSIONS) };
            await updateAgent(agent.id, { permissions: { ...currentPerms, [perm]: enabled } as schema.AgentPermissions });
            await sendMessage(chatId, `✅ Permission \`${perm}\` for *${name}* set to *${enabled ? "ON" : "OFF"}*`, { parse_mode: "Markdown" });
            return;
          }

          if (sub === "memory") {
            const name = parts[2] ?? "";
            const agents = await listAgents(userId, true);
            const agent = agents.find((a) => a.name.toLowerCase() === name.toLowerCase());
            if (!agent) { await sendMessage(chatId, `Agent "${name}" not found.`); return; }
            const memories = await readAgentMemories(agent.id, userId, "", 10);
            if (memories.length === 0) { await sendMessage(chatId, `Agent *${name}* has no memories yet.`, { parse_mode: "Markdown" }); return; }
            const lines = memories.map((m) => `• [${m.category}] ${m.content.slice(0, 100)}`);
            await sendMessage(chatId, `*${name} Memories:*\n${lines.join("\n")}`, { parse_mode: "Markdown" });
            return;
          }

          if (sub === "clear-memory") {
            const name = parts[2] ?? "";
            const agents = await listAgents(userId, true);
            const agent = agents.find((a) => a.name.toLowerCase() === name.toLowerCase());
            if (!agent) { await sendMessage(chatId, `Agent "${name}" not found.`); return; }
            const deleted = await clearAgentMemory(agent.id, userId);
            await sendMessage(chatId, `🧹 Cleared *${deleted}* memories for *${name}*.`, { parse_mode: "Markdown" });
            return;
          }

          if (sub === "approvals") {
            const gates = await listPendingGates(userId);
            if (gates.length === 0) { await sendMessage(chatId, "✅ No pending approval requests."); return; }
            const lines = gates.map((g) => `• \`${g.id.slice(-8)}\` — *${g.toolName}* (${g.description.slice(0, 80)})`);
            await sendMessage(chatId, `*Pending Approvals (${gates.length})*\n${lines.join("\n")}\n\nApprove/reject in the Agents → Approvals section of the app.`, { parse_mode: "Markdown" });
            return;
          }

          // Unknown sub-command — check if it's a custom agent slug
          // e.g. /agent tech-research [prompt...]
          {
            const { db: _db } = await import("./db");
            const { customAgents: _customAgents } = await import("@shared/schema");
            const { eq: _eq, and: _and } = await import("drizzle-orm");

            const candidateSlug = sub;
            const [customAgent] = await _db
              .select()
              .from(_customAgents)
              .where(_and(_eq(_customAgents.userId, userId), _eq(_customAgents.slug, candidateSlug)))
              .limit(1);

            if (customAgent) {
              const customPrompt = parts.slice(2).join(" ").trim();
              if (!customPrompt) {
                await sendMessage(chatId, `Usage: /agent ${candidateSlug} <prompt>`);
                return;
              }
              const { submitAgentJob } = await import("./agent/jobClient");
              const { id: jobId } = await submitAgentJob({
                userId,
                agentType: "custom_agent",
                title: `${customAgent.name}: ${customPrompt.slice(0, 80)}`,
                prompt: customPrompt,
                input: {
                  customAgentId: customAgent.id,
                  customAgentSlug: customAgent.slug,
                  customAgentName: customAgent.name,
                  originChannel: "telegram",
                },
              });
              await sendMessage(
                chatId,
                `🤖 Queued *${customAgent.name}* — I'll send you the result when it's ready.\n_Job: \`${jobId.slice(0, 8)}\`_`,
                { parse_mode: "Markdown" },
              );
              return;
            }

            await sendMessage(chatId, `Unknown subcommand "${sub}". Send /agent help for usage.\n\nTip: run custom sub-agents with /agent <slug> <prompt>`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await sendMessage(chatId, `❌ Error: ${msg.slice(0, 500)}`);
        }
        return;
      }

      // ── /project commands ──────────────────────────────────────────────────
      if (text.startsWith("/project")) {
        const projectUserId = link[0].userId;
        const parts = text.trim().split(/\s+/);
        const sub = (parts[1] ?? "").toLowerCase();

        try {
          const {
            startProject, pauseProject, resumeProject, answerProjectQuestion,
            getProjectStatus, getUserProjects, setAutonomousMode,
          } = await import("./agent/projectRunner");

          if (!sub || sub === "help") {
            await sendMessage(
              chatId,
              `*Jarvis Projects* — 24/7 autonomous building\n\n` +
              `/project new <title> — <goal> — start a new project\n` +
              `/project list — list your active projects\n` +
              `/project status <id> — full project status\n` +
              `/project pause <id> — pause a project\n` +
              `/project resume <id> — resume a paused project\n` +
              `/project answer <id> <answer> — answer a pending question\n` +
              `/project auto on <id> — enable 24/7 autonomous mode\n` +
              `/project auto off <id> — disable autonomous mode\n` +
              `/project help — show this message`,
              { parse_mode: "Markdown" },
            );
            return;
          }

          if (sub === "new") {
            const rest = parts.slice(2).join(" ");
            const separatorIdx = rest.indexOf(" — ");
            if (separatorIdx === -1) {
              await sendMessage(chatId, "Usage: /project new <title> — <goal>\nExample: /project new Website redesign — Modern, fast site that converts 2x better");
              return;
            }
            const title = rest.slice(0, separatorIdx).trim();
            const goal = rest.slice(separatorIdx + 3).trim();
            if (!title || !goal) {
              await sendMessage(chatId, "Please provide both a title and a goal separated by ' — '");
              return;
            }
            await sendMessage(chatId, `📋 Creating project *${title}*... I'll send you the plan shortly.`, { parse_mode: "Markdown" });
            const projectId = await startProject(projectUserId, title, "", goal, "telegram");
            await sendMessage(chatId, `✅ Project created (id: \`${projectId.slice(0, 8)}\`). I'm generating the plan now — you'll hear back in a moment.`, { parse_mode: "Markdown" });
            return;
          }

          if (sub === "list") {
            const projects = await getUserProjects(projectUserId);
            if (projects.length === 0) {
              await sendMessage(chatId, "You have no projects yet. Start one with /project new <title> — <goal>");
              return;
            }
            const statusEmoji: Record<string, string> = {
              draft: "📝", planning: "🗺", building: "🔨", waiting_for_input: "❓",
              paused: "⏸", complete: "✅", failed: "❌",
            };
            const lines = projects.map((p) => {
              const emoji = statusEmoji[p.status] ?? "•";
              const plan = Array.isArray(p.plan) ? (p.plan as schema.ProjectPlanStep[]) : [];
              const steps = plan.length;
              const done = plan.filter((s) => s.status === "complete").length;
              return `${emoji} *${p.title}* — ${p.status}${steps > 0 ? ` (${done}/${steps} steps)` : ""}\nid: \`${p.id.slice(0, 8)}\``;
            });
            await sendMessage(chatId, `*Your Projects (${projects.length})*\n\n${lines.join("\n\n")}`, { parse_mode: "Markdown" });
            return;
          }

          if (sub === "status" && parts[2]) {
            const projectIdPrefix = parts[2];
            const projects = await getUserProjects(projectUserId);
            const project = projects.find((p) => p.id.startsWith(projectIdPrefix) || p.title?.toLowerCase().includes(projectIdPrefix.toLowerCase()));
            if (!project) {
              await sendMessage(chatId, `Project not found. Use /project list to see your projects.`);
              return;
            }
            const status = await getProjectStatus(project.id);
            if (!status) {
              await sendMessage(chatId, "Project not found.");
              return;
            }
            const { completedCount, totalCount, nextStep } = status;
            const autoMode = status.project.autonomousMode ? "ON ⚡" : "off";
            const msg =
              `📋 *${status.project.title}*\n` +
              `Status: ${status.project.status}\n` +
              `Progress: ${completedCount}/${totalCount} steps\n` +
              `Autonomous mode: ${autoMode}\n` +
              (status.project.questionPending ? `❓ Waiting for: ${status.project.questionPending.slice(0, 200)}\n` : "") +
              (nextStep ? `⏭ Next: ${nextStep.label}\n` : "") +
              `Sessions: ${status.sessions.length}\n` +
              `id: \`${status.project.id.slice(0, 8)}\``;
            await sendMessage(chatId, msg, { parse_mode: "Markdown" });
            return;
          }

          if ((sub === "pause" || sub === "resume") && parts[2]) {
            const projectIdPrefix = parts[2];
            const projects = await getUserProjects(projectUserId);
            const project = projects.find((p) => p.id.startsWith(projectIdPrefix));
            if (!project) {
              await sendMessage(chatId, "Project not found.");
              return;
            }
            if (sub === "pause") {
              await pauseProject(project.id);
              await sendMessage(chatId, `⏸ Project *${project.title}* paused.`, { parse_mode: "Markdown" });
            } else {
              await resumeProject(project.id);
              await sendMessage(chatId, `▶️ Project *${project.title}* resumed — next session queued.`, { parse_mode: "Markdown" });
            }
            return;
          }

          if (sub === "answer" && parts[2]) {
            const projectIdPrefix = parts[2];
            const answer = parts.slice(3).join(" ");
            if (!answer) {
              await sendMessage(chatId, "Usage: /project answer <id> <your answer>");
              return;
            }
            const projects = await getUserProjects(projectUserId);
            const project = projects.find((p) => p.id.startsWith(projectIdPrefix));
            if (!project) {
              await sendMessage(chatId, "Project not found.");
              return;
            }
            await answerProjectQuestion(project.id, answer);
            await sendMessage(chatId, `✅ Answer received. Resuming project *${project.title}*...`, { parse_mode: "Markdown" });
            return;
          }

          if (sub === "auto" && parts[2] && parts[3]) {
            const toggle = parts[2].toLowerCase();
            const projectIdPrefix = parts[3];
            const projects = await getUserProjects(projectUserId);
            const project = projects.find((p) => p.id.startsWith(projectIdPrefix));
            if (!project) {
              await sendMessage(chatId, "Project not found.");
              return;
            }
            const enabled = toggle === "on";
            await setAutonomousMode(project.id, enabled);
            await sendMessage(chatId, `${enabled ? "⚡ Autonomous mode ON" : "⏸ Autonomous mode OFF"} for *${project.title}*.${enabled ? " I'll keep building every 30 minutes." : ""}`, { parse_mode: "Markdown" });
            return;
          }

          await sendMessage(chatId, "Unknown /project subcommand. Send /project help for usage.");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await sendMessage(chatId, `❌ Project error: ${msg.slice(0, 400)}`);
        }
        return;
      }

      // ── /pr command ───────────────────────────────────────────────────────
      // List open GitHub pull requests for the user's tracked repos and format
      // them as a compact status card with CI emoji and merge buttons.
      const PR_CMD_RE = /^\/pr(?:@\S+)?(\s|$)/i;
      if (PR_CMD_RE.test(text)) {
        const prUserId = link[0].userId;
        const placeholderId = await sendMessageGetId(chatId, "⏳ Fetching pull requests...").catch(() => null);
        try {
          const { getGitHubSettings, listOpenPRs } = await import("./integrations/github");
          const settings = await getGitHubSettings(prUserId);
          if (!settings.pat) {
            const msg = "GitHub not connected. Connect via OAuth or add a token in Settings → GitHub to use /pr.";
            if (placeholderId) await editMessage(chatId, placeholderId, msg);
            else await sendMessage(chatId, msg);
          } else if (settings.repos.length === 0) {
            const msg = "No repos configured. Add repos to watch in Settings → GitHub.";
            if (placeholderId) await editMessage(chatId, placeholderId, msg);
            else await sendMessage(chatId, msg);
          } else {
            const prs = await listOpenPRs(settings.pat, settings.repos);
            if (prs.length === 0) {
              const msg = `✅ No open pull requests across: ${settings.repos.join(", ")}`;
              if (placeholderId) await editMessage(chatId, placeholderId, msg);
              else await sendMessage(chatId, msg);
            } else {
              const lines: string[] = [`*Open Pull Requests (${prs.length})*\n`];
              for (const pr of prs) {
                const ci =
                  pr.ciStatus === "pass" ? "✅"
                  : pr.ciStatus === "fail" ? "❌"
                  : pr.ciStatus === "pending" ? "⏳"
                  : "❓";
                const draftStr = pr.draft ? " \\[DRAFT\\]" : "";
                lines.push(`${ci} *${pr.repo}* #${pr.number}${draftStr}`);
                lines.push(`└ ${pr.title}`);
                lines.push(`└ by @${pr.author} • \`${pr.branch}\``);
                if (pr.reviewers.length > 0) lines.push(`└ reviewers: ${pr.reviewers.join(", ")}`);
                lines.push(`└ [View PR](${pr.url})`);
                lines.push("");
              }
              const cardText = lines.join("\n");
              const greenPrs = prs.filter((p) => p.ciStatus === "pass" && !p.draft);
              if (placeholderId) await editMessage(chatId, placeholderId, cardText);
              else await sendMessage(chatId, cardText);
              if (greenPrs.length > 0) {
                const inlineKeyboard = {
                  inline_keyboard: greenPrs.slice(0, 5).map((p) => [
                    {
                      text: `🔀 Merge #${p.number} — ${p.repo}`,
                      callback_data: `merge_pr:${p.repo}:${p.number}`,
                    },
                  ]),
                };
                await sendMessage(chatId, "Tap to merge a PR:", inlineKeyboard);
              }
            }
          }
        } catch (err) {
          const errMsg = "Sorry, I couldn't fetch your pull requests. Check your GitHub settings.";
          if (placeholderId) await editMessage(chatId, placeholderId, errMsg);
          else await sendMessage(chatId, errMsg);
          console.error("[Telegram /pr]", err);
        }
        return;
      }

      // ── /call command and voice trigger phrases ──────────────────────────
      // Intercept before the generic slash command router so we can send an
      // inline keyboard button instead of plain text.
      const VOICE_CALL_CMD_RE = /^\/call(?:@\S+)?(\s|$)/i;
      const VOICE_TRIGGER_RE = /\b(voice\s+call|call\s+me|let['']?s\s+talk)\b/i;
      if (VOICE_CALL_CMD_RE.test(text) || VOICE_TRIGGER_RE.test(text)) {
        // /call and trigger phrases: single button only (no "💬 Text reply" — we're already in text)
        const keyboard = buildVoiceCallKeyboard();
        if (keyboard) {
          await sendMessage(
            chatId,
            "Tap below to open a voice session with me:",
            keyboard,
          );
        } else {
          await sendMessage(chatId, "Voice calls are available in the Jarvis app. Open the app and go to the Voice screen to start a session.");
        }
        return;
      }

      // ── Slash command router: /research, /plan, /write, /brief, /help ─────
      // Commands may arrive as "/research topic" or "/research@BotName topic".
      // Only the recognized task commands are intercepted here — unknown slash
      // commands fall through to the coach agent for natural-language handling.
      const TASK_CMD_RE = /^\/([a-z_]+)(?:@\S+)?(?:\s+([\s\S]*))?$/i;
      // Exclude "call" and "pr" — they are handled above and "pr" would return getHelpText() via the router.
      const ROUTABLE_CMDS = new Set(SLASH_COMMANDS.filter((c) => c.name !== "call" && c.name !== "pr").map((c) => c.name));
      const cmdMatch = text.match(TASK_CMD_RE);
      if (cmdMatch) {
        const rawCmd = cmdMatch[1].toLowerCase();
        if (ROUTABLE_CMDS.has(rawCmd)) {
          const cmdUserId = link[0].userId;
          const rawArgs = (cmdMatch[2] ?? "").trim();
          const ackText = await routeSlashCommand(rawCmd, rawArgs, cmdUserId, "telegram");
          await sendMessage(chatId, ackText);
          return;
        }
      }

      const userId = link[0].userId;

      await handleCoachReply(userId, chatId, text, imageUrl);
    } catch (err) {
      console.error("Error handling Telegram message:", err);
      await sendMessage(chatId, "Sorry, something went wrong. Please try again.");
    }
  } catch (error) {
    console.error("Telegram processUpdate error:", error);
  }
}

let pollingOffset = 0;
let pollingActive = false;

export async function startTelegramPolling(): Promise<void> {
  if (!isTelegramConfigured()) return;
  if (pollingActive) return;
  pollingActive = true;
  console.log('[Telegram] Polling started (dev mode — webhook not modified)');
  // Register slash command menu for the dev bot too.
  registerTelegramBotCommands().catch((err) =>
    console.warn("[Telegram] setMyCommands failed (non-fatal):", err),
  );

  const poll = async () => {
    if (!pollingActive) return;
    try {
      const updates = await getUpdates(pollingOffset);
      for (const update of updates) {
        await processUpdate(update);
        pollingOffset = update.update_id + 1;
      }
    } catch (err) {
      console.error('[Telegram] Polling error:', err);
    }
    setTimeout(poll, 2000);
  };

  poll();
}

export function registerTelegramWebhook(app: Express): void {
  app.post("/api/telegram/webhook", async (req: Request, res: Response) => {
    res.sendStatus(200);
    await processUpdate(req.body);
  });
  // Register the slash command menu on every startup (idempotent on Telegram's side).
  registerTelegramBotCommands().catch((err) =>
    console.warn("[Telegram] setMyCommands failed (non-fatal):", err),
  );
}

export function registerTelegramRoutes(app: Express): void {
  app.post("/api/telegram/link-code", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      if (!isTelegramConfigured()) {
        return res.status(400).json({ error: "Telegram bot not configured. Add TELEGRAM_BOT_TOKEN to secrets." });
      }

      const code = generateLinkCode();
      await db.insert(schema.telegramLinkCodes).values({ code, userId });

      res.json({ code });
    } catch (error) {
      console.error("Error generating link code:", error);
      res.status(500).json({ error: "Failed to generate link code" });
    }
  });

  const WEBHOOK_STATUS_REFRESH_MS = 5 * 60 * 1000; // re-check at most every 5 minutes

  app.get("/api/telegram/status", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const link = await db.select().from(schema.telegramLinks).where(eq(schema.telegramLinks.userId, userId)).limit(1);

      const isProduction = process.env.NODE_ENV === 'production';
      // If health data is stale (or never set), kick off a background refresh so
      // the next request (within ~1 s) sees fresh data. We do not await it here
      // to keep the response snappy.
      if (isProduction && isTelegramConfigured()) {
        const currentHealth = getWebhookHealth();
        const stale = !currentHealth.lastChecked ||
          (Date.now() - new Date(currentHealth.lastChecked).getTime() > WEBHOOK_STATUS_REFRESH_MS);
        if (stale) {
          const expectedUrl = getExpectedWebhookUrl();
          if (expectedUrl) {
            ensureWebhook(expectedUrl).catch(() => { /* silent — periodic check will retry */ });
          }
        }
      }
      const webhookHealth = isProduction ? getWebhookHealth() : null;

      if (link.length === 0) {
        return res.json({
          connected: false,
          username: null,
          configured: isTelegramConfigured(),
          webhookHealthy: webhookHealth?.healthy ?? null,
          webhookLastChecked: webhookHealth?.lastChecked ?? null,
        });
      }

      res.json({
        connected: true,
        username: link[0].username,
        configured: isTelegramConfigured(),
        webhookHealthy: webhookHealth?.healthy ?? null,
        webhookLastChecked: webhookHealth?.lastChecked ?? null,
      });
    } catch (error) {
      console.error("Error getting Telegram status:", error);
      res.status(500).json({ error: "Failed to get status" });
    }
  });

  app.post("/api/telegram/reset-webhook", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      if (!isTelegramConfigured()) {
        return res.status(400).json({ error: "Telegram bot not configured" });
      }

      const webhookUrl = getExpectedWebhookUrl();
      if (!webhookUrl) {
        return res.status(400).json({ error: "Not in production mode — cannot determine webhook URL" });
      }

      console.log(`[Telegram] Manual webhook reset requested by user=${userId}`);
      const result = await ensureWebhook(webhookUrl);
      res.json({
        success: result.healthy,
        reregistered: result.reregistered,
        webhookUrl,
        healthy: result.healthy,
      });
    } catch (error) {
      console.error("Error resetting Telegram webhook:", error);
      res.status(500).json({ error: "Failed to reset webhook" });
    }
  });

  app.delete("/api/telegram/disconnect", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      await db.delete(schema.telegramLinks).where(eq(schema.telegramLinks.userId, userId));
      res.json({ success: true });
    } catch (error) {
      console.error("Error disconnecting Telegram:", error);
      res.status(500).json({ error: "Failed to disconnect" });
    }
  });

  app.get("/api/telegram/messages", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const link = await db.select().from(schema.telegramLinks).where(eq(schema.telegramLinks.userId, userId)).limit(1);
      if (link.length === 0) {
        return res.json({ connected: false, messages: [] });
      }

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const messages = await db.select()
        .from(schema.telegramGroupMessages)
        .where(and(
          eq(schema.telegramGroupMessages.userId, userId),
          gte(schema.telegramGroupMessages.messageDate, sevenDaysAgo)
        ))
        .orderBy(desc(schema.telegramGroupMessages.messageDate))
        .limit(50);

      res.json({
        connected: true,
        messages: messages.map(m => ({
          chatTitle: m.chatTitle,
          fromUser: m.fromUser,
          text: m.text,
          timestamp: m.messageDate.toISOString(),
        })),
      });
    } catch (error) {
      console.error("Error getting Telegram messages:", error);
      res.status(500).json({ error: "Failed to get messages" });
    }
  });

  app.post("/api/telegram/notify", async (req: Request, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { type, message: msgText } = req.body;
      if (!msgText) return res.status(400).json({ error: "message is required" });

      const link = await db.select().from(schema.telegramLinks).where(eq(schema.telegramLinks.userId, userId)).limit(1);
      if (link.length === 0) {
        return res.json({ sent: false, reason: "Not linked" });
      }

      await sendMessage(link[0].chatId, msgText);
      res.json({ sent: true });
    } catch (error) {
      console.error("Error sending Telegram notification:", error);
      res.status(500).json({ error: "Failed to send notification" });
    }
  });
}

async function getCommitmentsForUser(userId: string): Promise<any[]> {
  try {
    return await db
      .select()
      .from(schema.commitments)
      .where(and(eq(schema.commitments.userId, userId), eq(schema.commitments.status, 'pending')))
      .orderBy(desc(schema.commitments.extractedAt))
      .limit(20);
  } catch {
    return [];
  }
}

function formatCommitmentsForMessage(commitments: any[], dateKey: string): string {
  const overdue = commitments.filter((c: any) => c.dueDate && c.dueDate < dateKey);
  const dueToday = commitments.filter((c: any) => c.dueDate === dateKey);
  const upcoming = commitments.filter((c: any) => c.dueDate && c.dueDate > dateKey).slice(0, 3);

  const parts: string[] = [];
  if (overdue.length > 0) {
    parts.push(`\nOverdue commitments (${overdue.length}):\n${overdue.slice(0, 5).map((c: any) => `  - "${c.content}" (was due ${c.dueDate})`).join('\n')}`);
  }
  if (dueToday.length > 0) {
    parts.push(`\nDue today (${dueToday.length}):\n${dueToday.map((c: any) => `  - "${c.content}"`).join('\n')}`);
  }
  if (upcoming.length > 0) {
    parts.push(`\nComing up:\n${upcoming.map((c: any) => `  - "${c.content}" (due ${c.dueDate})`).join('\n')}`);
  }
  return parts.join('');
}

export async function getPlansForDateRange(userId: string, startDate: string, endDate: string): Promise<{ date: string; tasks: any[] }[]> {
  try {
    const rows = await db.select().from(schema.plans)
      .where(and(
        eq(schema.plans.userId, userId),
        gte(schema.plans.date, startDate),
        lte(schema.plans.date, endDate),
      ));
    return rows.map(r => ({
      date: r.date,
      tasks: ((r.data as any)?.tasks as any[]) || [],
    }));
  } catch {
    return [];
  }
}

export function computePatternInsights(plans: { date: string; tasks: any[] }[], commitments?: any[]): string {
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayStats: Record<string, { planned: number; completed: number; days: number }> = {};
  for (const d of dayNames) dayStats[d] = { planned: 0, completed: 0, days: 0 };

  const categoryStats: Record<string, { planned: number; completed: number }> = {};
  let totalPlanned = 0;
  let totalCompleted = 0;
  const dailyCounts: { date: string; planned: number; completed: number }[] = [];
  const streakBreakDays: Record<string, number> = {};
  for (const d of dayNames) streakBreakDays[d] = 0;

  for (const plan of plans) {
    const dayOfWeek = dayNames[new Date(plan.date + 'T12:00:00').getDay()];
    const planned = plan.tasks.length;
    const completed = plan.tasks.filter((t: any) => t.completed).length;

    dayStats[dayOfWeek].planned += planned;
    dayStats[dayOfWeek].completed += completed;
    dayStats[dayOfWeek].days += 1;
    totalPlanned += planned;
    totalCompleted += completed;
    dailyCounts.push({ date: plan.date, planned, completed });

    for (const task of plan.tasks) {
      const cat = (task as any).category || 'uncategorized';
      if (!categoryStats[cat]) categoryStats[cat] = { planned: 0, completed: 0 };
      categoryStats[cat].planned += 1;
      if ((task as any).completed) categoryStats[cat].completed += 1;
    }
  }

  const sortedDays = dailyCounts.sort((a, b) => a.date.localeCompare(b.date));
  const planDates = new Set(sortedDays.map(d => d.date));
  if (sortedDays.length >= 2) {
    const firstDate = new Date(sortedDays[0].date + 'T12:00:00');
    const lastDate = new Date(sortedDays[sortedDays.length - 1].date + 'T12:00:00');
    const allDatesInRange: { date: string; planned: number; completed: number }[] = [];
    for (let d = new Date(firstDate); d <= lastDate; d.setDate(d.getDate() + 1)) {
      const dk = d.toISOString().slice(0, 10);
      const existing = sortedDays.find(s => s.date === dk);
      allDatesInRange.push(existing || { date: dk, planned: 0, completed: 0 });
    }
    let prevActive = false;
    for (const day of allDatesInRange) {
      const rate = day.planned > 0 ? day.completed / day.planned : 0;
      const isActiveDay = (rate >= 0.5 && day.planned > 0);
      if (prevActive && !isActiveDay) {
        const dayOfWeek = dayNames[new Date(day.date + 'T12:00:00').getDay()];
        streakBreakDays[dayOfWeek] += 1;
      }
      prevActive = isActiveDay;
    }
  }

  let stats = `BEHAVIORAL DATA (${plans.length} days analyzed):\n\n`;

  stats += `Overall: ${totalCompleted}/${totalPlanned} tasks completed (${totalPlanned > 0 ? Math.round(totalCompleted / totalPlanned * 100) : 0}%)\n`;
  stats += `Avg tasks planned per day: ${plans.length > 0 ? (totalPlanned / plans.length).toFixed(1) : '0'}\n\n`;

  stats += `Day-of-week completion rates:\n`;
  for (const day of dayNames) {
    const s = dayStats[day];
    if (s.days === 0) continue;
    const rate = s.planned > 0 ? Math.round(s.completed / s.planned * 100) : 0;
    stats += `  ${day}: ${rate}% (${s.completed}/${s.planned} across ${s.days} day${s.days > 1 ? 's' : ''})\n`;
  }

  const catEntries = Object.entries(categoryStats).filter(([_, v]) => v.planned >= 2);
  if (catEntries.length > 0) {
    stats += `\nCategory completion rates:\n`;
    for (const [cat, v] of catEntries) {
      stats += `  ${cat}: ${Math.round(v.completed / v.planned * 100)}% (${v.completed}/${v.planned})\n`;
    }
  }

  const breakEntries = Object.entries(streakBreakDays).filter(([_, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (breakEntries.length > 0) {
    stats += `\nStreak break days (days where momentum dropped):\n`;
    for (const [day, count] of breakEntries) {
      stats += `  ${day}: ${count} break${count > 1 ? 's' : ''}\n`;
    }
  }

  if (commitments && commitments.length > 0) {
    const resolved = commitments.filter((c: any) => c.status === 'done').length;
    const expired = commitments.filter((c: any) => c.status === 'expired').length;
    const pending = commitments.filter((c: any) => c.status === 'pending').length;
    const total = commitments.length;
    stats += `\nCommitment follow-through:\n`;
    stats += `  Resolved: ${resolved}/${total} (${Math.round(resolved / total * 100)}%)\n`;
    if (expired > 0) stats += `  Expired: ${expired}/${total}\n`;
    if (pending > 0) stats += `  Still pending: ${pending}\n`;
  }

  return stats;
}

async function generateProactiveMessage(
  type: string,
  context: {
    tasks?: any[];
    goals?: any[];
    commitments?: any[];
    stats?: any;
    dateKey?: string;
    userId?: string;
  }
): Promise<string | null> {
  const now = new Date();
  const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });
  const dateFull = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const allTasks = context.tasks || [];
  const incompleteTasks = allTasks.filter((t: any) => !t.completed);
  const completedTasks = allTasks.filter((t: any) => t.completed);
  const goalsText = (context.goals || []).slice(0, 3).map((g: any) => `${g.title} (${g.current || 0}/${g.target} ${g.unit})`).join(', ') || 'none set';
  const commitmentList = (context.commitments || []).slice(0, 5).map((c: any) => `"${c.content}"${c.dueDate ? ` due ${c.dueDate}` : ''}`).join(', ') || 'none';

  let prompt = '';

  if (type === 'morning') {
    const dueToday = (context.commitments || []).filter((c: any) => c.dueDate === context.dateKey);
    const overdue = (context.commitments || []).filter((c: any) => c.dueDate && c.dueDate < context.dateKey!);
    const tomorrow = new Date(context.dateKey + 'T12:00:00');
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowKey = tomorrow.toISOString().slice(0, 10);
    const dueTomorrow = (context.commitments || []).filter((c: any) => c.dueDate === tomorrowKey);
    prompt = `Today is ${dayName}, ${dateFull}. User has ${incompleteTasks.length} task(s) planned.
Tasks: ${incompleteTasks.map((t: any) => t.title).join(', ') || 'none planned'}
Goals: ${goalsText}
Due today: ${dueToday.map((c: any) => `"${c.content}"`).join(', ') || 'none'}
Overdue: ${overdue.map((c: any) => `"${c.content}"`).join(', ') || 'none'}
Due TOMORROW: ${dueTomorrow.map((c: any) => `"${c.content}"`).join(', ') || 'none'}
Streak: ${context.stats?.streak || 0} days

Write a sharp, energizing morning check-in (3-4 sentences). Be specific to their actual tasks/goals. No generic phrases like "Good morning!" Start with something direct. If there are items due tomorrow, give a heads-up so they can plan ahead.`;
  } else if (type === 'commitment_check') {
    const dueToday = (context.commitments || []).filter((c: any) => c.dueDate === context.dateKey);
    const overdue = (context.commitments || []).filter((c: any) => c.dueDate && c.dueDate < context.dateKey!);
    if (dueToday.length === 0 && overdue.length === 0) return null;
    prompt = `Today is ${dayName}, ${dateFull}.
Due today: ${dueToday.map((c: any) => `"${c.content}"`).join(', ') || 'none'}
Overdue: ${overdue.map((c: any) => `"${c.content}" (${c.dueDate})`).join(', ') || 'none'}

Write a brief mid-day accountability check-in (2-3 sentences). Direct, no lecture. Ask what progress has been made on the specific items.`;
  } else if (type === 'evening') {
    const tomorrow = new Date(context.dateKey + 'T12:00:00');
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowKey = tomorrow.toISOString().slice(0, 10);
    const dueTomorrow = (context.commitments || []).filter((c: any) => c.dueDate === tomorrowKey);
    prompt = `Today is ${dayName}, ${dateFull}.
Completed: ${completedTasks.length}/${allTasks.length} tasks
Remaining: ${incompleteTasks.slice(0, 3).map((t: any) => t.title).join(', ') || 'none'}
Open commitments: ${commitmentList}
Due TOMORROW: ${dueTomorrow.map((c: any) => `"${c.content}"`).join(', ') || 'none'}
Streak: ${context.stats?.streak || 0} days

Write a concise evening recap (3-4 sentences). Acknowledge what was done, note what's still open. If there are items due tomorrow, specifically call them out so the user can plan tonight. End with something forward-looking. No platitudes.`;
  } else if (type === 'weekly' || type === 'weekly_planning') {
    const userId = context.userId;
    if (userId) {
      const endDate = context.dateKey || new Date().toISOString().slice(0, 10);
      const anchorDate = new Date(endDate + 'T12:00:00');
      const startOfWeekDate = new Date(anchorDate);
      startOfWeekDate.setDate(startOfWeekDate.getDate() - 6);
      const startDate = startOfWeekDate.toISOString().slice(0, 10);

      const weekPlans = await getPlansForDateRange(userId, startDate, endDate);
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

      let dayByDay = '';
      let weekCompleted = 0;
      let weekPlanned = 0;
      const categoryBreakdown: Record<string, { done: number; total: number }> = {};
      const droppedCategories: Record<string, number> = {};

      for (let i = 0; i < 7; i++) {
        const d = new Date(startOfWeekDate);
        d.setDate(d.getDate() + i);
        const dk = d.toISOString().slice(0, 10);
        const dayName = dayNames[d.getDay()];
        const plan = weekPlans.find(p => p.date === dk);
        if (plan && plan.tasks.length > 0) {
          const done = plan.tasks.filter((t: any) => t.completed).length;
          const total = plan.tasks.length;
          weekCompleted += done;
          weekPlanned += total;
          dayByDay += `  ${dayName}: ${done}/${total} completed\n`;

          for (const task of plan.tasks) {
            const cat = (task as any).category || 'general';
            if (!categoryBreakdown[cat]) categoryBreakdown[cat] = { done: 0, total: 0 };
            categoryBreakdown[cat].total += 1;
            if ((task as any).completed) {
              categoryBreakdown[cat].done += 1;
            } else {
              droppedCategories[cat] = (droppedCategories[cat] || 0) + 1;
            }
          }
        } else {
          dayByDay += `  ${dayName}: no plan\n`;
        }
      }

      const weekRate = weekPlanned > 0 ? Math.round(weekCompleted / weekPlanned * 100) : 0;

      const catSummary = Object.entries(categoryBreakdown)
        .map(([cat, v]) => `  ${cat}: ${v.done}/${v.total} (${Math.round(v.done / v.total * 100)}%)`)
        .join('\n');

      const droppedTypeEntries = Object.entries(droppedCategories).sort((a, b) => b[1] - a[1]);
      const droppedSummary = droppedTypeEntries.length > 0
        ? `Top dropped task types: ${droppedTypeEntries.slice(0, 5).map(([cat, count]) => `${cat} (${count})`).join(', ')}`
        : 'No incomplete tasks this week';

      const allWeekCommitments = await db.select().from(schema.commitments)
        .where(eq(schema.commitments.userId, userId)).limit(200);
      const weekDueCommitments = allWeekCommitments.filter((c: any) =>
        c.dueDate && c.dueDate >= startDate && c.dueDate <= endDate
      );
      const weekDueDone = weekDueCommitments.filter((c: any) => c.status === 'done').length;
      const weekDueExpired = weekDueCommitments.filter((c: any) => c.status === 'expired').length;
      const weekDueUnresolved = weekDueCommitments.filter((c: any) => c.status === 'pending').length;
      const weekDueTotal = weekDueCommitments.length;
      const commitmentRate = weekDueTotal > 0 ? Math.round(weekDueDone / weekDueTotal * 100) : 0;

      let goalDeltaText = '';
      try {
        const goalsData = (context.goals || []);
        if (goalsData.length > 0) {
          const statsHistory = (context.stats as any)?.goalHistory as any[] | undefined;

          const goalDeltas = goalsData.map((g: any) => {
            const current = g.current || 0;
            let baseline = current;
            if (statsHistory) {
              const priorEntries = statsHistory
                .filter((h: any) => h.goalId === g.id && h.date && h.date <= startDate)
                .sort((a: any, b: any) => (b.date || '').localeCompare(a.date || ''));
              if (priorEntries.length > 0) baseline = priorEntries[0].value || 0;
            }
            if (baseline === current && g.previousValue !== undefined) baseline = g.previousValue;
            const delta = current - baseline;
            const deltaStr = delta > 0 ? `+${delta}` : delta === 0 ? 'no change' : `${delta}`;
            return `  ${g.title}: ${current}/${g.target} ${g.unit} (${deltaStr} this week)`;
          });
          goalDeltaText = goalDeltas.join('\n');
        }
      } catch {}
      if (!goalDeltaText) goalDeltaText = goalsText;

      let patternSection = '';
      try {
        const thirtyDaysAgoDate = new Date(anchorDate);
        thirtyDaysAgoDate.setDate(thirtyDaysAgoDate.getDate() - 30);
        const thirtyDayStart = thirtyDaysAgoDate.toISOString().slice(0, 10);
        const allPlans = await getPlansForDateRange(userId, thirtyDayStart, endDate);
        const allCommitmentsRaw = await db.select().from(schema.commitments)
          .where(eq(schema.commitments.userId, userId)).limit(200);
        const scopedCommitments30d = allCommitmentsRaw.filter((c: any) =>
          (c.dueDate && c.dueDate >= thirtyDayStart && c.dueDate <= endDate) ||
          (c.extractedAt && c.extractedAt >= new Date(thirtyDayStart) && c.extractedAt <= new Date(endDate + 'T23:59:59')) ||
          (c.resolvedAt && c.resolvedAt >= new Date(thirtyDayStart) && c.resolvedAt <= new Date(endDate + 'T23:59:59'))
        );
        if (allPlans.length >= 7) {
          patternSection = computePatternInsights(allPlans, scopedCommitments30d);
        }
      } catch {}

      prompt = `WEEKLY PLANNING SESSION — Sunday Review

Day-by-day this week:
${dayByDay}
Week completion rate: ${weekRate}% (${weekCompleted}/${weekPlanned})
${catSummary ? `Category breakdown:\n${catSummary}` : ''}
${droppedSummary}
Commitments due this week: ${weekDueTotal > 0 ? `${commitmentRate}% follow-through (${weekDueDone} resolved / ${weekDueTotal} due)${weekDueExpired > 0 ? ` | ${weekDueExpired} expired` : ''}${weekDueUnresolved > 0 ? ` | ${weekDueUnresolved} still unresolved` : ''}` : 'none due this week'}

Streak: ${context.stats?.streak || 0} days | XP: ${context.stats?.xp || 0}
Goal progress (this week):
${goalDeltaText}
Open commitments: ${commitmentList}

${patternSection ? `PATTERN DATA (30 days):\n${patternSection}` : ''}

Write a comprehensive weekly planning session. Structure it as:
1. WEEK RECAP — what happened day-by-day, what the overall trend was, honest assessment
2. GOAL CHECK — how goals moved (or didn't)
3. CARRY FORWARD — what dropped tasks or commitments should carry into next week
4. INTENTIONS — 3 specific, actionable intentions for next week based on what you see in the data
${patternSection ? '5. PATTERNS — include the top 2-3 behavioral observations from the 30-day pattern data. Name each pattern (e.g. "Friday drop-off", "Health task avoidance"). Be specific with numbers.' : ''}

Use line breaks between sections for readability. Plain text, no markdown. Be direct and honest. This is allowed to be thorough (8-15 sentences total).`;
    } else {
      prompt = `Weekly review.
Streak: ${context.stats?.streak || 0} days | XP: ${context.stats?.xp || 0}
Goals: ${goalsText}
Open commitments: ${commitmentList}

Write a sharp weekly summary (3-4 sentences). What's the trend? What needs focus next week? Be honest and direct.`;
    }
  }

  if (!prompt) return null;

  const isWeeklyPlanning = type === 'weekly' || type === 'weekly_planning';
  try {
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: isWeeklyPlanning
            ? 'You are GamePlan Coach Jarvis — a direct, sharp, ADHD-friendly productivity coach. Messages go via Telegram. This is the weekly planning session — you are allowed to be comprehensive (8-15 sentences). Use line breaks between sections for readability. Plain text only, no markdown, no bullet points, no asterisks.'
            : 'You are GamePlan Coach Jarvis — a direct, sharp, ADHD-friendly productivity coach. Messages go via Telegram. Keep it SHORT (3-4 sentences max). Plain text only, no markdown, no bullet points.',
        },
        { role: 'user', content: prompt },
      ],
      max_completion_tokens: isWeeklyPlanning ? 4000 : 2000,
    });
    return resp.choices[0]?.message?.content || null;
  } catch (err) {
    console.error('[Proactive] AI generation failed:', err);
    return null;
  }
}

interface ScheduleEntry {
  type: string;
  hour: number;
  minute: number;
  dayOfWeek?: number;
}

// Note: the 'evening' recap type is intentionally excluded here — the
// Jarvis heartbeat daemon owns the evening wrap-up (default 21:00 local).
// It updates XP/streaks, writes a Drive reflection, and pre-loads a
// tomorrow seed. Adding it here would duplicate the notification.
const PROACTIVE_SCHEDULE: ScheduleEntry[] = [
  { type: 'morning', hour: 8, minute: 0 },
  { type: 'commitment_check', hour: 10, minute: 0 },
  { type: 'followup_check', hour: 12, minute: 0 },
  { type: 'momentum_nudge', hour: 14, minute: 0 },
  { type: 'weekly_planning', dayOfWeek: 0, hour: 19, minute: 0 },
];

// claimAndMark lives in server/lib/proactiveDedup.ts — imported below at the
// top of this file so heartbeat.ts can share the same helper without importing
// the entire route module.

// Returns one entry per user with any linked channel (telegram chatId may be
// missing for WhatsApp/Slack/daemon-only users). Used by proactive engines so
// every linked user receives scheduled notifications routed by notifyUser.
async function getProactiveEligibleUsers(): Promise<{ userId: string; chatId?: string }[]> {
  const [tgRows, chRows, prefRows] = await Promise.all([
    db.select({ userId: schema.telegramLinks.userId, chatId: schema.telegramLinks.chatId }).from(schema.telegramLinks),
    db.select({ userId: schema.channelLinks.userId }).from(schema.channelLinks),
    db.select({ userId: schema.channelPreferences.userId }).from(schema.channelPreferences),
  ]);
  const chatIdByUser = new Map<string, string>();
  for (const r of tgRows) chatIdByUser.set(r.userId, r.chatId);
  const userIds = new Set<string>();
  for (const r of tgRows) userIds.add(r.userId);
  for (const r of chRows) userIds.add(r.userId);
  for (const r of prefRows) userIds.add(r.userId);
  return Array.from(userIds).map((userId) => ({ userId, chatId: chatIdByUser.get(userId) }));
}

async function sendScheduledMessage(
  link: { userId: string; chatId?: string },
  schedule: ScheduleEntry,
  dateKey: string,
  timezone: string
): Promise<void> {
  if (schedule.type === 'followup_check') {
    const tokens = await getValidGoogleTokens(link.userId).catch(() => []);
    if (!tokens || tokens.length === 0) return;
    const token = tokens[0];
    const starredEmails = await getStarredFollowUpEmails(token, 3);
    if (starredEmails.length === 0) return;
    const emailList = starredEmails.slice(0, 10).map((e) => {
      const senderName = e.from.replace(/<.*>/, '').trim() || e.from;
      return `${senderName} (${e.ageDays}d) — "${e.subject}"`;
    }).join('\n');
    const msg = `📬 ${starredEmails.length} starred/important email${starredEmails.length === 1 ? '' : 's'} sitting >3 days:\n\n${emailList}\n\nStill relevant? Reply, archive, or unstar anything you've handled.`;
    console.log(`[Proactive] Sending followup_check to user ${link.userId} (${timezone})`);
    await notifyUser(link.userId, "general", msg);
    logInteraction(link.userId, "notification", "outbound", msg, "followup_check").catch(() => {});
    return;
  }

  const [goalsRow, planRow, statsRow] = await Promise.allSettled([
    db.select().from(schema.goals).where(eq(schema.goals.userId, link.userId)).limit(1),
    db.select().from(schema.plans).where(and(eq(schema.plans.userId, link.userId), eq(schema.plans.date, dateKey))).limit(1),
    db.select().from(schema.stats).where(eq(schema.stats.userId, link.userId)).limit(1),
  ]);
  const userGoals: any[] = goalsRow.status === 'fulfilled' ? ((goalsRow.value[0]?.data as any[]) || []) : [];
  const todayPlan: any = planRow.status === 'fulfilled' ? (planRow.value[0]?.data as any) : null;
  const userStats: any = statsRow.status === 'fulfilled' ? (statsRow.value[0]?.data || {}) : {};
  const tasks = todayPlan?.tasks || [];

  if (schedule.type === 'momentum_nudge') {
    // Momentum coaching is Telegram-specific (interactive multi-turn session
    // bound to a chat). Skip silently for users without a Telegram chat.
    if (!link.chatId) return;
    const alreadyHasSession = await hasMomentumSessionToday(link.userId, dateKey);
    if (alreadyHasSession) return;
    console.log(`[Proactive] Sending momentum_nudge to user ${link.userId} (${timezone})`);
    await startMomentumSession(link.userId, link.chatId, {
      tasks,
      goals: userGoals,
      stats: userStats,
      dateKey,
    });
    logInteraction(link.userId, "notification", "outbound", "[Momentum coaching session started]", "momentum_nudge").catch(() => {});
    return;
  }

  const commitments = await getCommitmentsForUser(link.userId);
  const message = await generateProactiveMessage(schedule.type, {
    tasks,
    goals: userGoals,
    commitments,
    stats: userStats,
    dateKey,
    userId: link.userId,
  });

  if (message) {
    console.log(`[Proactive] Sending ${schedule.type} to user ${link.userId} (${timezone})`);

    // For morning briefings: persist the exact generated text so every
    // channel (app chat, Telegram, daemon) delivers the identical message.
    if (schedule.type === 'morning') {
      try {
        const existingPrefs = await db
          .select({ data: schema.userPreferences.data })
          .from(schema.userPreferences)
          .where(eq(schema.userPreferences.userId, link.userId));
        const currentPrefs = (existingPrefs[0]?.data as any) || {};
        await db.insert(schema.userPreferences).values({
          userId: link.userId,
          data: { ...currentPrefs, morningBrief: { date: dateKey, text: message } },
        }).onConflictDoUpdate({
          target: [schema.userPreferences.userId],
          set: { data: { ...currentPrefs, morningBrief: { date: dateKey, text: message } }, updatedAt: new Date() },
        });
      } catch (e) {
        console.error('[Proactive] Failed to save morning brief:', e);
      }
    }

    // Map proactive schedule types onto registered NotificationType values so
    // per-type channel preferences (telegram/whatsapp/slack/daemon) apply.
    const typeMap: Record<string, NotificationType> = {
      morning: "morning_briefing",
      commitment_check: "commitment_check",
      weekly_planning: "weekly_planning",
      followup_check: "general",
      momentum_nudge: "general",
    };
    const notifType = typeMap[schedule.type] || "general";
    await notifyUser(link.userId, notifType, message);
    logInteraction(link.userId, "notification", "outbound", message, schedule.type).catch(() => {});
  }
}

export async function runProactiveStartupCatchup(): Promise<void> {
  try {
    const links = await getProactiveEligibleUsers();
    if (links.length === 0) return;

    const allPrefs = await db.select().from(schema.userPreferences);
    const prefsMap: Record<string, any> = {};
    for (const p of allPrefs) prefsMap[p.userId] = (p.data as any) || {};

    const now = new Date();

    for (const link of links) {
      const timezone = prefsMap[link.userId]?.timezone || 'America/New_York';
      const localDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
      const localHour = localDate.getHours();
      const localDay = localDate.getDay();
      const yr = localDate.getFullYear();
      const mo = String(localDate.getMonth() + 1).padStart(2, '0');
      const dy = String(localDate.getDate()).padStart(2, '0');
      const dateKey = `${yr}-${mo}-${dy}`;

      for (const schedule of PROACTIVE_SCHEDULE) {
        if (schedule.type === 'weekly_planning' && localDay !== (schedule.dayOfWeek ?? -1)) continue;
        const scheduleMinutesFromMidnight = schedule.hour * 60 + schedule.minute;
        const currentMinutesFromMidnight = localHour * 60 + localDate.getMinutes();
        const minutesSinceScheduled = currentMinutesFromMidnight - scheduleMinutesFromMidnight;

        if (minutesSinceScheduled < 0 || minutesSinceScheduled > 120) continue;

        // Atomic claim: INSERT ... ON CONFLICT DO NOTHING.
        // Only the process that wins the insert proceeds; any parallel
        // restart that races here will get rows.length === 0 and skip.
        const claimed = await claimAndMark(link.userId, schedule.type, dateKey);
        if (!claimed) continue;

        console.log(`[Proactive] Catchup: sending missed ${schedule.type} to user ${link.userId}`);
        try {
          await sendScheduledMessage(link, schedule, dateKey, timezone);
        } catch (err) {
          console.error(`[Proactive] Catchup error for ${link.userId}:`, err);
        }
      }
    }
  } catch (err) {
    console.error('[Proactive] Startup catchup error:', err);
  }
}

export async function startProactiveScheduler(): Promise<void> {
  setInterval(async () => {
    const now = new Date();
    try {
      const links = await getProactiveEligibleUsers();
      if (links.length === 0) return;

      const allPrefs = await db.select().from(schema.userPreferences);
      const prefsMap: Record<string, any> = {};
      for (const p of allPrefs) prefsMap[p.userId] = (p.data as any) || {};

      for (const link of links) {
        const timezone = prefsMap[link.userId]?.timezone || 'America/New_York';
        const localDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
        const localHour = localDate.getHours();
        const localMinute = localDate.getMinutes();
        const localDay = localDate.getDay();
        const yr = localDate.getFullYear();
        const mo = String(localDate.getMonth() + 1).padStart(2, '0');
        const dy = String(localDate.getDate()).padStart(2, '0');
        const dateKey = `${yr}-${mo}-${dy}`;

        for (const schedule of PROACTIVE_SCHEDULE) {
          if (localHour !== schedule.hour || localMinute !== schedule.minute) continue;
          if (schedule.type === 'weekly_planning' && localDay !== (schedule.dayOfWeek ?? -1)) continue;

          // Atomic claim: INSERT ... ON CONFLICT DO NOTHING.
          // Prevents the scheduler tick and the startup catchup from both
          // sneaking past a read-before-write race on rapid restarts.
          const claimed = await claimAndMark(link.userId, schedule.type, dateKey);
          if (!claimed) continue;

          try {
            await sendScheduledMessage(link, schedule, dateKey, timezone);
          } catch (err) {
            console.error(`[Proactive] Error for user ${link.userId}:`, err);
          }
        }
      }
    } catch (err) {
      console.error('[Proactive] Scheduler error:', err);
    }
  }, 60 * 1000);

  console.log('Proactive scheduler started (channel-agnostic)');
}

export async function startMeetingBriefScanner(): Promise<void> {
  if (!isTelegramConfigured()) return;

  const SCAN_INTERVAL_MS = 5 * 60 * 1000;
  const sentBriefs = new Set<string>();

  const runScan = async () => {
    try {
      const links = await db.select().from(schema.telegramLinks);
      if (links.length === 0) return;

      const allPrefs = await db.select().from(schema.userPreferences);
      const prefsMap: Record<string, any> = {};
      for (const p of allPrefs) prefsMap[p.userId] = (p.data as any) || {};

      const now = new Date();

      const utcDateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const oldKeys = Array.from(sentBriefs).filter(k => !k.includes(utcDateKey));
      for (const k of oldKeys) sentBriefs.delete(k);

      for (const link of links) {
        try {
          const tokens = await getValidGoogleTokens(link.userId).catch(() => []);
          if (!tokens || tokens.length === 0) continue;
          const token = tokens[0];

          const timezone = prefsMap[link.userId]?.timezone || 'America/New_York';
          const localDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
          const localDateStr = `${localDate.getFullYear()}-${String(localDate.getMonth() + 1).padStart(2, '0')}-${String(localDate.getDate()).padStart(2, '0')}`;

          const events = await getGoogleCalendarEvents(localDateStr, undefined, undefined, token);
          if (events.length === 0) continue;

          const nowMs = now.getTime();

          for (const event of events) {
            const eventStart = new Date(event.start).getTime();
            const minutesUntil = (eventStart - nowMs) / (60 * 1000);

            if (minutesUntil < 10 || minutesUntil > 20) continue;

            const briefKey = `${link.userId}-${event.id}-${localDateStr}`;
            if (sentBriefs.has(briefKey)) continue;
            sentBriefs.add(briefKey);

            let relevantEmails: string[] = [];
            try {
              const titleWords = event.title
                .split(/[\s,\-—]+/)
                .filter(w => w.length > 3)
                .map(w => w.toLowerCase());

              if (titleWords.length > 0) {
                const recentEmails = await getEmailsSince(Date.now() - 7 * 24 * 60 * 60 * 1000, token);
                relevantEmails = recentEmails
                  .filter(e => {
                    const subjectLower = e.subject.toLowerCase();
                    return titleWords.some(w => subjectLower.includes(w));
                  })
                  .slice(0, 3)
                  .map(e => {
                    const senderName = e.from.replace(/<.*>/, '').trim() || e.from;
                    return `"${e.subject}" from ${senderName}`;
                  });
              }
            } catch {}

            const eventTime = new Date(event.start).toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
            });

            let briefPrompt = `Upcoming meeting in ~15 minutes:
Event: "${event.title}"
Time: ${eventTime}
${event.location ? `Location: ${event.location}` : ''}
${event.description ? `Description: ${event.description.slice(0, 300)}` : ''}
${relevantEmails.length > 0 ? `\nRelated recent emails:\n${relevantEmails.map(e => `- ${e}`).join('\n')}` : ''}

Write a sharp 2-3 sentence meeting prep brief. Include what the meeting is about, highlight any relevant email context if provided, and end with one clear action item or thing to focus on. Be direct, no fluff.`;

            try {
              const resp = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                  {
                    role: 'system',
                    content: 'You are GamePlan Coach Jarvis — a direct, sharp productivity coach. You send pre-meeting prep briefs via Telegram. Keep it SHORT (2-3 sentences). Plain text only, no markdown, no bullet points.',
                  },
                  { role: 'user', content: briefPrompt },
                ],
                max_completion_tokens: 1500,
              });

              const briefMessage = resp.choices[0]?.message?.content;
              if (briefMessage) {
                const header = `📅 Meeting in ~15 min: ${event.title} (${eventTime})${event.location ? `\n📍 ${event.location}` : ''}`;
                const fullMsg = `${header}\n\n${briefMessage}`;
                console.log(`[MeetingBrief] Sending brief for "${event.title}" to user ${link.userId}`);
                await notifyUser(link.userId, "meeting_brief", fullMsg);
                logInteraction(link.userId, "notification", "outbound", fullMsg, "meeting_brief").catch(() => {});
              }
            } catch (err) {
              console.error(`[MeetingBrief] AI generation failed for "${event.title}":`, err);
            }
          }
        } catch (err) {
          console.error(`[MeetingBrief] Error for user ${link.userId}:`, err);
        }
      }
    } catch (err) {
      console.error('[MeetingBrief] Scanner error:', err);
    }
  };

  setTimeout(runScan, 10 * 1000);
  setInterval(runScan, SCAN_INTERVAL_MS);
  console.log('Meeting brief scanner started (5-min interval)');
}

export async function startEmailAlertScanner(): Promise<void> {
  const SCAN_INTERVAL_MS = 30 * 60 * 1000;

  const runScan = async () => {
    try {
      const links = await getProactiveEligibleUsers();
      if (links.length === 0) return;

      const allPrefs = await db.select().from(schema.userPreferences);
      const prefsMap: Record<string, any> = {};
      for (const p of allPrefs) prefsMap[p.userId] = (p.data as any) || {};

      for (const link of links) {
        const prefs = prefsMap[link.userId] || {};
        if (prefs.emailAlertsEnabled === false) continue;

        const tokenObjs = await getUserTokens(link.userId, 'google').catch(() => []);
        if (tokenObjs.length === 0) continue;

        const sinceMs = prefs.lastEmailScanAt
          ? Number(prefs.lastEmailScanAt)
          : Date.now() - SCAN_INTERVAL_MS;

        const nowMs = Date.now();

        const newPrefs = { ...prefs, lastEmailScanAt: nowMs };
        await db.insert(schema.userPreferences)
          .values({ userId: link.userId, data: newPrefs })
          .onConflictDoUpdate({
            target: schema.userPreferences.userId,
            set: { data: newPrefs, updatedAt: new Date() },
          });

        const { getUserInboxRules, matchItemAgainstRules } = await import("./inboxRules");
        const userRules = await getUserInboxRules(link.userId);

        for (const tokenObj of tokenObjs) {
          let accessToken = tokenObj.accessToken;
          if (tokenObj.expiresAt && tokenObj.expiresAt.getTime() < Date.now() + 60_000) {
            const refreshed = await refreshGoogleToken(tokenObj);
            if (!refreshed) continue;
            accessToken = refreshed.accessToken;
          }
          const accountEmail = tokenObj.accountEmail || '';

          const emails = await getEmailsSince(sinceMs, accessToken);
          if (emails.length === 0) continue;

          console.log(`[EmailAlert] ${emails.length} new email(s) for user ${link.userId} (${accountEmail}), classifying...`);

          const filteredEmails: typeof emails = [];
          const autoSurfaced: { email: typeof emails[0]; ruleId?: string; reason: string }[] = [];

          for (const email of emails) {
            const result = matchItemAgainstRules(
              {
                sourceType: "email",
                sourceId: email.messageId || "",
                sender: email.from,
                subject: email.subject,
                snippet: email.snippet,
              },
              userRules
            );
            if (result.verdict === "suppress") {
              console.log(`[EmailAlert] Suppressed "${email.subject}" by rule ${result.matchedRuleId}`);
              continue;
            }
            if (result.verdict === "surface") {
              autoSurfaced.push({ email, ruleId: result.matchedRuleId, reason: "Matched your surface rule" });
              continue;
            }
            filteredEmails.push(email);
          }

          for (const { email, ruleId, reason } of autoSurfaced) {
            if (email.messageId && await gmailMessageIdExistsForUser(link.userId, email.messageId)) continue;
            const suggestedActions = email.messageId
              ? [
                  { label: "Archive", actionType: "archive" },
                  { label: "Star", actionType: "mark_important" },
                  { label: "Save as Task", actionType: "save_as_task" },
                  { label: "Dismiss", actionType: "dismiss" },
                ]
              : [
                  { label: "Save as Task", actionType: "save_as_task" },
                  { label: "Dismiss", actionType: "dismiss" },
                ];
            try {
              await db.insert(schema.inboxItems).values({
                userId: link.userId,
                sourceType: "email",
                sourceId: buildGmailSourceId(accountEmail, email.messageId, { subject: email.subject, from: email.from || '', receivedAt: email.receivedAt || 0 }),
                subject: email.subject,
                sender: email.from,
                snippet: email.snippet,
                jarvisReason: reason,
                suggestedActions,
                matchedRuleId: ruleId || null,
              }).onConflictDoNothing();
            } catch (err) {
              console.error("[EmailAlert] inbox_items insert failed:", err);
            }
            const senderName = email.from.replace(/<.*>/, '').trim() || email.from;
            const msg = `📧 Surfaced for you:\nFrom: ${senderName}\n"${email.subject}"\n\n${email.snippet.slice(0, 150)}${email.snippet.length > 150 ? '...' : ''}\n\nJarvis: ${reason}`;
            await notifyUser(link.userId, "email_alert", msg);
            logInteraction(link.userId, "notification", "outbound", msg, "email_surfaced").catch(() => {});
          }

          if (filteredEmails.length === 0) continue;

          const emailList = filteredEmails.map((e, i) =>
            `${i}. From: ${e.from}\n   Subject: "${e.subject}"\n   Preview: ${e.snippet}`
          ).join('\n\n');

          let flagged: { index: number; reason: string }[] = [];
          try {
            const classification = await openai.chat.completions.create({
              model: 'gpt-4o-mini',
              messages: [
                {
                  role: 'system',
                  content: `You review emails and decide which need IMMEDIATE user attention. Alert = true ONLY for:
- Urgent reply needed from a real person they know
- Deadline TODAY or TOMORROW explicitly mentioned
- Meeting cancelled, moved, or significantly changed
- Time-sensitive action required today
- Important client/boss/colleague needing a response soon

Alert = false for:
- Newsletters, marketing, promotions, sales
- Automated notifications, receipts, shipping updates
- Social media notifications
- No-reply or automated senders
- General FYI or informational emails

Return ONLY a JSON array of flagged emails (only include alert=true ones):
[{"index": 0, "reason": "brief reason why this is urgent"}]
Return [] if nothing is urgent.`,
                },
                {
                  role: 'user',
                  content: `Emails received in the last 30 minutes:\n\n${emailList}`,
                },
              ],
              max_completion_tokens: 2000,
            });

            const raw = classification.choices[0]?.message?.content || '[]';
            const jsonMatch = raw.match(/\[[\s\S]*\]/);
            if (jsonMatch) flagged = JSON.parse(jsonMatch[0]);
          } catch (err) {
            console.error('[EmailAlert] Classification failed:', err);
            continue;
          }

          for (const flag of flagged) {
            const email = filteredEmails[flag.index];
            if (!email) continue;
            if (email.messageId && await gmailMessageIdExistsForUser(link.userId, email.messageId)) continue;
            const senderName = email.from.replace(/<.*>/, '').trim() || email.from;

            const suggestedActions = email.messageId
              ? [
                  { label: "Archive", actionType: "archive" },
                  { label: "Save as Task", actionType: "save_as_task" },
                  { label: "Dismiss", actionType: "dismiss" },
                ]
              : [
                  { label: "Save as Task", actionType: "save_as_task" },
                  { label: "Dismiss", actionType: "dismiss" },
                ];
            try {
              await db.insert(schema.inboxItems).values({
                userId: link.userId,
                sourceType: "email",
                sourceId: buildGmailSourceId(accountEmail, email.messageId, { subject: email.subject, from: email.from || '', receivedAt: email.receivedAt || 0 }),
                subject: email.subject,
                sender: email.from,
                snippet: email.snippet,
                jarvisReason: flag.reason,
                suggestedActions,
              }).onConflictDoNothing();
            } catch (err) {
              console.error("[EmailAlert] inbox_items insert failed:", err);
            }

            const msg = `📧 Email needs your attention:\nFrom: ${senderName}\n"${email.subject}"\n\n${email.snippet.slice(0, 150)}${email.snippet.length > 150 ? '...' : ''}\n\nJarvis: ${flag.reason}`;
            await notifyUser(link.userId, "email_alert", msg);
            logInteraction(link.userId, "notification", "outbound", msg, "email_alert").catch(() => {});
            console.log(`[EmailAlert] Alerted user ${link.userId}: "${email.subject}"`);
          }
        }
      }
    } catch (err) {
      console.error('[EmailAlert] Scanner error:', err);
    }
  };

  setInterval(runScan, SCAN_INTERVAL_MS);
  console.log('Email alert scanner started (30-min interval)');
}

export async function startGithubCiAlertScanner(): Promise<void> {
  const SCAN_INTERVAL_MS = 30 * 60 * 1000;

  const runScan = async () => {
    try {
      const allPrefs = await db.select().from(schema.userPreferences);
      for (const prefRow of allPrefs) {
        const prefs = (prefRow.data as Record<string, unknown>) || {};
        const pat = prefs.github_pat as string | undefined;
        const repos = (prefs.github_repos as string[]) || [];
        if (!pat || repos.length === 0) continue;

        try {
          const { listOpenPRs } = await import("./integrations/github");
          const prs = await listOpenPRs(pat, repos);
          const prevState = (prefs.github_pr_ci_state as Record<string, string>) || {};
          const newState: Record<string, string> = {};
          const redAlerts: string[] = [];

          for (const pr of prs) {
            const key = `${pr.repo}#${pr.number}`;
            newState[key] = pr.ciStatus;
            if (prevState[key] === "pass" && pr.ciStatus === "fail") {
              redAlerts.push(`❌ CI went red on PR #${pr.number} in ${pr.repo}: "${pr.title}"\n${pr.url}`);
            }
          }

          const updatedPrefs = { ...prefs, github_pr_ci_state: newState };
          await db
            .insert(schema.userPreferences)
            .values({ userId: prefRow.userId, data: updatedPrefs })
            .onConflictDoUpdate({
              target: schema.userPreferences.userId,
              set: { data: updatedPrefs, updatedAt: new Date() },
            });

          for (const alert of redAlerts) {
            const msg = `🚨 *CI Alert* — a PR that was passing is now failing:\n\n${alert}`;
            await notifyUser(prefRow.userId, "github_ci_alert", msg);
            console.log(`[GitHubCI] Sent CI red alert to user ${prefRow.userId}`);
          }
        } catch (err) {
          console.warn(`[GitHubCI] Scan failed for user ${prefRow.userId}:`, err);
        }
      }
    } catch (err) {
      console.error("[GitHubCI] Scanner error:", err);
    }
  };

  setTimeout(runScan, 60 * 1000);
  setInterval(runScan, SCAN_INTERVAL_MS);
  console.log("GitHub CI alert scanner started (30-min interval)");
}
