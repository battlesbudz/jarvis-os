import { seedAllSessions } from "../channels/sessionStore";

export async function runPreListenBoot(): Promise<void> {
  seedAllSessions().catch((err) =>
    console.warn("[Startup] seedAllSessions failed (non-fatal):", err),
  );

  try {
    const { seedDefaultPacks } = await import("../intelligence/behaviorStore");
    await seedDefaultPacks();
  } catch (err) {
    console.warn("[Startup] skill pack seeding failed (non-fatal):", err);
  }

  try {
    const { seedCoreAgentsForAllUsers } = await import("../agent/coreAgentSeed");
    await seedCoreAgentsForAllUsers();
  } catch (err) {
    console.warn("[Startup] core agent seeding failed (non-fatal):", err);
  }

  try {
    const { seedCrewAgentsForAllUsers } = await import("../agent/crewSeed");
    await seedCrewAgentsForAllUsers();
  } catch (err) {
    console.warn("[Startup] crew agent seeding failed (non-fatal):", err);
  }

  try {
    const { seedConfirmTokenCache } = await import("../agent/discordConfirmStore");
    await seedConfirmTokenCache();
  } catch (err) {
    console.warn("[Startup] seedConfirmTokenCache failed (non-fatal):", err);
  }

  import("../agent/mcp/mcpServerRegistry").then(async ({ mcpServerRegistry }) => {
    await mcpServerRegistry.start();
    const systemTools = mcpServerRegistry.getSystemTools();
    if (systemTools.length > 0) {
      const [{ capabilityRegistry }, { buildMcpCapability }, { registerMcpTools }] = await Promise.all([
        import("../capabilities/index"),
        import("../capabilities/mcpCapability"),
        import("../agent/tools/index"),
      ]);
      capabilityRegistry.register(buildMcpCapability());
      registerMcpTools(systemTools);
      console.log(`[McpRegistry] registered ${systemTools.length} system tools`);
    }
  }).catch((err: Error) => {
    console.warn("[McpRegistry] startup failed (non-fatal):", err.message);
  });

  setTimeout(() => {
    Promise.allSettled([
      import("../agent/tools/index"),
      import("../capabilities/index"),
      import("../lib/modelPrefs"),
      import("../intelligence/behaviorStore"),
      import("../intelligence/skillWriter"),
      import("../agent/tools/channelTools"),
    ]).then(() => {
      console.log("[Startup] pre-warming complete: agent modules loaded");
    }).catch(() => {});
  }, 2000);
}
