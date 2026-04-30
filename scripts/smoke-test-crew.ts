/**
 * Smoke test for the PRIME crew layer.
 * Run with: npx tsx scripts/smoke-test-crew.ts
 */

import { resolveSpecialist, getCrewManifest } from "../server/agent/crewRouter";

const USER_ID = process.env.SEED_USER_ID || "c06aae28-159a-4716-9222-d1389fb6618f";

async function main() {
  console.log("=== PRIME Crew Layer Smoke Test ===\n");

  // 1. Verify crew manifest generation
  console.log("1. Crew manifest:");
  const manifest = await getCrewManifest(USER_ID);
  const manifestLines = manifest.split("\n").length;
  console.log(`   Lines: ${manifestLines}`);
  console.log(`   Has ATLAS: ${manifest.includes("ATLAS")}`);
  console.log(`   Has HERALD: ${manifest.includes("HERALD")}`);
  console.log(`   Has ORACLE: ${manifest.includes("ORACLE")}`);
  console.log(`   Has SCOUT: ${manifest.includes("SCOUT")}`);
  console.log(`   Has FORGE: ${manifest.includes("FORGE")}`);
  console.log(`   Has ECHO: ${manifest.includes("ECHO")}`);
  console.log();

  // 2. Verify each specialist resolves
  const specialists = ["ATLAS", "HERALD", "ORACLE", "SCOUT", "FORGE", "ECHO"];
  console.log("2. Specialist resolution:");
  for (const name of specialists) {
    const agent = await resolveSpecialist(name, USER_ID);
    if (agent) {
      const cfg = (agent.configJson ?? {}) as Record<string, unknown>;
      console.log(`   ${name} → ${agent.name} (${agent.preferredModel}) crewRole=${cfg.crewRole} isCrewMember=${cfg.isCrewMember}`);

      // Model enforcement check
      const ALLOWED = new Set(["gpt-4o-mini", "gpt-4.1-mini"]);
      if (!ALLOWED.has(agent.preferredModel ?? "")) {
        console.warn(`   ⚠️  ${name} has non-approved model: ${agent.preferredModel}`);
      } else {
        console.log(`   ✓ Model approved: ${agent.preferredModel}`);
      }
    } else {
      console.error(`   ✗ ${name} NOT FOUND`);
    }
  }
  console.log();

  // 3. Verify null for non-existent specialist
  const none = await resolveSpecialist("NONEXISTENT", USER_ID);
  console.log(`3. Non-existent specialist: ${none === null ? "✓ returns null" : "✗ expected null"}`);
  console.log();

  // 4. PRIME should not resolve as a specialist (orchestrator role)
  const prime = await resolveSpecialist("PRIME", USER_ID);
  console.log(`4. PRIME (orchestrator) resolve: ${prime === null ? "✓ returns null (not routed as specialist)" : `✗ expected null but got ${prime?.name}`}`);
  console.log();

  console.log("=== Smoke test complete ===");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Smoke test failed:", err);
    process.exit(1);
  });
