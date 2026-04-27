/**
 * Anthropic client — uses Replit's native Anthropic AI integration.
 * Env vars (AI_INTEGRATIONS_ANTHROPIC_API_KEY / AI_INTEGRATIONS_ANTHROPIC_BASE_URL)
 * are injected automatically; no personal API key is needed.
 */
import Anthropic from "@anthropic-ai/sdk";

export const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

export const ORCHESTRATOR_MODEL = "claude-opus-4-6";
export const ORCHESTRATOR_MAX_TOKENS = 8192;
