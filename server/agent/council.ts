/**
 * Council Mode — run multiple agents in parallel, each responding from their
 * specialty, then synthesize a unified answer via the main assistant.
 *
 * Usage: runCouncil(userId, question, agentIds?)
 *   - If agentIds is omitted, all active agents for the user are included.
 *   - Each agent runs in parallel with a 30s timeout.
 *   - Failed agents are gracefully skipped.
 *   - The main assistant synthesizes a final answer.
 */
import { runNamedAgent } from "./runNamedAgent";
import { listAgents } from "./agentManager";
import { logAgentEvent } from "./agentLogger";
import { createRoutedOpenAIChatShim } from "./routedChatCompletion";

export interface CouncilAgentResponse {
  agentId: string;
  agentName: string;
  response: string;
  ok: boolean;
  error?: string;
}

export interface CouncilResult {
  question: string;
  agentResponses: CouncilAgentResponse[];
  synthesis: string;
  agentCount: number;
  succeededCount: number;
}

const AGENT_TIMEOUT_MS = 30_000;

// ── runCouncil ─────────────────────────────────────────────────────────────────

export async function runCouncil(
  userId: string,
  question: string,
  agentIds?: string[],
): Promise<CouncilResult> {
  // Resolve agents to include
  let agents = await listAgents(userId);
  if (agentIds && agentIds.length > 0) {
    agents = agents.filter((a) => agentIds.includes(a.id));
  }

  if (agents.length === 0) {
    return {
      question,
      agentResponses: [],
      synthesis: "No active agents found. Create some agents first.",
      agentCount: 0,
      succeededCount: 0,
    };
  }

  logAgentEvent({
    event: "council_started",
    userId,
    detail: `agents=${agents.map((a) => a.name).join(",")} question="${question.slice(0, 80)}"`,
  });

  // Build a focused question for each agent
  const agentQuestion = `You are ${"{name}"}, a ${"{role}"} specialist. Answer the following question from your unique specialty perspective in 2-4 paragraphs. Be specific and insightful.\n\nQuestion: ${question}`;

  // Run all agents in parallel with individual timeouts
  const results = await Promise.allSettled(
    agents.map(async (agent): Promise<CouncilAgentResponse> => {
      const q = agentQuestion
        .replace("{name}", agent.name)
        .replace("{role}", agent.role);

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Agent ${agent.name} timed out (30s)`)), AGENT_TIMEOUT_MS),
      );

      const runPromise = runNamedAgent({
        agentId: agent.id,
        userId,
        userMessage: q,
        platform: "council",
        initiatedBy: 'jarvis',
      });

      const result = await Promise.race([runPromise, timeoutPromise]);
      return {
        agentId: agent.id,
        agentName: agent.name,
        response: result.reply,
        ok: true,
      };
    }),
  );

  const agentResponses: CouncilAgentResponse[] = results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      agentId: agents[i].id,
      agentName: agents[i].name,
      response: "",
      ok: false,
      error: r.reason instanceof Error ? r.reason.message : String(r.reason),
    };
  });

  const succeededCount = agentResponses.filter((r) => r.ok).length;

  // Synthesize with the main assistant
  const synthesis = await synthesizeCouncilResponse(userId, question, agentResponses);

  logAgentEvent({
    event: "council_completed",
    userId,
    detail: `succeeded=${succeededCount}/${agents.length}`,
  });

  return {
    question,
    agentResponses,
    synthesis,
    agentCount: agents.length,
    succeededCount,
  };
}

// ── synthesizeCouncilResponse ──────────────────────────────────────────────────

async function synthesizeCouncilResponse(
  userId: string,
  question: string,
  responses: CouncilAgentResponse[],
): Promise<string> {
  const successfulResponses = responses.filter((r) => r.ok && r.response.length > 0);
  if (successfulResponses.length === 0) {
    return "No agents were able to respond to this question.";
  }

  if (successfulResponses.length === 1) {
    return successfulResponses[0].response;
  }

  const responsesText = successfulResponses
    .map((r) => `**${r.agentName}** (specialist response):\n${r.response}`)
    .join("\n\n---\n\n");

  try {
    const openai = createRoutedOpenAIChatShim("[CouncilSynthesis]", "balanced");

    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      user: userId,
      messages: [
        {
          role: "system",
          content: `You are synthesizing responses from multiple specialist AI agents into a unified, coherent answer.
Your synthesis should:
- Identify points of agreement and interesting divergence
- Combine the insights into a single clear recommendation or analysis
- Attribute which agent contributed which insight (briefly)
- Be well-structured and actionable
- Be 300-600 words`,
        },
        {
          role: "user",
          content: `Question: ${question}\n\n## Agent Responses:\n\n${responsesText.slice(0, 8000)}`,
        },
      ],
      max_completion_tokens: 1000,
    });

    return resp.choices[0]?.message?.content?.trim() ?? "Unable to synthesize responses.";
  } catch (err) {
    // Fallback: concatenate responses
    console.error("[Council] synthesis LLM failed:", err);
    return successfulResponses
      .map((r) => `**${r.agentName}:** ${r.response}`)
      .join("\n\n");
  }
}
