#!/usr/bin/env node

const DEFAULT_BASE_URL = "https://gameplanjarvisai.up.railway.app";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const baseUrl = (process.env.JARVIS_QA_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
const token = process.env.JARVIS_QA_AUTH_TOKEN || "";
const titleMarker = process.env.JARVIS_QA_CLEANUP_TITLE || "Browser QA scheduled probe";
const deliverableTitle = process.env.JARVIS_QA_CLEANUP_DELIVERABLE_TITLE || "Browser QA Probe Deliverable";
const contentMarkers = (process.env.JARVIS_QA_CLEANUP_MARKERS || "Browser QA,QA_ENDPOINT_OK,QA_SEND_OK,QA_WEATHER_DONE")
  .split(",")
  .map((marker) => marker.trim())
  .filter(Boolean);

if (args.has("--help") || args.has("-h")) {
  console.log([
    "Usage: npm run jarvis:qa:cleanup -- [--apply]",
    "",
    "Dry-run is the default. With --apply, this script only uses existing",
    "owner-authenticated app APIs for targeted cleanup:",
    "  - DELETE /api/jarvis/scheduled-tasks/:id for exact title matches",
    "  - POST /api/deliverables/:id/discard for exact pending deliverable title matches",
    "  - DELETE /api/memories/:id for marker matches in memory content/category",
    "",
    "Chat-history artifacts are reported only because the app currently exposes",
    "whole-history JSON replacement/deletion, not a safe per-message delete API.",
  ].join("\n"));
  process.exit(0);
}

if (!token) {
  console.error("Missing JARVIS_QA_AUTH_TOKEN. Set it to an authenticated owner bearer token before cleanup.");
  process.exit(2);
}

function containsMarker(value) {
  if (value == null) return false;
  const text = String(value);
  return contentMarkers.some((marker) => text.includes(marker));
}

async function requestJson(path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text.slice(0, 500) };
  }
  if (!res.ok) {
    const message = payload?.error || payload?.raw || res.statusText;
    throw new Error(`${options.method || "GET"} ${path} failed with ${res.status}: ${message}`);
  }
  return payload;
}

function getChatMessages(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.messages)) return data.messages;
  return [];
}

async function main() {
  const [tasks, deliverables, memoryPayload, chatHistory] = await Promise.all([
    requestJson("/api/jarvis/scheduled-tasks"),
    requestJson("/api/deliverables"),
    requestJson("/api/memories"),
    requestJson("/api/data/chat-history"),
  ]);

  const matchingTasks = (Array.isArray(tasks) ? tasks : [])
    .filter((task) => task?.title === titleMarker);

  const matchingDeliverables = (Array.isArray(deliverables) ? deliverables : [])
    .filter((item) => item?.title === deliverableTitle && item?.status === "pending_approval");

  const matchingMemories = (Array.isArray(memoryPayload?.memories) ? memoryPayload.memories : [])
    .filter((memory) => containsMarker(memory?.content) || containsMarker(memory?.category) || containsMarker(memory?.sourceRef));

  const chatMatches = getChatMessages(chatHistory?.data)
    .filter((message) => containsMarker(message?.content) || containsMarker(message?.text));

  const summary = {
    baseUrl,
    mode: apply ? "apply" : "dry-run",
    markers: {
      scheduledTaskTitle: titleMarker,
      deliverableTitle,
      contentMarkers,
    },
    matches: {
      scheduledTasks: matchingTasks.map((task) => ({ id: task.id, title: task.title, scheduledAt: task.scheduledAt })),
      pendingDeliverables: matchingDeliverables.map((item) => ({ id: item.id, title: item.title, status: item.status, createdAt: item.createdAt })),
      memories: matchingMemories.map((memory) => ({ id: memory.id, category: memory.category, content: String(memory.content || "").slice(0, 140) })),
      chatHistoryMessages: chatMatches.length,
    },
  };

  console.log(JSON.stringify(summary, null, 2));

  if (!apply) {
    console.log("\nDry-run only. Re-run with --apply to delete/discard the targeted task, deliverable, and memory matches.");
    console.log("Chat-history matches are report-only; no chat history is changed by this script.");
    return;
  }

  const actions = [];
  for (const task of matchingTasks) {
    await requestJson(`/api/jarvis/scheduled-tasks/${encodeURIComponent(task.id)}`, { method: "DELETE" });
    actions.push({ type: "scheduled_task_deleted", id: task.id, title: task.title });
  }
  for (const item of matchingDeliverables) {
    await requestJson(`/api/deliverables/${encodeURIComponent(item.id)}/discard`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    actions.push({ type: "deliverable_discarded", id: item.id, title: item.title });
  }
  for (const memory of matchingMemories) {
    await requestJson(`/api/memories/${encodeURIComponent(memory.id)}`, { method: "DELETE" });
    actions.push({ type: "memory_deleted", id: memory.id });
  }

  console.log("\nApplied actions:");
  console.log(JSON.stringify(actions, null, 2));
  if (chatMatches.length > 0) {
    console.log(`\nReported ${chatMatches.length} chat-history match(es), but left chat history unchanged.`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
