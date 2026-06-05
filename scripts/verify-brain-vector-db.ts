import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFiles } from "./test-env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

loadEnvFiles(projectRoot);

async function main(): Promise<void> {
  const { formatBrainVectorVerificationReport, runBrainVectorDbVerification } = await import(
    "../server/brain/vectorDbVerification"
  );

  const report = await runBrainVectorDbVerification({ projectRoot, closePool: true });
  console.log(formatBrainVectorVerificationReport(report));

  if (!report.allPassed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
