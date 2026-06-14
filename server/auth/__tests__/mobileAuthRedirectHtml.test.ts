import assert from "node:assert/strict";
import { createMobileAuthImplicitCallbackHtml, createMobileAuthSuccessHtml } from "../mobileAuthHtml";

function run() {
  const token = "jwt.token.value";

  const webHtml = createMobileAuthSuccessHtml(token, { returnTarget: "web" });
  assert.match(webHtml, /\/login\?auth_complete=1#auth_token=jwt\.token\.value/);
  assert.doesNotMatch(webHtml, /gameplan:\/\/auth\/complete/);
  assert.doesNotMatch(webHtml, /window\.opener\.postMessage/);

  const nativeHtml = createMobileAuthSuccessHtml(token, { returnTarget: "native" });
  assert.match(nativeHtml, /gameplan:\/\/auth\/complete/);
  assert.match(nativeHtml, /window\.opener\.postMessage/);
  assert.match(nativeHtml, /\/login\?auth_complete=1#auth_token=jwt\.token\.value/);

  const implicitHtml = createMobileAuthImplicitCallbackHtml();
  assert.match(implicitHtml, /access_token/);
  assert.match(implicitHtml, /\/api\/auth\/mobile\/implicit-complete/);
  assert.match(implicitHtml, /Return to Jarvis to continue/);

  console.log("mobileAuthRedirectHtml tests passed");
}

run();
