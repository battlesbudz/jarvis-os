import assert from "node:assert/strict";
import { isFastInteractiveRequest, isFastLaneDeflection } from "../fastInteractive";

assert.equal(isFastInteractiveRequest("hello jarvis"), true);
assert.equal(isFastInteractiveRequest("tell me a joke"), true);
assert.equal(isFastInteractiveRequest("reply with FAST_OK"), true);
assert.equal(isFastInteractiveRequest("what are you using to talk through?"), true);

assert.equal(isFastInteractiveRequest("use the full workflow and answer with my available tools"), false);
assert.equal(isFastInteractiveRequest("do not use the fast path for this"), false);
assert.equal(isFastInteractiveRequest("what tools do you have access to?"), false);
assert.equal(isFastInteractiveRequest("check my email"), false);
assert.equal(isFastInteractiveRequest("research the latest cannabis regulations"), false);
assert.equal(isFastInteractiveRequest("using current information, give one event and a source"), false);
assert.equal(isFastInteractiveRequest("what recent OpenAI product announcement has an official source?"), false);
assert.equal(isFastInteractiveRequest("open the terminal and run tests"), false);
assert.equal(isFastInteractiveRequest("remind me tomorrow to call Sarah"), false);
assert.equal(isFastInteractiveRequest("/help"), false);

assert.equal(isFastLaneDeflection("I need the full Jarvis workflow for that."), true);
assert.equal(isFastLaneDeflection("I do not have access to tools from this fast path."), true);
assert.equal(isFastLaneDeflection("Sure - here's a quick answer."), false);

console.log("OK: Telegram fast path classifier keeps quick chat fast and routes work to full Jarvis");
