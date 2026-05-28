import assert from "node:assert/strict";
import {
  buildComposioConnectIntent,
  disconnectComposioAccount,
  getComposioCallbackUrl,
  getComposioStatus,
  handleComposioCallback,
  signComposioCallbackState,
  testComposioConnection,
  verifyComposioCallbackState,
  type ComposioAccountStore,
  type StoredComposioAccount,
} from "../../connectors/composio/connectionCenter";

async function main(): Promise<void> {
  process.env.COMPOSIO_CALLBACK_BASE_URL = "https://jarvis.example.com";
  process.env.COMPOSIO_CALLBACK_STATE_SECRET = "state_secret";
  process.env.COMPOSIO_GMAIL_AUTH_CONFIG_ID = "authcfg_gmail_123";

  const savedAccounts: StoredComposioAccount[] = [];
  const store: ComposioAccountStore = {
    async list(userId) {
      return savedAccounts.filter((account) => account.userId === userId);
    },
    async upsert(account) {
      const next = { ...account, updatedAt: new Date("2026-05-28T12:00:00.000Z") };
      const index = savedAccounts.findIndex((saved) =>
        saved.userId === next.userId && saved.connectedAccountId === next.connectedAccountId
      );
      if (index >= 0) savedAccounts[index] = { ...savedAccounts[index], ...next };
      else savedAccounts.push(next);
      return next;
    },
    async delete(userId, filters = {}) {
      const before = savedAccounts.length;
      for (let index = savedAccounts.length - 1; index >= 0; index -= 1) {
        const account = savedAccounts[index];
        if (account.userId !== userId) continue;
        if (filters.connectedAccountId && account.connectedAccountId !== filters.connectedAccountId) continue;
        if (filters.toolkit && account.toolkit !== filters.toolkit) continue;
        savedAccounts.splice(index, 1);
      }
      return before - savedAccounts.length;
    },
  };

  const calls: string[] = [];
  const client = {
    connectedAccounts: {
      async link(userId: string, authConfigId: string, options: { callbackUrl: string }) {
        calls.push(`link:${userId}:${authConfigId}:${options.callbackUrl}`);
        return { id: "conn_req_123", redirectUrl: "https://connect.composio.dev/session_123" };
      },
      async list(query?: Record<string, unknown>) {
        calls.push(`list:${JSON.stringify(query || {})}`);
        return {
          items: [
            {
              id: "ca_gmail_123",
              toolkit: { slug: "gmail", name: "Gmail" },
              status: "ACTIVE",
              accountEmail: "justin@example.com",
            },
          ],
        };
      },
      async delete(id: string) {
        calls.push(`delete:${id}`);
        return { ok: true };
      },
    },
    tools: {
      async get(userId: string, query: { toolkits: string[] }) {
        calls.push(`tools.get:${userId}:${query.toolkits.join(",")}`);
        return [{ slug: "GMAIL_FETCH_EMAILS" }];
      },
    },
  };

  const missingStatus = await getComposioStatus("user_1");
  assert.equal(missingStatus.provider, "composio");
  assert.equal(missingStatus.configured, Boolean(process.env.COMPOSIO_API_KEY));
  if (!process.env.COMPOSIO_API_KEY) {
    assert.equal(missingStatus.ready, false);
    assert.match(missingStatus.error || "", /COMPOSIO_API_KEY/);
  }
  console.log("OK: Composio status names missing server API key clearly");

  const signedState = signComposioCallbackState({ userId: "user_1", toolkit: "gmail" });
  assert.deepEqual(verifyComposioCallbackState(signedState), { userId: "user_1", toolkit: "gmail" });
  assert.equal(verifyComposioCallbackState(`${signedState}x`), null);
  const callbackUrl = getComposioCallbackUrl(undefined, { userId: "user_1", toolkit: "gmail" });
  assert.ok(callbackUrl);
  const callbackParsed = new URL(callbackUrl);
  assert.equal(callbackParsed.pathname, "/api/connections/callback");
  assert.ok(callbackParsed.searchParams.get("state"));
  console.log("OK: Composio callback state is signed and callback URL points at Jarvis");

  const link = await buildComposioConnectIntent(
    "user_1",
    "gmail",
    undefined,
    { client },
  );
  assert.equal(link.provider, "composio");
  assert.equal(link.redirectUrl, "https://connect.composio.dev/session_123");
  assert.equal(link.connectionRequestId, "conn_req_123");
  assert.ok(calls.some((call) => call.startsWith(`link:user_1:authcfg_gmail_123:${callbackUrl}`)));
  console.log("OK: Composio connect-link uses auth config env and hosted callback");

  const state = new URL(calls.find((call) => call.startsWith("link:"))!.split(":https://")[1].replace(/^/, "https://")).searchParams.get("state");
  assert.ok(state);
  const callbackSuccess = await handleComposioCallback({
    state,
    status: "success",
    connected_account_id: "ca_gmail_123",
  }, { store });
  assert.equal(callbackSuccess.ok, true);
  assert.equal(savedAccounts[0].connectedAccountId, "ca_gmail_123");
  assert.equal(savedAccounts[0].toolkit, "gmail");
  console.log("OK: Composio callback success stores connected-account metadata");

  const callbackFailure = await handleComposioCallback({
    state,
    status: "failed",
    connected_account_id: "ca_failed",
  }, { store });
  assert.equal(callbackFailure.ok, false);
  assert.equal(callbackFailure.status, "FAILED");
  console.log("OK: Composio callback failure does not mark the account connected");

  const status = await getComposioStatus("user_1", { client, store });
  assert.equal(status.configured, true);
  assert.equal(status.ready, true);
  assert.equal(status.connections[0].state, "active");
  assert.equal(status.connections[0].accountEmail, "justin@example.com");
  console.log("OK: Composio status refreshes active connected accounts");

  const test = await testComposioConnection("user_1", "gmail", { client });
  assert.equal(test.ok, true);
  assert.equal((test as any).toolCount, 1);
  assert.ok(calls.includes("tools.get:user_1:gmail"));
  console.log("OK: Composio connection test lists tools without executing external actions");

  const disconnect = await disconnectComposioAccount("user_1", "gmail", { client, store });
  assert.equal(disconnect.ok, true);
  assert.ok(calls.includes("delete:ca_gmail_123"));
  assert.equal(savedAccounts.length, 0);
  console.log("OK: Composio disconnect revokes through Composio and clears local metadata");

  console.log("\nAll Composio connection assertions passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
