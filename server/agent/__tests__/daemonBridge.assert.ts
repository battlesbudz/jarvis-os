import assert from "node:assert/strict";
import { WebSocket } from "ws";

process.env.DATABASE_URL ||= "postgres://jarvis:jarvis@127.0.0.1:5432/jarvis_test";

async function main() {
  const { shouldProtectPendingDaemonSocket } = await import("../../daemon/bridge");

  assert.equal(shouldProtectPendingDaemonSocket(undefined, 1), false);
  assert.equal(shouldProtectPendingDaemonSocket({ readyState: WebSocket.CLOSED }, 1), false);
  assert.equal(shouldProtectPendingDaemonSocket({ readyState: WebSocket.OPEN }, 0), false);
  assert.equal(shouldProtectPendingDaemonSocket({ readyState: WebSocket.OPEN }, 1), true);

  console.log("OK: daemon bridge protects active sockets with pending operations from duplicate reconnects");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
