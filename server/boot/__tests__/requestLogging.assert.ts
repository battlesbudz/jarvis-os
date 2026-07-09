import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { setupRequestLogging } from "../httpApp";

async function main() {
  const app = express();
  const lines: string[] = [];
  const originalLog = console.log;
  let resolveLogged: (() => void) | undefined;
  const logged = new Promise<void>((resolve) => {
    resolveLogged = resolve;
  });
  console.log = (line?: unknown, ...rest: unknown[]) => {
    const rendered = [line, ...rest].map(String).join(" ");
    lines.push(rendered);
    if (rendered.includes("GET /api/leaky 200")) resolveLogged?.();
  };

  try {
    setupRequestLogging(app);
    app.get("/api/leaky", (_req, res) => {
      res.json({
        ok: true,
        token: "secret-token-that-must-not-enter-access-logs",
      });
    });

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      assert.equal(typeof address, "object");
      assert(address);
      const { port } = address as AddressInfo;

      const response = await fetch(`http://127.0.0.1:${port}/api/leaky`);
      assert.equal(response.status, 200);
      await response.json();
      await Promise.race([
        logged,
        new Promise((_, reject) => setTimeout(() => reject(new Error("request log was not emitted")), 1000)),
      ]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  } finally {
    console.log = originalLog;
  }

  assert(lines.some((line) => line.includes("GET /api/leaky 200")));
  assert(!lines.some((line) => line.includes("secret-token-that-must-not-enter-access-logs")));
  assert(!lines.some((line) => line.includes('"token"')));

  console.log("OK: request logging does not serialize JSON response bodies");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
