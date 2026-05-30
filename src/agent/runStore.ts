import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type ConversationState<TTools = unknown> = Record<string, unknown> & {
  id?: string;
  status?: string;
  createdAt?: number;
  updatedAt?: number;
  messages?: unknown[];
  pendingToolCalls?: unknown[];
  tools?: TTools;
};

export type Tool = Record<string, unknown>;

export interface StateAccessor<TTools extends readonly Tool[] = readonly Tool[]> {
  load(): Promise<ConversationState<TTools> | null>;
  save(state: ConversationState<TTools>): Promise<void>;
}

export type AgentSdkRunStatus =
  | "running"
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "complete"
  | "failed";

export interface AgentSdkRunMeta {
  runId: string;
  userId: string;
  originChannel: "app" | "telegram" | string;
  originChannelId?: string;
  workflow?: "email_send_approval" | "email_draft_only" | "internal_reminder";
  status: AgentSdkRunStatus;
  draft?: { to: string; subject: string; body: string };
  reminder?: { id?: string; title: string; scheduledAt: string; recurrence?: string | null; deduped?: boolean };
  pendingToolCallId?: string;
  gateId?: string;
  createdAt: string;
  updatedAt: string;
  resumedAt?: string;
  completedAt?: string;
  maxCostUsd?: number;
  maxSteps?: number;
  model?: string;
  usage?: unknown;
  error?: string;
}

export interface AgentSdkRunRecord {
  meta: AgentSdkRunMeta;
  state: ConversationState<any> | null;
}

export interface AgentSdkRunStore {
  load(runId: string): Promise<AgentSdkRunRecord | null>;
  save(record: AgentSdkRunRecord): Promise<void>;
  createStateAccessor<TTools extends readonly Tool[] = readonly Tool[]>(runId: string): StateAccessor<TTools>;
}

function safeRunId(runId: string): string {
  return runId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function createFileAgentSdkRunStore(
  rootDir = path.join(process.cwd(), ".jarvis", "runtime", "agent-sdk-runs"),
): AgentSdkRunStore {
  const fileFor = (runId: string) => path.join(rootDir, `${safeRunId(runId)}.json`);

  async function load(runId: string): Promise<AgentSdkRunRecord | null> {
    try {
      return JSON.parse(await readFile(fileFor(runId), "utf8")) as AgentSdkRunRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async function atomicWrite(filePath: string, contents: string): Promise<void> {
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpPath, contents, "utf8");
    await rename(tmpPath, filePath);
  }

  async function save(record: AgentSdkRunRecord): Promise<void> {
    await mkdir(rootDir, { recursive: true });
    await atomicWrite(fileFor(record.meta.runId), JSON.stringify(record, null, 2));
  }

  return {
    load,
    save,
    createStateAccessor<TTools extends readonly Tool[] = readonly Tool[]>(runId: string): StateAccessor<TTools> {
      return {
        load: async () => ((await load(runId))?.state as ConversationState<TTools> | null) ?? null,
        save: async (state) => {
          const existing = await load(runId);
          const now = new Date().toISOString();
          await save({
            meta: existing?.meta ?? {
              runId,
              userId: "unknown",
              originChannel: "unknown",
              status: "running",
              createdAt: now,
              updatedAt: now,
            },
            state: state as ConversationState<any>,
          });
        },
      };
    },
  };
}
