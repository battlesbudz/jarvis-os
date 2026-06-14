import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const connectorRoot = path.resolve(__dirname, "..");
const targetTriple = process.env.TAURI_TARGET_TRIPLE || "x86_64-pc-windows-msvc";
const builtBinary = path.join(__dirname, "dist", "jarvis-desktop-daemon.exe");
const tauriBinariesRelativePath = "src-tauri/binaries";
const binariesDir = path.join(connectorRoot, ...tauriBinariesRelativePath.split("/"));
const tauriSidecar = path.join(binariesDir, `jarvis-desktop-daemon-${targetTriple}.exe`);

await fs.mkdir(binariesDir, { recursive: true });
await fs.copyFile(builtBinary, tauriSidecar);
console.log(`Prepared Tauri sidecar ${path.relative(connectorRoot, tauriSidecar)}`);
