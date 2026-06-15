import process from "node:process";

const rawTarget = process.env.E2E_TARGET_URL || process.env.JARVIS_E2E_TARGET_URL || "";
const target = rawTarget.trim();

if (!target) {
  console.log("Skipping deployed E2E smoke: E2E_TARGET_URL is not set.");
  process.exit(0);
}

let baseUrl;
try {
  baseUrl = new URL(target);
} catch {
  console.error(`E2E_TARGET_URL is not a valid URL: ${target}`);
  process.exit(1);
}

async function fetchWithTimeout(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, redirect: "manual" });
  } finally {
    clearTimeout(timer);
  }
}

let response;
try {
  response = await fetchWithTimeout(baseUrl);
} catch (error) {
  console.error(`Deployed E2E smoke failed: ${baseUrl} could not be reached. ${error.message}`);
  process.exit(1);
}

const isSuccess = response.status >= 200 && response.status < 300;
const isRedirect = response.status >= 300 && response.status < 400;

if (!isSuccess && !isRedirect) {
  console.error(`Deployed E2E smoke failed: ${baseUrl} returned ${response.status}. Expected 2xx or redirect.`);
  process.exit(1);
}

console.log(`Deployed E2E smoke passed: ${baseUrl} returned ${response.status}.`);
