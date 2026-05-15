#!/usr/bin/env node

const DEFAULT_BASE_URL = "https://gameplanjarvisai.up.railway.app";

const baseUrl = (process.env.JARVIS_QA_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
const token = process.env.JARVIS_QA_AUTH_TOKEN || process.env.EXPO_PUBLIC_AUTH_TOKEN || "";
const runChat = process.env.JARVIS_QA_RUN_CHAT === "1";
const chatPrompt = process.env.JARVIS_QA_CHAT_PROMPT
  || "QA_ENDPOINT_OK: reply with exactly QA_ENDPOINT_OK and do not create tasks, jobs, memories, or deliverables.";

if (!token) {
  console.error("Missing JARVIS_QA_AUTH_TOKEN. Set it to a logged-in Jarvis bearer token before running endpoint QA.");
  process.exit(2);
}

const probes = [
  { name: "auth.me", method: "GET", path: "/api/auth/me" },
  { name: "doctor", method: "GET", path: "/api/doctor" },
  { name: "integrations.status", method: "GET", path: "/api/integrations/status" },
  { name: "calendar.status", method: "GET", path: "/api/calendar/status" },
  { name: "gmail.status", method: "GET", path: "/api/gmail/status" },
  { name: "discord.status", method: "GET", path: "/api/discord/status" },
  { name: "slack.status", method: "GET", path: "/api/slack/status" },
  { name: "provider.health", method: "GET", path: "/api/jarvis/provider-health", okStatuses: [200, 207] },
  { name: "usage.today", method: "GET", path: "/api/jarvis/model-usage?days=1" },
  { name: "scheduled.tasks", method: "GET", path: "/api/jarvis/scheduled-tasks" },
  { name: "inbox.items", method: "GET", path: "/api/inbox/items" },
  { name: "deliverables", method: "GET", path: "/api/deliverables" },
  { name: "agent.jobs", method: "GET", path: "/api/agent-jobs" },
  { name: "agent.jobs.active", method: "GET", path: "/api/agent-jobs/active" },
  { name: "agents", method: "GET", path: "/api/agents" },
  { name: "projects", method: "GET", path: "/api/projects" },
  { name: "memories", method: "GET", path: "/api/memories" },
  { name: "commitments", method: "GET", path: "/api/commitments" },
];

function summarizePayload(name, payload) {
  if (!payload || typeof payload !== "object") return undefined;
  if (name === "doctor" && payload.summary) {
    return `pass=${payload.summary.pass ?? "?"} warn=${payload.summary.warn ?? "?"} fail=${payload.summary.fail ?? "?"}`;
  }
  if (name === "provider.health") {
    const primary = payload.routeChains?.balanced?.[0];
    const codex = payload.codexGateway?.enabled ? "codex=enabled" : "codex=off";
    return `${payload.allOk ? "allOk" : "check"} ${codex}${primary ? ` primary=${primary.provider}/${primary.model}` : ""}`;
  }
  if (name === "usage.today" && payload.totals) {
    return `calls=${payload.totals.calls ?? 0} tokens=${payload.totals.totalTokens ?? 0}`;
  }
  if (name === "integrations.status") {
    const entries = Object.values(payload);
    const runnable = entries.filter((entry) => entry?.capabilityRunnable === true).length;
    const linkedBlocked = entries.filter((entry) => entry?.readiness === "linked_blocked").length;
    return `runnable=${runnable} linked_blocked=${linkedBlocked} total=${entries.length}`;
  }
  if (Array.isArray(payload)) return `items=${payload.length}`;
  if (Array.isArray(payload.items)) return `items=${payload.items.length}`;
  if (Array.isArray(payload.data)) return `items=${payload.data.length}`;
  if (Array.isArray(payload.results)) return `items=${payload.results.length}`;
  if (typeof payload.connected === "boolean") return `connected=${payload.connected}`;
  if (typeof payload.ok === "boolean") return `ok=${payload.ok}`;
  return undefined;
}

async function requestJson(probe) {
  const started = Date.now();
  const res = await fetch(`${baseUrl}${probe.path}`, {
    method: probe.method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text.slice(0, 500) };
  }
  const okStatuses = probe.okStatuses || [200];
  return {
    name: probe.name,
    path: probe.path,
    status: res.status,
    ok: okStatuses.includes(res.status),
    durationMs: Date.now() - started,
    summary: summarizePayload(probe.name, payload),
    payload,
  };
}

function parseSse(text) {
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const raw = line.slice(5).trim();
    if (!raw || raw === "[DONE]") continue;
    try {
      events.push(JSON.parse(raw));
    } catch {
      events.push({ raw });
    }
  }
  return events;
}

async function runChatProbe() {
  const started = Date.now();
  const res = await fetch(`${baseUrl}/api/coach/chat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      originChannel: "qa_endpoint_harness",
      messages: [{ role: "user", content: chatPrompt }],
      history: [],
      goals: [],
      stats: {},
    }),
  });
  const text = await res.text();
  const events = parseSse(text);
  const content = events
    .map((event) => event.content || event.text || "")
    .filter(Boolean)
    .join("");
  const job = events.find((event) => event.type === "background_job");
  return {
    name: "chat.basic",
    path: "/api/coach/chat",
    status: res.status,
    ok: res.ok && content.includes("QA_ENDPOINT_OK"),
    durationMs: Date.now() - started,
    summary: `content=${JSON.stringify(content.slice(0, 120))}${job ? ` job=${job.jobId}` : ""}`,
    payload: { events, content },
  };
}

const results = [];
for (const probe of probes) {
  try {
    results.push(await requestJson(probe));
  } catch (error) {
    results.push({
      name: probe.name,
      path: probe.path,
      status: 0,
      ok: false,
      durationMs: 0,
      summary: error instanceof Error ? error.message : String(error),
      payload: null,
    });
  }
}

if (runChat) {
  try {
    results.push(await runChatProbe());
  } catch (error) {
    results.push({
      name: "chat.basic",
      path: "/api/coach/chat",
      status: 0,
      ok: false,
      durationMs: 0,
      summary: error instanceof Error ? error.message : String(error),
      payload: null,
    });
  }
}

const failed = results.filter((result) => !result.ok);
for (const result of results) {
  const marker = result.ok ? "ok" : "FAIL";
  const detail = result.summary ? ` - ${result.summary}` : "";
  console.log(`${marker.padEnd(4)} ${result.name.padEnd(22)} ${String(result.status).padStart(3)} ${String(result.durationMs).padStart(5)}ms${detail}`);
}

console.log("");
console.log(JSON.stringify({
  baseUrl,
  checkedAt: new Date().toISOString(),
  runChat,
  passed: results.length - failed.length,
  failed: failed.length,
  results: results.map(({ payload, ...result }) => result),
}, null, 2));

process.exit(failed.length > 0 ? 1 : 0);
