/**
 * ContextRegistry - before_prompt_build hook system.
 *
 * Any module can register a context provider that contributes text to the
 * agent prompt before each model call. Providers run in descending priority
 * order and each has a 2-second timeout so a slow provider can never block
 * the whole turn.
 */

import fs from "fs/promises";
import path from "path";
import { BUDGET_PRESETS } from "../memory/contextBuilder";

export type ContextProviderInput = {
  userId: string;
  /** Normalised platform identifier, e.g. "discord", "telegram", "in_app". */
  platform: string;
  channelId?: string;
  agentId?: string;
  userMessage: string;
};

export type ContextProviderOutput = {
  /** Injected into the system prompt body. */
  systemContext?: string;
  /** Prepended before the user message string. */
  prependContext?: string;
  /** Appended after the user message string. */
  appendContext?: string;
};

export type ContextProvider = (
  input: ContextProviderInput,
) => Promise<ContextProviderOutput | void> | ContextProviderOutput | void;

const PROVIDER_TIMEOUT_MS = 2_000;

class ContextRegistry {
  private readonly providers: Array<{
    provider: ContextProvider;
    priority: number;
  }> = [];

  register(provider: ContextProvider, opts?: { priority?: number }): void {
    this.providers.push({ provider, priority: opts?.priority ?? 0 });
    this.providers.sort((a, b) => b.priority - a.priority);
  }

  async build(input: ContextProviderInput): Promise<{
    systemContext: string;
    prependContext: string;
    appendContext: string;
  }> {
    const parts = {
      systemContext: [] as string[],
      prependContext: [] as string[],
      appendContext: [] as string[],
    };

    for (const { provider } of this.providers) {
      try {
        const timeout = new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("context provider timeout")), PROVIDER_TIMEOUT_MS),
        );
        const result = await Promise.race([
          Promise.resolve(provider(input)),
          timeout,
        ]) as ContextProviderOutput | void;

        if (!result) continue;
        if (result.systemContext?.trim()) parts.systemContext.push(result.systemContext.trim());
        if (result.prependContext?.trim()) parts.prependContext.push(result.prependContext.trim());
        if (result.appendContext?.trim()) parts.appendContext.push(result.appendContext.trim());
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg !== "context provider timeout") {
          console.warn("[ContextRegistry] provider skipped due to error:", msg);
        }
      }
    }

    return {
      systemContext: parts.systemContext.join("\n\n"),
      prependContext: parts.prependContext.join("\n"),
      appendContext: parts.appendContext.join("\n"),
    };
  }
}

export const contextRegistry = new ContextRegistry();

type RouterSelection = {
  taskType: string;
  crewFile?: string;
  workspaceContext?: string;
  needsToolPolicy: boolean;
};

const REPO_ROOT = process.cwd();
const MAX_ROUTER_DOC_CHARS = BUDGET_PRESETS.agentTurn.routerDocs;
const MAX_CONTEXT_DOC_CHARS = 1_600;

async function readRepoDoc(relativePath: string, maxChars = MAX_CONTEXT_DOC_CHARS): Promise<string> {
  try {
    const fullPath = path.resolve(REPO_ROOT, relativePath);
    if (!fullPath.startsWith(REPO_ROOT)) return "";
    const content = await fs.readFile(fullPath, "utf-8");
    return content.trim().slice(0, maxChars);
  } catch {
    return "";
  }
}

function selectRouterContext(userMessage: string): RouterSelection {
  const msg = userMessage.toLowerCase();
  const needsToolPolicy = /\b(send|email|message|post|publish|calendar|schedule|delete|overwrite|remove|move|rename|deploy|push|commit|daemon|phone|android|desktop|file|edit|write|memory|purchase|buy|contract|legal|pay)\b/.test(msg);

  if (/\b(email|gmail|outlook|telegram|discord|slack|whatsapp|message|dm|reply|outreach|draft)\b/.test(msg)) {
    return { taskType: "communications", crewFile: "agents/crew/communications.md", workspaceContext: "workspaces/battles/business/CONTEXT.md", needsToolPolicy: true };
  }
  if (/\b(research|source|citation|cite|find out|look up|market|legal|cannabis|ai|compare|analysis)\b/.test(msg)) {
    return { taskType: "research", crewFile: "agents/crew/research.md", workspaceContext: "workspaces/battles/research/CONTEXT.md", needsToolPolicy };
  }
  if (/\b(plan|priority|priorities|schedule|calendar|goal|goals|task|tasks|today|week|roadmap|sequence)\b/.test(msg)) {
    return { taskType: "planning", crewFile: "agents/crew/planning.md", workspaceContext: "workspaces/battles/daily-command-center/CONTEXT.md", needsToolPolicy: true };
  }
  if (/\b(monitor|watch|alert|status|health|check|scan|anomaly|failing|offline|heartbeat)\b/.test(msg)) {
    return { taskType: "monitoring", crewFile: "agents/crew/monitoring.md", workspaceContext: "workspaces/battles/daily-command-center/CONTEXT.md", needsToolPolicy };
  }
  if (/\b(write|create|draft|script|content|brief|spec|build|output|presentation|document|asset|ui|screen|component)\b/.test(msg)) {
    const isProduction = /\b(production|brief|spec|build|output|animation|video)\b/.test(msg);
    return {
      taskType: "creation",
      crewFile: "agents/crew/creation.md",
      workspaceContext: isProduction ? "workspaces/battles/production/CONTEXT.md" : "workspaces/battles/content-studio/CONTEXT.md",
      needsToolPolicy,
    };
  }
  if (/\b(memory|remember|preference|personal|life|family|health|finance|decision|soul|context about me)\b/.test(msg)) {
    return { taskType: "memory", crewFile: "agents/crew/memory.md", workspaceContext: "workspaces/battles/personal-life/CONTEXT.md", needsToolPolicy };
  }
  if (/\b(code|repo|bug|fix|implement|typescript|server|app|component|auth|oauth|api|test|lint)\b/.test(msg)) {
    return { taskType: "code/app", crewFile: "agents/crew/creation.md", workspaceContext: "docs/workspace-map.md", needsToolPolicy: true };
  }
  return { taskType: "general", needsToolPolicy };
}

contextRegistry.register(
  async ({ userMessage }) => {
    const selection = selectRouterContext(userMessage);
    const [agentContext, routing, toolPolicy, crew, workspace] = await Promise.all([
      readRepoDoc("agents/CONTEXT.md", MAX_CONTEXT_DOC_CHARS),
      readRepoDoc("agents/ROUTING.md", MAX_ROUTER_DOC_CHARS),
      selection.needsToolPolicy ? readRepoDoc("agents/TOOL_POLICY.md", MAX_CONTEXT_DOC_CHARS) : Promise.resolve(""),
      selection.crewFile ? readRepoDoc(selection.crewFile, MAX_CONTEXT_DOC_CHARS) : Promise.resolve(""),
      selection.workspaceContext ? readRepoDoc(selection.workspaceContext, MAX_CONTEXT_DOC_CHARS) : Promise.resolve(""),
    ]);

    const sections = [
      `Task type: ${selection.taskType}`,
      `Loaded crew: ${selection.crewFile ?? "none"}`,
      `Loaded workspace: ${selection.workspaceContext ?? "none"}`,
      agentContext ? `### agents/CONTEXT.md\n${agentContext}` : "",
      routing ? `### agents/ROUTING.md\n${routing}` : "",
      toolPolicy ? `### agents/TOOL_POLICY.md\n${toolPolicy}` : "",
      crew ? `### ${selection.crewFile}\n${crew}` : "",
      workspace ? `### ${selection.workspaceContext}\n${workspace}` : "",
    ].filter(Boolean);

    if (sections.length <= 3) return;
    return {
      systemContext:
        "## Jarvis Workspace Router\n" +
        "Use this repo-backed router to decide what context to load, what to skip, which tools need approval, and where outputs belong.\n\n" +
        sections.join("\n\n"),
    };
  },
  { priority: 190 },
);

contextRegistry.register(
  () => ({
    systemContext: `Today is ${new Date().toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    })}.`,
  }),
  { priority: 200 },
);
