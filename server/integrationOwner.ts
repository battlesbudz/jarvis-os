import { db } from "./db";
import { sql } from "drizzle-orm";

let cachedOwnerId: string | null = null;

const TEST_OWNER_OVERRIDE_KEY = Symbol.for("jarvis.integrationOwner.testOverride");

function getTestOwnerOverride(): string | null | undefined {
  if (process.env.NODE_ENV === "production") return undefined;
  return (globalThis as any)[TEST_OWNER_OVERRIDE_KEY] as string | null | undefined;
}

export async function getIntegrationOwnerId(): Promise<string | null> {
  const testOverride = getTestOwnerOverride();
  if (testOverride !== undefined) return testOverride;
  if (cachedOwnerId) return cachedOwnerId;
  try {
    const result = await db.execute(sql`SELECT owner_user_id FROM integration_owner LIMIT 1`);
    const row = (result as any).rows?.[0];
    if (row?.owner_user_id) {
      cachedOwnerId = row.owner_user_id;
      return cachedOwnerId;
    }

    // No owner claimed yet — auto-seed from the earliest registered user.
    // This handles single-user deployments where Google/Outlook OAuth has
    // never been connected (the only previous trigger for claiming ownership),
    // so self-edit tools and integrations work out of the box.
    const userResult = await db.execute(
      sql`SELECT id FROM users ORDER BY created_at ASC LIMIT 1`
    );
    const firstUser = (userResult as any).rows?.[0];
    if (firstUser?.id) {
      await db.execute(
        sql`INSERT INTO integration_owner (owner_user_id) VALUES (${firstUser.id}) ON CONFLICT DO NOTHING`
      );
      cachedOwnerId = firstUser.id;
      return cachedOwnerId;
    }

    return null;
  } catch {
    return null;
  }
}

export async function claimIntegrationOwnership(userId: string): Promise<boolean> {
  try {
    const existing = await getIntegrationOwnerId();
    if (existing) return existing === userId;
    await db.execute(sql`INSERT INTO integration_owner (owner_user_id) VALUES (${userId})`);
    cachedOwnerId = userId;
    return true;
  } catch {
    return false;
  }
}

export async function isIntegrationOwner(userId: string): Promise<boolean> {
  const ownerId = await getIntegrationOwnerId();
  if (!ownerId) return false;
  return ownerId === userId;
}

/**
 * TEST-ONLY: Directly set the cached owner ID so tests can exercise owner-gated
 * tool behaviour without a real database connection.
 * Pass null to clear the cache (simulates no owner claimed).
 * Never call this from production code.
 */
export function _setOwnerIdForTest(id: string | null): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("_setOwnerIdForTest must not be called in production");
  }
  (globalThis as any)[TEST_OWNER_OVERRIDE_KEY] = id;
  cachedOwnerId = id;
}
