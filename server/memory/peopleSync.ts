/**
 * Phase 4 — automatic relationship intelligence.
 *
 * Each heartbeat tick, scan the user's upcoming calendar attendees
 * and recent gmail senders. Each non-self party gets upserted into
 * the `people` table with an incremented interaction count and a
 * lightweight role hint (e.g. "calendar_attendee:work-meeting" or
 * "email_sender"). The next SOUL regeneration picks them up so the
 * coach knows who shows up in the user's life and how often.
 *
 * Inspired by OpenClaw's relationship-graph builder (MIT, © 2025
 * Peter Steinberger).
 */
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import * as schema from "@shared/schema";
import { getGoogleCalendarEvents } from "../integrations/googleCalendar";
import { getEmailsSince } from "../integrations/gmail";

const SYNC_LOOKBACK_HOURS = 24;
const SYNC_LOOKAHEAD_DAYS = 3;

interface PersonObservation {
  email: string;
  name: string | null;
  source: "calendar" | "email";
  context: string;
  when: Date;
}

function parseSender(from: string): { name: string | null; email: string } | null {
  // "Jane Doe <jane@example.com>" or "jane@example.com"
  const angle = from.match(/^"?([^"<]+?)"?\s*<([^>]+)>$/);
  if (angle) return { name: angle[1].trim(), email: angle[2].trim().toLowerCase() };
  const bare = from.match(/^[^\s<>]+@[^\s<>]+$/);
  if (bare) return { name: null, email: from.trim().toLowerCase() };
  return null;
}

export async function syncPeopleFromGoogle(userId: string, accessToken: string, now: Date): Promise<number> {
  const observations: PersonObservation[] = [];

  // 1) Calendar attendees: today + next few days.
  try {
    const dayKeys: string[] = [];
    for (let i = 0; i <= SYNC_LOOKAHEAD_DAYS; i++) {
      const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
      dayKeys.push(d.toISOString().slice(0, 10));
    }
    for (const day of dayKeys) {
      const events = await getGoogleCalendarEvents(day, undefined, undefined, accessToken).catch(() => []);
      for (const ev of events) {
        for (const att of ev.attendees ?? []) {
          if (att.self) continue;
          const email = att.email.toLowerCase();
          if (!email.includes("@")) continue;
          observations.push({
            email,
            name: att.displayName || null,
            source: "calendar",
            context: ev.title,
            when: new Date(ev.start),
          });
        }
      }
    }
  } catch (err) {
    console.error("[PeopleSync] calendar pass failed:", err);
  }

  // 2) Recent inbound gmail senders.
  try {
    const sinceMs = now.getTime() - SYNC_LOOKBACK_HOURS * 60 * 60 * 1000;
    const emails = await getEmailsSince(sinceMs, accessToken).catch(() => []);
    for (const e of emails) {
      const parsed = parseSender(e.from);
      if (!parsed) continue;
      observations.push({
        email: parsed.email,
        name: parsed.name,
        source: "email",
        context: e.subject,
        when: new Date(e.receivedAt),
      });
    }
  } catch (err) {
    console.error("[PeopleSync] gmail pass failed:", err);
  }

  if (observations.length === 0) return 0;

  // Coalesce by email so we only hit the DB once per person.
  const byEmail = new Map<string, PersonObservation>();
  for (const o of observations) {
    const existing = byEmail.get(o.email);
    if (!existing || o.when > existing.when) byEmail.set(o.email, o);
  }

  // Compute upcoming-event aggregates per email from the calendar
  // observations only (future events).
  const nowMs = now.getTime();
  const upcoming = new Map<string, { count: number; nearest: Date }>();
  for (const o of observations) {
    if (o.source !== "calendar") continue;
    if (o.when.getTime() < nowMs) continue;
    const cur = upcoming.get(o.email);
    if (!cur) upcoming.set(o.email, { count: 1, nearest: o.when });
    else {
      cur.count += 1;
      if (o.when < cur.nearest) cur.nearest = o.when;
    }
  }

  let upserts = 0;
  for (const obs of byEmail.values()) {
    const upc = upcoming.get(obs.email);
    try {
      const [existing] = await db
        .select()
        .from(schema.people)
        .where(and(eq(schema.people.userId, userId), eq(schema.people.email, obs.email)))
        .limit(1);

      const relationshipHint = obs.source === "calendar"
        ? `calendar attendee — ${obs.context}`
        : `email correspondent — re: ${obs.context}`;

      if (existing) {
        await db
          .update(schema.people)
          .set({
            name: existing.name && existing.name !== obs.email ? existing.name : (obs.name || obs.email),
            relationship: existing.relationship || relationshipHint,
            interactionCount: (existing.interactionCount ?? 0) + 1,
            lastInteractionAt: obs.when,
            nextInteractionAt: upc?.nearest ?? null,
            upcomingCount: upc?.count ?? 0,
            updatedAt: new Date(),
          })
          .where(eq(schema.people.id, existing.id));
      } else {
        await db.insert(schema.people).values({
          userId,
          name: obs.name || obs.email,
          email: obs.email,
          relationship: relationshipHint,
          notes: null,
          interactionCount: 1,
          lastInteractionAt: obs.when,
          nextInteractionAt: upc?.nearest ?? null,
          upcomingCount: upc?.count ?? 0,
        });
      }
      upserts += 1;
    } catch (err) {
      console.error(`[PeopleSync] upsert failed for ${obs.email}:`, err);
    }
  }

  // Touch SOUL so the next coach turn sees the updated relationship list.
  try {
    const { markSoulStale } = await import("./soul");
    await markSoulStale(userId);
  } catch {}

  console.log(`[PeopleSync] user=${userId} upserted=${upserts}`);
  return upserts;
}
