import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const template = readFileSync(resolve(process.cwd(), "server", "templates", "chat.html"), "utf8");
const settingsScreen = readFileSync(resolve(process.cwd(), "app", "(tabs)", "settings.tsx"), "utf8");

assert.match(template, /id="setup-btn"/);
assert.match(template, /Open model and provider setup/);
assert.match(template, /class="icon-btn setup-header-btn"/);
assert.match(template, /<span class="setup-btn-label">Models<\/span>/);
assert.match(template, /id="empty-setup-btn"/);
assert.match(template, /Models and keys/);
assert.match(template, /id="setup-sheet-overlay"/);
assert.match(template, /AI models/);
assert.match(template, /Provider access/);

assert.match(template, /Connect ChatGPT Subscription/);
assert.match(template, /Use OpenAI API Key/);
assert.match(template, /Use Jarvis Default Model/);
assert.match(template, /Paste full callback URL/);
assert.match(template, /localhost error page/);
assert.match(template, /Open ChatGPT login/);
assert.match(template, /Anthropic Claude/);
assert.match(template, /Google Gemini/);
assert.match(template, /Local Llama/);
assert.match(template, /data-provider-action="save-key"/);

assert.match(template, /\/api\/settings\/models/);
assert.match(template, /\/api\/settings\/orchestrator/);
assert.match(template, /\/api\/auth\/providers\/status/);
assert.match(template, /\/api\/auth\/openai-oauth\/start/);
assert.match(template, /\/api\/auth\/openai-oauth\/callback-url/);
assert.match(template, /\/api\/auth\/openai-api-key/);
assert.match(template, /\/api\/auth\/model-provider-api-key/);
assert.match(template, /\/api\/auth\/providers\/openai/);
assert.match(template, /\/api\/auth\/providers\/\$\{encodeURIComponent\(provider\)\}/);

assert.match(template, /setupBtn\.addEventListener\('click', openSetupSheet\)/);
assert.match(template, /emptySetupBtn\.addEventListener\('click', openSetupSheet\)/);
assert.match(template, /restoredEmptySetupBtn\.addEventListener\('click', openSetupSheet\)/);
assert.match(template, /openAILoginLink\.style\.display\s*=\s*'flex'/);
assert.match(template, /openAILoginLink\.focus\(\)/);
assert.doesNotMatch(template, /window\.open\(data\.loginUrl/);
assert.match(template, /data\.requiresDesktopConnector/);
assert.match(template, /APP_AUTH_TOKEN_KEY = '@gameplan_auth_token'/);
assert.match(template, /APP_AUTH_BRIDGE_KEY = 'jarvis_web_app_auth_bridge'/);
assert.match(template, /bridgeWebchatAuthToAppStorage\(\)/);
assert.match(template, /previousToken/);
assert.match(template, /restoreBridgedAppAuthStorage\(\)/);
assert.match(template, /localStorage\.removeItem\(APP_AUTH_BRIDGE_KEY\)/);
assert.doesNotMatch(template, /function signOut\(\)[\s\S]*localStorage\.removeItem\(APP_AUTH_TOKEN_KEY\)[\s\S]*showAuth\(\)/);
assert.match(template, /window\.location\.assign\(setupPath\)/);
assert.match(template, /setupBtn\.style\.display\s*=\s*'none'/);
assert.match(template, /setupBtn\.style\.display\s*=\s*'flex'/);
assert.match(template, /emptySetupBtn\.style\.display\s*=\s*'none'/);
assert.match(template, /emptySetupBtn\.style\.display\s*=\s*'inline-flex'/);
assert.match(template, /Provider setup is only available to the Jarvis owner/);

assert.match(settingsScreen, /setOpenAILoginUrl\(data\.loginUrl\)/);
assert.match(settingsScreen, /Platform\.OS !== 'web'[\s\S]*openHostedConnectionLink\(data\.loginUrl\)/);
assert.match(settingsScreen, /openOpenAILoginUrl/);
assert.match(settingsScreen, /window\.open\(openAILoginUrl, '_blank', 'noopener,noreferrer'\)/);
assert.doesNotMatch(settingsScreen, /window\.location\.assign\(openAILoginUrl\)/);
assert.match(settingsScreen, /data\.requiresDesktopConnector === true/);
assert.match(settingsScreen, /router\.push\(setupPath as Href\)/);
assert.match(settingsScreen, /Open login URL/);
assert.match(settingsScreen, /Copy login URL/);

console.log("OK: webchat exposes owner-only model and OpenAI provider setup controls");
