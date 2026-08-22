import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _setHostedCodexProcessFactoryForTesting,
  runHostedCodexPrompt,
} from "../providers/codexHostedAppServer";
import {
  _setCodexOAuthHostedRuntimeForTesting,
  CodexFinalContentStreamParser,
  CodexOAuthProvider,
} from "../providers/codexOAuth";

function fakeJwt(accountId: string, planType = "plus"): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode({
    "https://api.openai.com/auth": {
      chatgpt_account_id: accountId,
      chatgpt_plan_type: planType,
    },
  })}.signature`;
}

async function testAppServerProtocol(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-hosted-codex-test-"));
  const scriptPath = join(dir, "fake-app-server.mjs");
  const statePath = join(dir, "state.json");
  await writeFile(scriptPath, `
import fs from "node:fs";
import readline from "node:readline";
const statePath = ${JSON.stringify(statePath)};
const state = { initialize: null, login: null, refresh: null, thread: null, turn: null };
const save = () => fs.writeFileSync(statePath, JSON.stringify(state));
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === 900 && !message.method) {
    state.refresh = {
      hasAccessToken: Boolean(message.result?.accessToken),
      accountId: message.result?.chatgptAccountId,
      planType: message.result?.chatgptPlanType,
    };
    save();
    return;
  }
  if (message.method === "initialize") {
    state.initialize = message.params;
    save();
    send({ id: message.id, result: { userAgent: "fake" } });
    return;
  }
  if (message.method === "account/login/start") {
    state.login = {
      type: message.params.type,
      hasAccessToken: Boolean(message.params.accessToken),
      accountId: message.params.chatgptAccountId,
      planType: message.params.chatgptPlanType,
    };
    save();
    send({ id: message.id, result: { type: "chatgptAuthTokens" } });
    send({ id: 900, method: "account/chatgptAuthTokens/refresh", params: { reason: "unauthorized" } });
    return;
  }
  if (message.method === "thread/start") {
    state.thread = message.params;
    save();
    send({ id: message.id, result: { thread: { id: "thread-hosted" } } });
    return;
  }
  if (message.method === "turn/start") {
    state.turn = message.params;
    save();
    const completedOnly = message.params.input?.[0]?.text?.includes("COMPLETED_ONLY");
    process.stdout.write([
      JSON.stringify({ id: message.id, result: { turn: { id: "turn-hosted" } } }),
      ...(completedOnly
        ? [JSON.stringify({ method: "item/completed", params: { turnId: "turn-hosted", item: { type: "agentMessage", text: "COMPLETED_ONLY" } } })]
        : [
            JSON.stringify({ method: "item/agentMessage/delta", params: { turnId: "turn-hosted", delta: "HOSTED_" } }),
            JSON.stringify({ method: "item/agentMessage/delta", params: { turnId: "turn-hosted", delta: "OK" } }),
          ]),
      JSON.stringify({ method: "turn/completed", params: { turn: { id: "turn-hosted", status: "completed" } } }),
    ].join("\\n") + "\\n");
  }
});
save();
`, "utf8");

  let processOptions: { cwd: string; codexHome: string } | null = null;
  _setHostedCodexProcessFactoryForTesting((_command, _args, options) => {
    processOptions = options;
    return {
      child: spawn(process.execPath, [scriptPath], { stdio: ["pipe", "pipe", "pipe"] }),
    };
  });
  try {
    const streamedDeltas: string[] = [];
    const answer = await runHostedCodexPrompt({
      accessToken: fakeJwt("acct-initial"),
      chatgptAccountId: "acct-initial",
      chatgptPlanType: "plus",
      prompt: "Reply with HOSTED_OK",
      onDelta: (delta) => streamedDeltas.push(delta),
      refreshTokens: async () => ({
        accessToken: fakeJwt("acct-refreshed", "pro"),
        chatgptAccountId: "acct-refreshed",
        chatgptPlanType: "pro",
      }),
    });
    assert.equal(answer, "HOSTED_OK");
    assert.deepEqual(streamedDeltas, ["HOSTED_", "OK"]);
    const completedOnlyDeltas: string[] = [];
    const completedOnlyAnswer = await runHostedCodexPrompt({
      accessToken: fakeJwt("acct-initial"),
      chatgptAccountId: "acct-initial",
      chatgptPlanType: "plus",
      prompt: "Reply with COMPLETED_ONLY",
      onDelta: (delta) => completedOnlyDeltas.push(delta),
      refreshTokens: async () => ({
        accessToken: fakeJwt("acct-refreshed", "pro"),
        chatgptAccountId: "acct-refreshed",
        chatgptPlanType: "pro",
      }),
    });
    assert.equal(completedOnlyAnswer, "COMPLETED_ONLY");
    assert.deepEqual(completedOnlyDeltas, ["COMPLETED_ONLY"]);
    const state = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(state.initialize.capabilities.experimentalApi, true);
    assert.deepEqual(state.login, {
      type: "chatgptAuthTokens",
      hasAccessToken: true,
      accountId: "acct-initial",
      planType: "plus",
    });
    assert.deepEqual(state.refresh, {
      hasAccessToken: true,
      accountId: "acct-refreshed",
      planType: "pro",
    });
    assert.equal(state.thread.approvalPolicy, "never");
    assert.equal(state.thread.sandbox, "read-only");
    assert.equal(state.thread.cwd, processOptions?.cwd);
    assert.notEqual(processOptions?.cwd, process.cwd());
    assert.notEqual(processOptions?.codexHome, process.env.CODEX_HOME);
    assert.equal(state.turn.sandboxPolicy.type, "readOnly");
    assert.equal(state.turn.sandboxPolicy.networkAccess, false);
  } finally {
    _setHostedCodexProcessFactoryForTesting(null);
    await rm(dir, { recursive: true, force: true });
  }
}

async function testProviderStreamsPlainFinalContent(): Promise<void> {
  const token = fakeJwt("acct-stream", "plus");
  let runnerFinished = false;
  _setCodexOAuthHostedRuntimeForTesting({
    credentialResolver: async () => ({
      provider: "openai",
      authType: "oauth",
      credential: token,
      refreshToken: "refresh-token",
      expiresAt: new Date(Date.now() + 60_000),
      accountId: "acct-stream",
      email: "user@example.com",
    }),
    credentialRefresher: async () => ({
      provider: "openai",
      authType: "oauth",
      credential: token,
      refreshToken: "refresh-token",
      expiresAt: new Date(Date.now() + 60_000),
      accountId: "acct-stream",
      email: "user@example.com",
    }),
    promptRunner: async (input) => {
      input.onDelta?.('Hello');
      await new Promise<void>((resolve) => setImmediate(resolve));
      input.onDelta?.(' world\nright away');
      await new Promise<void>((resolve) => setImmediate(resolve));
      runnerFinished = true;
      return 'Hello world\nright away';
    },
  });

  try {
    const provider = new CodexOAuthProvider();
    const chunks = [];
    const completionStates: boolean[] = [];
    for await (const chunk of provider.query({
      model: "chatgpt-codex-oauth/auto",
      messages: [{ role: "user", content: "Hello" }],
      toolChoice: "none",
      maxCompletionTokens: 64,
      preferredAuthType: "oauth",
      stream: true,
      userId: "user-1",
    })) {
      chunks.push(chunk);
      if (chunk.type === "text") completionStates.push(runnerFinished);
    }
    assert.deepEqual(chunks, [
      { type: "text", delta: "Hello" },
      { type: "text", delta: " world\nright away" },
      { type: "finish", reason: "stop" },
    ]);
    assert.deepEqual(completionStates, [false, false]);
  } finally {
    _setCodexOAuthHostedRuntimeForTesting(null);
  }
}

function testStructuredStreamOnlyEmitsFinalContent(): void {
  const finalParser = new CodexFinalContentStreamParser();
  assert.equal(finalParser.push('{"type":"fi'), "");
  assert.equal(finalParser.push('nal","content":"Hello\\n'), "Hello\n");
  assert.equal(finalParser.push('world"}'), "world");

  const toolParser = new CodexFinalContentStreamParser();
  assert.equal(toolParser.push(
    '{"type":"tool_calls","tool_calls":[{"name":"daemon_action","arguments":{"action":"file_write","content":"private file body"}}]}',
  ), "");
}

async function testStreamingProviderPropagatesCancellation(): Promise<void> {
  const token = fakeJwt("acct-abort", "plus");
  _setCodexOAuthHostedRuntimeForTesting({
    credentialResolver: async () => ({
      provider: "openai",
      authType: "oauth",
      credential: token,
      refreshToken: "refresh-token",
      expiresAt: new Date(Date.now() + 60_000),
      accountId: "acct-abort",
      email: "user@example.com",
    }),
    credentialRefresher: async () => ({
      provider: "openai",
      authType: "oauth",
      credential: token,
      refreshToken: "refresh-token",
      expiresAt: new Date(Date.now() + 60_000),
      accountId: "acct-abort",
      email: "user@example.com",
    }),
    promptRunner: async (input) => new Promise<string>((_resolve, reject) => {
      input.onDelta?.('partial');
      const abort = () => reject(new DOMException("aborted", "AbortError"));
      if (input.signal?.aborted) abort();
      else input.signal?.addEventListener("abort", abort, { once: true });
    }),
  });

  try {
    const controller = new AbortController();
    const provider = new CodexOAuthProvider();
    const iterator = provider.query({
      model: "chatgpt-codex-oauth/auto",
      messages: [{ role: "user", content: "Hello" }],
      toolChoice: "none",
      maxCompletionTokens: 64,
      preferredAuthType: "oauth",
      stream: true,
      userId: "user-1",
      signal: controller.signal,
    });
    assert.deepEqual(await iterator.next(), {
      value: { type: "text", delta: "partial" },
      done: false,
    });
    controller.abort();
    await assert.rejects(() => iterator.next(), (error: unknown) => (
      error instanceof Error && error.name === "AbortError"
    ));
  } finally {
    _setCodexOAuthHostedRuntimeForTesting(null);
  }
}

async function testProviderUsesHostedSubscription(): Promise<void> {
  const initialToken = fakeJwt("acct-user", "plus");
  const refreshedToken = fakeJwt("acct-user", "pro");
  let refreshCalled = false;
  let hostedInput: any = null;
  _setCodexOAuthHostedRuntimeForTesting({
    credentialResolver: async () => ({
      provider: "openai",
      authType: "oauth",
      credential: initialToken,
      refreshToken: "refresh-token",
      expiresAt: new Date(Date.now() + 60_000),
      accountId: null,
      email: "user@example.com",
    }),
    credentialRefresher: async () => {
      refreshCalled = true;
      return {
        provider: "openai",
        authType: "oauth",
        credential: refreshedToken,
        refreshToken: "refresh-token-2",
        expiresAt: new Date(Date.now() + 120_000),
        accountId: "acct-user",
        email: "user@example.com",
      };
    },
    promptRunner: async (input) => {
      hostedInput = input;
      const refreshed = await input.refreshTokens?.();
      assert.equal(refreshed?.accessToken, refreshedToken);
      assert.equal(refreshed?.chatgptPlanType, "pro");
      return "subscription provider ok";
    },
  });

  try {
    const provider = new CodexOAuthProvider();
    const chunks = [];
    for await (const chunk of provider.query({
      model: "chatgpt-codex-oauth/auto",
      messages: [{ role: "user", content: "Hello" }],
      toolChoice: "none",
      maxCompletionTokens: 64,
      preferredAuthType: "oauth",
      stream: false,
      userId: "user-1",
    })) {
      chunks.push(chunk);
    }
    assert.equal(hostedInput.chatgptAccountId, "acct-user");
    assert.equal(hostedInput.chatgptPlanType, "plus");
    assert.equal(refreshCalled, true);
    assert.deepEqual(chunks, [
      { type: "text", delta: "subscription provider ok" },
      { type: "finish", reason: "stop" },
    ]);
  } finally {
    _setCodexOAuthHostedRuntimeForTesting(null);
  }
}

async function main(): Promise<void> {
  await testAppServerProtocol();
  await testProviderUsesHostedSubscription();
  await testProviderStreamsPlainFinalContent();
  testStructuredStreamOnlyEmitsFinalContent();
  await testStreamingProviderPropagatesCancellation();
  console.log("OK: hosted Codex app-server uses externally managed ChatGPT subscription tokens");
  console.log("OK: hosted Codex final answers stream before turn completion");
  console.log("OK: ChatGPT subscription provider bypasses OpenAI Chat Completions");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
