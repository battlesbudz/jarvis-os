import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/db";

const { parseNaturalTime } = require("../tools/cronTools") as {
  parseNaturalTime: (expr: string) => Date | null;
};

function assertAboutOneHour(expr: string) {
  const before = Date.now();
  const parsed = parseNaturalTime(expr);
  assert(parsed, `${expr} should parse`);
  const delta = parsed.getTime() - before;
  assert(
    delta > 55 * 60 * 1000 && delta < 65 * 60 * 1000,
    `${expr} parsed outside one-hour window: ${delta}`,
  );
  console.log(`ok - ${expr} parses to about one hour from now`);
}

assertAboutOneHour("in 1 hour");
assertAboutOneHour("in an hour");
assertAboutOneHour("in one hour");

