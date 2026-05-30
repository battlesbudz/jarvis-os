import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const DEFAULT_BASE_URL = "https://gameplanjarvisai.up.railway.app";

function argEnabled(name) {
  return process.argv.includes(name);
}

function header(title) {
  console.log(`\n== ${title} ==`);
}

function requireAuthToken() {
  const token = process.env.JARVIS_QA_AUTH_TOKEN || process.env.JARVIS_AUTH_TOKEN;
  if (!token) {
    console.error("Missing JARVIS_QA_AUTH_TOKEN.");
    console.error("Log in to production, copy an owner QA bearer token, then rerun without the Bearer prefix.");
    process.exitCode = 1;
    return null;
  }
  return token;
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    // Keep plain text bodies intact for diagnostics.
  }
  return { status: response.status, ok: response.ok, body };
}

function printManualChecklist(baseUrl) {
  header("Manual Chrome checklist");
  console.log(`1. Open Chrome to ${baseUrl}.`);
  console.log("2. Log in as the owner account and open Profile or Settings.");
  console.log("3. Confirm Connected Accounts shows Composio, not One, and missing setup names COMPOSIO_API_KEY.");
  console.log("4. Click Gmail connect link, complete OAuth, and return through /api/connections/composio/callback with status=success.");
  console.log("5. Repeat the connect-link flow for Google Calendar.");
  console.log("6. Run Test Connection and confirm Gmail and Google Calendar accounts are ACTIVE.");
  console.log("7. Ask Jarvis to read recent Gmail. Confirm he uses Composio connected-account tools and does not request approval.");
  console.log("8. Ask Jarvis to draft/send or delete email. Confirm the first attempt is blocked behind approval.");
  console.log("9. Approve only a harmless draft action, then confirm the approved Composio execution completes.");
  console.log("10. Ask Jarvis to read tomorrow's calendar. Confirm Composio tools are selected.");
  console.log("11. Ask Jarvis to create or edit a calendar event. Confirm write execution is blocked until approval.");
  console.log("12. If a Composio-backed job fails, use the job detail retry control and verify the retry keeps the approval requirement.");
  console.log("13. Open Memory Review and confirm no unapproved Composio action details were written as durable memory.");
  console.log("14. Disconnect the test Gmail/Calendar accounts from Connected Accounts and confirm status updates.");
  console.log("15. Check Railway logs for COMPOSIO_API_KEY, callback, approval, execution, and retry errors.");
}

async function runEndpointSmoke(baseUrl, token) {
  const auth = { Authorization: `Bearer ${token}` };
  const results = [];

  results.push(["status", await request(baseUrl, "/api/connections/status", { headers: auth })]);
  results.push(["test", await request(baseUrl, "/api/connections/test", { method: "POST", headers: auth, body: "{}" })]);

  if (argEnabled("--include-connect-link")) {
    results.push([
      "gmail.connect-link",
      await request(baseUrl, "/api/connections/connect-link", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ platform: "gmail" }),
      }),
    ]);
    results.push([
      "calendar.connect-link",
      await request(baseUrl, "/api/connections/connect-link", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ platform: "google-calendar" }),
      }),
    ]);
  }

  header("Endpoint smoke results");
  let failures = 0;
  for (const [name, result] of results) {
    const ready = result.ok ? "PASS" : "FAIL";
    if (!result.ok) failures += 1;
    console.log(`${ready} ${name}: HTTP ${result.status}`);
    if (!result.ok || argEnabled("--verbose")) {
      console.log(JSON.stringify(result.body, null, 2));
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
  }
}

function openChrome(baseUrl) {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];
  const chromePath = candidates.find((candidate) => {
    try {
      return existsSync(candidate);
    } catch {
      return false;
    }
  });
  if (!chromePath) {
    console.warn("Chrome executable not found in the standard Windows locations.");
    return;
  }
  spawn(chromePath, [baseUrl], { detached: true, stdio: "ignore", windowsHide: false }).unref();
}

async function main() {
  const baseUrl = process.env.JARVIS_QA_BASE_URL || DEFAULT_BASE_URL;

  header("Composio production smoke");
  console.log(`Base URL: ${baseUrl}`);
  console.log(`COMPOSIO_API_KEY present locally: ${process.env.COMPOSIO_API_KEY ? "yes" : "no"}`);

  printManualChecklist(baseUrl);

  if (argEnabled("--open-chrome")) {
    openChrome(baseUrl);
  }

  if (argEnabled("--manual-only")) {
    return;
  }

  const token = requireAuthToken();
  if (!token) return;
  await runEndpointSmoke(baseUrl, token);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
