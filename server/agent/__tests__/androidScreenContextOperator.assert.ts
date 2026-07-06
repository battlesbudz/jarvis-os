import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../../..");
const bridgeSrc = fs.readFileSync(path.join(repoRoot, "server/daemon/bridge.ts"), "utf8");
const daemonToolSrc = fs.readFileSync(path.join(repoRoot, "server/agent/tools/daemon.ts"), "utf8");
const routesSrc = fs.readFileSync(path.join(repoRoot, "server/routes.ts"), "utf8");

assert.ok(
  bridgeSrc.includes('{ type: "android_screen_context" }'),
  "bridge exposes android_screen_context daemon op",
);
assert.ok(
  bridgeSrc.includes('{ type: "android_operator_action"; action: Record<string, unknown> }'),
  "bridge exposes android_operator_action daemon op",
);
assert.ok(
  bridgeSrc.includes('android_screen_context: "android_read_screen"'),
  "android_screen_context keeps read_screen permission gate",
);
assert.ok(
  bridgeSrc.includes('operatorActionPermKey(op.action)'),
  "android_operator_action derives nested permission in bridge gate",
);
assert.ok(
  bridgeSrc.includes('case "open_app":') && bridgeSrc.includes('return "android_open_app";'),
  "android_operator_action bridge gate requires android_open_app for open_app",
);
assert.ok(
  !bridgeSrc.includes('android_operator_action: "android_tap_type"'),
  "android_operator_action bridge gate is not hard-coded to tap_type",
);
assert.ok(
  daemonToolSrc.includes('"android_screen_context"'),
  "daemon_action tool lists android_screen_context",
);
assert.ok(
  daemonToolSrc.includes('"android_operator_action"'),
  "daemon_action tool lists android_operator_action",
);
assert.ok(
  daemonToolSrc.includes("operatorAction"),
  "daemon_action tool accepts operatorAction payload",
);
assert.ok(
  daemonToolSrc.includes('operatorActionPermKey(typedOperatorAction)'),
  "daemon_action tool derives nested permission from operatorAction payload",
);
assert.ok(
  daemonToolSrc.includes('case "open_app": return "android_open_app";'),
  "daemon_action tool requires android_open_app permission for open_app operator actions",
);
assert.ok(
  daemonToolSrc.includes('op = { type: "android_type", text: String(args.text), submit: args.submit === true }'),
  "daemon_action tool preserves android_type submit when replaying approved actions",
);
assert.ok(
  routesSrc.includes('"android_screen_context"'),
  "routes daemon_action schema lists android_screen_context",
);
assert.ok(
  routesSrc.includes('"android_operator_action"'),
  "routes daemon_action schema lists android_operator_action",
);
assert.ok(
  routesSrc.includes("operatorAction"),
  "routes daemon_action schema accepts operatorAction payload",
);
assert.ok(
  routesSrc.includes('operatorActionPermKey(typedOperatorAction)'),
  "routes daemon_action derives nested permission from operatorAction payload",
);
assert.ok(
  routesSrc.includes("case 'open_app': return 'android_open_app';"),
  "routes daemon_action requires android_open_app permission for open_app operator actions",
);
assert.ok(
  routesSrc.includes("op = { type: 'android_type', text: String(args.text), submit: !!args.submit }"),
  "routes daemon_action preserves android_type submit when replaying approved actions",
);

console.log("OK: Android screen context and operator daemon actions are exposed with permission gates");
