import type { AgentTool } from "../types";
import { submitAgentJob, type AgentJobType, getModelForJobType } from "../jobQueue";
import { SUB_AGENT_TYPES, type SubAgentType } from "../subagents";
import { getProtectedEntityNames, findEntityNearMatch } from "../../memory/protectedEntities";

interface QueueJobArgs {
  agent_type?: string;
  prompt?: string;
  title?: string;
  skip_entity_check?: boolean;
  skip_location_check?: boolean;
}

/**
 * Agent types that queue_background_job accepts, including the extended
 * "deep_research" type beyond the core SubAgentType set.
 */
const QUEUEABLE_AGENT_TYPES: readonly string[] = [...SUB_AGENT_TYPES, "deep_research"];

/**
 * Commonly confused US city names — bare city name (lower-cased) → list of states.
 * If a prompt contains one of these names with no adjacent state qualifier, the
 * tool pauses and asks the coach to confirm which city the user meant.
 */
const AMBIGUOUS_CITIES: Record<string, string[]> = {
  springfield:  ["IL", "MA", "MO", "OH", "OR"],
  watertown:    ["MA", "NY", "SD", "WI"],
  portland:     ["ME", "OR"],
  greenville:   ["NC", "SC", "TX", "MS"],
  jackson:      ["MS", "TN", "MI"],
  rochester:    ["MN", "NY"],
  lexington:    ["KY", "VA"],
  franklin:     ["TN", "PA", "VA", "MA"],
  columbia:     ["MD", "MO", "SC"],
  henderson:    ["NV", "KY", "NC", "TX"],
  clinton:      ["MS", "IA", "MA", "NY"],
  auburn:       ["AL", "ME", "NY", "WA"],
  burlington:   ["VT", "NC", "IA", "MA"],
  camden:       ["NJ", "SC", "AR"],
  concord:      ["NH", "NC", "CA"],
  dover:        ["DE", "NH", "NJ"],
  fairfield:    ["CA", "CT", "OH"],
  florence:     ["AL", "SC", "KY"],
  georgetown:   ["TX", "SC", "KY"],
  manhattan:    ["KS", "NY"],
  marion:       ["OH", "IN", "IA"],
  midland:      ["TX", "MI"],
  milford:      ["CT", "MA", "NH"],
  newark:       ["NJ", "DE", "OH"],
  richmond:     ["VA", "CA", "KY"],
  salem:        ["OR", "MA", "VA", "NH", "OH"],
  savannah:     ["GA", "TN"],
  troy:         ["NY", "OH", "AL", "MI"],
  wilmington:   ["NC", "DE"],
};

/**
 * US state names and abbreviations used to detect adjacent state qualifiers.
 */
const STATE_ABBREVS = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
]);
const STATE_NAMES = new Set([
  "alabama","alaska","arizona","arkansas","california","colorado","connecticut",
  "delaware","florida","georgia","hawaii","idaho","illinois","indiana","iowa",
  "kansas","kentucky","louisiana","maine","maryland","massachusetts","michigan",
  "minnesota","mississippi","missouri","montana","nebraska","nevada",
  "new hampshire","new jersey","new mexico","new york","north carolina",
  "north dakota","ohio","oklahoma","oregon","pennsylvania","rhode island",
  "south carolina","south dakota","tennessee","texas","utah","vermont",
  "virginia","washington","west virginia","wisconsin","wyoming",
]);

/**
 * Checks whether a state qualifier appears *directly* after the city name at
 * position `idx` in `lower` (the lowercased prompt) and `orig` (original case).
 *
 * "Directly after" means: optional comma + optional whitespace + state token,
 * within ~30 chars. Accepted forms:
 *   "Watertown, NY"        — comma + uppercase abbrev
 *   "Watertown NY"         — space + uppercase abbrev
 *   "Watertown, ny"        — comma + lowercase abbrev
 *   "Watertown, New York"  — comma or space + full state name
 *   "Watertown in New York"— "in" + full state name (within the suffix)
 *
 * Returns true if any state qualifier is found directly adjacent.
 */
function hasAdjacentStateQualifier(
  lower: string,
  orig: string,
  cityEndIdx: number,
): boolean {
  // Suffix: up to 40 chars immediately after the city token.
  const suffixLower = lower.slice(cityEndIdx, cityEndIdx + 40);
  const suffixOrig  = orig.slice(cityEndIdx, cityEndIdx + 40);

  // Check for full state names in the suffix.
  for (const name of STATE_NAMES) {
    if (suffixLower.includes(name)) return true;
  }

  // Check for state abbreviation patterns directly adjacent (comma or space).
  // Two accepted forms to minimise false-positives:
  //   a) Comma-prefixed any case:  ", NY"  or  ", ny"  — comma signals a geographic qualifier
  //   b) Space-prefixed UPPERCASE: " NY" — uppercase strongly signals an abbreviation,
  //      not a preposition like "in" (which would match as Indiana if we allowed lowercase)
  const commaAbbrev = suffixOrig.match(/^,\s{0,2}([A-Za-z]{2})\b/);
  if (commaAbbrev && STATE_ABBREVS.has(commaAbbrev[1].toUpperCase())) return true;

  const spaceUpperAbbrev = suffixOrig.match(/^\s{1,2}([A-Z]{2})\b/);
  if (spaceUpperAbbrev && STATE_ABBREVS.has(spaceUpperAbbrev[1])) return true;

  return false;
}

/**
 * Returns the first bare ambiguous city occurrence found in `prompt` that has
 * no adjacent state qualifier. Iterates ALL occurrences of every city name so
 * that a later bare mention is caught even if the first has a qualifier.
 *
 * Returns null if every city occurrence in the prompt is properly qualified.
 */
function findAmbiguousCity(prompt: string): { city: string; states: string[] } | null {
  const lower = prompt.toLowerCase();

  for (const [city, states] of Object.entries(AMBIGUOUS_CITIES)) {
    let searchFrom = 0;

    while (searchFrom < lower.length) {
      const idx = lower.indexOf(city, searchFrom);
      if (idx === -1) break;

      const cityEndIdx = idx + city.length;
      searchFrom = cityEndIdx; // advance past this match for next iteration

      // Require word boundaries: character before and after must not be a word char.
      const before = idx > 0 ? lower[idx - 1] : " ";
      const after = cityEndIdx < lower.length ? lower[cityEndIdx] : " ";
      if (/\w/.test(before) || /\w/.test(after)) continue;

      // If this occurrence has no adjacent state qualifier, it is ambiguous.
      if (!hasAdjacentStateQualifier(lower, prompt, cityEndIdx)) {
        return { city, states };
      }
    }
  }
  return null;
}

/**
 * queue_background_job — the primary tool for the coach agent to hand off
 * multi-step or time-consuming requests to a background sub-agent so the
 * user gets an immediate acknowledgement instead of waiting.
 *
 * Compared to spawn_subagent this tool:
 *  - Has a title field with a sensible default derived from the prompt
 *  - Emphasises the "detect and delegate" use case in its description
 *  - Guards against duplicate jobs for the same topic within a 10-minute window
 *  - Checks the prompt against the user's known projects/products and asks for
 *    confirmation if a near-match (possible typo) is detected
 */
export const queueBackgroundJobTool: AgentTool = {
  name: "queue_background_job",
  description: `Queue a background sub-agent to handle tasks that require multiple steps, deep research, document drafting, structured planning, or composing emails — anything that takes longer than a quick lookup. Use this whenever the user's request would take more than 10-15 seconds to answer inline. The user receives an immediate acknowledgement ("I've queued that — you'll get a notification when it's done") and sees the result in their Inbox when complete.

IMPORTANT — one job per user message: Do NOT call this tool more than once per user message. If you have multiple approaches to a topic, pick the best one and queue a single job. Queuing multiple jobs for the same user message results in the user receiving multiple notifications for what felt like one question. If the user asks to "try another approach", you may queue a second job.

Before calling this tool, use sessions_list (filter: status=queued or status=running) to check whether a recent job already exists for this topic and agent_type. If a matching job is already active, tell the user their request is already in progress rather than queuing a duplicate.

Choose agent_type based on the request:
- "research"       — single focused topic; results don't depend on each other (e.g. "latest news on OpenAI", "what is the current ETH price")
- "deep_research"  — complex request where understanding one thing is REQUIRED before properly researching another, OR multiple related topics that should be synthesised into one coherent report (e.g. "compare these two investment theses", "research this startup and its market", "analyse multiple companies in the same space")
- writing: drafting memos, notes, blog posts, documents, reports
- planning: phased project plans, goal breakdowns, action plans
- email: composing an outbound email on the user's behalf

ENTITY CHECK: Before queueing research or writing jobs, the tool automatically checks the prompt against the user's known projects and products. If a near-match (possible typo) is found, the tool will pause and return a confirmation request — relay this to the user and wait for their reply before re-calling. If the user explicitly confirms they want to search as-is (not the matched entity), set skip_entity_check=true on the next call. If they confirm the corrected name, update the prompt and re-call without skip_entity_check.

LOCATION CHECK: Before queueing any job, the tool checks whether the prompt contains a bare city name that matches multiple US cities in different states (e.g. "Watertown" could be MA, NY, SD, or WI). If found without a state qualifier, the tool will pause and return a LOCATION_CHECK_REQUIRED message — relay this to the user, wait for their state confirmation, then re-call with the confirmed city+state in the prompt and skip_location_check=true.

Do NOT use for: quick one-sentence answers, reading today's tasks, anything answered by another tool, or any Discord server action (listing/deleting channels — use discord_list_channels and discord_delete_channel instead).`,
  parameters: {
    type: "object",
    properties: {
      agent_type: {
        type: "string",
        enum: QUEUEABLE_AGENT_TYPES,
        description: "The type of sub-agent to run.",
      },
      prompt: {
        type: "string",
        description:
          "Complete instructions for the sub-agent. Include ALL context it needs: domain topic (e.g. 'animal shelters' not just 'shelters'), full location with state/country (e.g. 'Watertown, NY' not just 'Watertown'), any constraints or preferences from earlier in the conversation. The sub-agent has no access to the conversation history — everything must be in this prompt. For email type, name the recipient and purpose.",
      },
      title: {
        type: "string",
        description:
          "Short label for the Inbox card (≤80 chars). If omitted, a title will be derived from the prompt.",
      },
      skip_entity_check: {
        type: "boolean",
        description:
          "Set to true ONLY after the user has explicitly confirmed they want to search for this exact term despite it resembling a known project or product in their profile. Default: false.",
      },
      skip_location_check: {
        type: "boolean",
        description:
          "Set to true ONLY after the user has confirmed the specific city and state (e.g. 'Watertown, NY'). Update the prompt to include the confirmed city+state before re-calling. Default: false.",
      },
    },
    required: ["agent_type", "prompt"],
  },
  async execute(args, ctx) {
    const a = args as QueueJobArgs;
    const agentType = String(a.agent_type || "").trim() as AgentJobType;
    const prompt = String(a.prompt || "").trim();
    const skipEntityCheck = Boolean(a.skip_entity_check);
    const skipLocationCheck = Boolean(a.skip_location_check);

    if (!QUEUEABLE_AGENT_TYPES.includes(agentType)) {
      return {
        ok: false,
        content: `Invalid agent_type "${agentType}". Must be one of: ${QUEUEABLE_AGENT_TYPES.join(", ")}.`,
        label: "Invalid agent_type",
      };
    }
    if (!prompt) {
      return { ok: false, content: "prompt is required.", label: "Missing prompt" };
    }

    const title = String(a.title || "").trim() || deriveTitle(agentType, prompt);

    // ── Protected-entity pre-flight check ────────────────────────────────────
    // Only run for research/writing/deep_research jobs (the ones most likely
    // to produce a useless result if the wrong entity name is searched), and
    // only when the caller has not already confirmed the search term.
    if (!skipEntityCheck && ctx.userId && (agentType === "research" || agentType === "writing" || agentType === "deep_research")) {
      try {
        const entityNames = await getProtectedEntityNames(ctx.userId);
        const nearMatch = findEntityNearMatch(prompt, entityNames);
        if (nearMatch) {
          console.log(
            `[${ctx.channel || "Coach"}] queue_background_job ENTITY CHECK: ` +
            `query word "${nearMatch.queryWord}" is close to known entity ` +
            `"${nearMatch.matchedEntity}" (distance=${nearMatch.distance}) — pausing for confirmation`,
          );
          return {
            ok: true,
            content:
              `ENTITY_CHECK_REQUIRED — I noticed the search includes "${nearMatch.queryWord}", ` +
              `which looks very similar to "${nearMatch.matchedEntity}" — a project or product I have in your profile. ` +
              `Please relay this to the user: "I'm about to search for '${nearMatch.queryWord}' — ` +
              `did you mean '${nearMatch.matchedEntity}' (a project I have in your profile)? ` +
              `Reply 'yes' to use that name, or 'no' to search as-is." ` +
              `After the user replies: if they say yes, update the prompt with the corrected name and re-call. ` +
              `If they say no, re-call with skip_entity_check=true. Do NOT queue the job until you receive their reply.`,
            label: "Entity confirmation needed",
            detail: `${nearMatch.queryWord} ≈ ${nearMatch.matchedEntity}`,
          };
        }
      } catch (entityErr) {
        // Non-fatal: if the entity check fails, proceed normally.
        console.warn(`[queue_background_job] entity check failed:`, entityErr);
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    // ── Ambiguous-location pre-flight check ──────────────────────────────────
    // Scan the prompt for bare city names that are well-known US naming conflicts
    // (e.g. "Watertown" without a state). If found, pause and ask the user to
    // confirm which city they mean before queuing the job.
    if (!skipLocationCheck) {
      const ambiguous = findAmbiguousCity(prompt);
      if (ambiguous) {
        const stateList = ambiguous.states.join(", ");
        const cityTitle = ambiguous.city.charAt(0).toUpperCase() + ambiguous.city.slice(1);
        console.log(
          `[${ctx.channel || "Coach"}] queue_background_job LOCATION CHECK: ` +
          `"${cityTitle}" is ambiguous (${stateList}) — pausing for confirmation`,
        );
        return {
          ok: true,
          content:
            `LOCATION_CHECK_REQUIRED — The prompt mentions "${cityTitle}" which matches cities in ` +
            `multiple states (${stateList}). Please relay this to the user: ` +
            `"I want to make sure I look up the right place — which ${cityTitle} did you mean? (${stateList})" ` +
            `After the user confirms the state, update the prompt to use the full city+state (e.g. "${cityTitle}, NY") ` +
            `and re-call with skip_location_check=true. Do NOT queue the job until you receive their reply.`,
          label: "Location confirmation needed",
          detail: `${cityTitle} → ${stateList}`,
        };
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    try {
      // Inject per-type model routing so the job queue uses the appropriate
      // GPT mini for each sub-agent workload (research/planning → gpt-4.1-mini,
      // writing/email → gpt-4o-mini).
      const routedModel = getModelForJobType(agentType as AgentJobType);
      const jobInput: Record<string, unknown> = routedModel ? { model: routedModel } : {};
      if (ctx.channel) jobInput.originChannel = ctx.channel;
      if (ctx.discordChannelId) jobInput.originDiscordChannelId = ctx.discordChannelId;
      const { id: jobId, isDuplicate } = await submitAgentJob({
        userId: ctx.userId,
        agentType,
        title,
        prompt,
        input: jobInput,
      });
      if (isDuplicate) {
        console.log(
          `[${ctx.channel || "Coach"}] queue_background_job DUPLICATE SKIPPED type=${agentType} job=${jobId} title="${title}"`,
        );
        return {
          // Return ok:true so the coach treats this as a successful no-op
          // rather than a tool failure that might trigger retry behaviour.
          ok: true,
          content: `A ${agentType} job for this topic is already running (id=${jobId}) — skipped creating a duplicate. The user will be notified when the existing job completes.`,
          label: `Duplicate ${agentType} job skipped`,
          detail: jobId,
        };
      }
      console.log(
        `[${ctx.channel || "Coach"}] queue_background_job type=${agentType} job=${jobId} title="${title.slice(0, 60)}"`,
      );
      return {
        ok: true,
        content: `Background job queued successfully (type=${agentType}, id=${jobId}). The user will receive an inbox notification when it finishes.`,
        label: `Queued ${agentType} job`,
        detail: jobId,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[queue_background_job] submit failed:`, err);
      return {
        ok: false,
        content: `Failed to queue the job: ${msg}`,
        label: "Queue failed",
        detail: msg,
      };
    }
  },
};

function deriveTitle(agentType: AgentJobType, prompt: string): string {
  const prefixes: Partial<Record<AgentJobType, string>> = {
    research: "Research:",
    deep_research: "Deep Research:",
    writing: "Draft:",
    planning: "Plan:",
    email: "Email:",
  };
  const prefix = prefixes[agentType] ?? "Task:";
  const snippet = prompt.slice(0, 60).replace(/\s+/g, " ").trim();
  return `${prefix} ${snippet}${prompt.length > 60 ? "…" : ""}`;
}
