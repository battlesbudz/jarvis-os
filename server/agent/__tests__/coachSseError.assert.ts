import assert from "node:assert/strict";
import { writeCoachStreamError } from "../../services/coachSse";

class ResponseStub {
  headersSent = true;
  writableEnded = false;
  destroyed = false;
  readonly headers = new Map<string, string>();
  readonly writes: string[] = [];

  setHeader(name: string, value: string): void {
    this.headers.set(name, value);
  }

  flushHeaders(): void {
    this.headersSent = true;
  }

  write(chunk: string): boolean {
    if (this.writableEnded || this.destroyed) {
      throw new Error("write after end");
    }
    this.writes.push(chunk);
    return true;
  }

  end(): void {
    this.writableEnded = true;
  }
}

{
  const res = new ResponseStub();
  const wrote = writeCoachStreamError(res as any, new Error("provider exploded"));

  assert.equal(wrote, true);
  assert.equal(res.writableEnded, true);
  assert.equal(res.writes.length, 1);
  assert.match(res.writes[0], /"type":"error"/);
  assert.match(res.writes[0], /provider exploded/);
  console.log("OK: coach SSE error helper writes a structured error to an open stream");
}

{
  const res = new ResponseStub();
  res.headersSent = false;
  const wrote = writeCoachStreamError(res as any, new Error("opened during catch"));

  assert.equal(wrote, true);
  assert.equal(res.headersSent, true);
  assert.equal(res.headers.get("Content-Type"), "text/event-stream");
  assert.equal(res.headers.get("Cache-Control"), "no-cache, no-transform");
  assert.equal(res.headers.get("X-Accel-Buffering"), "no");
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal(res.writableEnded, true);
  assert.match(res.writes[0], /opened during catch/);
  console.log("OK: coach SSE error helper opens SSE before writing stream errors");
}

{
  const res = new ResponseStub();
  res.writableEnded = true;
  const wrote = writeCoachStreamError(res as any, new Error("too late"));

  assert.equal(wrote, false);
  assert.equal(res.writes.length, 0);
  console.log("OK: coach SSE error helper does not write to ended streams");
}

{
  const res = new ResponseStub();
  res.destroyed = true;
  const wrote = writeCoachStreamError(res as any, new Error("destroyed"));

  assert.equal(wrote, false);
  assert.equal(res.writes.length, 0);
  console.log("OK: coach SSE error helper does not write to destroyed streams");
}
