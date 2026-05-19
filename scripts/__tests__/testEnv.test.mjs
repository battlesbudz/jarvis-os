import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  configureDatabaseEnvForTests,
  loadEnvFiles,
} from "../test-env.mjs";

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-test-env-"));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

withTempDir((dir) => {
  fs.writeFileSync(path.join(dir, ".env"), "KEEP=from-env\nDATABASE_URL=postgresql://live-db\n");
  fs.writeFileSync(path.join(dir, ".env.local"), "KEEP=from-local\nLOCAL_ONLY=yes\n");
  fs.writeFileSync(path.join(dir, ".env.test.local"), "JARVIS_TEST_DATABASE_URL=postgresql://test-db\n");

  const env = { KEEP: "already-set" };
  loadEnvFiles(dir, env);

  assert.equal(env.KEEP, "already-set", "env loading does not overwrite existing values");
  assert.equal(env.LOCAL_ONLY, "yes", "env loading reads .env.local");
  assert.equal(env.JARVIS_TEST_DATABASE_URL, "postgresql://test-db", "env loading reads .env.test.local");

  const hasDatabase = configureDatabaseEnvForTests(env);
  assert.equal(hasDatabase, true, "test DB URL enables DB-backed tests");
  assert.equal(env.DATABASE_URL, "postgresql://test-db", "test DB URL wins over live DATABASE_URL");
});

{
  const env = { DATABASE_URL: "postgresql://live-db" };
  const hasDatabase = configureDatabaseEnvForTests(env);
  assert.equal(hasDatabase, false, "plain DATABASE_URL does not run DB tests without opt-in");
  assert.equal(env.DATABASE_URL, "postgresql://live-db", "plain DATABASE_URL remains available");
}

{
  const env = {
    DATABASE_URL: "postgresql://explicit-live-db",
    JARVIS_RUN_DB_TESTS_WITH_DATABASE_URL: "1",
  };
  const hasDatabase = configureDatabaseEnvForTests(env);
  assert.equal(hasDatabase, true, "explicit opt-in allows DATABASE_URL for DB tests");
}

console.log("test-env assertions passed.");
