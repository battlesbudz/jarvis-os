import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const tsxCli = path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");

const tests = [
  { file: "server/diagnostics/__tests__/osReadiness.test.ts" },
  { file: "server/agent/__tests__/autonomyPolicy.test.ts" },
  { file: "server/agent/__tests__/autonomyRuntime.test.ts" },
  { file: "server/agent/__tests__/appCoachChatAutonomy.test.ts" },
  { file: "server/agent/__tests__/appProjectRunner.test.ts" },
  { file: "server/agent/__tests__/topLevelApprovalContinuation.test.ts" },
  { file: "server/agent/__tests__/reviewLoop.test.ts" },
  { file: "server/agent/__tests__/deliverableReviewActions.test.ts" },
  { file: "server/agent/__tests__/deliverableReviewHttpRoutes.test.ts" },
  { file: "server/agent/__tests__/osSmoke.test.ts" },
  { file: "server/agent/__tests__/manifestFilter.assert.ts" },
  { file: "server/agent/__tests__/toolAwareRouting.assert.ts" },
  { file: "server/agent/__tests__/projectCreateRequest.assert.ts" },
  { file: "server/agent/__tests__/modelRouter.assert.ts" },
  { file: "server/agent/__tests__/codexOAuth.assert.ts" },
  { file: "server/agent/__tests__/codexDelegation.assert.ts" },
  { file: "server/agent/__tests__/routedChatCompletion.assert.ts" },
  { file: "server/agent/__tests__/providerEnv.assert.ts" },
  { file: "server/agent/__tests__/inboxTriageConfig.assert.ts" },
  { file: "server/agent/__tests__/contextRegistryRouting.assert.ts" },
  { file: "server/agent/__tests__/livingContextUpdateTool.assert.ts" },
  { file: "server/workspace/__tests__/livingContextRouter.assert.ts" },
  { file: "server/agent/__tests__/integrationError.assert.ts", requiresDatabase: true },
  { file: "server/agent/__tests__/selfHeal.assert.ts", requiresDatabase: true },
  { file: "server/agent/__tests__/writeBudget.assert.ts", requiresDatabase: true },
  { file: "server/agent/__tests__/mcp.assert.ts", requiresDatabase: true },
  { file: "server/agent/__tests__/browserTabTools.test.ts", requiresDatabase: true },
  { file: "server/agent/__tests__/toolCallHooks.test.ts" },
  { file: "server/agent/__tests__/outboundMiddleware.test.ts" },
  { file: "server/agent/__tests__/responseQuality.test.ts" },
  { file: "server/agent/__tests__/queryClassifier.test.ts" },
  { file: "server/agent/__tests__/weatherLookup.test.ts" },
];

const hasDatabase = Boolean(process.env.DATABASE_URL);
let skipped = 0;

for (const test of tests) {
  if (test.requiresDatabase && !hasDatabase) {
    skipped += 1;
    console.warn(`${test.file}: DATABASE_URL not set - skipped`);
    continue;
  }

  const result = spawnSync(process.execPath, [tsxCli, test.file], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (skipped > 0) {
  console.warn(`Skipped ${skipped} DB-backed test file(s).`);
}
