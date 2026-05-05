const fs = require("node:fs");
const path = require("node:path");

const routesPath = path.resolve(process.cwd(), "server", "routes.ts");
let source = fs.readFileSync(routesPath, "utf8");

if (!source.includes('from "./agent/modelRouter"')) {
  source = source.replace(
    'import { runCapabilityGapAnalysis } from "./agent/capabilityGapAnalyzer";',
    'import { runCapabilityGapAnalysis } from "./agent/capabilityGapAnalyzer";\nimport { routeModelTurn } from "./agent/modelRouter";\nimport type { ProviderTurnResult } from "./agent/providers/base";',
  );
}

if (!source.includes("async function runCoachModelTurn(")) {
  source = source.replace(
    `const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});
`,
    `const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

async function runCoachModelTurn(
  params: {
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
    tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
    toolChoice: "auto" | "required" | "none";
    maxCompletionTokens: number;
    signal?: AbortSignal;
    logPrefix: string;
  },
): Promise<ProviderTurnResult> {
  return routeModelTurn({
    tier: "balanced",
    messages: params.messages,
    tools: params.tools,
    toolChoice: params.toolChoice,
    maxCompletionTokens: params.maxCompletionTokens,
    signal: params.signal,
    logPrefix: params.logPrefix,
  });
}
`,
  );
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
