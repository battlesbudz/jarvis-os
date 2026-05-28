#!/usr/bin/env bash
set -euo pipefail

TAILSCALE_VERSION="${TAILSCALE_VERSION:-1.96.6}"
TAILSCALE_ARCHIVE="tailscale_${TAILSCALE_VERSION}_amd64.tgz"
TAILSCALE_URL="https://pkgs.tailscale.com/stable/${TAILSCALE_ARCHIVE}"
TAILSCALE_DIR="${TAILSCALE_DIR:-/tmp/jarvis-tailscale}"
TAILSCALE_STATE_DIR="${TAILSCALE_STATE_DIR:-/tmp/jarvis-tailscale-state}"
TAILSCALE_SOCKET="${TAILSCALE_SOCKET:-${TAILSCALE_STATE_DIR}/tailscaled.sock}"
TS_HOSTNAME="${TS_HOSTNAME:-railway-jarvis}"
TS_HTTP_PROXY_PORT="${TS_HTTP_PROXY_PORT:-1056}"
TS_SOCKS5_PORT="${TS_SOCKS5_PORT:-1055}"

echo "[railway-start] applying database migrations"
npm run db:push -- --force

echo "[railway-start] running prestart checks"
node scripts/railway-prestart.mjs

download_tailscale() {
  mkdir -p "${TAILSCALE_DIR}"
  if [[ -x "${TAILSCALE_DIR}/tailscaled" && -x "${TAILSCALE_DIR}/tailscale" ]]; then
    return
  fi

  echo "[railway-start] downloading Tailscale ${TAILSCALE_VERSION}"
  curl -fsSL "${TAILSCALE_URL}" -o "/tmp/${TAILSCALE_ARCHIVE}"
  tar -xzf "/tmp/${TAILSCALE_ARCHIVE}" -C /tmp
  cp "/tmp/tailscale_${TAILSCALE_VERSION}_amd64/tailscaled" "${TAILSCALE_DIR}/tailscaled"
  cp "/tmp/tailscale_${TAILSCALE_VERSION}_amd64/tailscale" "${TAILSCALE_DIR}/tailscale"
  chmod +x "${TAILSCALE_DIR}/tailscaled" "${TAILSCALE_DIR}/tailscale"
}

start_tailscale() {
  local auth_key="${TS_AUTHKEY:-${TAILSCALE_AUTHKEY:-}}"
  if [[ -z "${auth_key}" ]]; then
    echo "[railway-start] TS_AUTHKEY/TAILSCALE_AUTHKEY is not set; starting without tailnet proxy"
    return
  fi

  download_tailscale
  mkdir -p "${TAILSCALE_STATE_DIR}"

  echo "[railway-start] starting tailscaled userspace proxy"
  "${TAILSCALE_DIR}/tailscaled" \
    --tun=userspace-networking \
    --socks5-server="127.0.0.1:${TS_SOCKS5_PORT}" \
    --outbound-http-proxy-listen="127.0.0.1:${TS_HTTP_PROXY_PORT}" \
    --state="${TAILSCALE_STATE_DIR}/tailscaled.state" \
    --socket="${TAILSCALE_SOCKET}" &

  local tailscaled_pid=$!
  trap 'kill ${tailscaled_pid} 2>/dev/null || true' EXIT

  for _ in {1..30}; do
    if "${TAILSCALE_DIR}/tailscale" --socket="${TAILSCALE_SOCKET}" status >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done

  echo "[railway-start] joining tailnet as ${TS_HOSTNAME}"
  "${TAILSCALE_DIR}/tailscale" --socket="${TAILSCALE_SOCKET}" up \
    --auth-key="${auth_key}" \
    --hostname="${TS_HOSTNAME}" \
    --accept-dns=true \
    --timeout=30s

  export JARVIS_CODEX_GATEWAY_PROXY_URL="http://127.0.0.1:${TS_HTTP_PROXY_PORT}"
  echo "[railway-start] Tailscale HTTP proxy ready for Codex gateway calls"
}

start_tailscale

echo "[railway-start] starting Jarvis production server"
exec npm run server:prod
