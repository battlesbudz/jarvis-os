import { existsSync, readFileSync } from "node:fs";

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;

  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;

    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(".env");
loadEnvFile(".env.local");

async function main(): Promise<void> {
  const { formatJarvisOsReadiness, getJarvisOsReadiness } = await import("../server/diagnostics/osReadiness");
  const userId = process.env.JARVIS_DOCTOR_USER_ID;
  const report = await getJarvisOsReadiness(userId);

  console.log(formatJarvisOsReadiness(report));

  process.exitCode = report.overallStatus === "blocked" ? 1 : 0;
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Jarvis doctor failed before producing a readiness report: ${message}`);
  process.exitCode = 1;
});
