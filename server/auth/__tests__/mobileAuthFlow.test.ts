import assert from "node:assert/strict";
import { resolveMobileAuthStartFlow } from "../mobileAuthFlow";

function run() {
  assert.equal(
    resolveMobileAuthStartFlow({
      requestedFlow: undefined,
      returnTarget: "native",
      hasPollSecret: true,
    }),
    "implicit",
    "native polling sessions should avoid the server-side code exchange by default",
  );

  assert.equal(
    resolveMobileAuthStartFlow({
      requestedFlow: undefined,
      returnTarget: "native",
      hasPollSecret: false,
    }),
    "code",
    "native sessions without app polling keep the code flow",
  );

  assert.equal(
    resolveMobileAuthStartFlow({
      requestedFlow: undefined,
      returnTarget: "web",
      hasPollSecret: true,
    }),
    "code",
    "web return targets keep the existing code flow unless they opt in",
  );

  assert.equal(
    resolveMobileAuthStartFlow({
      requestedFlow: "code",
      returnTarget: "native",
      hasPollSecret: true,
    }),
    "code",
    "explicit code-flow requests are respected",
  );

  assert.equal(
    resolveMobileAuthStartFlow({
      requestedFlow: "implicit",
      returnTarget: "web",
      hasPollSecret: false,
    }),
    "implicit",
    "explicit implicit-flow requests are respected",
  );

  console.log("mobileAuthFlow tests passed");
}

run();
