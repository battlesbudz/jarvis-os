import { EventEmitter } from "events";
import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import * as schema from "@shared/schema";

export type GatewayEventSeverity = "debug" | "info" | "warning" | "error";

export interface GatewayEventInput {
  userId?: string | null;
  type: string;
  area?: string;
  severity?: GatewayEventSeverity;
  title: string;
  message?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  actorKind?: string | null;
  actorId?: string | null;
  metadata?: Record<string, unknown>;
}

export type GatewayEventRow = typeof schema.gatewayEvents.$inferSelect;

const emitter = new EventEmitter();
emitter.setMaxListeners(100);

export function onGatewayEvent(listener: (event: GatewayEventRow) => void): () => void {
  emitter.on("event", listener);
  return () => emitter.off("event", listener);
}

export async function recordGatewayEvent(input: GatewayEventInput): Promise<GatewayEventRow | null> {
  try {
    const [event] = await db.insert(schema.gatewayEvents).values({
      userId: input.userId ?? null,
      type: input.type,
      area: input.area ?? "gateway",
      severity: input.severity ?? "info",
      title: input.title,
      message: input.message ?? null,
      subjectType: input.subjectType ?? null,
      subjectId: input.subjectId ?? null,
      actorKind: input.actorKind ?? null,
      actorId: input.actorId ?? null,
      metadata: input.metadata ?? {},
    }).returning();
    if (event) emitter.emit("event", event);
    return event ?? null;
  } catch (error) {
    console.warn("[gateway-events] record failed:", error);
    return null;
  }
}

export async function listGatewayEvents(userId: string | null, limit: number): Promise<GatewayEventRow[]> {
  const query = db.select().from(schema.gatewayEvents).orderBy(desc(schema.gatewayEvents.createdAt)).limit(limit);
  if (!userId) return query.catch(() => []);
  return db.select()
    .from(schema.gatewayEvents)
    .where(eq(schema.gatewayEvents.userId, userId))
    .orderBy(desc(schema.gatewayEvents.createdAt))
    .limit(limit)
    .catch(() => []);
}
