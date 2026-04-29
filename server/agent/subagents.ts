import { runAgent } from "./harness";
import type { AgentTool, ToolContext } from "./types";
import { db } from "../db";
import * as schema from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import {
  webSearchTool,
  researchTopicTool,
  createDocumentTool,
  listDocumentsTool,
  readDocumentTool,
  fetchCalendarTool,
} from "./tools";

export type SubAgentType = "research" | "writing" | "planning" | "email";

export type DeliverableType = "research" | "document" | "plan" | "email_draft";

export interface SubAgentResult {
  type: DeliverableType;
  title: string;
  summary: string;
  body: string;
  meta: Record<string, unknown>;
  turns: number;
  toolCallsCount: number;
}

interface SubAgentSpec {
  systemPrompt: string;
  tools: (opts: { hasGoogle: boolean }) => AgentTool[];
  deliverableType: DeliverableType;
  maxTurns: number;
}

const SHARED_RULES = `Output rules:
- Be concrete and specific, never generic.
- No filler ("As an AI…", "I hope this helps…").
- No markdown headers above H2 (##). No bold/italic for decoration.
- Prefer facts from tool results you executed in this run. If searches fail or return nothing, synthesize from general knowledge and note clearly that live data was unavailable.`;

const SPECS: Record<SubAgentType, SubAgentSpec> = {
  research: {
    systemPrompt: `You are a Research sub-agent for Jarvis. The user has asked for a focused research brief; they will read it later and approve or discard it. They are NOT in this conversation.

IMPORTANT — search for exactly what you were asked: Use the product/project/company name given to you verbatim. Do not substitute a similar-sounding name from your own knowledge. If the name looks unusual or misspelled, still search it as-is — the entity pre-flight check in the coach layer has already verified with the user that this is the intended search term.

How you work:
1. CRITICAL: You MUST call research_topic or search_web at least once before writing ANY content — even if you believe the task is unexecutable, unclear, or outside your capabilities. No exceptions.
2. If the exact request cannot be fulfilled (e.g. you cannot perform an action directly), you MUST still search for alternative services, tools, or approaches and cite them. Never write "I'm unable to do X" without first searching for "how to X alternatives" or "X services" and listing what you found.
3. Stop researching once you have enough to answer concretely.
4. Produce a final response that IS the deliverable — markdown, ~250-600 words.

Structure your final markdown:
## TL;DR
2-3 bullet points.

## Findings
Numbered list, each finding with a 1-sentence "why it matters".

## Sources
Bullet list of the URLs you actually used. If ## Sources has no URLs it means you skipped searching — that is an error. Every research brief MUST include at least one real URL. If all searches returned nothing, write: "Searches performed: [list your exact queries] — no results returned."

ENFORCEMENT RULE: Any response that includes the phrase "I'm unable", "I cannot", "I can't", or "not possible" WITHOUT a ## Sources section containing at least one URL will be automatically rejected by the delivery pipeline. Always search first, then explain limitations.

${SHARED_RULES}`,
    tools: () => [webSearchTool, researchTopicTool],
    deliverableType: "research",
    maxTurns: 6,
  },
  writing: {
    systemPrompt: `You are a Writing sub-agent for Jarvis. The user has asked you to draft a longer-form document (memo, plan, note, post). They will review and approve.

How you work:
1. If the topic needs facts, call research_topic ONCE for context.
2. Optionally call list_documents / read_document if the user references existing notes.
3. Produce the final document as your last assistant message — that IS the deliverable.

The first line of your final reply MUST be: "# <document title>"
Keep length appropriate to the request (300-1200 words). Plain markdown only.

${SHARED_RULES}`,
    tools: () => [researchTopicTool, listDocumentsTool, readDocumentTool],
    deliverableType: "document",
    maxTurns: 5,
  },
  planning: {
    systemPrompt: `You are a Planning sub-agent for Jarvis. Decompose the user's request into a concrete, sequenced action plan they can execute.

How you work:
1. If you need outside facts, call research_topic at most ONCE.
2. Optionally call fetch_calendar to know their schedule.
3. Output the plan as your final assistant message.

Final markdown structure:
## Goal
One sentence.

## Phases
For each phase:
### Phase N — <name> (<rough duration>)
- Milestone: <outcome>
- Tasks:
  - [ ] task 1 (≤2h)
  - [ ] task 2 (≤2h)

## Risks & how to handle them
2-4 bullets.

## First step (today)
Single, specific task ≤30 min.

${SHARED_RULES}`,
    tools: (opts) => (opts.hasGoogle ? [researchTopicTool, fetchCalendarTool] : [researchTopicTool]),
    deliverableType: "plan",
    maxTurns: 5,
  },
  email: {
    systemPrompt: `You are an Email sub-agent for Jarvis. Draft a single outbound email on the user's behalf. They will review in their Inbox and either Approve (sent to Gmail Drafts) or Discard.

How you work:
1. If the request needs facts (recipient's company, current price, recent news), call research_topic at most ONCE.
2. Output ONLY the draft, in this EXACT format, as your final assistant message:

---EMAIL DRAFT---
To: recipient@example.com
Subject: <subject line>
Body:
<email body, plain text, 2-4 short paragraphs, sign off as the user, no signature line>
---END DRAFT---

Rules:
- Never invent commitments, prices, dates, or facts the user has not stated.
- If you need info from the user, leave a clearly bracketed placeholder like [confirm date].
- If the user did not name a recipient, put [recipient@unknown] in the To line.

${SHARED_RULES}`,
    tools: () => [researchTopicTool],
    deliverableType: "email_draft",
    maxTurns: 4,
  },
};

function summarize(body: string, fallback: string, max = 240): string {
  const stripped = body
    .replace(/^#.*$/gm, "")
    .replace(/^---EMAIL DRAFT---[\s\S]*?Body:\s*/m, "")
    .replace(/^---END DRAFT---/m, "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return fallback;
  if (stripped.length <= max) return stripped;
  return stripped.slice(0, max - 1).trimEnd() + "…";
}

function extractTitle(body: string, fallback: string, type: DeliverableType): string {
  if (type === "email_draft") {
    const m = body.match(/^Subject:\s*(.+)$/m);
    return m?.[1]?.trim() || fallback;
  }
  // First H1 if present
  const h1 = body.match(/^#\s+(.+)$/m);
  if (h1?.[1]) return h1[1].trim().slice(0, 200);
  // Fallback: first non-empty line
  const firstLine = body.split("\n").map((l) => l.trim()).find((l) => l.length > 0);
  if (firstLine) return firstLine.replace(/^#+\s*/, "").slice(0, 200);
  return fallback;
}

function parseEmailDraft(body: string): { to: string; subject: string; emailBody: string } | null {
  const block = body.match(/---EMAIL DRAFT---\s*([\s\S]*?)---END DRAFT---/);
  if (!block) return null;
  const inner = block[1];
  const toMatch = inner.match(/^To:\s*(.+)$/m);
  const subjMatch = inner.match(/^Subject:\s*(.+)$/m);
  // Body runs from the "Body:" line all the way to the end of the
  // ---EMAIL DRAFT---/---END DRAFT--- block (we already stripped the
  // closing marker via the outer block match). Capture everything after
  // "Body:" so multi-paragraph bodies survive intact.
  const bodyMatch = inner.match(/(^|\n)Body:\s*([\s\S]*)$/);
  if (!toMatch || !subjMatch || !bodyMatch) return null;
  return {
    to: toMatch[1].trim(),
    subject: subjMatch[1].trim(),
    emailBody: bodyMatch[2].trim(),
  };
}

export interface RunSubAgentOptions {
  agentType: SubAgentType;
  prompt: string;
  defaultTitle: string;
  context: ToolContext;
  /**
   * Per-request model override. When provided, used instead of the global
   * user "research" model preference. Lets the orchestrator route different
   * sub-agent workloads to different models without touching the agent loop.
   */
  model?: string;
}

/**
 * Run a typed sub-agent end-to-end and return a structured deliverable.
 * The caller is responsible for persisting it.
 */
export async function runSubAgent(opts: RunSubAgentOptions): Promise<SubAgentResult> {
  const spec = SPECS[opts.agentType];
  if (!spec) throw new Error(`Unknown sub-agent type: ${opts.agentType}`);

  const hasGoogle = !!opts.context.googleAccessToken;
  const tools = spec.tools({ hasGoogle });

  // Phase 4: enrich the email sub-agent's system prompt with SOUL +
  // relationship context for whoever the user is writing to. Other
  // sub-agent types stay lean.
  let systemPrompt = spec.systemPrompt;
  if (opts.agentType === "email" && opts.context.userId) {
    const enrich: string[] = [];
    try {
      const { getSoulPromptBlock } = await import("../memory/soul");
      const soulText = await getSoulPromptBlock(opts.context.userId);
      if (soulText && soulText.trim()) {
        enrich.push(`What I know about the sender (JARVIS Soul):\n${soulText.trim()}`);
      }
    } catch (err) {
      console.error(`[subagents/email] SOUL enrichment failed for ${opts.context.userId}:`, err);
    }
    try {
      const emailMatches = Array.from(opts.prompt.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)).map((m) => m[0].toLowerCase());
      if (emailMatches.length > 0) {
        const peopleRows = await db
          .select()
          .from(schema.people)
          .where(and(eq(schema.people.userId, opts.context.userId), sql`lower(${schema.people.email}) = ANY(${emailMatches})`));
        if (peopleRows.length > 0) {
          const lines = peopleRows.map((p) => {
            const bits = [`${p.name}${p.email ? ` <${p.email}>` : ""}`];
            if (p.relationship) bits.push(`relationship: ${p.relationship}`);
            if (p.interactionCount) bits.push(`prior interactions: ${p.interactionCount}`);
            if (p.lastInteractionAt) bits.push(`last seen: ${new Date(p.lastInteractionAt).toISOString().slice(0, 10)}`);
            if (p.notes) bits.push(`notes: ${p.notes.slice(0, 200)}`);
            return `- ${bits.join(" — ")}`;
          });
          enrich.push(`Recipient relationship history:\n${lines.join("\n")}`);
        }
      }
    } catch (err) {
      console.error(`[subagents/email] people enrichment failed for ${opts.context.userId}:`, err);
    }
    if (enrich.length > 0) {
      systemPrompt = `${spec.systemPrompt}\n\n--- CONTEXT ---\n${enrich.join("\n\n")}`;
    }
  }

  const { getModel } = await import("../lib/modelPrefs");
  const subAgentModel =
    opts.model ??
    (await getModel(opts.context.userId, "research"));

  const result = await runAgent({
    model: subAgentModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: opts.prompt },
    ],
    tools,
    context: opts.context,
    maxTurns: spec.maxTurns,
    maxCompletionTokens: 2400,
  });

  const body = (result.reply || "").trim();
  if (!body) {
    throw new Error(`Sub-agent ${opts.agentType} produced empty output`);
  }

  const title = extractTitle(body, opts.defaultTitle, spec.deliverableType);
  const summary = summarize(body, opts.defaultTitle);

  const meta: Record<string, unknown> = {};
  if (spec.deliverableType === "email_draft") {
    const parsed = parseEmailDraft(body);
    if (!parsed) {
      throw new Error("Email sub-agent did not return a parsable ---EMAIL DRAFT--- block");
    }
    meta.to = parsed.to;
    meta.subject = parsed.subject;
    meta.emailBody = parsed.emailBody;
  }

  return {
    type: spec.deliverableType,
    title,
    summary,
    body,
    meta,
    turns: result.turns,
    toolCallsCount: result.toolCalls.length,
  };
}

export const SUB_AGENT_TYPES: SubAgentType[] = ["research", "writing", "planning", "email"];
