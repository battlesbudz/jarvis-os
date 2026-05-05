import assert from "node:assert/strict";
import { detectLivingContextUpdate } from "../livingContextRouter";

function assertRoute(text: string, target: string) {
  const match = detectLivingContextUpdate({ text, sourceType: "conversation" });
  assert.ok(match, `Expected match for: ${text}`);
  assert.equal(match.target, target);
}

function assertNoRoute(text: string) {
  const match = detectLivingContextUpdate({ text, sourceType: "conversation" });
  assert.equal(match, null, `Expected no match for: ${text}`);
}

async function main() {
  assertRoute("OCM said final approval is waiting on the facility inspection.", "licensing_readiness");
  assertRoute("The facility inspection is scheduled after the security cameras are installed.", "facility_readiness");
  assertRoute("The compliance SOPs still need inventory tracking and packaging review.", "compliance_readiness");
  assertRoute("Pre-rolls are the first product we can realistically get ready.", "product_readiness");
  assertRoute("Retail distribution is the fastest revenue path if we can line up a processor.", "first_revenue_plan");

  assertNoRoute("Can you make Jarvis update the files automatically?");
  assertNoRoute("What should we do about OCM approval?");
  assertNoRoute("Thanks, that makes sense.");

  const emailMatch = detectLivingContextUpdate({
    sourceType: "email",
    text: "Subject: Facility inspection update\nThe facility inspection is pending the alarm certificate.",
  });
  assert.ok(emailMatch);
  assert.equal(emailMatch.target, "facility_readiness");
  assert.equal(emailMatch.confidence, 75);

  console.log("All living context router assertions passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
