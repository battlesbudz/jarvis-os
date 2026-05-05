import fs from "fs/promises";
import path from "path";
import type { AgentTool, ToolArgs, ToolContext } from "../types";

type SourceType = "conversation" | "email" | "document" | "research" | "manual";
type LearningStatus = "confirmed" | "needs_review" | "draft";

const DEFAULT_TARGETS = {
  current_state: "workspaces/battles/daily-command-center/current-state.md",
  battles_budz_context: "workspaces/battles/business/battles-budz/CONTEXT.md",
  licensing_readiness: "workspaces/battles/business/battles-budz/licensing/2026-05-05-licensing-readiness-checklist-draft-v1.md",
  compliance_readiness: "workspaces/battles/business/battles-budz/compliance/2026-05-05-compliance-readiness-checklist-draft-v1.md",
  facility_readiness: "workspaces/battles/business/battles-budz/facility/2026-05-05-facility-readiness-checklist-draft-v1.md",
  product_readiness: "workspaces/battles/business/battles-budz/products/2026-05-05-product-readiness-matrix-draft-v1.md",
  first_revenue_plan: "workspaces/battles/business/battles-budz/revenue/2026-05-05-first-revenue-action-plan-draft-v1.md",
} as const;

const VALID_SOURCE_TYPES: SourceType[] = ["conversation", "email", "document", "research", "manual"];
const VALID_STATUSES: LearningStatus[] = ["confirmed", "needs_review", "draft"];

interface LivingContextToolOptions {
  rootDir?: string;
  targets?: Record<string, string>;
  auditLogPath?: string;
  requireOwner?: boolean;
  now?: () => Date;
}

function normalizeForDedup(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function clampConfidence(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 70;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function cleanSingleLine(value: unknown, fallback = ""): string {
  return String(value ?? fallback).replace(/\r?\n/g, " ").trim();
}

function resolveTarget(rootDir: string, targets: Record<string, string>, key: string): { rel: string; abs: string } | null {
  const rel = targets[key];
  if (!rel) return null;
  if (path.isAbsolute(rel) || rel.includes("..")) return null;

  const abs = path.resolve(rootDir, rel);
  const allowedRoot = path.resolve(rootDir, "workspaces", "battles");
  if (!(abs === allowedRoot || abs.startsWith(allowedRoot + path.sep))) return null;
  if (path.extname(abs).toLowerCase() !== ".md") return null;
  return { rel: rel.replace(/\\/g, "/"), abs };
}

async function appendAudit(auditLogPath: string, entry: Record<string, unknown>): Promise<void> {
  try {
    await fs.mkdir(path.dirname(auditLogPath), { recursive: true });
    await fs.appendFile(auditLogPath, JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    // Audit logging is best effort; the file write result is still returned to the user.
  }
}

function ensureLearnedUpdatesSection(content: string): string {
  if (/^## Learned Updates\s*$/m.test(content)) return content.trimEnd();
  return `${content.trimEnd()}

## Learned Updates
<!-- Jarvis appends dated, source-backed updates here when a conversation, email, document, or research result answers an open question. These notes are draft context unless explicitly approved for official action. -->`;
}

function formatLearning(args: ToolArgs, now: Date): {
  block: string;
  learned: string;
  status: LearningStatus;
  confidence: number;
  sourceType: SourceType;
} {
  const topic = cleanSingleLine(args.topic, "Context update").slice(0, 120);
  const learned = String(args.learned ?? "").trim();
  const sourceTypeRaw = cleanSingleLine(args.sourceType, "conversation") as SourceType;
  const sourceType = VALID_SOURCE_TYPES.includes(sourceTypeRaw) ? sourceTypeRaw : "conversation";
  const statusRaw = cleanSingleLine(args.status, "needs_review") as LearningStatus;
  const status = VALID_STATUSES.includes(statusRaw) ? statusRaw : "needs_review";
  const confidence = clampConfidence(args.confidence);
  const sourceRef = cleanSingleLine(args.sourceRef, "").slice(0, 200);
  const fillsQuestion = cleanSingleLine(args.fillsQuestion, "").slice(0, 240);
  const notes = String(args.notes ?? "").trim();
  const approvalSensitive = Boolean(args.approvalSensitive);
  const finalStatus: LearningStatus = approvalSensitive && status === "confirmed" ? "needs_review" : status;

  const lines = [
    `### ${now.toISOString().slice(0, 10)} - ${topic}`,
    `- Source: ${sourceType}${sourceRef ? ` (${sourceRef})` : ""}`,
    `- Confidence: ${confidence}`,
    `- Status: ${finalStatus}`,
    `- Learned: ${learned}`,
  ];
  if (fillsQuestion) lines.push(`- Fills: ${fillsQuestion}`);
  if (approvalSensitive) {
    lines.push("- Approval boundary: This may inform planning, but official compliance, licensing, financial, or external actions still require explicit approval from Battles.");
  }
  if (notes) lines.push(`- Notes: ${notes}`);

  return { block: lines.join("\n"), learned, status: finalStatus, confidence, sourceType };
}

export function createLivingContextUpdateTool(options: LivingContextToolOptions = {}): AgentTool {
  const rootDir = options.rootDir ?? process.cwd();
  const targets = options.targets ?? DEFAULT_TARGETS;
  const auditLogPath = options.auditLogPath ?? path.join(rootDir, "server", "living-context-audit.log");
  const requireOwner = options.requireOwner ?? true;
  const now = options.now ?? (() => new Date());
  const targetKeys = Object.keys(targets);

  return {
    name: "living_context_update",
    description:
      "Read or append source-backed updates to allow-listed Battles workspace markdown files. " +
      "Use this when a conversation, email, document, or research result answers an open readiness question, such as OCM status, facility readiness, product path, compliance gaps, or first-revenue blockers. " +
      "This tool appends dated Learned Updates only; it cannot edit arbitrary files, delete content, or mark official compliance/licensing/financial actions as approved.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list_targets", "read", "append_learning"],
          description: "list_targets returns allowed files; read returns one file; append_learning adds a dated learned update.",
        },
        target: {
          type: "string",
          enum: targetKeys,
          description: "Allowed living document target.",
        },
        topic: {
          type: "string",
          description: "Short heading for the learned update.",
        },
        learned: {
          type: "string",
          description: "The concrete fact learned. Required for append_learning.",
        },
        sourceType: {
          type: "string",
          enum: VALID_SOURCE_TYPES,
          description: "Where the information came from.",
        },
        sourceRef: {
          type: "string",
          description: "Optional source reference, such as email subject/sender/date or conversation turn.",
        },
        confidence: {
          type: "number",
          description: "0-100 confidence. Use 90+ for direct user statements or clear source docs.",
        },
        status: {
          type: "string",
          enum: VALID_STATUSES,
          description: "confirmed for direct user/source facts; needs_review for sensitive or uncertain facts; draft for tentative notes.",
        },
        fillsQuestion: {
          type: "string",
          description: "Optional open question this update answers.",
        },
        approvalSensitive: {
          type: "boolean",
          description: "True when this touches licensing, compliance, finances, external commitments, or official action.",
        },
        notes: {
          type: "string",
          description: "Optional short note about implication or next step.",
        },
      },
      required: ["action"],
    },
    async execute(args: ToolArgs, ctx: ToolContext) {
      if (requireOwner) {
        const { isIntegrationOwner } = await import("../../integrationOwner");
        if (!(await isIntegrationOwner(ctx.userId))) {
          return {
            ok: false,
            content: "Access denied: living_context_update is restricted to the integration owner.",
            label: "living_context_update: forbidden",
          };
        }
      }

      const action = cleanSingleLine(args.action, "list_targets");

      if (action === "list_targets") {
        const lines = targetKeys.map((key) => `- ${key}: ${targets[key]}`);
        return {
          ok: true,
          content: `Allowed living context targets:\n${lines.join("\n")}`,
          label: "living_context_update: list targets",
        };
      }

      const targetKey = cleanSingleLine(args.target);
      const resolved = resolveTarget(rootDir, targets, targetKey);
      if (!resolved) {
        return {
          ok: false,
          content: `Invalid target "${targetKey}". Use action=list_targets to see allowed targets.`,
          label: "living_context_update: invalid target",
        };
      }

      if (action === "read") {
        const content = await fs.readFile(resolved.abs, "utf-8").catch(() => "");
        return {
          ok: true,
          content: content || "(file is empty or missing)",
          label: `living_context_update: read ${targetKey}`,
        };
      }

      if (action === "append_learning") {
        const { block, learned, status, confidence, sourceType } = formatLearning(args, now());
        if (!learned) {
          return {
            ok: false,
            content: "learned is required for append_learning.",
            label: "living_context_update: missing learned",
          };
        }

        const existing = await fs.readFile(resolved.abs, "utf-8").catch(() => "");
        if (normalizeForDedup(existing).includes(normalizeForDedup(learned))) {
          return {
            ok: true,
            content: `No write needed. ${targetKey} already appears to contain this learned fact.`,
            label: `living_context_update: duplicate ${targetKey}`,
          };
        }

        const updated = `${ensureLearnedUpdatesSection(existing)}\n\n${block}\n`;
        await fs.mkdir(path.dirname(resolved.abs), { recursive: true });
        await fs.writeFile(resolved.abs, updated, "utf-8");
        await appendAudit(auditLogPath, {
          ts: now().toISOString(),
          event: "living_context_append",
          userId: ctx.userId,
          target: targetKey,
          path: resolved.rel,
          sourceType,
          status,
          confidence,
          preview: learned.slice(0, 160),
        });

        return {
          ok: true,
          content: `Appended learned update to ${resolved.rel}. Official actions still require explicit approval when applicable.`,
          label: `living_context_update: append ${targetKey}`,
          metadata: { target: targetKey, path: resolved.rel, status, confidence },
        };
      }

      return {
        ok: false,
        content: `Unknown action "${action}".`,
        label: "living_context_update: bad action",
      };
    },
  };
}

export const livingContextUpdateTool = createLivingContextUpdateTool();
