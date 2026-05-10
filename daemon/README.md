# Jarvis Desktop Daemon

A small Node.js process that lets the GamePlan autonomous agent control a
sandboxed corner of your desktop — running shell commands, reading and
writing files, and sending you native notifications.

Inspired by [OpenClaw](https://github.com/steipete/openclaw)'s computer-use
patterns. MIT licensed. Copyright (c) 2025 Peter Steinberger.

## What it can do

The agent communicates with the daemon over a WebSocket. The daemon only
exposes five operations, all sandboxed to a single workspace directory:

| Op           | Description                                                |
| ------------ | ---------------------------------------------------------- |
| `shell`      | Run a shell command inside the workspace root              |
| `notify`     | Send a native desktop notification                         |
| `file_read`  | Read a text file (max 512 KB) inside the workspace root    |
| `file_write` | Write a text file inside the workspace root                |
| `file_list`  | List entries (max 500) in a directory inside the workspace |

Anything outside the workspace root is rejected — the daemon refuses paths
that resolve outside it.

## Install

```bash
cd daemon
npm install
```

## Pair with your account

1. Open the GamePlan app → Profile → Connected Channels → Desktop Daemon.
2. Tap "Generate pairing code" — you'll get an 8-character code valid for 15 minutes.
3. On your desktop, run:

```bash
JARVIS_SERVER=https://gameplanjarvisai.up.railway.app \
JARVIS_PAIR_CODE=ABCD1234 \
JARVIS_DAEMON_ROOT=$HOME/jarvis-workspace \
node jarvis-daemon.js
```

You can also pass them as flags: `--server`, `--code`, `--root`.

After pairing, the daemon stays connected and reconnects with exponential
backoff if the network drops. Replace the daemon by running the install
again with a fresh code — the server will close any prior session for you.

## Notifications

- macOS: uses `osascript display notification`
- Linux: uses `notify-send` (install `libnotify-bin` if missing)
- Windows: uses `BurntToast` PowerShell module (`Install-Module BurntToast`)

## Security notes

- The daemon only accepts ops from the server it paired with.
- All file ops are confined to `JARVIS_DAEMON_ROOT` (default `~/jarvis-workspace`).
- Shell commands run with the privileges of the user running the daemon.
  Treat the workspace root the same way you'd treat a folder you let any
  CLI tool you installed touch — keep secrets out of it.
- Pairing codes are single-use and expire after 15 minutes.
- Stop the daemon at any time with `Ctrl+C`. Unpair from the GamePlan app
  to revoke the binding server-side.
