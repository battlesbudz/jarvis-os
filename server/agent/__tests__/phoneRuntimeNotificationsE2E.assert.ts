import assert from "node:assert/strict";
import type OpenAI from "openai";

process.env.JARVIS_CODEX_OAUTH_ENABLED = "false";

function chatTool(name: string): OpenAI.Chat.Completions.ChatCompletionTool {
  return {
    type: "function",
    function: {
      name,
      description: `${name} test tool`,
      parameters: { type: "object", properties: {}, required: [] },
    },
  };
}

async function main() {
  const {
    deterministicAndroidToolSummary,
    deterministicPhoneRuntimeToolCallFromRequest,
    isPhoneRuntimeCoveredRequest,
  } = await import("../phoneRuntimeRouting");

  const phoneTools = [
    chatTool("android_open_app"),
    chatTool("android_capture_screen"),
    chatTool("android_read_notifications"),
  ];
  const connectedPhoneRuntime = { androidActive: true, phoneRuntimeCoveredRequest: true };

  for (const requestText of [
    "Read my notifications",
    "What are my notifications?",
    "android_read _notifications and tell me what they are",
  ]) {
    assert.equal(
      isPhoneRuntimeCoveredRequest(requestText),
      true,
      `${requestText} should enter the deterministic Phone Runtime route`,
    );
    const toolCall = deterministicPhoneRuntimeToolCallFromRequest(requestText, phoneTools, connectedPhoneRuntime);
    assert.equal(toolCall?.function.name, "android_read_notifications");
  }

  assert.equal(
    deterministicPhoneRuntimeToolCallFromRequest("Read my notifications", phoneTools, {
      androidActive: false,
      phoneRuntimeCoveredRequest: false,
    }),
    null,
    "offline Android Device Control must not use the deterministic notification shortcut",
  );

  assert.equal(
    isPhoneRuntimeCoveredRequest("Summarize how Android notifications work."),
    false,
    "informational notification questions should not force phone-control routing",
  );
  assert.equal(
    deterministicPhoneRuntimeToolCallFromRequest("Do not read my notifications.", phoneTools, connectedPhoneRuntime),
    null,
    "negated notification requests must not run phone control",
  );
  assert.equal(
    deterministicPhoneRuntimeToolCallFromRequest("Read my notifications and then open Gmail.", phoneTools, connectedPhoneRuntime),
    null,
    "compound phone requests must stay in the multi-tool loop",
  );
  assert.equal(
    deterministicPhoneRuntimeToolCallFromRequest("Read my notifications and open Gmail.", phoneTools, connectedPhoneRuntime),
    null,
    "plain-and compound phone requests must stay in the multi-tool loop",
  );
  assert.equal(
    deterministicPhoneRuntimeToolCallFromRequest("Do I have any Gmail notifications?", phoneTools, connectedPhoneRuntime),
    null,
    "filtered notification requests must let the normal loop apply the filter",
  );
  assert.equal(
    deterministicPhoneRuntimeToolCallFromRequest("Read my notifications but only give me the count.", phoneTools, connectedPhoneRuntime),
    null,
    "count-only notification requests must not stream the broad notification list",
  );

  const finalText = deterministicAndroidToolSummary("android_read_notifications", {
    result: "success",
    label: "2 notifications",
    detail: JSON.stringify({
      notifications: [
        { app: "Life360", title: "Justin arrived Home", text: "", ts: Date.now() },
        { app: "Codex", title: "PR review finished", text: "No major issues found", ts: Date.now() },
      ],
      source: "notification_listener",
    }),
  }, {
    deterministicToolCall: true,
  });

  assert.match(finalText ?? "", /Life360/);
  assert.match(finalText ?? "", /Codex/);
  assert.doesNotMatch(finalText ?? "", /cannot|do not have access|language model/i);
  assert.equal(
    deterministicAndroidToolSummary("android_read_notifications", {
      result: "success",
      label: "2 notifications",
      detail: JSON.stringify({
        notifications: [
          { app: "Life360", title: "Justin arrived Home", text: "", ts: Date.now() },
          { app: "Codex", title: "PR review finished", text: "No major issues found", ts: Date.now() },
        ],
      }),
    }),
    null,
    "model-selected notification tool calls must not short-circuit the multi-tool loop",
  );

  console.log("All Phone Runtime notification E2E contract assertions passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
