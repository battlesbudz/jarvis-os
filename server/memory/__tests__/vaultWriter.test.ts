/**
 * Tests for the Knowledge Vault Writer — behavior validation.
 *
 * Tests verify that each source builder queries the correct memory
 * categories and tables, and that isVaultStale enforces completeness
 * (all 5 slugs must exist) and freshness correctly.
 *
 * Run with: tsx server/memory/__tests__/vaultWriter.test.ts
 */

import { db, pool } from "../../db";
import * as schema from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  isVaultStale,
  buildAboutYouSource,
  buildProjectsSource,
  buildPeopleSource,
  buildPatternsSource,
  buildDecisionsSource,
} from "../vaultWriter";

const TEST_USER_ID = "__vault_test_user__";

let passed = 0;
let failed = 0;

function ok(condition: boolean, label: string): void {
  if (condition) { console.log(`✓ ${label}`); passed++; }
  else           { console.error(`✗ ${label}`); failed++; }
}

async function setup(): Promise<void> {
  await db
    .insert(schema.users)
    .values({ id: TEST_USER_ID, username: TEST_USER_ID })
    .onConflictDoNothing();
  await teardown();
}

async function teardown(): Promise<void> {
  await db.delete(schema.knowledgeVaultPages).where(eq(schema.knowledgeVaultPages.userId, TEST_USER_ID));
  await db.delete(schema.userMemories).where(eq(schema.userMemories.userId, TEST_USER_ID));
  await db.delete(schema.people).where(eq(schema.people.userId, TEST_USER_ID));
  await db.delete(schema.weeklyInsights).where(eq(schema.weeklyInsights.userId, TEST_USER_ID));
  await db.delete(schema.dreamInsights).where(eq(schema.dreamInsights.userId, TEST_USER_ID));
}

async function insertMemory(category: schema.MemoryCategory | "fact", content: string, tier: schema.MemoryTier = "long_term"): Promise<void> {
  await db.insert(schema.userMemories).values({
    userId: TEST_USER_ID,
    content,
    category,
    confidence: 80,
    tier,
    memoryType: "semantic",
    reviewStatus: "active",
    relevanceScore: 50,
    sourceType: "test",
  });
}

// ── V-1: isVaultStale → true when no pages exist ─────────────────────────────

async function testStaleWhenEmpty(): Promise<void> {
  const stale = await isVaultStale(TEST_USER_ID);
  ok(stale === true, "V-1: isVaultStale returns true when no pages exist");
}

// ── V-2: isVaultStale → true when only partial pages exist ───────────────────

async function testStaleWhenPartial(): Promise<void> {
  const now = new Date();
  await db.insert(schema.knowledgeVaultPages).values({
    userId: TEST_USER_ID,
    slug: "about-you",
    title: "About You",
    content: "# Test",
    generatedAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [schema.knowledgeVaultPages.userId, schema.knowledgeVaultPages.slug],
    set: { content: "# Test", generatedAt: now, updatedAt: now },
  });

  const stale = await isVaultStale(TEST_USER_ID);
  ok(stale === true, "V-2: isVaultStale returns true when only 1 of 5 pages exist");
}

// ── V-3: isVaultStale → false when all 5 pages are fresh ─────────────────────

async function testNotStaleWhenAllFresh(): Promise<void> {
  const now = new Date();
  for (const slug of schema.VAULT_SLUGS) {
    await db.insert(schema.knowledgeVaultPages).values({
      userId: TEST_USER_ID,
      slug,
      title: slug,
      content: `# ${slug}`,
      generatedAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [schema.knowledgeVaultPages.userId, schema.knowledgeVaultPages.slug],
      set: { content: `# ${slug}`, generatedAt: now, updatedAt: now },
    });
  }

  const stale = await isVaultStale(TEST_USER_ID);
  ok(stale === false, "V-3: isVaultStale returns false when all 5 pages exist and are fresh");
}

// ── V-4: about-you sources from identity/preference categories ────────────────

async function testAboutYouCategories(): Promise<void> {
  const marker = "VAULT_TEST_VALUES_MEMORY_" + Date.now();
  await insertMemory("values", marker);

  const source = await buildAboutYouSource(TEST_USER_ID);
  ok(source.includes(marker), "V-4: buildAboutYouSource includes 'values' category memories");

  const marker2 = "VAULT_TEST_PREFS_MEMORY_" + Date.now();
  await insertMemory("preferences", marker2);
  const source2 = await buildAboutYouSource(TEST_USER_ID);
  ok(source2.includes(marker2), "V-4b: buildAboutYouSource includes 'preferences' category memories");
}

// ── V-5: projects sources from goals_history/accomplishments memories ─────────

async function testProjectsCategories(): Promise<void> {
  const marker = "VAULT_TEST_GOAL_MEMORY_" + Date.now();
  await insertMemory("goals_history", marker);

  const source = await buildProjectsSource(TEST_USER_ID);
  ok(source.includes(marker), "V-5: buildProjectsSource includes 'goals_history' category memories");

  const marker2 = "VAULT_TEST_ACCOMPLISH_MEMORY_" + Date.now();
  await insertMemory("accomplishments", marker2);
  const source2 = await buildProjectsSource(TEST_USER_ID);
  ok(source2.includes(marker2), "V-5b: buildProjectsSource includes 'accomplishments' category memories");
}

// ── V-6: people sources from the people table ─────────────────────────────────

async function testPeopleSource(): Promise<void> {
  const uniqueName = "VaultTestPerson_" + Date.now();
  await db.insert(schema.people).values({
    userId: TEST_USER_ID,
    name: uniqueName,
    relationship: "colleague",
    interactionCount: 3,
  });

  const source = await buildPeopleSource(TEST_USER_ID);
  ok(source.includes(uniqueName), "V-6: buildPeopleSource includes names from the people table");
}

// ── V-7: patterns sources from dream_insights table ───────────────────────────

async function testPatternsSource(): Promise<void> {
  const marker = "VAULT_TEST_DREAM_INSIGHT_" + Date.now();
  await db.insert(schema.dreamInsights).values({
    userId: TEST_USER_ID,
    dreamDate: new Date().toISOString().slice(0, 10),
    insightText: marker,
    confidenceScore: 85,
  });

  const source = await buildPatternsSource(TEST_USER_ID);
  ok(source.includes(marker), "V-7: buildPatternsSource includes dream insight text");
}

// ── V-8: decisions sources from goals_history/values/blockers memories ────────

async function testDecisionsCategories(): Promise<void> {
  const marker = "VAULT_TEST_BLOCKER_MEMORY_" + Date.now();
  await insertMemory("blockers", marker);

  const source = await buildDecisionsSource(TEST_USER_ID);
  ok(source.includes(marker), "V-8: buildDecisionsSource includes 'blockers' category memories");
}

// ── Runner ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await setup();
  try {
    await testStaleWhenEmpty();
    await testStaleWhenPartial();
    await testNotStaleWhenAllFresh();
    await teardown();
    await setup();
    await testAboutYouCategories();
    await teardown();
    await setup();
    await testProjectsCategories();
    await teardown();
    await setup();
    await testPeopleSource();
    await teardown();
    await setup();
    await testPatternsSource();
    await teardown();
    await setup();
    await testDecisionsCategories();
  } finally {
    await teardown();
    await db.delete(schema.users).where(eq(schema.users.id, TEST_USER_ID));
    await pool.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
