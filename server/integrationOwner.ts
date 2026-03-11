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
