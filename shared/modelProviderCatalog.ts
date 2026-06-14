export type ProviderCredentialKind = "api_key" | "oauth" | "local";
export type ModelProviderId = "openai" | "anthropic" | "google" | "local-llama";
export type ModelCategory = "chat" | "planning" | "memory" | "research" | "orchestrator";

export interface CatalogModelOption {
  value: string;
  label: string;
  description: string;
  provider: ModelProviderId;
  categories: ModelCategory[];
}

export interface CatalogProvider {
  id: ModelProviderId;
  label: string;
  shortLabel: string;
  description: string;
  credentialKinds: ProviderCredentialKind[];
  apiKeyPlaceholder?: string;
  setupHint: string;
}

export const CODEX_OAUTH_MODEL = "chatgpt-codex-oauth/auto";

export const MODEL_CATEGORIES: Array<{ key: ModelCategory; label: string; description: string }> = [
  { key: "chat", label: "Chat", description: "Everyday Jarvis replies and agent turns." },
  { key: "planning", label: "Planning", description: "Plans, schedules, decomposition, and prioritization." },
  { key: "memory", label: "Memory", description: "Recall, summaries, and memory maintenance." },
  { key: "research", label: "Research", description: "Research, synthesis, and evidence gathering." },
  { key: "orchestrator", label: "Orchestrator", description: "Primary runtime coordination and verification." },
];

export const MODEL_PROVIDER_CATALOG: CatalogProvider[] = [
  {
    id: "openai",
    label: "OpenAI / ChatGPT",
    shortLabel: "OpenAI",
    description: "Use a ChatGPT subscription through Codex OAuth or an OpenAI API key.",
    credentialKinds: ["oauth", "api_key"],
    apiKeyPlaceholder: "OPENAI_API_KEY",
    setupHint: "Connect ChatGPT Subscription for Codex OAuth, or save an OpenAI API key.",
  },
  {
    id: "anthropic",
    label: "Anthropic Claude",
    shortLabel: "Claude",
    description: "Use Claude models with an Anthropic API key.",
    credentialKinds: ["api_key"],
    apiKeyPlaceholder: "ANTHROPIC_API_KEY",
    setupHint: "Paste an Anthropic API key, then choose a Claude model below.",
  },
  {
    id: "google",
    label: "Google Gemini",
    shortLabel: "Gemini",
    description: "Use Gemini models with a Google AI Studio API key.",
    credentialKinds: ["api_key"],
    apiKeyPlaceholder: "GEMINI_API_KEY",
    setupHint: "Paste a Google Gemini API key, then choose a Gemini model below.",
  },
  {
    id: "local-llama",
    label: "Local Llama",
    shortLabel: "Local",
    description: "Use a local OpenAI-compatible runtime such as Ollama, LM Studio, vLLM, or the Jarvis model relay.",
    credentialKinds: ["local", "api_key"],
    apiKeyPlaceholder: "Optional local runtime API key",
    setupHint: "Run a local OpenAI-compatible server, then choose Local Llama below.",
  },
];

const ALL_CATEGORIES: ModelCategory[] = ["chat", "planning", "memory", "research", "orchestrator"];

export const MODEL_OPTIONS: CatalogModelOption[] = [
  {
    value: CODEX_OAUTH_MODEL,
    label: "ChatGPT Subscription",
    description: "Jarvis primary route through the ChatGPT/Codex OAuth login.",
    provider: "openai",
    categories: ALL_CATEGORIES,
  },
  {
    value: "openai/gpt-4.1-mini",
    label: "GPT-4.1 mini",
    description: "Fast OpenAI API-key model for everyday chat and planning.",
    provider: "openai",
    categories: ALL_CATEGORIES,
  },
  {
    value: "openai/gpt-4.1",
    label: "GPT-4.1",
    description: "Stronger OpenAI API-key model for harder reasoning.",
    provider: "openai",
    categories: ALL_CATEGORIES,
  },
  {
    value: "anthropic/claude-sonnet-4-5",
    label: "Claude Sonnet 4.5",
    description: "Claude model for balanced reasoning, coding, and writing.",
    provider: "anthropic",
    categories: ALL_CATEGORIES,
  },
  {
    value: "anthropic/claude-opus-4-1",
    label: "Claude Opus 4.1",
    description: "Claude model for heavyweight planning and research.",
    provider: "anthropic",
    categories: ALL_CATEGORIES,
  },
  {
    value: "google/gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    description: "Fast Gemini model for quick chat and research passes.",
    provider: "google",
    categories: ALL_CATEGORIES,
  },
  {
    value: "google/gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    description: "Gemini model for deeper research and reasoning.",
    provider: "google",
    categories: ALL_CATEGORIES,
  },
  {
    value: "openai-compatible/llama-local",
    label: "Local Llama",
    description: "Local OpenAI-compatible model through Ollama, LM Studio, vLLM, or Jarvis model relay.",
    provider: "local-llama",
    categories: ALL_CATEGORIES,
  },
  {
    value: "modelrelay/auto-fastest",
    label: "Jarvis Model Relay",
    description: "Use the fastest available local model relay route.",
    provider: "local-llama",
    categories: ALL_CATEGORIES,
  },
];

export const MODEL_DEFAULTS: Record<ModelCategory, string> = {
  chat: CODEX_OAUTH_MODEL,
  planning: CODEX_OAUTH_MODEL,
  memory: CODEX_OAUTH_MODEL,
  research: CODEX_OAUTH_MODEL,
  orchestrator: CODEX_OAUTH_MODEL,
};

export function getModelProvider(providerId: string): CatalogProvider | null {
  return MODEL_PROVIDER_CATALOG.find((provider) => provider.id === providerId) ?? null;
}

export function isSupportedModelProvider(providerId: string): providerId is ModelProviderId {
  return !!getModelProvider(providerId);
}

export function getModelsForCategory(category: ModelCategory): CatalogModelOption[] {
  return MODEL_OPTIONS.filter((model) => model.categories.includes(category));
}

export function isValidModelForCategory(value: unknown, category: ModelCategory): boolean {
  return typeof value === "string" && getModelsForCategory(category).some((model) => model.value === value);
}
