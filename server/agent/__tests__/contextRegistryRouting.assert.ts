import assert from "node:assert/strict";
import { contextRegistry } from "../contextRegistry";

async function build(message: string) {
  return contextRegistry.build({
    userId: "test-user",
    platform: "test",
    userMessage: message,
  });
}

async function main() {
  {
  const ctx = await build("Draft an email to a partner and schedule a follow up.");
  assert.match(ctx.systemContext, /Jarvis Workspace Router/);
  assert.match(ctx.systemContext, /Task type: communications/);
  assert.match(ctx.systemContext, /agents\/crew\/communications\.md/);
  assert.match(ctx.systemContext, /agents\/TOOL_POLICY\.md/);
  assert.match(ctx.systemContext, /workspaces\/battles\/business\/CONTEXT\.md/);
  console.log("OK: communications tasks load HERALD, business context, and tool policy");
  }

  {
  const ctx = await build("Research cannabis compliance rules and cite sources.");
  assert.match(ctx.systemContext, /Task type: research/);
  assert.match(ctx.systemContext, /agents\/crew\/research\.md/);
  assert.match(ctx.systemContext, /workspaces\/battles\/research\/CONTEXT\.md/);
  console.log("OK: research tasks load ATLAS and research workspace context");
  }

  {
  const ctx = await build("Remember this as a personal preference for my life context.");
  assert.match(ctx.systemContext, /Task type: memory/);
  assert.match(ctx.systemContext, /agents\/crew\/memory\.md/);
  assert.match(ctx.systemContext, /workspaces\/battles\/personal-life\/CONTEXT\.md/);
  console.log("OK: memory tasks load ECHO and personal-life workspace context");
  }

  {
  const ctx = await build("Fix the TypeScript bug in the server API.");
  assert.match(ctx.systemContext, /Task type: code\/app/);
  assert.match(ctx.systemContext, /docs\/workspace-map\.md/);
  assert.match(ctx.systemContext, /agents\/TOOL_POLICY\.md/);
  console.log("OK: code tasks load workspace map and tool policy");
  }

  {
  const ctx = await build("Say hello.");
  assert.match(ctx.systemContext, /Jarvis Workspace Router/);
  assert.match(ctx.systemContext, /agents\/ROUTING\.md/);
  assert.doesNotMatch(ctx.systemContext, /### agents\/TOOL_POLICY\.md/);
  console.log("OK: simple general tasks avoid loading tool policy");
  }

  console.log("\nAll context registry routing assertions passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
