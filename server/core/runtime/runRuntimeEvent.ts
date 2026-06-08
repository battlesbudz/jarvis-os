import type { RuntimeDecision, RuntimeEvent } from "../protocol";
import { executeRuntimeEvent } from "./executeRuntimeEvent";

export interface RunRuntimeEventOptions {
  now?: Date;
}

export async function runRuntimeEvent(
  event: RuntimeEvent | unknown,
  options: RunRuntimeEventOptions = {},
): Promise<RuntimeDecision> {
  const result = executeRuntimeEvent({
    event,
    now: options.now,
  });

  return result.decision;
}
