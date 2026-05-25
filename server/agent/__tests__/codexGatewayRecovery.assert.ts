import assert from "node:assert/strict";
import {
  buildCodexGatewayRecoveryReply,
  classifyCodexGatewayRecoveryRequest,
  summarizeGatewayProbe,
} from "../codexGatewayRecovery";

assert.equal(
  classifyCodexGatewayRecoveryRequest("Jarvis, fix the Codex gateway because the tunnel is down."),
  true,
);
assert.equal(
  classifyCodexGatewayRecoveryRequest("Can you plan my morning?"),
  false,
);

const healthyProbe = summarizeGatewayProbe({
  localOk: true,
  publicOk: true,
  localUrl: "http://127.0.0.1:5000/api/ping",
  publicUrl: "https://example.test/api/codex/gateway-health",
});
assert.equal(healthyProbe.status, "healthy");

const tunnelProbe = summarizeGatewayProbe({
  localOk: true,
  publicOk: false,
  localUrl: "http://127.0.0.1:5000/api/ping",
  publicUrl: "https://example.test/api/codex/gateway-health",
  publicError: "502 Bad Gateway",
});
assert.equal(tunnelProbe.status, "public_tunnel_down");
assert.match(tunnelProbe.recommendedAction, /tunnel/i);

const reply = buildCodexGatewayRecoveryReply(tunnelProbe);
assert.match(reply, /without using Codex/i);
assert.match(reply, /public tunnel/i);
assert.match(reply, /jarvis:oauth:gateway:doctor/i);

console.log("OK: Codex gateway recovery helper is deterministic and non-Codex.");
