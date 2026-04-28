import { researchHasSourceUrls } from "../researchUtils";

let passed = 0;
let failed = 0;

function assert(label: string, actual: boolean, expected: boolean) {
  if (actual === expected) {
    console.log(`✓ ${label}`);
    passed++;
  } else {
    console.error(`✗ ${label} — expected ${expected}, got ${actual}`);
    failed++;
  }
}

const bodyWithUrl = `## TL;DR
- Finding one.

## Findings
1. Something important (matters because it does).

## Sources
- https://example.com/article
- https://news.ycombinator.com/item?id=12345
`;

const bodyWithNoSourcesSection = `## TL;DR
- Finding one.

## Findings
1. Something important.
`;

const bodyWithEmptySourcesSection = `## TL;DR
- Finding one.

## Findings
1. Something important.

## Sources
(No sources found.)
`;

const bodyWithSourcesAfterOtherHeading = `## TL;DR
- Finding one.

## Sources
- https://real-source.com/page

## Additional Notes
Some extra content here.
`;

const bodyWithHttpOnly = `## Sources
- http://insecure-site.org/data
`;

const bodyWithUrlBeforeSources = `## TL;DR
- See https://example.com for context.

## Findings
1. Something.

## Sources
No URLs here.
`;

const bodyWithMultipleH2s = `## TL;DR
- Something.

## Findings
1. Item.

## Sources
- https://cited-source.com

## Next Steps
- Do something.
`;

assert("A: body with real https URL in Sources → true", researchHasSourceUrls(bodyWithUrl), true);
assert("B: body with no Sources heading at all → false", researchHasSourceUrls(bodyWithNoSourcesSection), false);
assert("C: Sources section exists but has no URL → false", researchHasSourceUrls(bodyWithEmptySourcesSection), false);
assert("D: URL present only before Sources (in TL;DR), none in Sources → false", researchHasSourceUrls(bodyWithUrlBeforeSources), false);
assert("E: http:// (non-https) URL in Sources → true", researchHasSourceUrls(bodyWithHttpOnly), true);
assert("F: URL in Sources followed by another ## heading → true", researchHasSourceUrls(bodyWithSourcesAfterOtherHeading), true);
assert("G: multiple headings, URL appears in Sources section → true", researchHasSourceUrls(bodyWithMultipleH2s), true);
assert("H: empty string → false", researchHasSourceUrls(""), false);

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed.`);
  process.exit(1);
} else {
  console.log(`\nAll ${passed} researchHasSourceUrls assertions passed ✓`);
}
