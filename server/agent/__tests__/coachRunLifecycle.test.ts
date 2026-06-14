import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { registerCoachRunLifecycle } from "../../coachRunLifecycle";

class ResponseStub extends EventEmitter {
  writableEnded = false;
}

async function main(): Promise<void> {
  {
    const req = new EventEmitter();
    const res = new ResponseStub();
    let cleanupCount = 0;
    let disconnectedCount = 0;
    let progressStops = 0;

    registerCoachRunLifecycle({
      req: req as any,
      res: res as any,
      cleanupRun: () => { cleanupCount += 1; },
      markClientDisconnected: () => { disconnectedCount += 1; },
      stopVisibleProgress: () => { progressStops += 1; },
    });

    req.emit("close");

    assert.equal(cleanupCount, 0, "normal request close must not abort the coach run");
    assert.equal(disconnectedCount, 0, "normal request close must not mark the client disconnected");
    assert.equal(progressStops, 0, "normal request close must not stop visible progress");
  }

  {
    const req = new EventEmitter();
    const res = new ResponseStub();
    let cleanupCount = 0;
    let disconnectedCount = 0;

    registerCoachRunLifecycle({
      req: req as any,
      res: res as any,
      cleanupRun: () => { cleanupCount += 1; },
      markClientDisconnected: () => { disconnectedCount += 1; },
      stopVisibleProgress: () => {},
    });

    req.emit("aborted");

    assert.equal(cleanupCount, 1, "aborted request should abort the coach run");
    assert.equal(disconnectedCount, 1, "aborted request should mark the client disconnected");
  }

  {
    const req = new EventEmitter();
    const res = new ResponseStub();
    let cleanupCount = 0;
    let disconnectedCount = 0;
    let progressStops = 0;

    registerCoachRunLifecycle({
      req: req as any,
      res: res as any,
      cleanupRun: () => { cleanupCount += 1; },
      markClientDisconnected: () => { disconnectedCount += 1; },
      stopVisibleProgress: () => { progressStops += 1; },
    });

    res.emit("close");

    assert.equal(cleanupCount, 1, "premature response close should abort the coach run");
    assert.equal(disconnectedCount, 1, "premature response close should mark the client disconnected");
    assert.equal(progressStops, 1, "response close should stop visible progress");
  }

  {
    const req = new EventEmitter();
    const res = new ResponseStub();
    let cleanupCount = 0;
    let disconnectedCount = 0;
    let progressStops = 0;

    registerCoachRunLifecycle({
      req: req as any,
      res: res as any,
      cleanupRun: () => { cleanupCount += 1; },
      markClientDisconnected: () => { disconnectedCount += 1; },
      stopVisibleProgress: () => { progressStops += 1; },
    });

    res.writableEnded = true;
    res.emit("finish");

    assert.equal(cleanupCount, 1, "finished response should clean up registry state");
    assert.equal(disconnectedCount, 0, "finished response should not mark a disconnect");
    assert.equal(progressStops, 1, "finished response should stop visible progress");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
