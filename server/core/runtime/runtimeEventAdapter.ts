import { JarvisEventSchema, type JarvisEvent } from "../protocol";

export interface RuntimeMessageEventInput {
  source: JarvisEvent["source"];
  userId: string;
  message?: string;
  channel?: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
  eventId?: string;
}

function randomEventId(): string {
  return `event-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function jarvisEventFromMessage(input: RuntimeMessageEventInput): JarvisEvent {
  return JarvisEventSchema.parse({
    eventId: input.eventId ?? randomEventId(),
    source: input.source,
    userId: input.userId,
    message: input.message ?? "",
    channel: input.channel,
    createdAt: input.createdAt ?? new Date().toISOString(),
    metadata: input.metadata ?? {},
  });
}
