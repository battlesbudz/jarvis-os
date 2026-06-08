import {
  decideContextPacks,
  type ContextPackDecision,
  type ContextPackId,
} from "../../agent/contextPacks";
import {
  ContextPacketSchema,
  JarvisEventSchema,
  type ContextPacket,
  type ContextSource,
  type JarvisEvent,
} from "../protocol";

export interface RuntimeContextPacketAdapterInput {
  event: JarvisEvent | unknown;
  decision?: ContextPackDecision;
  createdAt?: string;
}

export interface RuntimeContextPacketAdapterResult {
  event: JarvisEvent;
  decision: ContextPackDecision;
  contextPacket: ContextPacket;
}

export function runtimeProtocolSafeId(prefix: string, raw: string): string {
  const safe = raw.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").slice(0, 72);
  return `${prefix}-${safe || "unknown"}`;
}

export function runtimeContextSourceKindForPack(pack: ContextPackId): ContextSource["kind"] {
  switch (pack) {
    case "daily_planning_context":
      return "goals";
    case "memory_context":
    case "brain_context":
      return "memory";
    case "email_context":
      return "email";
    case "calendar_context":
      return "calendar";
    case "research_context":
    case "daemon_context":
    case "self_healing_context":
      return "tool";
    case "business_context":
    case "code_work_context":
    case "always_on_kernel":
      return "workspace";
    default:
      return "unknown";
  }
}

export function contextPacketFromContextPackDecision(input: {
  event: JarvisEvent;
  decision: ContextPackDecision;
  createdAt: string;
}): ContextPacket {
  return ContextPacketSchema.parse({
    packetId: runtimeProtocolSafeId("packet", input.event.eventId),
    userId: input.event.userId,
    query: input.event.message,
    createdAt: input.createdAt,
    sources: input.decision.requiredContextPacks.map((pack) => ({
      kind: runtimeContextSourceKindForPack(pack),
      id: pack,
      label: pack,
      confidence: pack === "always_on_kernel" ? 0.95 : 0.75,
    })),
    provenance: ["server/agent/contextPacks.ts"],
    uncertainty: input.decision.reasons.length === 0 ? ["No classifier reasons were produced."] : [],
    omissions: ["Runtime Gate v0.2 does not retrieve live context or execute tools."],
  });
}

export function adaptRuntimeContextPacketFromEvent(input: RuntimeContextPacketAdapterInput): RuntimeContextPacketAdapterResult {
  const event = JarvisEventSchema.parse(input.event);
  const decision = input.decision ?? decideContextPacks({
    userMessage: event.message,
    channel: event.channel,
  });
  const createdAt = input.createdAt ?? event.createdAt;
  return {
    event,
    decision,
    contextPacket: contextPacketFromContextPackDecision({
      event,
      decision,
      createdAt,
    }),
  };
}
