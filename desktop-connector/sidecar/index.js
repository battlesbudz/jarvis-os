#!/usr/bin/env node

const path = require("path");

process.env.JARVIS_DAEMON_PLATFORM = process.env.JARVIS_DAEMON_PLATFORM || "desktop";
process.env.JARVIS_SERVER = process.env.JARVIS_SERVER || "https://gameplanjarvisai.up.railway.app";

if (!process.env.JARVIS_DAEMON_ROOT) {
  process.env.JARVIS_DAEMON_ROOT = path.join(process.env.USERPROFILE || process.env.HOME || process.cwd(), "jarvis-workspace");
}

const daemon = require("./bundled-daemon/jarvis-daemon.js");

if (!daemon || typeof daemon.connect !== "function") {
  console.error("[connector] bundled daemon does not export connect()");
  process.exit(1);
}

daemon.connect();
