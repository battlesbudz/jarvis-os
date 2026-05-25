import assert from "node:assert/strict";

import {
  buildPublicIngressTargets,
  isPrivateOrTailscaleAddress,
  shouldProbePublicIngress,
} from "../jarvis-oauth-gateway-doctor.mjs";

const gatewayUrl = new URL("https://battles-pc.tailf68942.ts.net/api/codex/gateway-health");

assert.equal(shouldProbePublicIngress(gatewayUrl), true);
assert.equal(shouldProbePublicIngress(new URL("http://battles-pc.tailf68942.ts.net/api/codex/gateway-health")), false);
assert.equal(shouldProbePublicIngress(new URL("https://127.0.0.1:5000/api/ping")), false);

assert.equal(isPrivateOrTailscaleAddress("100.81.131.98"), true);
assert.equal(isPrivateOrTailscaleAddress("192.168.1.194"), true);
assert.equal(isPrivateOrTailscaleAddress("fd7a:115c:a1e0::5639:8362"), true);
assert.equal(isPrivateOrTailscaleAddress("209.177.145.97"), false);
assert.equal(isPrivateOrTailscaleAddress("2607:f740:f::67"), false);

const targets = buildPublicIngressTargets(gatewayUrl, {
  addresses: [
    { family: 4, address: "100.81.131.98" },
    { family: 4, address: "209.177.145.97" },
  ],
});

assert.deepEqual(targets, [
  {
    family: 4,
    address: "100.81.131.98",
    port: 443,
    servername: "battles-pc.tailf68942.ts.net",
    hostHeader: "battles-pc.tailf68942.ts.net",
    path: "/api/codex/gateway-health",
    publicAddress: false,
  },
  {
    family: 4,
    address: "209.177.145.97",
    port: 443,
    servername: "battles-pc.tailf68942.ts.net",
    hostHeader: "battles-pc.tailf68942.ts.net",
    path: "/api/codex/gateway-health",
    publicAddress: true,
  },
]);

const customPortTargets = buildPublicIngressTargets(
  new URL("https://battles-pc.tailf68942.ts.net:8443/telegram-codex?check=1"),
  { addresses: [{ family: 6, address: "2607:f740:f::67" }] },
);

assert.equal(customPortTargets[0].port, 8443);
assert.equal(customPortTargets[0].hostHeader, "battles-pc.tailf68942.ts.net:8443");
assert.equal(customPortTargets[0].path, "/telegram-codex?check=1");

console.log("oauthGatewayDoctor.test.mjs passed");
