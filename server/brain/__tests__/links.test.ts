import assert from "node:assert/strict";
import { extractBrainLinks } from "../links";

const links = extractBrainLinks("Justin met with Jean Smith about the website.", ["Jean Smith"]);
assert.deepEqual(links, [{ verb: "mentions", toSlug: "person/jean-smith", confidence: 80 }]);

assert.equal(extractBrainLinks("Jean Smith emailed Jean Smith.", ["Jean Smith"]).length, 1);

assert.deepEqual(extractBrainLinks("JEAN SMITH replied.", ["jean smith"]), [
  { verb: "mentions", toSlug: "person/jean-smith", confidence: 80 },
]);
assert.deepEqual(extractBrainLinks("Sam Taylor replied.", [{ name: "Sam Taylor", toSlug: "person/sam-taylor-samalpha" }]), [
  { verb: "mentions", toSlug: "person/sam-taylor-samalpha", confidence: 80 },
]);
assert.deepEqual(extractBrainLinks("Justin met about the website.", [" ", "Jean Smith"]), []);
assert.deepEqual(extractBrainLinks("annual report", ["Ann"]), []);
assert.deepEqual(extractBrainLinks("Jean Smithsonian replied", ["Jean Smith"]), []);

console.log("OK: lightweight brain link extraction");
