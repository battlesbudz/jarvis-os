import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const daemonSource = path.join(repoRoot, "daemon", "jarvis-daemon.js");
const outputDir = path.join(__dirname, "bundled-daemon");
const outputFile = path.join(outputDir, "jarvis-daemon.js");

await fs.mkdir(outputDir, { recursive: true });
await fs.copyFile(daemonSource, outputFile);
console.log(`Copied daemon/jarvis-daemon.js to ${path.relative(repoRoot, outputFile)}`);
