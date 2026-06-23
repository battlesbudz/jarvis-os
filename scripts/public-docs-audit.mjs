import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const publicFiles = [
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CODE_OF_CONDUCT.md",
  "CHANGELOG.md",
  "ACKNOWLEDGEMENTS.md",
  "ROADMAP.md",
  "JARVIS_ROADMAP.md",
  "docs/README.md",
  "docs/self-hosting.md",
  "docs/architecture.md",
  "docs/workspace-map.md",
  "docs/operations/jarvis-os-runbook.md",
  "docs/public-compatibility.md",
  "dashboard/README.md",
  "downloads/README.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/workflows/ci.yml",
  ".github/workflows/e2e-smoke.yml",
];

const publicDirs = [
  ".github/ISSUE_TEMPLATE",
  ".github/PULL_REQUEST_TEMPLATE",
];

const blockedPatterns = [
  { label: "old public product name", pattern: /\bGamePlan\b/ },
  { label: "old public slug/package name", pattern: /\bexpo-app\b/ },
  { label: "old public slug", pattern: /\bgameplan\b/ },
  { label: "MiniMax branch wording", pattern: /\bMiniMax\b/i },
  { label: "OpenClaw branch wording", pattern: /\bOpenClaw\b/i },
  { label: "private workspace path", pattern: /workspaces[\\/]+battles/i },
  { label: "private business/persona wording", pattern: /\bBattles Budz\b|\bBattles\b/ },
  { label: "maintainer-local Windows path", pattern: /C:\\Users\\/i },
  { label: "stale dashboard port", pattern: /localhost:3000/ },
  { label: "internal planning archive link", pattern: /docs[\\/]+superpowers|docs\/superpowers/i },
];

const allowedCompatibilityReferences = [
  {
    file: "docs/public-compatibility.md",
    labels: new Set(["old public slug"]),
    reason: "This file intentionally documents staged-rename compatibility identifiers.",
  },
];

const requiredReadmeAssets = [
  "docs/assets/screenshots/mobile-mission-control.png",
  "docs/assets/screenshots/mobile-memory-review.png",
  "docs/assets/screenshots/mobile-stored-memories.png",
  "docs/assets/screenshots/mobile-app-workspace.png",
  "docs/assets/screenshots/mobile-app-static-workspace.png",
  "docs/assets/screenshots/mobile-provider-usage.png",
  "docs/assets/screenshots/mobile-connections.png",
  "docs/assets/screenshots/mobile-knowledge-vault.png",
  "docs/assets/screenshots/mobile-wiki-index-detail.png",
  "docs/assets/screenshots/mobile-universal-conversation-search.png",
];

function toFsPath(relativePath) {
  return path.join(repoRoot, ...relativePath.split("/"));
}

function walkFiles(relativeDir) {
  const dir = toFsPath(relativeDir);
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const child = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) return walkFiles(child);
    return [child];
  });
}

const files = [
  ...publicFiles,
  ...publicDirs.flatMap(walkFiles),
].filter((file, index, all) => all.indexOf(file) === index && fs.existsSync(toFsPath(file)));

const failures = [];

function isAllowedReference(file, blocked) {
  return allowedCompatibilityReferences.some(
    (allowed) => allowed.file === file && allowed.labels.has(blocked.label),
  );
}

for (const file of files) {
  const text = fs.readFileSync(toFsPath(file), "utf8");
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    for (const blocked of blockedPatterns) {
      if (blocked.pattern.test(line) && !isAllowedReference(file, blocked)) {
        failures.push(`${file}:${index + 1} contains ${blocked.label}: ${line.trim()}`);
      }
    }
  });
}

for (const asset of requiredReadmeAssets) {
  if (!fs.existsSync(toFsPath(asset))) {
    failures.push(`${asset} is referenced by README.md but does not exist`);
  }
}

if (failures.length > 0) {
  console.error("Public docs audit failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Public docs audit passed (${files.length} files checked).`);
