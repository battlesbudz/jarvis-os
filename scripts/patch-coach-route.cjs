const fs = require("node:fs");
const path = require("node:path");

const routesPath = path.resolve(process.cwd(), "server", "routes.ts");
let source = fs.readFileSync(routesPath, "utf8");
const modelRouterPath = path.resolve(process.cwd(), "server", "agent", "modelRouter.ts");
let modelRouterSource = fs.readFileSync(modelRouterPath, "utf8");

if (!modelRouterSource.includes("function maybeUseLeanContext(")) {
  modelRouterSource = modelRouterSource.replace(
    `function messageTextSize(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): number {
  return messages.reduce((sum, message) => sum + textFromContent(message.content).length, 0);
}
`,
    `function messageTextSize(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): number {
  return messages.reduce((sum, message) => sum + textFromContent(message.content).length, 0);
}

function hasToolMessages(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): boolean {
  return messages.some((message) => message.role === "tool");
}

function needsPersonalJarvisContext(text: string): boolean {
  const lower = text.toLowerCase();
  const personalSignals = [
    "my task", "my tasks", "my plan", "my plans", "my goal", "my goals",
    "my memory", "my memories", "remember", "about me", "who am i",
    "what do you know about me", "commitment", "commitments", "calendar",
    "schedule", "meeting", "email", "gmail", "inbox", "telegram", "discord",
    "slack", "profile", "dashboard", "stats", "xp", "habit", "habits",
    "document", "documents", "file", "files", "code", "repo", "repository",
    "screen", "phone", "daemon",
  ];
  return personalSignals.some((signal) => lower.includes(signal));
}

function buildLeanSystemPrompt(): string {
  return [
    "You are GamePlan Coach, Jarvis's chat persona.",
    "Answer the user's latest message directly and keep it concise.",
    "Use only the context included in this request. Do not invent memories, files, user data, live research, or tool results.",
    "If the user asks for current information or an action and a relevant tool is available, use it. If the needed tool or API is unavailable, say that plainly.",
  ].join("\\n");
}

function maybeUseLeanContext(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  logPrefix: string,
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  if (process.env.JARVIS_LEAN_CONTEXT === "0") return messages;

  const inputChars = messageTextSize(messages);
  const maxChars = Number(process.env.JARVIS_LEAN_CONTEXT_CHAR_LIMIT || 12000);
  if (inputChars <= maxChars) return messages;

  if (hasToolMessages(messages)) return messages;

  const lastUserText = getLastUserText(messages);
  const complexity = classifyTaskComplexity(lastUserText);
  if (complexity !== "trivial" && complexity !== "easy") return messages;
  if (needsPersonalJarvisContext(lastUserText)) return messages;

  const historyLimit = Math.max(1, Number(process.env.JARVIS_LEAN_CONTEXT_HISTORY_MESSAGES || 4));
  const nonSystemMessages = messages.filter((message) => message.role !== "system");
  const leanMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: buildLeanSystemPrompt() },
    ...nonSystemMessages.slice(-historyLimit),
  ];

  const leanChars = messageTextSize(leanMessages);
  console.log(
    \`\${logPrefix} lean_context: \${inputChars} chars -> \${leanChars} chars for \${complexity} non-personal request\`,
  );

  return leanMessages;
}
`,
  );
}

modelRouterSource = modelRouterSource.replace(
  `messages: params.messages,`,
  `messages: maybeUseLeanContext(params.messages, logPrefix),`,
);

if (!modelRouterSource.includes("const leanContextApplied = routedMessages !== params.messages;")) {
  modelRouterSource = modelRouterSource.replace(
    /const routedMessages = maybeUseLeanContext\(params\.messages, logPrefix\);\s*/,
    `const routedMessages = maybeUseLeanContext(params.messages, logPrefix);
  const leanContextApplied = routedMessages !== params.messages;
  if (leanContextApplied && params.tools?.length) {
    console.log(\`\${logPrefix} lean_context: omitted \${params.tools.length} tool schema(s)\`);
  }

  `,
  );
}

modelRouterSource = modelRouterSource.replace(
  `tools: params.tools,
      toolChoice: params.toolChoice ?? "none",`,
  `tools: routedMessages !== params.messages ? undefined : params.tools,
      toolChoice: routedMessages !== params.messages ? "none" : (params.toolChoice ?? "none"),`,
);

modelRouterSource = modelRouterSource.replace(
  `tools: leanContextApplied ? undefined : params.tools,
      toolChoice: leanContextApplied ? "none" : (params.toolChoice ?? "none"),`,
  `tools: routedMessages !== params.messages ? undefined : params.tools,
      toolChoice: routedMessages !== params.messages ? "none" : (params.toolChoice ?? "none"),`,
);

fs.writeFileSync(modelRouterPath, modelRouterSource);

if (!source.includes('from "./agent/modelRouter"')) {
  source = source.replace(
    'import { runCapabilityGapAnalysis } from "./agent/capabilityGapAnalyzer";',
    'import { runCapabilityGapAnalysis } from "./agent/capabilityGapAnalyzer";\nimport { routeModelTurn } from "./agent/modelRouter";\nimport type { ProviderTurnResult } from "./agent/providers/base";',
  );
}

const hasImportedCoachModelTurn =
  source.includes('from "./services/aiCoachContextService"') &&
  /\brunCoachModelTurn\b/.test(source);

if (!hasImportedCoachModelTurn && !source.includes("async function runCoachModelTurn(")) {
  const coachHelper = `
async function runCoachModelTurn(
  params: {
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
    tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
    toolChoice: "auto" | "required" | "none";
    maxCompletionTokens: number;
    requestedModel?: string;
    preferRequestedModel?: boolean;
    signal?: AbortSignal;
    userId?: string;
    logPrefix: string;
  },
): Promise<ProviderTurnResult> {
  return routeModelTurn({
    tier: "balanced",
    requestedModel: params.requestedModel,
    preferRequestedModel: params.preferRequestedModel,
    messages: params.messages,
    tools: params.tools,
    toolChoice: params.toolChoice,
    maxCompletionTokens: params.maxCompletionTokens,
    userId: params.userId,
    signal: params.signal,
    logPrefix: params.logPrefix,
  });
}
`;
  const openaiBlocks = [
    `const openai = new OpenAI(getOpenAIClientConfig());
`,
    `const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});
`,
  ];
  for (const block of openaiBlocks) {
    if (source.includes(block)) {
      source = source.replace(block, `${block}${coachHelper}`);
      break;
    }
  }
}

source = source.replace(
  `const phase1 = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: currentMessages,
            tools: requestTools,
            // Force a tool call on turn 0 for device-control requests.
            // Subsequent turns use "auto" so the model can stop and respond.
            tool_choice: (turn === 0 && isDeviceControlRequest) ? "required" : "auto",
            max_completion_tokens: 2048,
          }, { signal });

          const choice = phase1.choices[0];`,
  `const phase1 = await runCoachModelTurn({
            messages: currentMessages,
            tools: requestTools,
            // Force a tool call on turn 0 for device-control requests.
            // Subsequent turns use "auto" so the model can stop and respond.
            toolChoice: (turn === 0 && isDeviceControlRequest) ? "required" : "auto",
            maxCompletionTokens: 2048,
            signal,
            logPrefix: "[CoachChat]",
          });

          const choice = {
            finish_reason: phase1.finishReason,
            message: {
              role: "assistant" as const,
              content: phase1.textContent || null,
              tool_calls: phase1.toolCallList,
            },
          };`,
);

source = source.replace(
  `const stream = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: streamMessages,
        stream: true,
        max_completion_tokens: 8192,
      }, { signal });

      stopKeepalive();
      let fullStreamedReply = '';
      for await (const chunk of stream) {
        if (signal.aborted) break;
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          fullStreamedReply += content;
          if (!clientDisconnected) {
            try { res.write(\`data: \${JSON.stringify({ content })}\\n\\n\`); } catch {}
          }
        }
      }`,
  `const finalTurn = await routeModelTurn({
        tier: "balanced",
        messages: streamMessages,
        maxCompletionTokens: 8192,
        signal,
        logPrefix: "[CoachChatFinal]",
      });

      stopKeepalive();
      const fullStreamedReply = signal.aborted ? "" : finalTurn.textContent;
      if (fullStreamedReply && !clientDisconnected) {
        try { res.write(\`data: \${JSON.stringify({ content: fullStreamedReply })}\\n\\n\`); } catch {}
      }`,
);

fs.writeFileSync(routesPath, source);
console.log("[patch-coach-route] routed /api/coach/chat through model router");
