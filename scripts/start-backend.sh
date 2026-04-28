#!/usr/bin/env bash
# Best-effort yt-dlp upgrade via pip --user before the dev server starts.
# Overrides the stale Nix-pinned binary (2024.05.27) without touching replit.nix.
# --break-system-packages is required in Nix environments that enforce PEP 668;
# with --user it writes only to ~/.local, never to the immutable /nix/store.
# The production path (npm run server:prod) is covered by ensureYtdlpUpgraded()
# in server/lib/transcriptCache.ts which runs on first audio-transcription.

set -euo pipefail

echo "[start-backend] upgrading yt-dlp via pip (best-effort)..."
python3 -m pip install --user -U yt-dlp \
    --quiet --disable-pip-version-check --break-system-packages 2>&1 || \
  echo "[start-backend] WARNING: pip upgrade failed — server-side upgrade will run on first audio request"

# Prepend the pip user-scripts dir to PATH
USER_BIN="$(python3 -m site --user-base)/bin"
export PATH="$USER_BIN:$PATH"
hash -r 2>/dev/null || true

echo "[start-backend] yt-dlp version: $(yt-dlp --version 2>/dev/null || echo 'unknown')"

exec npm run server:dev
