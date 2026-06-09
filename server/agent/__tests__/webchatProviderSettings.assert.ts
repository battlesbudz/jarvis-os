import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const template = readFileSync(resolve(process.cwd(), "server", "templates", "chat.html"), "utf8");

assert.match(template, /id="setup-btn"/);
assert.match(template, /title="Model setup"/);
assert.match(template, /id="setup-sheet-overlay"/);
assert.match(template, /AI models/);
assert.match(template, /OpenAI authentication/);

assert.match(template, /Connect ChatGPT Subscription/);
assert.match(template, /Use OpenAI API Key/);
assert.match(template, /Use Jarvis Default Model/);
assert.match(template, /Paste full callback URL/);
assert.match(template, /localhost error page/);

assert.match(template, /\/api\/settings\/models/);
assert.match(template, /\/api\/settings\/orchestrator/);
assert.match(template, /\/api\/auth\/providers\/status/);
assert.match(template, /\/api\/auth\/openai-oauth\/start/);
assert.match(template, /\/api\/auth\/openai-oauth\/callback-url/);
assert.match(template, /\/api\/auth\/openai-api-key/);
assert.match(template, /\/api\/auth\/providers\/openai/);

assert.match(template, /setupBtn\.style\.display\s*=\s*'none'/);
assert.match(template, /setupBtn\.style\.display\s*=\s*'flex'/);
assert.match(template, /Provider setup is only available to the Jarvis owner/);

console.log("OK: webchat exposes owner-only model and OpenAI provider setup controls");
