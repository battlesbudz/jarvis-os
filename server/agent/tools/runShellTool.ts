/**
 * run_shell — restricted shell execution tool for the self-heal verify phase.
 *
 * Security model:
 *  - Does NOT accept arbitrary shell strings. The `command` parameter is a
 *    named enum dispatched to a hard-coded (bin, args) pair. This closes
 *    shell-injection vectors entirely.
 *  - `shell: false` is always passed to spawn — no shell interpolation.
 *  - Gated behind isIntegrationOwner (owner-only tool).
 *
 * Allowed commands:
 *  - type_check           → npx tsc --noEmit           (60 s timeout)
 *  - lint                 → npm run lint --if-present   (60 s timeout)
 *  - run_tests            → npm test                    (120 s timeout)
 *  - check_health         → HTTP GET localhost:5000      (immediate)
 *  - reset_circuit_breaker→ clear autonomous write counter (immediate)
 *  - restart_server       → SIGTERM self                (immediate, async)
 */

import { spawn } from "child_process";
import http from "http";
import type { AgentTool } from "../types";
import { isIntegrationOwner } from "../../integrationOwner";
import { resetCircuitBreaker, writeBudgetSummary } from "../safeWritePolicy";

const PROJECT_ROOT = process.cwd();
const MAX_OUTPUT_CHARS = 8_000;

type SafeCommand = "type_check" | "lint" | "run_tests" | "check_health" | "reset_circuit_breaker" | "restart_server";

interface CommandConfig {
  bin: string;
  args: string[];
  timeoutMs: number;
}

const COMMAND_CONFIGS: Record<SafeCommand, CommandConfig> = {
  type_check: {
    bin: "npx",
    args: ["tsc", "--noEmit"],
    timeoutMs: 60_000,
  },
  lint: {
    bin: "npm",
    args: ["run", "lint", "--if-present"],
    timeoutMs: 60_000,
  },
  run_tests: {
    bin: "npm",
    args: ["test"],
    timeoutMs: 120_000,
  },
  // Handled specially — not spawned as a child process
  check_health:          { bin: "", args: [], timeoutMs: 0 },
  reset_circuit_breaker: { bin: "", args: [], timeoutMs: 0 },
  restart_server:        { bin: "", args: [], timeoutMs: 0 },
};

const VALID_COMMANDS = Object.keys(COMMAND_CONFIGS) as SafeCommand[];

/** Perform an HTTP GET and resolve with status code + body snippet. */
function httpGet(url: string, timeoutMs = 5000): Promise<{ status: number; body: string }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ status: -1, body: "Request timed out" });
    }, timeoutMs);

    http.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        clearTimeout(timer);
        const body = Buffer.concat(chunks).toString("utf8").slice(0, 500);
        resolve({ status: res.statusCode ?? 0, body });
      });
      res.on("error", (err) => {
        clearTimeout(timer);
        resolve({ status: -1, body: err.message });
      });
    }).on("error", (err) => {
      clearTimeout(timer);
      resolve({ status: -1, body: err.message });
    });
  });
}

function runProcess(
  bin: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; exitCode: number | null; timedOut: boolean }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let timedOut = false;

    const child = spawn(bin, args, {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false, // ← no shell interpolation
    });

    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      const raw  = Buffer.concat(chunks).toString("utf8");
      const stdout = raw.length > MAX_OUTPUT_CHARS
        ? raw.slice(0, MAX_OUTPUT_CHARS) + "\n…[output truncated]"
        : raw;
      resolve({ stdout, exitCode: code, timedOut });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ stdout: `Failed to spawn '${bin}': ${err.message}`, exitCode: -1, timedOut: false });
    });
  });
}

export const runShellTool: AgentTool = {
  name: "run_shell",
  description:
    "Execute a restricted set of safe shell commands for verification in the self-heal loop. " +
    "Does NOT accept arbitrary shell strings — only named commands from a hard-coded allowlist. " +
    "Commands:\n" +
    "  'type_check'           — runs `npx tsc --noEmit` to check for TypeScript compile errors;\n" +
    "  'lint'                 — runs `npm run lint` if a lint script is configured;\n" +
    "  'run_tests'            — runs `npm test` to execute the full test suite (120 s timeout);\n" +
    "  'check_health'         — HTTP GET to localhost:5000 to confirm the server is responding;\n" +
    "  'reset_circuit_breaker'— clear the autonomous write counter after the owner reviews the audit log;\n" +
    "  'restart_server'       — gracefully restarts the backend process via SIGTERM. " +
    "Verification order: check_health → type_check → run_tests → restart_server. " +
    "Use check_health to confirm baseline, type_check (fast) and run_tests to verify correctness. " +
    "Only call restart_server after all checks pass. " +
    "Use reset_circuit_breaker only after the owner has confirmed the audit log looks correct.",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        enum: VALID_COMMANDS,
        description: `The named command to run. Must be one of: ${VALID_COMMANDS.join(", ")}.`,
      },
    },
    required: ["command"],
  },
  async execute(args, ctx) {
    if (!await isIntegrationOwner(ctx.userId)) {
      return {
        ok: false,
        content: "Access denied: only the account owner may run shell commands.",
        label: "run_shell: forbidden",
      };
    }

    const command = String(args.command ?? "").trim() as SafeCommand;
    if (!VALID_COMMANDS.includes(command)) {
      return {
        ok: false,
        content: `Invalid command '${command}'. Must be one of: ${VALID_COMMANDS.join(", ")}.`,
        label: "run_shell: invalid-command",
      };
    }

    // ── Special commands handled in-process (no child spawn) ─────────────────

    if (command === "check_health") {
      console.log("[SelfHeal] run_shell: check_health → GET http://localhost:5000/");
      const { status, body } = await httpGet("http://localhost:5000/", 5_000);
      const ok = status >= 200 && status < 500;
      return {
        ok,
        content: ok
          ? `Server is responding (HTTP ${status}).`
          : `Server health check failed — HTTP ${status}: ${body.slice(0, 200)}`,
        label: `run_shell: check_health (${status})`,
      };
    }

    if (command === "reset_circuit_breaker") {
      console.log("[SelfHeal] run_shell: reset_circuit_breaker — clearing write counter");
      await resetCircuitBreaker();
      return {
        ok: true,
        content: `Circuit-breaker write counter cleared. ${await writeBudgetSummary()}`,
        label: "run_shell: reset_circuit_breaker",
      };
    }

    // restart_server is handled specially — sends SIGTERM and returns immediately
    if (command === "restart_server") {
      console.log("[SelfHeal] run_shell: scheduling graceful server restart (SIGTERM in 2 s)");
      setTimeout(() => process.kill(process.pid, "SIGTERM"), 2_000);
      return {
        ok: true,
        content: "Server restart scheduled (SIGTERM in 2 seconds). The workflow manager will relaunch the process automatically. The new code will be active after restart.",
        label: "run_shell: restart_server",
      };
    }

    const config = COMMAND_CONFIGS[command];
    console.log(`[SelfHeal] run_shell: ${command} → ${config.bin} ${config.args.join(" ")}`);

    const { stdout, exitCode, timedOut } = await runProcess(
      config.bin,
      config.args,
      config.timeoutMs,
    );

    if (timedOut) {
      return {
        ok: false,
        content:
          `Command '${command}' timed out after ${config.timeoutMs / 1000} s.` +
          (stdout ? `\n\nPartial output:\n${stdout}` : ""),
        label: `run_shell: ${command} (timeout)`,
      };
    }

    const succeeded = exitCode === 0;
    const trimmed   = stdout.trimEnd();

    return {
      ok: succeeded,
      content: succeeded
        ? `${command} passed.${trimmed ? `\n\n\`\`\`\n${trimmed}\n\`\`\`` : ""}`
        : `${command} failed (exit ${exitCode}).\n\n\`\`\`\n${trimmed}\n\`\`\``,
      label: `run_shell: ${command} (exit ${exitCode ?? "?"})`,
    };
  },
};
