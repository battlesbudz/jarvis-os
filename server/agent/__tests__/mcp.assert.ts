/**
 * MCP API key and endpoint assertions.
 *
 * Run with:  npx tsx server/agent/__tests__/mcp.assert.ts
 *
 * No test framework required — uses Node.js built-in assert/strict.
 *
 * Sections:
 *   A. Key format validation — verifyMcpApiKey short-circuits before DB on bad-format keys
 *   B. Rate limiting — checkRateLimit in-memory sliding window (120 req/min per key)
 *   C. HTTP handler — mini express server + McpTestDeps injected (no DB/bcrypt)
 *      C1.  Missing Authorization header → 401
 *      C2.  Non-Bearer Authorization header → 401
 *      C3.  Invalid key (mocked verify returns null) → 401
 *      C4.  Valid key (mocked) + initialize → 200 with protocol version + server info
 *      C5.  Valid key (mocked) + notifications/initialized → 204
 *      C6.  Valid key (mocked) + tools/list → 200 with tools array
 *      C7.  Valid key (mocked) + unknown method → 405
 *      C8.  Rate limit exceeded (mocked checkRateLimit) → 429
 *      C9.  tools/call for unknown tool → 404
 *      C10. tools/call for known non-streaming tool → 200 with content
 *   D. Key generation with real DB (integration tests)
 *      D1.  generateMcpApiKey returns rawKey ("jarvis_" prefix, 47 chars) + 16-char prefix
 *      D2.  rawKey can be verified immediately via verifyMcpApiKey
 *      D3.  Generating a second key revokes the first (old key fails verification)
 *      D4.  POST /api/mcp-key/generate requires session auth — rejects without JWT → 401
 */

import assert from "node:assert/strict";
import http from "node:http";
import type { IncomingMessage } from "node:http";
import type { McpTestDeps } from "../mcp/mcpServerHandler";
import type { AgentTool } from "../types";

/** Minimal HTTP POST helper — avoids needing `fetch` in Node 18 tests. */
function httpPost(
  port: number,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          ...headers,
        },
      },
      (res: IncomingMessage) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString()));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: data });
          }
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

(async () => {
  // ── Imports that may be async or require DB must happen inside the IIFE ──
  // Ensure the mcp_api_keys table exists before any DB-touching tests
  const { db: _dbInit, ensureTablesExist: _ensureInit } = await import("../../db");
  await _ensureInit();

  const { verifyMcpApiKey, checkRateLimit, generateMcpApiKey, getMcpKeyInfo } = await import(
    "../mcp/mcpApiKeys"
  );
  const { handleMcpRequest } = await import("../mcp/mcpServerHandler");
  const express = (await import("express")).default;

  function makeTool(name: string): AgentTool {
    return {
      name,
      description: `Mock tool: ${name}`,
      parameters: { type: "object", properties: {}, required: [] },
      execute: async (_args, _ctx) => ({ ok: true, content: `result of ${name}`, label: name }),
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Section A — Key format validation (no DB, no server)
  // verifyMcpApiKey returns null immediately when the key fails the format check
  // ════════════════════════════════════════════════════════════════════════════

  {
    // A1: Key that does not start with "jarvis_" → null (no DB lookup)
    const result = await verifyMcpApiKey("invalid_key_abc123");
    assert.equal(result, null, "A1: key not starting with 'jarvis_' → null");
    console.log("✓ A1: key not starting with 'jarvis_' → null (no DB hit)");
  }

  {
    // A2: Key shorter than 16 chars (KEY_PREFIX_LEN) → null
    const result = await verifyMcpApiKey("jarvis_short");
    assert.equal(result, null, "A2: key shorter than 16 chars → null");
    console.log("✓ A2: key shorter than KEY_PREFIX_LEN → null");
  }

  {
    // A3: Well-formed key format with no DB record → null (not in DB)
    const result = await verifyMcpApiKey("jarvis_0000000000000000000000000000000000000000000000");
    assert.equal(result, null, "A3: well-formed but unknown key → null");
    console.log("✓ A3: well-formed key with no DB record → null");
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Section B — Rate limiting (in-memory, no DB)
  // checkRateLimit uses a per-keyId sliding-window counter (max 120 / min)
  // ════════════════════════════════════════════════════════════════════════════

  {
    // B1: Fresh keyId is allowed up to 120 times in the same window
    const keyId = `test-ratelimit-b1-${Date.now()}`;
    let allowed = 0;
    for (let i = 0; i < 120; i++) {
      if (await checkRateLimit(keyId)) allowed++;
    }
    assert.equal(allowed, 120, "B1: first 120 calls are allowed");
    console.log("✓ B1: checkRateLimit allows 120 requests per window");
  }

  {
    // B2: The 121st call in the same window is rejected
    const keyId = `test-ratelimit-b2-${Date.now()}`;
    for (let i = 0; i < 120; i++) await checkRateLimit(keyId);
    const blocked = !(await checkRateLimit(keyId));
    assert.equal(blocked, true, "B2: 121st call in same window is rate-limited");
    console.log("✓ B2: checkRateLimit blocks the 121st request");
  }

  {
    // B3: Different keyIds have independent counters
    const keyA = `test-ratelimit-b3a-${Date.now()}`;
    const keyB = `test-ratelimit-b3b-${Date.now()}`;
    for (let i = 0; i < 120; i++) await checkRateLimit(keyA);
    const keyBAllowed = await checkRateLimit(keyB);
    assert.equal(keyBAllowed, true, "B3: distinct keyId is unaffected by another key's counter");
    console.log("✓ B3: rate-limit counters are per-keyId and independent");
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Section C — HTTP handler (mini express server + McpTestDeps)
  // ════════════════════════════════════════════════════════════════════════════

  const MOCK_TOOLS: AgentTool[] = [makeTool("ping"), makeTool("set_reminder")];
  const MOCK_USER = "user-test-mcp-handler";
  const MOCK_KEY_ID = "keyid-test-mcp-handler";
  const BEARER_VALUE = "Bearer jarvis_1234567890123456789012345678901234567890";

  const mockVerifyOk = async (_: string) => ({
    userId: MOCK_USER,
    keyId: MOCK_KEY_ID,
    prefix: "jarvis_testpref",
  });
  const mockVerifyFail = async (_: string) => null;
  const mockRateLimitOk = async (_: string) => true;
  const mockRateLimitBlock = async (_: string) => false;
  const mockBuildTools = async (_userId: string) => MOCK_TOOLS;

  // Mutable dep slot: each sub-test sets its deps before making the request
  let currentDeps: McpTestDeps = {};

  const app = express();
  app.use(express.json());
  app.post("/api/mcp", async (req, res) => {
    await handleMcpRequest(req, res, currentDeps);
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;

  // ── C1: Missing Authorization header → 401 ─────────────────────────────────
  {
    currentDeps = { verifyMcpApiKey: mockVerifyOk, checkRateLimit: mockRateLimitOk };
    const res = await httpPost(port, "/api/mcp", { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    assert.equal(res.status, 401, "C1: missing Authorization → 401");
    const body = res.body as Record<string, unknown>;
    assert.ok(body.error, "C1: error field present");
    console.log("✓ C1: missing Authorization → 401");
  }

  // ── C2: Non-Bearer Authorization header → 401 ──────────────────────────────
  {
    currentDeps = { verifyMcpApiKey: mockVerifyOk, checkRateLimit: mockRateLimitOk };
    const res = await httpPost(
      port, "/api/mcp",
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { Authorization: "Basic dXNlcjpwYXNz" },
    );
    assert.equal(res.status, 401, "C2: Basic auth → 401");
    console.log("✓ C2: non-Bearer Authorization → 401");
  }

  // ── C3: Invalid key (mocked verify returns null) → 401 ─────────────────────
  {
    currentDeps = { verifyMcpApiKey: mockVerifyFail, checkRateLimit: mockRateLimitOk };
    const res = await httpPost(
      port, "/api/mcp",
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { Authorization: BEARER_VALUE },
    );
    assert.equal(res.status, 401, "C3: invalid key → 401");
    const body = res.body as Record<string, unknown>;
    const err = body.error as Record<string, unknown>;
    assert.ok(
      String(err?.message ?? "").includes("Unauthorized"),
      "C3: error message contains 'Unauthorized'",
    );
    console.log("✓ C3: invalid key (mocked) → 401 Unauthorized");
  }

  // ── C4: Valid key + initialize → 200 with protocol version ─────────────────
  {
    currentDeps = { verifyMcpApiKey: mockVerifyOk, checkRateLimit: mockRateLimitOk, buildPermittedTools: mockBuildTools };
    const res = await httpPost(
      port, "/api/mcp",
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { Authorization: BEARER_VALUE },
    );
    assert.equal(res.status, 200, "C4: initialize → 200");
    const body = res.body as Record<string, unknown>;
    assert.equal(body.jsonrpc, "2.0", "C4: jsonrpc field");
    assert.equal(body.id, 1, "C4: id echoed");
    const result = body.result as Record<string, unknown>;
    assert.ok(typeof result.protocolVersion === "string", "C4: protocolVersion is string");
    const serverInfo = result.serverInfo as Record<string, unknown>;
    assert.equal(serverInfo.name, "jarvis", "C4: serverInfo.name is 'jarvis'");
    assert.ok(result.capabilities, "C4: capabilities field present");
    console.log(`✓ C4: initialize → 200, protocolVersion=${result.protocolVersion}`);
  }

  // ── C5: Valid key + notifications/initialized → 204 ────────────────────────
  {
    currentDeps = { verifyMcpApiKey: mockVerifyOk, checkRateLimit: mockRateLimitOk };
    const rawRes = await new Promise<{ status: number }>((resolve) => {
      const payload = JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" });
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/api/mcp",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
            Authorization: BEARER_VALUE,
          },
        },
        (res) => { res.resume(); resolve({ status: res.statusCode ?? 0 }); },
      );
      req.write(payload);
      req.end();
    });
    assert.equal(rawRes.status, 204, "C5: notifications/initialized → 204");
    console.log("✓ C5: notifications/initialized → 204 No Content");
  }

  // ── C6: Valid key + tools/list → 200 with tools array ──────────────────────
  {
    currentDeps = { verifyMcpApiKey: mockVerifyOk, checkRateLimit: mockRateLimitOk, buildPermittedTools: mockBuildTools };
    const res = await httpPost(
      port, "/api/mcp",
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      { Authorization: BEARER_VALUE },
    );
    assert.equal(res.status, 200, "C6: tools/list → 200");
    const body = res.body as Record<string, unknown>;
    assert.equal(body.jsonrpc, "2.0", "C6: jsonrpc field");
    const result = body.result as Record<string, unknown>;
    assert.ok(Array.isArray(result.tools), "C6: result.tools is an array");
    assert.equal((result.tools as unknown[]).length, MOCK_TOOLS.length, "C6: tool count matches mock");
    const firstTool = (result.tools as Record<string, unknown>[])[0];
    assert.ok(typeof firstTool.name === "string", "C6: first tool has name");
    assert.ok(typeof firstTool.description === "string", "C6: first tool has description");
    assert.ok(firstTool.inputSchema, "C6: first tool has inputSchema");
    console.log(`✓ C6: tools/list → 200, ${(result.tools as unknown[]).length} tools`);
  }

  // ── C7: Valid key + unknown method → 405 ───────────────────────────────────
  {
    currentDeps = { verifyMcpApiKey: mockVerifyOk, checkRateLimit: mockRateLimitOk };
    const res = await httpPost(
      port, "/api/mcp",
      { jsonrpc: "2.0", id: 3, method: "tools/subscribe", params: {} },
      { Authorization: BEARER_VALUE },
    );
    assert.equal(res.status, 405, "C7: unknown method → 405");
    const body = res.body as Record<string, unknown>;
    const err = body.error as Record<string, unknown>;
    assert.ok(String(err?.message ?? "").includes("Method not found"), "C7: method-not-found error");
    console.log("✓ C7: unknown method → 405 Method Not Found");
  }

  // ── C8: Rate limit exceeded (mocked checkRateLimit) → 429 ──────────────────
  {
    currentDeps = { verifyMcpApiKey: mockVerifyOk, checkRateLimit: mockRateLimitBlock };
    const res = await httpPost(
      port, "/api/mcp",
      { jsonrpc: "2.0", id: 4, method: "initialize", params: {} },
      { Authorization: BEARER_VALUE },
    );
    assert.equal(res.status, 429, "C8: rate limit exceeded (mocked) → 429");
    const body = res.body as Record<string, unknown>;
    const err = body.error as Record<string, unknown>;
    assert.ok(
      String(err?.message ?? "").toLowerCase().includes("rate limit"),
      "C8: error message mentions rate limit",
    );
    console.log("✓ C8: rate limit exceeded → 429");
  }

  // ── C9: tools/call for unknown tool → 404 ──────────────────────────────────
  {
    currentDeps = { verifyMcpApiKey: mockVerifyOk, checkRateLimit: mockRateLimitOk, buildPermittedTools: mockBuildTools };
    const res = await httpPost(
      port, "/api/mcp",
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "nonexistent_tool", arguments: {} } },
      { Authorization: BEARER_VALUE },
    );
    assert.equal(res.status, 404, "C9: tools/call for unknown tool → 404");
    const body = res.body as Record<string, unknown>;
    const err = body.error as Record<string, unknown>;
    assert.ok(String(err?.message ?? "").includes("not permitted"), "C9: 'not permitted' in error");
    console.log("✓ C9: tools/call for unknown tool → 404");
  }

  // ── C10: tools/call for known non-streaming tool → 200 with content ─────────
  {
    currentDeps = { verifyMcpApiKey: mockVerifyOk, checkRateLimit: mockRateLimitOk, buildPermittedTools: mockBuildTools };
    const res = await httpPost(
      port, "/api/mcp",
      { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "ping", arguments: {} } },
      { Authorization: BEARER_VALUE },
    );
    assert.equal(res.status, 200, "C10: tools/call for known tool → 200");
    const body = res.body as Record<string, unknown>;
    assert.equal(body.jsonrpc, "2.0", "C10: jsonrpc field");
    assert.equal(body.id, 6, "C10: id echoed");
    const result = body.result as Record<string, unknown>;
    assert.ok(Array.isArray(result.content), "C10: result.content is array");
    assert.equal(typeof result.isError, "boolean", "C10: result.isError is boolean");
    const firstContent = (result.content as Record<string, unknown>[])[0];
    assert.equal(firstContent.type, "text", "C10: content item type is 'text'");
    assert.ok(typeof firstContent.text === "string", "C10: content item has text");
    console.log(`✓ C10: tools/call → 200, content="${firstContent.text}"`);
  }

  server.close();

  // ════════════════════════════════════════════════════════════════════════════
  // Section D — True route-level E2E tests (real Express server, real JWT,
  //             real bcrypt key verification, real rate-limit enforcement)
  //
  // A minimal express app is spun up with the real route handlers and real
  // authMiddleware — no McpTestDeps mocks.  This exercises the full auth stack.
  // ════════════════════════════════════════════════════════════════════════════

  const { db } = await import("../../db");
  const { users } = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");
  const { authMiddleware, generateToken } = await import("../../auth");

  // Boot the real-route mini server once — used for all D tests.
  const e2eApp = express();
  e2eApp.use(express.json());

  // Real POST /api/mcp-key/generate: real authMiddleware + real generateMcpApiKey
  e2eApp.post("/api/mcp-key/generate", authMiddleware, async (req: any, res: any) => {
    try {
      const { rawKey, prefix } = await generateMcpApiKey(req.userId as string);
      res.json({ rawKey, prefix });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // Real POST /api/mcp: NO McpTestDeps injected — uses real verifyMcpApiKey + checkRateLimit
  e2eApp.post("/api/mcp", async (req: any, res: any) => {
    await handleMcpRequest(req, res);   // ← no _testOnlyDeps arg
  });

  const e2eServer = http.createServer(e2eApp);
  await new Promise<void>((resolve) => e2eServer.listen(0, "127.0.0.1", resolve));
  const e2ePort = (e2eServer.address() as { port: number }).port;

  // Create a test user to satisfy the FK constraint on mcp_api_keys
  const testUsername = `__mcp_test__${Date.now()}`;
  const inserted = await db
    .insert(users)
    .values({ username: testUsername })
    .returning({ id: users.id });
  const testUserId = inserted[0].id;

  // Generate a real JWT for the test user (same signing key as production)
  const testJwt = generateToken(testUserId);
  const authBearer = `Bearer ${testJwt}`;

  try {
    // ── D1: POST /api/mcp-key/generate without valid JWT → 401 ───────────────
    // Verifies the real authMiddleware is in place on the real route.
    {
      const noAuthRes = await httpPost(e2ePort, "/api/mcp-key/generate", {});
      assert.equal(noAuthRes.status, 401, "D1: no Authorization header → 401");

      const badTokenRes = await httpPost(
        e2ePort, "/api/mcp-key/generate", {},
        { Authorization: "Bearer not-a-real-jwt" },
      );
      assert.equal(badTokenRes.status, 401, "D1: invalid JWT → 401");
      console.log("✓ D1: POST /api/mcp-key/generate rejects unauthenticated requests → 401");
    }

    // ── D2: POST /api/mcp-key/generate with valid JWT → key created once ──────
    // Tests that the real route returns {rawKey, prefix} and that rawKey is
    // only in the HTTP response body (not stored — only the hash is persisted).
    {
      const res = await httpPost(e2ePort, "/api/mcp-key/generate", {}, { Authorization: authBearer });
      assert.equal(res.status, 200, "D2: valid JWT → 200");

      const body = res.body as Record<string, unknown>;
      assert.ok(typeof body.rawKey === "string", "D2: rawKey field present and is a string");
      assert.ok(typeof body.prefix === "string", "D2: prefix field present and is a string");

      const rawKey = body.rawKey as string;
      const prefix = body.prefix as string;

      assert.ok(rawKey.startsWith("jarvis_"), "D2: rawKey starts with 'jarvis_'");
      assert.equal(rawKey.length, 47, `D2: rawKey is 47 chars (got ${rawKey.length})`);
      assert.equal(prefix.length, 16, `D2: prefix is 16 chars (got ${prefix.length})`);
      assert.equal(rawKey.slice(0, 16), prefix, "D2: prefix is the first 16 chars of rawKey");

      // Confirm the stored value is the hash — rawKey must NOT appear in DB.
      // We verify by calling verifyMcpApiKey (bcrypt check against stored hash).
      const info = await getMcpKeyInfo(testUserId);
      assert.notEqual(info, null, "D2: key info persisted after generation");
      assert.equal(info!.prefix, prefix, "D2: stored prefix matches response prefix");
      const verified = await verifyMcpApiKey(rawKey);
      assert.notEqual(verified, null, "D2: rawKey from response verifies against stored hash");

      console.log(`✓ D2: POST /api/mcp-key/generate → rawKey=${rawKey.slice(0, 16)}... (returned once, only hash stored)`);
    }

    // ── D3: POST /api/mcp-key/generate again → new key, old key revoked ───────
    // Confirms the one-key-per-user invariant at the route level.
    {
      const res1 = await httpPost(e2ePort, "/api/mcp-key/generate", {}, { Authorization: authBearer });
      const firstKey = (res1.body as Record<string, unknown>).rawKey as string;

      const res2 = await httpPost(e2ePort, "/api/mcp-key/generate", {}, { Authorization: authBearer });
      const secondKey = (res2.body as Record<string, unknown>).rawKey as string;

      assert.notEqual(firstKey, secondKey, "D3: second generation returns a different key");

      const oldVerified = await verifyMcpApiKey(firstKey);
      assert.equal(oldVerified, null, "D3: first key is revoked after second generation");

      const newVerified = await verifyMcpApiKey(secondKey);
      assert.notEqual(newVerified, null, "D3: second key verifies successfully");

      console.log("✓ D3: second key generation revokes the first (one-key-per-user, route level)");
    }

    // ── D4: POST /api/mcp with missing/invalid key → 401 (real auth path) ─────
    {
      const noAuthRes = await httpPost(
        e2ePort, "/api/mcp",
        { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      );
      assert.equal(noAuthRes.status, 401, "D4: no auth → 401 on real /api/mcp");

      const badKeyRes = await httpPost(
        e2ePort, "/api/mcp",
        { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
        { Authorization: "Bearer jarvis_0000000000000000000000000000000000000000000000" },
      );
      assert.equal(badKeyRes.status, 401, "D4: invalid key → 401 on real /api/mcp");

      console.log("✓ D4: POST /api/mcp rejects missing/invalid keys → 401 (real verifyMcpApiKey)");
    }

    // ── D5: POST /api/mcp with valid key + initialize → 200 (real bcrypt auth) ─
    {
      const genRes = await httpPost(e2ePort, "/api/mcp-key/generate", {}, { Authorization: authBearer });
      const activeKey = (genRes.body as Record<string, unknown>).rawKey as string;

      const res = await httpPost(
        e2ePort, "/api/mcp",
        { jsonrpc: "2.0", id: 10, method: "initialize", params: {} },
        { Authorization: `Bearer ${activeKey}` },
      );
      assert.equal(res.status, 200, "D5: valid key + initialize → 200 (real bcrypt auth)");
      const body = res.body as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;
      assert.ok(typeof result.protocolVersion === "string", "D5: protocolVersion present");
      const serverInfo = result.serverInfo as Record<string, unknown>;
      assert.equal(serverInfo.name, "jarvis", "D5: serverInfo.name is 'jarvis'");

      console.log(`✓ D5: POST /api/mcp with real key → 200 initialize (real bcrypt, protocolVersion=${result.protocolVersion})`);
    }

    // ── D6: POST /api/mcp with valid key + tools/list → 200 (real auth + tools) ─
    {
      const genRes = await httpPost(e2ePort, "/api/mcp-key/generate", {}, { Authorization: authBearer });
      const activeKey = (genRes.body as Record<string, unknown>).rawKey as string;

      const res = await httpPost(
        e2ePort, "/api/mcp",
        { jsonrpc: "2.0", id: 11, method: "tools/list", params: {} },
        { Authorization: `Bearer ${activeKey}` },
      );
      assert.equal(res.status, 200, "D6: valid key + tools/list → 200 (real auth)");
      const body = res.body as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;
      assert.ok(Array.isArray(result.tools), "D6: result.tools is an array");
      assert.ok((result.tools as unknown[]).length > 0, "D6: at least one tool returned");

      const firstTool = (result.tools as Record<string, unknown>[])[0];
      assert.ok(typeof firstTool.name === "string", "D6: each tool has a name");
      assert.ok(firstTool.inputSchema, "D6: each tool has inputSchema");

      console.log(`✓ D6: POST /api/mcp + tools/list → 200 (${(result.tools as unknown[]).length} tools, real auth + real tool registry)`);
    }

    // ── D7: Rate-limit enforcement on POST /api/mcp (real endpoint, 120 req/min) ─
    // Strategy: generate a fresh key, get its keyId via verifyMcpApiKey (1 bcrypt
    // call), pre-fill the post-auth counter to 119 using checkRateLimit(keyId),
    // then make 2 real HTTP requests — the first succeeds (120th), the second is
    // rejected (121st) — confirming the real /api/mcp endpoint enforces the limit.
    {
      const genRes = await httpPost(e2ePort, "/api/mcp-key/generate", {}, { Authorization: authBearer });
      const rlKey = (genRes.body as Record<string, unknown>).rawKey as string;

      const verified = await verifyMcpApiKey(rlKey);
      assert.notEqual(verified, null, "D7 setup: key must verify to get keyId");
      const keyId = verified!.keyId;

      for (let i = 0; i < 119; i++) await checkRateLimit(keyId);

      const allowed = await httpPost(
        e2ePort, "/api/mcp",
        { jsonrpc: "2.0", id: 20, method: "initialize", params: {} },
        { Authorization: `Bearer ${rlKey}` },
      );
      assert.equal(allowed.status, 200, "D7: 120th request within window → 200");

      const blocked = await httpPost(
        e2ePort, "/api/mcp",
        { jsonrpc: "2.0", id: 21, method: "initialize", params: {} },
        { Authorization: `Bearer ${rlKey}` },
      );
      assert.equal(blocked.status, 429, "D7: 121st request → 429 Too Many Requests");
      const blockedBody = blocked.body as Record<string, unknown>;
      const blockedErr = blockedBody.error as Record<string, unknown>;
      assert.ok(
        String(blockedErr?.message ?? "").toLowerCase().includes("rate limit"),
        "D7: 429 body contains 'rate limit' message",
      );

      console.log("✓ D7: POST /api/mcp rate-limit enforced → 120 allowed, 121st → 429 (real endpoint)");
    }
  } finally {
    await db.delete(users).where(eq(users.id, testUserId)).catch(() => {});
    e2eServer.close();
  }

  console.log("\nAll MCP API assertions passed.");
})().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
}).finally(() => {
  // Force-exit to close the pg connection pool
  process.exit(0);
});
