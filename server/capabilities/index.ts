/**
 * Capability registry entry point.
 *
 * Imports every capability module and registers it with the singleton
 * CapabilityRegistry. Import this file once at server startup (or lazily via
 * dynamic import) to guarantee all capabilities are available before the
 * registry is queried.
 *
 * Consumers (harness.ts, integrationValidator.ts) import `capabilityRegistry`
 * from this file — never from registry.ts directly — so registration always
 * runs before the first read.
 */

export { capabilityRegistry } from "./registry";
export type { Capability, CapabilityHealthStatus, IntegrationDependency, ConfigRequirement } from "./types";

import { capabilityRegistry } from "./registry";

import { calendarCapability }     from "./calendarCapability";
import { emailCapability }        from "./emailCapability";
import { coachingCapability }     from "./coachingCapability";
import { researchCapability }     from "./researchCapability";
import { discordCapability }      from "./discordCapability";
import { browserCapability }      from "./browserCapability";
import { daemonCapability }       from "./daemonCapability";
import { driveCapability }        from "./driveCapability";
import { systemCapability }       from "./systemCapability";
import { schedulingCapability }   from "./schedulingCapability";
import { mediaCapability }        from "./mediaCapability";
import { memoryCapability }       from "./memoryCapability";
import { connectionsCapability }  from "./connectionsCapability";

capabilityRegistry.register(calendarCapability);
capabilityRegistry.register(emailCapability);
capabilityRegistry.register(coachingCapability);
capabilityRegistry.register(researchCapability);
capabilityRegistry.register(discordCapability);
capabilityRegistry.register(browserCapability);
capabilityRegistry.register(daemonCapability);
capabilityRegistry.register(driveCapability);
capabilityRegistry.register(systemCapability);
capabilityRegistry.register(schedulingCapability);
capabilityRegistry.register(mediaCapability);
capabilityRegistry.register(memoryCapability);
capabilityRegistry.register(connectionsCapability);
