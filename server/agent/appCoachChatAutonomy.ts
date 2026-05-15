import {
  routeAutonomyRequest,
  type AutonomyRuntimeDeps,
  type AutonomyRuntimeResult,
} from "./autonomyRuntime";
import { decideAutonomyMode } from "./autonomyPolicy";

export interface AppCoachChatMessage {
  role?: string;
  content?: unknown;
}

export interface AppCoachChatAutonomyInput {
  userId?: string | null;
  messages: AppCoachChatMessage[];
  originChannel?: string;
}

export interface SavedChatHistory {
  userId: string;
  data: unknown[];
}

export interface LoggedInteraction {
  userId: string;
  channel: "app_chat";
  direction: "inbound" | "outbound";
  text: string;
}

export interface AppCoachChatAutonomyDeps extends AutonomyRuntimeDeps {
  saveChatHistory?: (entry: SavedChatHistory) => Promise<void>;
  logInteraction?: (entry: LoggedInteraction) => Promise<void>;
  now?: () => number;
}

export interface AppCoachChatAutonomyResult extends AutonomyRuntimeResult {
  userText?: string;
}

function latestUserText(messages: AppCoachChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role === "user" && typeof message.content === "string") {
      return message.content.trim();
    }
  }
  return "";
}

function appChannelName(originChannel: string | undefined): string {
  const normalized = (originChannel || "").trim().toLowerCase();
  if (normalized === "appchat" || normalized === "app_chat" || normalized === "app") {
    return "App Chat";
  }
  return "App Chat";
}

async function bestEffort(label: string, task: () => Promise<void>): Promise<void> {
  try {
    await task();
  } catch (err) {
    console.warn(`[appCoachChatAutonomy] ${label} failed:`, err);
  }
}

export async function routeAppCoachChatAutonomy(
  input: AppCoachChatAutonomyInput,
  deps: AppCoachChatAutonomyDeps = {},
): Promise<AppCoachChatAutonomyResult> {
  const userId = input.userId?.trim();
  const userText = latestUserText(input.messages);
  const channelName = appChannelName(input.originChannel);

  if (!userId || !userText) {
    return {
      handled: false,
      userText,
      decision: {
        mode: "answer_inline",
        reason: "App chat autonomy requires an authenticated user and a latest user message.",
      },
    };
  }

  const preliminary = decideAutonomyMode({
    userText,
    readiness: "ready",
    hasApproval: false,
  });
  if (
    preliminary.mode !== "queue_background_job" ||
    (preliminary.agentType !== "research" && preliminary.agentType !== "deep_research")
  ) {
    return { handled: false, userText, decision: preliminary };
  }

  const result = await routeAutonomyRequest(
    {
      userId,
      userText,
      channelName,
    },
    deps,
  );

  if (!result.handled || !result.reply) {
    return { ...result, userText };
  }

  const timestamp = deps.now?.() ?? Date.now();
  const userMsgEntry = { id: timestamp.toString(), role: "user", content: userText };
  const asstMsgEntry = { id: (timestamp + 1).toString(), role: "assistant", content: result.reply };
  const updatedChat = [asstMsgEntry, userMsgEntry, ...input.messages].slice(0, 100);

  if (deps.saveChatHistory) {
    await bestEffort("chat history persist", () =>
      deps.saveChatHistory!({ userId, data: updatedChat }),
    );
  }
  if (deps.logInteraction) {
    await bestEffort("inbound interaction log", () =>
      deps.logInteraction!({ userId, channel: "app_chat", direction: "inbound", text: userText }),
    );
    await bestEffort("outbound interaction log", () =>
      deps.logInteraction!({ userId, channel: "app_chat", direction: "outbound", text: result.reply! }),
    );
  }

  return { ...result, userText };
}
