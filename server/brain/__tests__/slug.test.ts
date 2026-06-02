import assert from "node:assert/strict";
import { memoryPageSlug, personPageSlug, slugify } from "../slug";

assert.equal(slugify("  John's Beans / Watertown, NY!  "), "johns-beans-watertown-ny");
assert.equal(slugify(`${"a".repeat(79)} b`), "a".repeat(79));
assert.equal(
  memoryPageSlug("abc-123", "User prefers morning deep work"),
  "memory/user-prefers-morning-deep-work-abc123",
);
assert.equal(personPageSlug("Jean Smith"), "person/jean-smith");

console.log("OK: deterministic brain slugs");
