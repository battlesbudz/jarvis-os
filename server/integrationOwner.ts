import { db } from "./db";
import { sql } from "drizzle-orm";

let cachedOwnerId: string | null = null;

export async function getIntegrationOwnerId(): Promise<string | null> {
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
