/**
 * Deep Research Planner
 *
 * Uses a lightweight LLM call (claude-3-5-haiku) to convert a research prompt
 * into a multi-phase research plan. Phase 1 (prerequisiteTopics) is researched
 * first to build context; Phase 2 (mainTopics) runs with that context injected.
 */
import Anthropic from "@anthropic-ai/sdk";

export interface ResearchPlan {
  prerequisiteTopics: string[];
  mainTopics: string[];
  synthesisGoal: string;
}

const PLANNER_SYSTEM_PROMPT = `You are a research planning assistant. Given a user's research request, output a JSON object (no markdown, no code fence) that splits the work into phases:

{
  "prerequisiteTopics": [...],
  "mainTopics": [...],
  "synthesisGoal": "..."
}

Rules:
- "prerequisiteTopics" contains topics that MUST be understood BEFORE the main research can be done. Leave empty ([]) if all topics are independent.
- "mainTopics" contains the primary research items. Keep both lists to ≤4 entries each.
- "synthesisGoal" is one sentence describing what the final combined report should answer.
- Be ruthless: only use prerequisiteTopics when there is a genuine dependency (e.g. "understand the market before analysing a company in it").
- Do NOT include meta-commentary. Output only the raw JSON object.`;

const FALLBACK_PLAN = (prompt: string): ResearchPlan => ({
  prerequisiteTopics: [],
  mainTopics: [prompt],
  synthesisGoal: prompt,
});

/**
 * Call the planner LLM to produce a multi-phase research plan.
 * Falls back gracefully on any error or JSON parse failure.
 */
export async function planResearch(
  prompt: string,
  userId: string,
): Promise<ResearchPlan> {
  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 512,
      system: PLANNER_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Research request: ${prompt}`,
        },
      ],
    });

    const raw = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("")
      .trim();

    const parsed = JSON.parse(raw) as Partial<ResearchPlan>;

    const plan: ResearchPlan = {
      prerequisiteTopics: Array.isArray(parsed.prerequisiteTopics)
        ? parsed.prerequisiteTopics.slice(0, 4).map(String)
        : [],
      mainTopics: Array.isArray(parsed.mainTopics) && parsed.mainTopics.length > 0
        ? parsed.mainTopics.slice(0, 4).map(String)
        : [prompt],
      synthesisGoal:
        typeof parsed.synthesisGoal === "string" && parsed.synthesisGoal.trim()
          ? parsed.synthesisGoal
          : prompt,
    };

    console.log(
      `[DeepResearchPlanner] userId=${userId} ` +
      `prereqs=${plan.prerequisiteTopics.length} main=${plan.mainTopics.length}`,
    );
    return plan;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[DeepResearchPlanner] planning failed, using fallback: ${msg}`);
    return FALLBACK_PLAN(prompt);
  }
}
