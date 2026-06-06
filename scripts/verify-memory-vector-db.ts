import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFiles } from "./test-env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

loadEnvFiles(projectRoot);

async function main(): Promise<void> {
  const { formatMemoryVectorVerificationReport, runMemoryVectorDbVerification } = await import(
    "../server/memory/vectorDbVerification"
  );

  const report = await runMemoryVectorDbVerification({ projectRoot, closePool: true });
  console.log(formatMemoryVectorVerificationReport(report));

  if (!report.allPassed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
