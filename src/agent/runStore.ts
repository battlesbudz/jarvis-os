import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ConversationState, StateAccessor, Tool } from "@openrouter/agent";

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
  status: AgentSdkRunStatus;
  draft?: { to: string; subject: string; body: string };
  pendingToolCallId?: string;
  gateId?: string;
  createdAt: string;
  updatedAt: string;
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
    } catch {
      return null;
    }
  }

  async function save(record: AgentSdkRunRecord): Promise<void> {
    await mkdir(rootDir, { recursive: true });
    await writeFile(fileFor(record.meta.runId), JSON.stringify(record, null, 2), "utf8");
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
