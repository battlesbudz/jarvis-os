/**
 * Voice Relay — WebSocket proxy between the mobile app and OpenAI Realtime API.
 *
 * Architecture:
 *   Mobile app → wss://<server>/api/voice/ws?ticket=<one-time-ticket>
 *   Server     → wss://api.openai.com/v1/realtime (with real API key)
 *
 * Auth: client first calls POST /api/voice/relay-ticket (JWT auth) to get a
 * short-lived, single-use relay ticket. The ticket (not the JWT) is passed in
 * the WebSocket URL, limiting bearer-token exposure in server logs/proxies.
 *
 * Sequencing guarantee: client messages are buffered until the session.update
 * persona injection is fully sent to OpenAI, so Jarvis persona is always active
 * before any user audio arrives.
 */

import type { Server as HttpServer, IncomingMessage } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { randomBytes } from "crypto";
import { db } from "./db";
import { and, eq, desc, sql } from "drizzle-orm";
import { userMemories } from "@shared/schema";
import { readWorkspaceFile } from "./workspace/loader";
import { containsRawRestrictedContent } from "./memory/restrictedContent";

// ── One-time relay ticket store ───────────────────────────────────────────────

interface RelayTicket {
  userId: string;
  expiresAt: number;
  used: boolean;
}

const ticketStore = new Map<string, RelayTicket>();
const TICKET_TTL_MS = 30_000;
const RESTRICTED_MEMORY_SOURCE_SQL_PATTERN = "%(plaid|bank|banking|financial|transaction|credit_card|credit card|debit_card|debit card|tax_document|tax document|payroll|brokerage|account_balance|account balance|restricted_source|restricted summary|restricted_summary)%";

export function createRelayTicket(userId: string): string {
  const ticket = randomBytes(24).toString("hex");
  ticketStore.set(ticket, {
    userId,
    expiresAt: Date.now() + TICKET_TTL_MS,
    used: false,
  });
  // Periodic cleanup of expired tickets
  for (const [k, v] of ticketStore) {
    if (v.expiresAt < Date.now()) ticketStore.delete(k);
  }
  return ticket;
}

function consumeTicket(ticket: string): string | null {
  const entry = ticketStore.get(ticket);
  if (!entry) return null;
  if (entry.used) return null;
  if (entry.expiresAt < Date.now()) {
    ticketStore.delete(ticket);
    return null;
  }
  entry.used = true;
  // Delay deletion to avoid race on rapid reconnect
  setTimeout(() => ticketStore.delete(ticket), 5000);
  return entry.userId;
}

// ── Persona builder ────────────────────────────────────────────────────────────

async function loadSoulContent(): Promise<string> {
  try {
    const raw = await readWorkspaceFile("soul");
    // Strip comment-only stub lines
    const lines = raw.split("\n").filter(l => {
      const t = l.trim();
      return t && !t.startsWith("<!--") && !t.startsWith("#");
    });
    return lines.join("\n").trim();
  } catch {
    return "";
  }
}

async function loadMemoryMd(maxLines = 50): Promise<string> {
  try {
    const raw = await readWorkspaceFile("memory");
    const lines = raw.split("\n").filter(l => {
      const t = l.trim();
      return t && !t.startsWith("<!--") && !t.startsWith("#");
    });
    return lines.slice(0, maxLines).join("\n").trim();
  } catch {
    return "";
  }
}

async function loadUserMemories(userId: string, maxLines = 50): Promise<string> {
  try {
    const rows = await db
      .select({
        content: userMemories.content,
        category: userMemories.category,
        confidence: userMemories.confidence,
      })
      .from(userMemories)
      .where(and(
        eq(userMemories.userId, userId),
        eq(userMemories.pendingReview, false),
        sql`${userMemories.reviewStatus} IN ('active', 'kept', 'edited')`,
        sql`COALESCE(${userMemories.sensitivity}, 'normal') = 'normal'`,
        sql`LOWER(COALESCE(${userMemories.sourceType}, '')) NOT SIMILAR TO ${RESTRICTED_MEMORY_SOURCE_SQL_PATTERN}`,
        sql`LOWER(COALESCE(${userMemories.sourceRef}, '')) NOT SIMILAR TO ${RESTRICTED_MEMORY_SOURCE_SQL_PATTERN}`,
      ))
      .orderBy(desc(userMemories.confidence))
      .limit(30);

    const visibleRows = rows.filter((row) => !containsRawRestrictedContent(row.content ?? ""));
    if (!visibleRows.length) return "";

    const lines: string[] = [];
    for (const row of visibleRows) {
      if (lines.length >= maxLines) break;
      lines.push(`[${row.category ?? "general"}] ${row.content}`);
    }
    return lines.join("\n");
  } catch {
    return "";
  }
}

export async function buildJarvisInstructions(userId: string): Promise<string> {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  const [soulContent, memoryMd, memoryContext] = await Promise.all([
    loadSoulContent(),
    loadMemoryMd(50),
    loadUserMemories(userId, 50),
  ]);

  const base = `You are Jarvis — a highly capable, proactive AI chief-of-staff.

You are speaking in a real-time voice conversation. Your responses should be:
- Natural and conversational — spoken language, not written text
- Concise but complete — never truncate an answer mid-thought
- Warm but direct — you are an intelligent partner, not a servant
- Free of markdown (no bullet points, no asterisks, no headers) — speak in flowing sentences

You have a distinct personality:
- Confident and decisive — you make recommendations, not just lists of options
- Proactively helpful — you anticipate what the user needs
- Intellectually engaged — you think out loud when reasoning
- Occasionally dry humour — tasteful, never forced

Current date: ${dateStr}
Current time: ${timeStr}

Available tools you can call:
- get_today_summary: Retrieve the user's tasks and scheduled items for today
- search_memories: Search the user's personal memory and knowledge base

When the user asks about their schedule, tasks, or anything personal — use a tool. Do not guess.${soulContent ? `\n\n## Standing character instructions (from SOUL.md)\n${soulContent}` : ""}${memoryMd ? `\n\n## Hot memory (MEMORY.md — standing context about this user)\n${memoryMd}` : ""}${memoryContext ? `\n\n## What Jarvis knows about this user (top memories from knowledge base)\n${memoryContext}` : ""}`;

  return base;
}

// ── Relay WebSocket server ────────────────────────────────────────────────────

export function registerVoiceRelay(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "", "http://localhost");
    if (!url.pathname.startsWith("/api/voice/ws")) return;

    const ticket = url.searchParams.get("ticket") || "";
    const userId = consumeTicket(ticket);
    if (!userId) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (clientWs) => {
      wss.emit("connection", clientWs, req, userId);
    });
  });

  wss.on("connection", async (clientWs: WebSocket, _req: IncomingMessage, userId: string) => {
    console.log(`[voice-relay] client connected userId=${userId}`);

    const openaiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    if (!openaiKey) {
      console.error("[voice-relay] No OpenAI API key — closing connection");
      clientWs.close(1011, "Server misconfiguration: missing API key");
      return;
    }

    const model = "gpt-4o-realtime-preview-2024-12-17";
    const openaiWs = new WebSocket(
      `wss://api.openai.com/v1/realtime?model=${model}`,
      {
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          "OpenAI-Beta": "realtime=v1",
        },
      }
    );

    // Buffer client messages until session.update is fully sent
    const clientMessageQueue: string[] = [];
    let sessionReady = false;

    const flushQueue = () => {
      sessionReady = true;
      for (const msg of clientMessageQueue) {
        if (openaiWs.readyState === WebSocket.OPEN) {
          try { openaiWs.send(msg); } catch { /* noop */ }
        }
      }
      clientMessageQueue.length = 0;
    };

    openaiWs.on("open", async () => {
      console.log(`[voice-relay] OpenAI connection open for userId=${userId}`);
      try {
        const instructions = await buildJarvisInstructions(userId);
        const sessionUpdate = {
          type: "session.update",
          session: {
            instructions,
            voice: "verse",
            modalities: ["text", "audio"],
            input_audio_format: "pcm16",
            output_audio_format: "pcm16",
            input_audio_transcription: { model: "whisper-1" },
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 500,
            },
            tools: [
              {
                type: "function",
                name: "get_today_summary",
                description: "Get the user's tasks and upcoming scheduled items for today",
                parameters: { type: "object", properties: {} },
              },
              {
                type: "function",
                name: "search_memories",
                description: "Search the user's personal memories and knowledge base",
                parameters: {
                  type: "object",
                  properties: {
                    query: { type: "string", description: "The search query" },
                  },
                  required: ["query"],
                },
              },
            ],
            tool_choice: "auto",
          },
        };
        openaiWs.send(JSON.stringify(sessionUpdate));
        console.log(`[voice-relay] session.update sent for userId=${userId}`);
        // Flush buffered client messages now that persona is applied
        flushQueue();
      } catch (err) {
        console.error("[voice-relay] Failed to configure session:", err);
        // Even on error, flush so the call isn't permanently stuck
        flushQueue();
      }
    });

    openaiWs.on("message", (data) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        try {
          clientWs.send(data.toString());
        } catch (err) {
          console.error("[voice-relay] Failed to forward OpenAI→client:", err);
        }
      }
    });

    openaiWs.on("error", (err) => {
      console.error("[voice-relay] OpenAI WebSocket error:", err);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close(1011, "OpenAI connection error");
      }
    });

    openaiWs.on("close", (code, reason) => {
      console.log(`[voice-relay] OpenAI WS closed code=${code} reason=${reason?.toString()}`);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close(code || 1000, reason?.toString() || "");
      }
    });

    clientWs.on("message", (data) => {
      if (!sessionReady) {
        // Buffer until persona is sent — cap at 50 messages (~5s at 100ms chunks)
        if (clientMessageQueue.length < 50) {
          clientMessageQueue.push(data.toString());
        }
        return;
      }
      if (openaiWs.readyState === WebSocket.OPEN) {
        try {
          openaiWs.send(data.toString());
        } catch (err) {
          console.error("[voice-relay] Failed to forward client→OpenAI:", err);
        }
      }
    });

    clientWs.on("close", (code, reason) => {
      console.log(`[voice-relay] client WS closed code=${code} userId=${userId}`);
      if (openaiWs.readyState === WebSocket.OPEN || openaiWs.readyState === WebSocket.CONNECTING) {
        openaiWs.close(1000, reason?.toString() || "");
      }
    });

    clientWs.on("error", (err) => {
      console.error("[voice-relay] Client WebSocket error:", err);
      if (openaiWs.readyState === WebSocket.OPEN) {
        openaiWs.close(1000, "");
      }
    });

    const keepalive = setInterval(() => {
      if (openaiWs.readyState === WebSocket.OPEN) {
        try { openaiWs.ping(); } catch { /* noop */ }
      } else {
        clearInterval(keepalive);
      }
    }, 20000);

    clientWs.on("close", () => clearInterval(keepalive));
  });

  console.log("[voice-relay] WebSocket relay mounted at /api/voice/ws");
}
