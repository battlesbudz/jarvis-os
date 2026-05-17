import assert from "node:assert/strict";
import { isRetriableProviderError } from "../providers/fallback";

{
  const err = new TypeError("fetch failed");
  (err as Error & { cause?: unknown }).cause = Object.assign(
    new Error("Headers Timeout Error"),
    { name: "HeadersTimeoutError", code: "UND_ERR_HEADERS_TIMEOUT" },
  );

  assert.equal(isRetriableProviderError(err), true);
  console.log("OK: provider fallback retries undici header timeout fetch failures");
}

{
  const err = new DOMException("User cancelled the run", "AbortError");
  assert.equal(isRetriableProviderError(err), false);
  console.log("OK: provider fallback does not retry caller aborts");
}

{
  const err = Object.assign(new Error("401 Unauthorized"), { status: 401 });
  assert.equal(isRetriableProviderError(err), false);
  console.log("OK: provider fallback still treats auth errors as non-retriable");
}

console.log("\nAll provider fallback assertions passed.");
