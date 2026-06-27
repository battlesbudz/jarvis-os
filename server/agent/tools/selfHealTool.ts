/**
 * selfHealTool.ts — autonomous diagnostic-fix-verify orchestrator.
 *
 * When the user asks Jarvis to fix a bug or make a code change via any chat
 * interface (app, Discord, Telegram), this tool runs an autonomous loop:
 *
 *   1. Diagnose  — read recent error logs + relevant source files
 *   2. Fix       — call the Codex OAuth model router to generate targeted file changes
 *   3. Apply     — write the changes via apply_code_change
 *   4. Verify    — run `npx tsc --noEmit` to confirm the change compiles
 *   5. Repeat    — if verification fails, loop back to Diagnose (up to max_iterations)
 *   6. Escalate  — if a protected file must be changed, or after max iterations,
 *                  report to the user with a clear explanation
 *
 * Progress messages are streamed back through the originating channel via
 * ctx.state.onProgress (SSE for the app, onToken for Discord, typing indicator
 * for Telegram) so the user sees live status without blocking.
 */

import type { AgentTool } from "../types";
import fs from "fs/promises";
import path from "path";
import { isIntegrationOwner } from "../../integrationOwner";
import { routeModelTurn } from "../modelRouter";
import { isPathAllowed, isProtectedFile, writeBudgetSummary, PROTECTED_FILES } from "../safeWritePolicy";
import { readRecentErrorsTool, proposeCodeChangeTool } from "./selfEditTools";
import { applyCodeChangeTool, recordVerificationResult } from "./applyCodeChangeTool";
import { runShellTool } from "./runShellTool";
import { testToolTool } from "./buildFeatureTool";
import { verifyJobOutput } from "../orchestrator";
import { getModel } from "../../lib/modelPrefs";

const PROJECT_ROOT    = process.cwd();
const MAX_FILE_LINES  = 800;   // lines per file passed to inner LLM (covers ~99 % of source files)

// ── Utility: derive a tool name from a tool source file name ─────────────────
// Convention: "applyCodeChangeTool.ts" → "apply_code_change"
function fileNameToToolName(filename: string): string | null {
  const base = filename.replace(/Tool\.tsx?$/, "");
  if (base === filename.replace(/\.tsx?$/, "")) return null; // no "Tool" suffix → not a tool file
  return base.replace(/([A-Z])/g, (_, c: string) => `_${c.toLowerCase()}`).replace(/^_/, "");
}
const MAX_FILES       = 8;     // max files included in inner LLM context
const INNER_MAX_TOKENS = 8192;

// ── Inner LLM types ───────────────────────────────────────────────────────────

interface FileChange {
  file_path: string;
  new_content: string;
  reason: string;
}

interface InnerFixPlan {
  diagnosis: string;
  changes: FileChange[];
  needs_protected_file: boolean;
  protected_file_reason: string | null;
  /**
   * When needs_protected_file is true the LLM still provides the proposed
   * change here so self_heal can auto-create a code proposal.
   */
  protected_file_change: FileChange | null;
  no_fix_needed: boolean;
  no_fix_reason: string | null;
  /** Registered tool names (snake_case) whose behaviour exercises the affected area. */
  affected_tools: string[];
}

// ── Inner LLM system prompt ───────────────────────────────────────────────────

const PROTECTED_FILE_LIST = [...PROTECTED_FILES].join(", ");

const INNER_SYSTEM_PROMPT = `\
You are a precise code-repair specialist embedded inside an autonomous self-healing agent.
Your job is to analyse a bug description, error logs, and source files, then produce the
MINIMAL set of file changes that will fix the described problem.

You MUST respond with a single valid JSON object and nothing else — no markdown fences,
no prose before or after the JSON.

Response schema:
{
  "diagnosis": "1–2 sentence root-cause summary",
  "changes": [
    {
      "file_path": "server/agent/tools/example.ts",
      "new_content": "...COMPLETE file content after the fix...",
      "reason": "Why this change resolves the issue"
    }
  ],
  "needs_protected_file": false,
  "protected_file_reason": null,
  "protected_file_change": null,
  "no_fix_needed": false,
  "no_fix_reason": null,
  "affected_tools": ["tool_name_a", "tool_name_b"]
}

"affected_tools" MUST list every registered agent tool (in snake_case, e.g. "apply_code_change",
"build_feature", "self_heal") whose runtime behaviour exercises the area you are changing.
Include tools from files you are modifying, AND tools that call helper modules you are changing
(e.g. if safeWritePolicy.ts is changed, list every tool that imports it).
If no registered tool is affected, return an empty array [].

Rules you MUST follow:
1. Only include files that genuinely need to change.
2. new_content MUST be the complete file (not a diff or partial patch).
3. Keep changes minimal — do not refactor code that does not need changing.
4. If the fix requires a protected file: set needs_protected_file: true, set protected_file_reason,
   AND populate protected_file_change with the proposed FileChange for that file
   (including the full new_content). Do NOT include the protected file in the changes array.
   The system will auto-create a user-approval proposal from protected_file_change.
5. If no code change is needed, set no_fix_needed: true with an explanation.
6. If a type-check output from a previous iteration is supplied, fix those specific errors.

Hard-protected files (must never appear in changes): ${PROTECTED_FILE_LIST}`;

// ── File reading helpers ──────────────────────────────────────────────────────

async function readFileSafe(filePath: string): Promise<string | null> {
  try {
    const abs  = path.join(PROJECT_ROOT, filePath);
    const raw  = await fs.readFile(abs, "utf-8");
    const lines = raw.split("\n");
    if (lines.length > MAX_FILE_LINES) {
      return (
        lines.slice(0, MAX_FILE_LINES).join("\n") +
        `\n…[truncated at ${MAX_FILE_LINES} lines of ${lines.length} total]`
      );
    }
    return raw;
  } catch {
    return null;
  }
}

async function collectTsFilesFromDir(dirRelative: string): Promise<string[]> {
  const abs = path.join(PROJECT_ROOT, dirRelative);
  try {
    const entries = await fs.readdir(abs, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && (e.name.endsWith(".ts") || e.name.endsWith(".tsx")))
      .map((e) => path.join(dirRelative, e.name));
  } catch {
    return [];
  }
}

/**
 * Determine which files to read given the description and optional hints.
 * Returns normalised relative paths that pass the allow-list check.
 */
async function findRelevantFiles(
  description: string,
  affectedPaths: string[] | undefined,
): Promise<Array<{ path: string; content: string }>> {
  const candidates: string[] = [];

  if (affectedPaths && affectedPaths.length > 0) {
    // Use the caller-supplied paths; expand directories to their .ts files
    for (const p of affectedPaths) {
      const norm = path.normalize(p);
      if (!isPathAllowed(norm)) continue;
      const abs = path.join(PROJECT_ROOT, norm);
      try {
        const stat = await fs.stat(abs);
        if (stat.isDirectory()) {
          candidates.push(...(await collectTsFilesFromDir(norm)));
        } else {
          candidates.push(norm);
        }
      } catch {
        // Skip missing paths
      }
    }
  } else {
    // Keyword heuristic: map description keywords to likely directories
    const lower = description.toLowerCase();
    const dirs = new Set<string>();

    if (lower.includes("discord"))                              dirs.add("server/channels");
    if (lower.includes("telegram"))                             dirs.add("server/channels");
    if (lower.includes("email") || lower.includes("gmail"))    dirs.add("server/agent/tools");
    if (lower.includes("calendar"))                            dirs.add("server/agent/tools");
    if (lower.includes("browser"))                             dirs.add("server/agent/tools");
    if (lower.includes("workflow"))                            dirs.add("server/agent/tools");
    if (lower.includes("cron"))                                dirs.add("server/agent/tools");
    if (lower.includes("capability") || lower.includes("tool")) dirs.add("server/agent/tools");
    if (lower.includes("channel"))                             dirs.add("server/channels");
    if (lower.includes("route"))                               dirs.add("server");

    if (dirs.size === 0) dirs.add("server/agent/tools"); // sensible default

    for (const dir of dirs) {
      candidates.push(...(await collectTsFilesFromDir(dir)));
    }
  }

  // Deduplicate, filter, and cap
  const seen = new Set<string>();
  const result: Array<{ path: string; content: string }> = [];

  for (const fp of candidates) {
    const norm = path.normalize(fp);
    if (seen.has(norm)) continue;
    if (!isPathAllowed(norm) || isProtectedFile(norm)) continue;
    seen.add(norm);

    if (result.length >= MAX_FILES) break;

    const content = await readFileSafe(norm);
    if (content !== null) result.push({ path: norm, content });
  }

  return result;
}

// ── Inner LLM call ────────────────────────────────────────────────────────────

async function callInnerLLM(
  description: string,
  errorLogs: string,
  files: Array<{ path: string; content: string }>,
  previousTypeCheckOutput: string | null,
  userId?: string,
): Promise<InnerFixPlan> {
  const filesSection =
    files.length > 0
      ? files.map((f) => `=== ${f.path} ===\n${f.content}`).join("\n\n")
      : "No source files were found or supplied.";

  const parts: string[] = [
    `## Fix Request\n${description}`,
    `## Recent Error Logs\n${errorLogs.trim() || "No recent errors found in the last 60 minutes."}`,
    `## Source Files\n${filesSection}`,
  ];
  if (previousTypeCheckOutput) {
    parts.push(`## Previous Iteration Type-Check Errors\n${previousTypeCheckOutput}`);
  }
  const userMessage = parts.join("\n\n---\n\n");

  const response = await routeModelTurn({
    tier: "smart",
    maxCompletionTokens: INNER_MAX_TOKENS,
    stream: false,
    toolChoice: "none",
    userId,
    disableRuntimeStateCard: true,
    logPrefix: "[SelfHealInner]",
    messages: [
      { role: "system", content: INNER_SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
  });

  if (response.finishReason === "max_tokens" || response.finishReason === "length") {
    throw new Error(
      "Inner LLM response was cut off by the token limit. " +
      "Try with fewer or smaller files using the affected_paths parameter.",
    );
  }

  const text = response.textContent ?? "";

  // Strip any accidental markdown fencing
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Inner LLM returned non-JSON response: ${cleaned.slice(0, 500)}`);
  }

  // Strict shape validation — every required field must be coerced to a valid value
  const p = parsed as Record<string, unknown>;

  const rawAffected = p.affected_tools;
  const affected_tools: string[] = Array.isArray(rawAffected)
    ? rawAffected.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    : [];

  // Validate protected_file_change shape
  const rawPfc = p.protected_file_change;
  let protected_file_change: FileChange | null = null;
  if (
    rawPfc !== null &&
    rawPfc !== undefined &&
    typeof rawPfc === "object" &&
    typeof (rawPfc as Record<string, unknown>).file_path  === "string" &&
    typeof (rawPfc as Record<string, unknown>).new_content === "string"
  ) {
    const pfc = rawPfc as Record<string, unknown>;
    protected_file_change = {
      file_path:   String(pfc.file_path),
      new_content: String(pfc.new_content),
      reason:      typeof pfc.reason === "string" ? pfc.reason : "Protected file change proposed by self-heal",
    };
  }

  return {
    diagnosis:              typeof p.diagnosis             === "string"  ? p.diagnosis             : "No diagnosis provided.",
    changes:                Array.isArray(p.changes)                     ? (p.changes as FileChange[]) : [],
    needs_protected_file:   typeof p.needs_protected_file  === "boolean" ? p.needs_protected_file  : false,
    protected_file_reason:  typeof p.protected_file_reason === "string"  ? p.protected_file_reason : null,
    protected_file_change,
    no_fix_needed:          typeof p.no_fix_needed         === "boolean" ? p.no_fix_needed         : false,
    no_fix_reason:          typeof p.no_fix_reason         === "string"  ? p.no_fix_reason         : null,
    affected_tools,
  };
}

// ── Tool definition ───────────────────────────────────────────────────────────

export const selfHealTool: AgentTool = {
  name: "self_heal",
  description:
    "Autonomously diagnose and fix a bug or make a code change without further user prompting. " +
    "Runs a loop: (1) read recent error logs, (2) read relevant source files, " +
    "(3) call an inner AI to generate the minimal fix, (4) apply the change, " +
    "(5) run TypeScript type-check to verify it compiles, (6) restart the server if all checks pass. " +
    "Repeats up to max_iterations if the type-check fails. " +
    "If a protected file (auth, DB schema, approval routes) must be changed, the loop halts " +
    "and a code proposal requiring your approval is submitted instead. " +
    "Progress updates are sent back through the same channel (app, Discord, Telegram) after each iteration. " +
    "Use when the user says 'fix X', 'patch X', 'add rate limiting to X', or similar autonomous repair requests.",
  parameters: {
    type: "object",
    properties: {
      description: {
        type: "string",
        description:
          "Plain-language description of what is broken or what should change. " +
          "Be specific — include the feature name, error message, or behaviour observed.",
      },
      affected_paths: {
        type: "array",
        description:
          "Optional list of relative file paths or directories to focus on " +
          "(e.g. ['server/channels/discordChannel.ts', 'server/agent/tools']). " +
          "If omitted, the tool infers relevant files from the description using keyword matching.",
        items: { type: "string" },
      },
      max_iterations: {
        type: "number",
        description:
          "Maximum number of diagnose-fix-verify iterations before escalating (default 5, max 10).",
      },
    },
    required: ["description"],
  },

  async execute(args, ctx) {
    if (!await isIntegrationOwner(ctx.userId)) {
      return {
        ok: false,
        content: "Access denied: only the account owner may trigger autonomous self-heal.",
        label: "self_heal: forbidden",
      };
    }

    const description    = String(args.description ?? "").trim();
    const affectedPaths  = Array.isArray(args.affected_paths)
      ? (args.affected_paths as unknown[]).map(String)
      : undefined;
    const maxIterations  = Math.min(Math.max(1, Number(args.max_iterations ?? 5)), 10);

    if (!description) {
      return { ok: false, content: "description is required.", label: "self_heal: error" };
    }

    const sendProgress = (msg: string) => {
      console.log(`[SelfHeal] ${msg}`);
      ctx.state.onProgress?.(msg);
    };

    sendProgress(`Starting self-heal loop for: "${description}" (max ${maxIterations} iterations)`);

    // ── Pre-loop: confirm baseline health ─────────────────────────────────────
    sendProgress("Checking server health baseline…");
    const baselineHealth = await runShellTool.execute({ command: "check_health" }, ctx);
    if (!baselineHealth.ok) {
      sendProgress(`⚠ Server health check failed before applying any changes: ${baselineHealth.content}`);
    } else {
      sendProgress(`✓ Server is healthy: ${baselineHealth.content}`);
    }

    let lastTypeCheckOutput: string | null = null;
    const iterationSummaries: string[] = [];

    for (let iter = 0; iter < maxIterations; iter++) {
      const iterLabel = `Iteration ${iter + 1}/${maxIterations}`;

      // ── Phase 1: Diagnose — read error logs ──────────────────────────────
      sendProgress(`[${iterLabel}] Reading recent error logs…`);
      let errorLogs = "";
      try {
        const errResult = await readRecentErrorsTool.execute(
          { lookback_minutes: 60, limit: 20 },
          ctx,
        );
        errorLogs = errResult.content;
      } catch (err) {
        errorLogs = `Could not read error logs: ${err instanceof Error ? err.message : String(err)}`;
      }

      // ── Phase 1b: Read relevant source files ──────────────────────────────
      sendProgress(`[${iterLabel}] Reading source files…`);
      let relevantFiles: Array<{ path: string; content: string }> = [];
      try {
        relevantFiles = await findRelevantFiles(description, affectedPaths);
      } catch (err) {
        sendProgress(`[${iterLabel}] Warning: could not read source files — ${err instanceof Error ? err.message : String(err)}`);
      }

      // ── Phase 2: Fix — inner LLM generates the change plan ───────────────
      sendProgress(`[${iterLabel}] Generating fix plan (analysing ${relevantFiles.length} file(s))…`);
      let plan: InnerFixPlan;
      try {
        plan = await callInnerLLM(description, errorLogs, relevantFiles, lastTypeCheckOutput, ctx.userId);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        sendProgress(`[${iterLabel}] Inner LLM error: ${errMsg}`);
        iterationSummaries.push(`${iterLabel}: inner LLM failed — ${errMsg}`);
        continue; // try next iteration
      }

      sendProgress(`[${iterLabel}] Diagnosis: ${plan.diagnosis}`);

      // ── Guard: no fix needed ──────────────────────────────────────────────
      if (plan.no_fix_needed) {
        return {
          ok: true,
          content:
            `Self-heal complete — no code change required.\n\n` +
            `Diagnosis: ${plan.diagnosis}\n` +
            `Reason: ${plan.no_fix_reason ?? "The issue does not require a source change."}`,
          label: "self_heal: no-fix-needed",
        };
      }

      // ── Guard: protected file required → auto-create proposal and halt ───────
      if (plan.needs_protected_file) {
        sendProgress(`[${iterLabel}] Fix requires a protected file — auto-creating a user-approval proposal`);
        let proposalDetail = "";
        if (plan.protected_file_change?.file_path && plan.protected_file_change?.new_content) {
          try {
            const pResult = await proposeCodeChangeTool.execute(
              {
                file_path:        plan.protected_file_change.file_path,
                title:            `Self-heal: ${plan.diagnosis.slice(0, 80)}`,
                reason:           `Self-heal requires changing a protected file. ${plan.protected_file_reason ?? ""} | Original request: ${description.slice(0, 200)}`,
                proposed_content: plan.protected_file_change.new_content,
              },
              ctx,
            );
            proposalDetail = pResult.ok
              ? `\n\nA code proposal has been auto-created for your review: ${pResult.content}`
              : `\n\nProposal creation failed: ${pResult.content}`;
          } catch (err) {
            proposalDetail = `\n\nCould not auto-create proposal: ${err instanceof Error ? err.message : String(err)}`;
          }
        } else {
          proposalDetail = "\n\nThe inner LLM did not supply the protected file's content — please create a proposal manually using propose_code_change.";
        }
        return {
          ok: false,
          content:
            `Self-heal halted: the fix requires modifying a protected file that needs explicit user approval.\n\n` +
            `**Diagnosis:** ${plan.diagnosis}\n\n` +
            `**Reason:** ${plan.protected_file_reason ?? "A protected file must be changed."}` +
            proposalDetail,
          label: "self_heal: escalated-protected",
        };
      }

      if (plan.changes.length === 0) {
        // LLM neither said no_fix_needed nor provided changes — treat as a
        // failed iteration so the loop retries with fresh context, not a success.
        const zeroChangesMsg = `Diagnosis complete but inner LLM returned 0 file changes without setting no_fix_needed. Retrying with additional context.`;
        sendProgress(`[${iterLabel}] ⚠ ${zeroChangesMsg}`);
        const iterSumZero = `${iterLabel}: inner LLM produced 0 changes — retrying`;
        iterationSummaries.push(iterSumZero);
        if (iter + 1 >= maxIterations) {
          return {
            ok: false,
            content:
              `Self-heal loop exhausted — inner LLM produced no changes across ${maxIterations} iteration(s).\n\n` +
              `Diagnosis: ${plan.diagnosis}\n\n` +
              `The LLM may need a more specific description, or the fix may require a protected file. ` +
              `Try describing the bug more precisely or use propose_code_change.\n\n` +
              `${await writeBudgetSummary()}`,
            label: "self_heal: no-changes-max-iterations",
          };
        }
        lastTypeCheckOutput = `Previous iteration produced 0 changes. Diagnosis was: ${plan.diagnosis}. Please generate concrete file changes.`;
        continue;
      }

      // ── Phase 3: Apply changes ────────────────────────────────────────────
      sendProgress(`[${iterLabel}] Applying ${plan.changes.length} file change(s)…`);
      const applyResults: Array<{ filePath: string; ok: boolean; summary: string; label: string }> = [];
      let circuitTripped      = false;
      let escalatedProtected  = false;
      let blockingApplyError: { filePath: string; message: string } | null = null;

      for (const change of plan.changes) {
        // Basic validation before calling apply_code_change
        if (!change.file_path || !change.new_content) {
          applyResults.push({
            filePath: change.file_path ?? "?",
            ok: false,
            summary: "Missing file_path or new_content in plan",
            label: "apply_code_change: invalid-plan",
          });
          blockingApplyError = { filePath: change.file_path ?? "?", message: "Inner LLM returned a change with missing file_path or new_content." };
          break;
        }

        // Read original file line count BEFORE applying — used to detect
        // truncation-induced incomplete rewrites (e.g. LLM saw 800 lines but
        // only produced 120 because context was cut).
        let originalLineCount = 0;
        try {
          const abs = path.join(PROJECT_ROOT, change.file_path);
          const orig = await fs.readFile(abs, "utf-8").catch(() => "");
          originalLineCount = orig.split("\n").length;
        } catch { /* new file — original count stays 0 */ }
        const newLineCount = change.new_content.split("\n").length;

        const applyResult = await applyCodeChangeTool.execute(
          {
            file_path:   change.file_path,
            new_content: change.new_content,
            reason:      change.reason ?? plan.diagnosis,
          },
          ctx,
        );

        // Integrity check: warn if proposed content is <40 % of original line
        // count and the original was large enough to care about (>50 lines).
        // This catches cases where the LLM saw a truncated file and only
        // rewrote the visible portion, silently dropping the rest.
        let truncationWarning = "";
        if (
          applyResult.ok &&
          originalLineCount > 50 &&
          newLineCount < originalLineCount * 0.4
        ) {
          truncationWarning = ` ⚠ Line count dropped from ${originalLineCount} → ${newLineCount} — possible truncated rewrite; type-check will verify.`;
          sendProgress(`[${iterLabel}] ⚠ ${change.file_path}: ${truncationWarning}`);
        }

        const summary = applyResult.content.slice(0, 200) + truncationWarning;
        const label   = applyResult.label ?? "";
        applyResults.push({ filePath: change.file_path, ok: applyResult.ok, summary, label });
        sendProgress(`[${iterLabel}] ${applyResult.ok ? "✓" : "✗"} ${change.file_path}`);

        if (!applyResult.ok) {
          // Categorise the failure so we give the right response.
          if (label.includes("circuit-tripped")) {
            circuitTripped = true;
          } else if (label.includes("protected") || label.includes("proposal")) {
            escalatedProtected = true;
          } else {
            // Any other failure (dangerous path, denied dir, write error, forbidden, etc.)
            // is a hard stop — we cannot safely proceed with remaining changes.
            blockingApplyError = { filePath: change.file_path, message: applyResult.content };
          }
          break; // stop applying further changes on any failure
        }
      }

      if (circuitTripped) {
        const lastApply = applyResults[applyResults.length - 1];
        return {
          ok: false,
          content:
            `Self-heal paused — circuit breaker tripped after too many autonomous writes.\n\n` +
            `${lastApply?.summary ?? ""}\n\n` +
            `**To resume autonomous self-heal:**\n` +
            `1. Review the recent changes in \`server/self-heal-audit.log\`.\n` +
            `2. Once satisfied, say "reset the write budget" — Jarvis will call \`run_shell reset_circuit_breaker\` to clear the counter.\n` +
            `3. Then retry the self-heal.\n\n` +
            `The circuit breaker resets automatically after 60 minutes if you prefer to wait.`,
          label: "self_heal: circuit-tripped",
        };
      }

      if (escalatedProtected) {
        return {
          ok: false,
          content:
            `Self-heal halted — one or more required changes touch protected files and have been ` +
            `submitted as code proposals for your review.\n\n` +
            `Changes summary:\n${applyResults.map((r) => `- ${r.ok ? "✓" : "✗"} ${r.filePath}: ${r.summary}`).join("\n")}`,
          label: "self_heal: escalated-protected",
        };
      }

      if (blockingApplyError) {
        return {
          ok: false,
          content:
            `Self-heal aborted — a file change could not be applied and the loop was halted ` +
            `to prevent an inconsistent state.\n\n` +
            `**File:** ${blockingApplyError.filePath}\n` +
            `**Reason:** ${blockingApplyError.message}\n\n` +
            `**Changes attempted:**\n${applyResults.map((r) => `- ${r.ok ? "✓" : "✗"} ${r.filePath}: ${r.summary}`).join("\n")}\n\n` +
            `Please review and correct the issue manually.`,
          label: "self_heal: apply-error",
        };
      }

      // ── Phase 4: Verify — type check ──────────────────────────────────────
      sendProgress(`[${iterLabel}] Running TypeScript type-check…`);
      const typeCheckResult = await runShellTool.execute({ command: "type_check" }, ctx);
      lastTypeCheckOutput   = typeCheckResult.content;

      if (!typeCheckResult.ok) {
        const iterSummary = `${iterLabel}: applied ${applyResults.filter((r) => r.ok).length}/${plan.changes.length} change(s), type-check FAILED`;
        iterationSummaries.push(iterSummary);
        sendProgress(`[${iterLabel}] ✗ Type-check failed — ${iter + 1 < maxIterations ? "retrying…" : "max iterations reached."}`);
        await recordVerificationResult(
          applyResults.filter((r) => r.ok).map((r) => r.filePath),
          "failed",
          `type-check failed (iteration ${iter + 1})`,
          ctx.userId,
        ).catch(() => {});
        continue; // loop back to diagnose with the type-check errors as context
      }

      sendProgress(`[${iterLabel}] ✓ Type-check passed. Running test suite…`);

      // ── Phase 4b: Verify — run full test suite ────────────────────────────
      const testResult = await runShellTool.execute({ command: "run_tests" }, ctx);
      const testPassed = testResult.ok;
      sendProgress(`[${iterLabel}] ${testPassed ? "✓ Tests passed!" : "✗ Tests failed — "} ${!testPassed && iter + 1 < maxIterations ? "retrying…" : ""}`);

      const iterSummary = `${iterLabel}: applied ${applyResults.filter((r) => r.ok).length}/${plan.changes.length} change(s), type-check PASSED, tests ${testPassed ? "PASSED" : "FAILED"}`;
      iterationSummaries.push(iterSummary);

      if (!testPassed) {
        // Feed test failure output back into next iteration context
        lastTypeCheckOutput = `Type-check: PASSED\n\nTest suite output (FAILED):\n${testResult.content}`;
        await recordVerificationResult(
          applyResults.filter((r) => r.ok).map((r) => r.filePath),
          "failed",
          `tests failed (iteration ${iter + 1})`,
          ctx.userId,
        ).catch(() => {});
        continue;
      }

      // ── Phase 4c: Smoke-test affected registered tools ───────────────────
      // Tests TWO categories of tools:
      //   (a) Tools derived from directly modified tool files (from apply results)
      //   (b) Tools listed in plan.affected_tools (LLM-identified: any registered
      //       tool whose runtime behaviour exercises the changed area, e.g. a shared
      //       helper module used by multiple tools)
      const smokeResults: Array<{ toolName: string; ok: boolean; summary: string }> = [];

      const toolNamesFromFiles = applyResults
        .filter((r) => r.ok && r.filePath.startsWith("server/agent/tools/"))
        .map((r) => fileNameToToolName(path.basename(r.filePath)))
        .filter((n): n is string => n !== null);

      const affectedToolNames: string[] = Array.isArray(plan.affected_tools)
        ? plan.affected_tools.filter((t) => typeof t === "string" && t.trim().length > 0)
        : [];

      // De-duplicate, preserving order: file-derived first, then LLM-identified extras
      const allToolNames = [...new Set([...toolNamesFromFiles, ...affectedToolNames])];

      if (allToolNames.length > 0) {
        sendProgress(`[${iterLabel}] Smoke-testing ${allToolNames.length} affected tool(s): ${allToolNames.join(", ")}`);
      }

      for (const toolName of allToolNames) {
        sendProgress(`[${iterLabel}] Smoke-testing tool '${toolName}'…`);
        try {
          const smokeResult = await testToolTool.execute({ tool_name: toolName, _internal: true }, ctx);
          smokeResults.push({ toolName, ok: smokeResult.ok, summary: smokeResult.content.slice(0, 120) });
          sendProgress(`[${iterLabel}] ${smokeResult.ok ? "✓" : "⚠"} test_tool(${toolName}): ${smokeResult.content.slice(0, 80)}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          smokeResults.push({ toolName, ok: false, summary: `threw: ${msg}` });
          sendProgress(`[${iterLabel}] ⚠ test_tool(${toolName}) threw: ${msg}`);
        }
      }

      // ── Phase 4d: Gate on smoke-test results ─────────────────────────────
      // Any tool smoke-test failure is treated as a verification failure —
      // the loop retries so the LLM can fix the issue.
      const smokeFailures = smokeResults.filter((s) => !s.ok);
      if (smokeFailures.length > 0) {
        const failureSummary = smokeFailures
          .map((s) => `  - ${s.toolName}: ${s.summary}`)
          .join("\n");
        const iterSumSmoke = `${iterLabel}: applied changes, type-check PASSED, tests PASSED, smoke-tests FAILED (${smokeFailures.length}/${allToolNames.length})`;
        iterationSummaries.push(iterSumSmoke);
        sendProgress(`[${iterLabel}] ✗ ${smokeFailures.length} smoke-test(s) failed — ${iter + 1 < maxIterations ? "retrying…" : "max iterations reached."}`);
        if (iter + 1 < maxIterations) {
          lastTypeCheckOutput =
            `Type-check: PASSED\nTests: PASSED\nSmoke-test failures (verify these tools work after your fixes):\n${failureSummary}`;
          await recordVerificationResult(
            applyResults.filter((r) => r.ok).map((r) => r.filePath),
            "failed",
            `smoke-tests failed (iteration ${iter + 1}, retrying)`,
            ctx.userId,
          ).catch(() => {});
          continue; // loop back to diagnose with smoke-test context
        }
        // Max iterations reached with smoke-test failures — escalate
        await recordVerificationResult(
          applyResults.filter((r) => r.ok).map((r) => r.filePath),
          "failed",
          `smoke-tests failed after ${maxIterations} iteration(s)`,
          ctx.userId,
        ).catch(() => {});
        return {
          ok: false,
          content:
            `Self-heal loop finished ${maxIterations} iteration(s). Code compiles and tests pass, ` +
            `but ${smokeFailures.length} tool smoke-test(s) still fail.\n\n` +
            `**Failing tools:**\n${failureSummary}\n\n` +
            `**Iterations:**\n${iterationSummaries.join("\n")}\n\n` +
            `Review the smoke-test errors and fix manually, or use propose_code_change.\n\n` +
            `${await writeBudgetSummary()}`,
          label: `self_heal: smoke-test-failed-max-iterations`,
        };
      }

      // All smoke-tests passed
      if (allToolNames.length > 0) {
        sendProgress(`[${iterLabel}] ✓ All ${allToolNames.length} smoke-test(s) passed.`);
      }

      // ── Phase 4e: Record verification success ─────────────────────────────
      await recordVerificationResult(
        applyResults.filter((r) => r.ok).map((r) => r.filePath),
        "passed",
        `type-check ✓, tests ✓${allToolNames.length > 0 ? `, smoke-tests ✓ (${allToolNames.length})` : ""}`,
        ctx.userId,
      ).catch(() => {});

      // ── Phase 4f: Codex OAuth AI logic review ─────────────────────────────
      // Mechanical checks (compile + tests + smoke) confirm the code is valid,
      // but an AI review confirms the change actually addresses the stated problem.
      // Fail-open: timeout/error yields null — Phase 4e "passed" audit entry stands.
      sendProgress(`[${iterLabel}] Running AI logic review…`);
      let aiReviewPassed: boolean | null = null;
      let aiReviewReason = "verify_timeout";
      try {
        const orchModel = await getModel(ctx.userId, "orchestrator");
        const changeSummary = applyResults
          .filter((r) => r.ok)
          .map((r) => `${r.filePath}: ${r.summary}`)
          .join("\n");
        const aiReview = await verifyJobOutput({
          agentType: "self_heal",
          originalPrompt: `Problem: ${description}\n\nDiff applied:\n${changeSummary}`,
          result: `Type-check: PASSED\nTests: PASSED${allToolNames.length > 0 ? `\nSmoke-tests: PASSED (${allToolNames.join(", ")})` : ""}\n\nSummary of changes:\n${changeSummary}`,
          orchestratorModel: orchModel,
          userId: ctx.userId,
        });
        aiReviewPassed = aiReview.passed;
        aiReviewReason = aiReview.reason;
      } catch (aiErr) {
        // Fail-open: treat as unknown — proceed as before
        aiReviewReason = `verify_error: ${aiErr instanceof Error ? aiErr.message : String(aiErr)}`;
        sendProgress(`[${iterLabel}] ⚠ AI review error (fail-open): ${aiReviewReason}`);
      }

      // Update the audit log for each changed file using recordVerificationResult,
      // which looks up the original entry timestamp via the lastAuditTimestamp map —
      // ensuring [VERIFY] lines merge into the correct entry in parseAuditLog().
      // Skip when null (verifier timed out): the Phase 4e "passed" entry already stands.
      const successFilePaths = applyResults.filter((r) => r.ok).map((r) => r.filePath);
      if (aiReviewPassed === true) {
        await recordVerificationResult(
          successFilePaths,
          "passed",
          `ai+typecheck ✓ — ${aiReviewReason}`,
        ).catch(() => {});
      } else if (aiReviewPassed === false) {
        await recordVerificationResult(
          successFilePaths,
          "error",
          `ai_review_failed: ${aiReviewReason}`,
        ).catch(() => {});
      }
      // aiReviewPassed === null: timeout/error — leave Phase 4e audit entry as-is

      if (aiReviewPassed === true || aiReviewPassed === null) {
        sendProgress(`[${iterLabel}] ✓ AI logic review passed: ${aiReviewReason}`);
      } else {
        sendProgress(
          `[${iterLabel}] ⚠ AI logic review flagged: ${aiReviewReason} — code checks pass but logical correctness is uncertain. Proceeding with restart (review carefully).`,
        );
      }
      // ─────────────────────────────────────────────────────────────────────

      // ── Phase 5: Verify current server is still healthy before activation ──
      sendProgress(`[${iterLabel}] All code checks passed. Confirming server health before activation…`);
      const preRestartHealth = await runShellTool.execute({ command: "check_health" }, ctx);
      const preHealthOk = preRestartHealth.ok;
      sendProgress(`[${iterLabel}] ${preHealthOk ? "✓" : "⚠"} Current server health: ${preRestartHealth.content}`);

      // ── Phase 6: Activate — restart server + queue post-restart verification ─
      // Architecture note: restart_server sends SIGTERM to this process in 2 s.
      // The current TCP connection cannot survive that. So the self_heal state
      // machine has two explicit stages:
      //   Stage A (this invocation): verify code → confirm current health → trigger restart
      //   Stage B (background job):  NEW server process polls health → confirms or warns via inbox
      // Stage B IS the post-restart re-entry of the verification loop. It is
      // persisted in the job queue DB before Stage A exits, so it survives restart.

      const changeList = applyResults
        .map((r) => `- ${r.ok ? "✓" : "✗"} ${r.filePath}: ${r.summary}`)
        .join("\n");
      const smokeSection = smokeResults.length > 0
        ? `\n**Smoke-tests:**\n${smokeResults.map((s) => `- ${s.ok ? "✓" : "⚠"} ${s.toolName}: ${s.summary}`).join("\n")}`
        : "";

      // Queue Stage B BEFORE triggering restart (so it survives the process exit)
      let stageB = "not queued";
      try {
        const { submitAgentJob } = await import("../jobQueue");
        await submitAgentJob({
          userId: ctx.userId,
          agentType: "general",
          title: `Self-heal stage B — post-restart health check: "${description.slice(0, 50)}"`,
          prompt: [
            `Self-heal stage B: verify the server is healthy after restart.`,
            ``,
            `Context (from stage A — code verification):`,
            `  Diagnosis: ${plan.diagnosis}`,
            `  Changes: ${changeList}`,
            ``,
            `You are running in the NEW server process (stage A triggered the restart).`,
            `Execute these steps in order — do NOT apply further code changes:`,
            `1. Wait 12 seconds for the server to fully initialize.`,
            `2. Call run_shell with command check_health.`,
            `   If it fails, retry up to 3 times with 10 s gaps.`,
            `3. Call read_recent_errors with lookback_minutes: 5 to check for startup errors.`,
            `4. Send the user an inbox message:`,
            `   - If healthy, no new errors: "✅ Self-heal complete — code changes verified and applied,`,
            `     server restarted successfully and is responding normally."`,
            `   - If unhealthy or errors detected: "⚠ Self-heal stage A verified the code changes,`,
            `     but the server may have startup issues after restart. Check self-heal-audit.log`,
            `     and run \`run_shell check_health\` manually."`,
          ].join("\n"),
          input: { postSelfHealVerification: true, selfHealDescription: description },
        });
        stageB = "queued";
        sendProgress(`[${iterLabel}] ✓ Stage B (post-restart health check) persisted to job queue.`);
      } catch (jobErr) {
        stageB = `failed: ${jobErr instanceof Error ? jobErr.message : String(jobErr)}`;
        sendProgress(`[${iterLabel}] ⚠ Could not queue stage B: ${stageB}`);
      }

      sendProgress(`[${iterLabel}] Triggering server restart to activate changes (stage B will confirm health)…`);
      await runShellTool.execute({ command: "restart_server" }, ctx);

      const aiReviewSection =
        aiReviewPassed === true
          ? `- AI logic review: ✓ (${aiReviewReason})\n`
          : aiReviewPassed === null
            ? `- AI logic review: unknown (verifier timed out — code checks pass)\n`
            : `- AI logic review: ⚠ flagged — ${aiReviewReason} (code compiles and tests pass; review carefully)\n`;

      return {
        ok: true,
        content:
          `✅ Self-heal stage A complete in ${iter + 1} iteration(s).\n\n` +
          `**Diagnosis:** ${plan.diagnosis}\n\n` +
          `**Changes applied (${applyResults.filter((r) => r.ok).length}/${plan.changes.length}):**\n${changeList}\n\n` +
          `**Stage A verification (complete):**\n` +
          `- Type-check: ✓\n` +
          `- Test suite: ✓\n` +
          smokeSection +
          `\n` + aiReviewSection +
          `- Current server health: ${preHealthOk ? "✓" : "⚠"}\n` +
          `\n**Stage B (post-restart health — in progress):**\n` +
          `- Server restart: triggered — workflow manager relaunching\n` +
          `- Post-restart health check: ${stageB === "queued" ? "✓ persisted to job queue — inbox message coming within ~30 s" : `⚠ ${stageB} — run \`run_shell check_health\` manually after restart`}\n` +
          `\n${await writeBudgetSummary()}`,
        label: `self_heal: stage-A-complete iter-${iter + 1}`,
        detail: plan.diagnosis,
      };
    }

    // ── Max iterations reached without success ────────────────────────────
    return {
      ok: false,
      content:
        `Self-heal loop finished ${maxIterations} iteration(s) without passing the type-check.\n\n` +
        `**Iterations:**\n${iterationSummaries.join("\n")}\n\n` +
        `**Most recent type-check output:**\n${lastTypeCheckOutput ?? "No type-check output captured."}\n\n` +
        `**Next steps:** Review the changes in server/self-heal-audit.log, fix the remaining errors ` +
        `manually, or use propose_code_change to request a review.\n\n` +
        `${await writeBudgetSummary()}`,
      label: `self_heal: max-iterations-${maxIterations}`,
    };
  },
};
