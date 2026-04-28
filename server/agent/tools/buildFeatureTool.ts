import type { AgentTool, ToolResult, JsonSchema } from "../types";
import { db } from "../../db";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { openclawBuildLog } from "@shared/schema";
import {
  checkCircuitBreaker,
  recordAutonomousWrite,
} from "../safeWritePolicy";

// ── Tool resolver injection ───────────────────────────────────────────────────
// Populated by index.ts after all tools are registered to avoid circular imports.
// Used by testToolTool to look up live registered tools by name.
let _toolResolver: ((name: string) => AgentTool | undefined) | null = null;
export function initToolResolver(resolver: (name: string) => AgentTool | undefined): void {
  _toolResolver = resolver;
}

// ── Result helpers ───────────────────────────────────────────────────────────
function ok(content: string, label?: string, detail?: string): ToolResult {
  return { ok: true, content, label, detail };
}
function fail(content: string, label?: string): ToolResult {
  return { ok: false, content, label };
}

function toCamelCase(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

// ── Apply tool code directly to disk ─────────────────────────────────────────
interface ApplyResult {
  applied: string[];
  warnings: string[];
}

async function applyToolCode(
  featureName: string,
  toolCode: string,
  routeCode?: string | null
): Promise<ApplyResult> {
  const { promises: fs } = await import("fs");
  const path = await import("path");

  const applied: string[] = [];
  const warnings: string[] = [];

  // ── Circuit-breaker guard ────────────────────────────────────────────────
  // build_feature writes are autonomous (LLM-generated), so they count
  // against the same write budget as apply_code_change.
  const circuit = await checkCircuitBreaker();
  if (circuit.tripped) {
    warnings.push(
      `Circuit breaker tripped (${circuit.count}/10 autonomous writes in the last 60 min). ` +
      `Disk writes skipped — budget resets at ${circuit.resetAt?.toISOString() ?? "unknown"}. ` +
      `Ask Jarvis to "reset the write budget" once you have reviewed the recent changes.`
    );
    return { applied, warnings };
  }

  const toolFilePath = `server/agent/tools/${featureName}.ts`;
  const routeFilePath = `server/${featureName}Routes.ts`;

  // 1. Write tool file
  try {
    await fs.mkdir(path.resolve(process.cwd(), "server/agent/tools"), { recursive: true });
    await fs.writeFile(path.resolve(process.cwd(), toolFilePath), toolCode, "utf8");
    await recordAutonomousWrite(toolFilePath);
    applied.push(toolFilePath);
  } catch (err) {
    warnings.push(
      `Failed to write ${toolFilePath}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // 2. Write route file if provided
  if (routeCode) {
    try {
      await fs.mkdir(path.resolve(process.cwd(), "server"), { recursive: true });
      await fs.writeFile(path.resolve(process.cwd(), routeFilePath), routeCode, "utf8");
      await recordAutonomousWrite(routeFilePath);
      applied.push(routeFilePath);
    } catch (err) {
      warnings.push(
        `Failed to write ${routeFilePath}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // 3. Patch index.ts — only if the tool file was written
  const toolFileWritten = applied.includes(toolFilePath);
  if (!toolFileWritten) {
    warnings.push(`Skipping index.ts patch because ${toolFilePath} was not written.`);
    return { applied, warnings };
  }

  try {
    const toolExportName = `${toCamelCase(featureName)}Tool`;
    let actualExportName = toolExportName;

    // Parse the actual export name from the written code
    const exportMatch = toolCode.match(/^export const (\w+)\s*:\s*AgentTool/m);
    if (exportMatch?.[1]) {
      actualExportName = exportMatch[1];
      if (actualExportName !== toolExportName) {
        warnings.push(
          `Tool uses export name \`${actualExportName}\` (expected \`${toolExportName}\`). Registering with actual name.`
        );
      }
    }

    const indexAbsPath = path.resolve(process.cwd(), "server/agent/tools/index.ts");
    let idx = await fs.readFile(indexAbsPath, "utf8");
    let modified = false;

    // a) Import — idempotent
    const importLine = `import { ${actualExportName} } from "./${featureName}";`;
    if (!idx.includes(`from "./${featureName}"`)) {
      const lastImportPos = idx.lastIndexOf("\nimport ");
      if (lastImportPos !== -1) {
        const lineEnd = idx.indexOf("\n", lastImportPos + 1);
        if (lineEnd !== -1) {
          idx = idx.slice(0, lineEnd) + "\n" + importLine + idx.slice(lineEnd);
          modified = true;
        }
      } else {
        warnings.push("Could not locate last import in index.ts — add the import manually.");
      }
    }

    // b) ALL_TOOLS array
    if (!idx.includes(`${actualExportName},`) && !idx.includes(`${actualExportName}\n`)) {
      const allToolsDecl = idx.indexOf("export const ALL_TOOLS");
      if (allToolsDecl !== -1) {
        const close = idx.indexOf("\n];", allToolsDecl);
        if (close !== -1) {
          idx = idx.slice(0, close) + `\n  ${actualExportName},` + idx.slice(close);
          modified = true;
        } else {
          warnings.push(
            `Could not find ALL_TOOLS closing \`];\` in index.ts — add \`${actualExportName},\` manually.`
          );
        }
      } else {
        warnings.push(
          `Could not find ALL_TOOLS in index.ts — add \`${actualExportName},\` manually.`
        );
      }
    }

    // c) telegramCoachTools() base array
    const tcFnIdx = idx.indexOf("telegramCoachTools(");
    if (tcFnIdx !== -1) {
      const tcClose = idx.indexOf("\n  ];", tcFnIdx);
      if (tcClose !== -1) {
        const tcSection = idx.slice(tcFnIdx, tcClose);
        if (!tcSection.includes(`${actualExportName},`) && !tcSection.includes(`${actualExportName}\n`)) {
          idx = idx.slice(0, tcClose) + `\n    ${actualExportName},` + idx.slice(tcClose);
          modified = true;
        }
      } else {
        warnings.push(
          `Could not find telegramCoachTools closing in index.ts — add \`${actualExportName},\` there manually.`
        );
      }
    }

    // d) Re-export block
    const exportBlockStart = idx.lastIndexOf("export {");
    if (exportBlockStart !== -1) {
      const exportBlockClose = idx.indexOf("\n};", exportBlockStart);
      if (exportBlockClose !== -1) {
        const exportSection = idx.slice(exportBlockStart, exportBlockClose);
        if (!exportSection.includes(`${actualExportName},`) && !exportSection.includes(`${actualExportName}\n`)) {
          idx = idx.slice(0, exportBlockClose) + `\n  ${actualExportName},` + idx.slice(exportBlockClose);
          modified = true;
        }
      } else {
        warnings.push(
          `Could not find export block closing in index.ts — add \`${actualExportName},\` to exports manually.`
        );
      }
    }

    if (modified) {
      await fs.writeFile(indexAbsPath, idx, "utf8");
      await recordAutonomousWrite("server/agent/tools/index.ts");
      applied.push("server/agent/tools/index.ts");
    } else {
      warnings.push(`index.ts already contains ${actualExportName} entries — no changes made.`);
    }
  } catch (err) {
    warnings.push(
      `Failed to patch index.ts: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return { applied, warnings };
}

// ── build_feature tool ────────────────────────────────────────────────────────
const TOOL_CODE_TEMPLATE = `
import type { AgentTool, ToolResult } from "../types";

export const exampleTool: AgentTool = {
  name: "example_tool",
  description: "What this tool does and when Jarvis should call it.",
  parameters: {
    type: "object",
    properties: {
      input: { type: "string", description: "The main input for the tool." },
    },
    required: ["input"],
  },
  async execute(args, ctx): Promise<ToolResult> {
    const input = String(args.input ?? "").trim();
    if (!input) return { ok: false, content: "input is required." };
    return { ok: true, content: "Result from tool", label: "example_tool" };
  },
};`.trim();

export const buildFeatureTool: AgentTool = {
  name: "build_feature",
  description:
    "Write a new Jarvis tool to the codebase. Generate the complete TypeScript code yourself and pass it in tool_code — Jarvis writes the file, registers it in index.ts, and runs a smoke test. After a successful build the server restarts automatically so the new tool becomes immediately active. Use this when the user wants a new Jarvis capability or you need to add a new tool to yourself.",
  parameters: {
    type: "object",
    properties: {
      feature_name: {
        type: "string",
        description:
          "Short snake_case name for the new tool, e.g. 'weather_lookup'. Becomes the filename (server/agent/tools/<feature_name>.ts) and the tool.name value.",
      },
      description: {
        type: "string",
        description: "Plain-English description of what the tool does (stored in the build log).",
      },
      tool_code: {
        type: "string",
        description: `Complete TypeScript source for server/agent/tools/<feature_name>.ts. Must export a const of type AgentTool. Follow this pattern exactly:\n\n${TOOL_CODE_TEMPLATE}\n\nRepo key paths:\n- server/agent/tools/<toolName>.ts — one file per tool\n- server/agent/tools/index.ts — auto-patched by build_feature\n- server/<featureName>Routes.ts — Express routes if needed\n- server/index.ts — mount new routers here\n- shared/schema.ts — Drizzle ORM schema\n\nConstraints: no uuid package; use Math.random().toString(36) for IDs; handle errors with return {ok:false}; never throw; use async/await.`,
      },
      route_code: {
        type: "string",
        description:
          "Optional Express route file code for server/<feature_name>Routes.ts. Only needed when the tool requires a new REST endpoint. You must also add the mount line to server/index.ts manually after the build.",
      },
      needs_api_endpoint: {
        type: "boolean",
        description:
          "Set to true if the tool requires a new Express REST endpoint. Provide route_code when true.",
      },
    },
    required: ["feature_name", "description", "tool_code"],
  },
  async execute(args, ctx): Promise<ToolResult> {
    const rawFeatureName = String(args.feature_name ?? "")
      .trim()
      .replace(/\s+/g, "_");
    const featureName = rawFeatureName
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
    const description = String(args.description ?? "").trim();
    const toolCode = String(args.tool_code ?? "").trim();
    const routeCode = args.route_code ? String(args.route_code).trim() : null;
    const needsApiEndpoint = Boolean(args.needs_api_endpoint ?? false);

    if (!featureName)
      return fail("feature_name must be a non-empty snake_case identifier (letters, digits, underscores).");
    if (!description) return fail("description is required.");
    if (!toolCode) return fail("tool_code is required.");

    const writeBuildLog = async (
      outputCode: string,
      success: boolean,
      smokeTestPassed: boolean | null,
      smokeTestArgs?: Record<string, unknown> | null
    ) => {
      try {
        await db.insert(openclawBuildLog).values({
          userId: ctx.userId,
          featureName,
          description,
          outputCode,
          success,
          smokeTestPassed,
          smokeTestArgs: smokeTestArgs ?? null,
        });
      } catch (logErr) {
        console.error("[build_feature] Failed to write build log:", logErr);
      }
    };

    const ctxForSmokeTest = {
      ...ctx,
      allowedToolNames: ctx.allowedToolNames
        ? new Set([...ctx.allowedToolNames, featureName])
        : undefined,
    };

    // Look up the most recent passing smokeTestArgs for this tool so future
    // calls use args that are already known to work instead of re-generating them.
    let priorPassingArgs: Record<string, unknown> | null = null;
    try {
      const priorRows = await db
        .select({ smokeTestArgs: openclawBuildLog.smokeTestArgs })
        .from(openclawBuildLog)
        .where(
          and(
            eq(openclawBuildLog.userId, ctx.userId),
            eq(openclawBuildLog.featureName, featureName),
            eq(openclawBuildLog.smokeTestPassed, true)
          )
        )
        .orderBy(desc(openclawBuildLog.createdAt))
        .limit(1);
      const stored = priorRows[0]?.smokeTestArgs;
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        priorPassingArgs = stored as Record<string, unknown>;
      }
    } catch {
      // Non-fatal — fall through to auto-generation
    }

    // Write files to disk
    const { applied, warnings } = await applyToolCode(
      featureName,
      toolCode,
      needsApiEndpoint ? routeCode : null
    );

    const appliedNote =
      applied.length > 0
        ? `\n\nFiles written:\n${applied.map((f) => `- \`${f}\``).join("\n")}`
        : "";
    const warnNote =
      warnings.length > 0
        ? `\n\nWarnings (manual action may be needed):\n${warnings.map((w) => `- ${w}`).join("\n")}`
        : "";

    if (!applied.includes(`server/agent/tools/${featureName}.ts`)) {
      const errMsg = `Failed to write tool file.${warnNote}`;
      await writeBuildLog(toolCode, false, null);
      return fail(errMsg, "build_feature");
    }

    // Smoke test
    // Prefer previously-passing args; fall back to auto-generating from the tool's JSON Schema.
    const resolvedTool = _toolResolver?.(featureName);
    const smokeTestArgsToUse: Record<string, unknown> =
      priorPassingArgs !== null
        ? priorPassingArgs
        : resolvedTool
        ? generateSmartTestArgs(resolvedTool.parameters)
        : {};

    console.log(`[build_feature] Running smoke test for "${featureName}"`);
    const smokeResult = await testToolTool.execute(
      { tool_name: featureName, test_args: JSON.stringify(smokeTestArgsToUse), _internal: true },
      ctxForSmokeTest
    );

    await writeBuildLog(
      toolCode,
      smokeResult.ok,
      smokeResult.ok,
      smokeResult.ok ? smokeTestArgsToUse : null
    );

    const fullNote = `${appliedNote}${warnNote}`;

    if (smokeResult.ok) {
      // Schedule a graceful self-restart so the new tool becomes active without
      // requiring a manual server restart. The short delay lets the HTTP response
      // reach the client before the process exits.
      setTimeout(() => process.kill(process.pid, "SIGTERM"), 1500);

      return ok(
        `Tool "${featureName}" built and smoke tested successfully.${fullNote}\n\nSmoke test output: ${smokeResult.content}\n\nThe server is restarting now — the new tool will be active in a few seconds.`,
        "build_feature",
        `pass: ${featureName}`
      );
    }

    return {
      ok: false,
      content:
        `Tool "${featureName}" written but smoke test failed.${fullNote}\n\n` +
        `Smoke test error: ${smokeResult.content}\n\n` +
        `Fix the tool_code and call build_feature again with the corrected code.`,
      label: "build_feature",
      detail: `fail: ${featureName}`,
    };
  },
};

// ── Smart dummy arg generator ─────────────────────────────────────────────────
// Inspects a tool's JSON Schema and produces safe dummy values for all required
// fields so smoke tests are more meaningful than calling with an empty object.
function generateSmartTestArgs(schema: JsonSchema): Record<string, unknown> {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const result: Record<string, unknown> = {};

  for (const [key, prop] of Object.entries(properties)) {
    if (!required.has(key)) continue;

    if (prop.enum && prop.enum.length > 0) {
      result[key] = prop.enum[0];
      continue;
    }

    switch (prop.type) {
      case "string":
        result[key] = "test";
        break;
      case "number":
      case "integer":
        result[key] = 1;
        break;
      case "boolean":
        result[key] = false;
        break;
      case "array":
        result[key] = [];
        break;
      case "object":
        result[key] = {};
        break;
      default:
        result[key] = "";
    }
  }

  return result;
}

// ── test_tool ─────────────────────────────────────────────────────────────────
export const testToolTool: AgentTool = {
  name: "test_tool",
  description:
    "Run a smoke test against a registered Jarvis tool by name. Invokes the tool with the provided test arguments (or auto-generated safe values from its schema) and reports whether it passed or failed. Use after build_feature to verify a new tool works before confirming to the user. If the tool is not yet registered, the test will report that clearly.",
  parameters: {
    type: "object",
    properties: {
      tool_name: {
        type: "string",
        description:
          "Exact name of the tool to test (the tool.name value, e.g. 'weather_lookup').",
      },
      test_args: {
        type: "string",
        description:
          "JSON object string of arguments to pass to the tool. Use safe, non-destructive dummy values. If omitted, safe dummy values are auto-generated from the tool's JSON Schema (required fields only).",
      },
    },
    required: ["tool_name"],
  },
  async execute(args, ctx): Promise<ToolResult> {
    const toolName = String(args.tool_name ?? "").trim();
    if (!toolName) return fail("tool_name is required.");

    if (toolName === "test_tool") {
      return fail("test_tool cannot test itself.", "test_tool");
    }

    const META_TOOLS = new Set(["build_feature", "spawn_subagent", "queue_background_job"]);
    if (META_TOOLS.has(toolName)) {
      return fail(
        `"${toolName}" is an orchestration tool and cannot be invoked via smoke test.`,
        "test_tool"
      );
    }

    if (ctx.allowedToolNames && !ctx.allowedToolNames.has(toolName)) {
      return fail(
        `Tool "${toolName}" is not in the allowed tool set for this agent surface.`,
        "test_tool"
      );
    }

    const hasExplicitArgs = args.test_args !== undefined;
    const testArgsRaw = hasExplicitArgs ? String(args.test_args).trim() : "";
    let callerArgs: Record<string, unknown> | null = null;

    if (hasExplicitArgs && testArgsRaw) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(testArgsRaw);
      } catch {
        return fail(`test_args is not valid JSON: ${testArgsRaw}`);
      }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return fail(`test_args must be a JSON object, got: ${testArgsRaw}`);
      }
      callerArgs = parsed as Record<string, unknown>;
    }

    if (!_toolResolver) {
      return fail(
        "Tool resolver not initialized — server may still be starting up. Try again in a moment.",
        "test_tool"
      );
    }

    const tool = _toolResolver(toolName);
    if (!tool) {
      return fail(
        `Tool "${toolName}" is not registered in the live server. ` +
          "Apply the code (add the tool file and register it in index.ts), " +
          "then restart the server so it appears in the registry.",
        "test_tool"
      );
    }

    // Look up the most recent passing smokeTestArgs for this tool so we can
    // reuse them instead of re-generating, giving consistent smoke-test behaviour.
    let priorPassingArgs: Record<string, unknown> | null = null;
    try {
      const priorRows = await db
        .select({ smokeTestArgs: openclawBuildLog.smokeTestArgs })
        .from(openclawBuildLog)
        .where(
          and(
            eq(openclawBuildLog.userId, ctx.userId),
            eq(openclawBuildLog.featureName, toolName),
            eq(openclawBuildLog.smokeTestPassed, true),
            isNotNull(openclawBuildLog.smokeTestArgs)
          )
        )
        .orderBy(desc(openclawBuildLog.createdAt))
        .limit(1);
      const stored = priorRows[0]?.smokeTestArgs;
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        priorPassingArgs = stored as Record<string, unknown>;
      }
    } catch {
      // Non-fatal — fall through to auto-generation
    }

    const testArgs: Record<string, unknown> =
      callerArgs !== null
        ? callerArgs
        : priorPassingArgs !== null
        ? priorPassingArgs
        : generateSmartTestArgs(tool.parameters);

    const argsNote =
      callerArgs !== null
        ? `args: ${JSON.stringify(testArgs)}`
        : priorPassingArgs !== null
        ? `using previously-passing args: ${JSON.stringify(testArgs)}`
        : `auto-generated args: ${JSON.stringify(testArgs)}`;

    const SMOKE_TIMEOUT_MS = 30_000;
    let result: ToolResult;
    try {
      const resultPromise = tool.execute(testArgs, ctx);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`smoke test timed out after ${SMOKE_TIMEOUT_MS / 1000}s`)),
          SMOKE_TIMEOUT_MS
        )
      );
      result = await Promise.race([resultPromise, timeoutPromise]);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        content:
          `Tool "${toolName}" threw an exception during the smoke test (${argsNote}): ${detail}\n\n` +
          "Fix the code in the tool file and call build_feature again with the corrected tool_code.",
        label: "test_tool",
        detail: `throw: ${toolName} — ${detail}`,
      };
    }

    if (result.ok) {
      // Persist manually-supplied passing args so they can be reused next time.
      // Skip when called internally by build_feature — it already writes its own log row.
      const isInternalCall = Boolean(args._internal);
      if (callerArgs !== null && !isInternalCall) {
        try {
          await db.insert(openclawBuildLog).values({
            userId: ctx.userId,
            featureName: toolName,
            description: "manual test",
            outputCode: "",
            success: true,
            smokeTestPassed: true,
            smokeTestArgs: callerArgs,
          });
        } catch {
          // Non-fatal
        }
      }
      return {
        ok: true,
        content: `Smoke test PASSED for "${toolName}" (${argsNote}).\n\nOutput: ${result.content}`,
        label: "test_tool",
        detail: `pass: ${toolName}`,
      };
    }

    return {
      ok: false,
      content:
        `Smoke test FAILED for "${toolName}" (${argsNote}).\n\nError: ${result.content}\n\n` +
        "Fix the code and call build_feature again with the corrected tool_code.",
      label: "test_tool",
      detail: `fail: ${toolName} — ${result.content}`,
    };
  },
};
