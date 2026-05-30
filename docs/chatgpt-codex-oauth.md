# ChatGPT/Codex OAuth Provider

Jarvis can optionally use the same no-OpenAI-API-key bridge that the grow room planner uses: a persistent host with the Codex CLI installed and logged in through ChatGPT.

This is not OpenAI Platform API OAuth. The official OpenAI API still authenticates with API keys. This provider shells out to `codex exec` on the gateway host, so it only works where the host has a valid Codex/ChatGPT login.

## Probe

```powershell
npm run jarvis:oauth:probe
```

The probe should report that Codex is logged in with ChatGPT.

## Enable

Create a local `.env.local` file on the gateway host:

```text
JARVIS_MODEL_PROVIDER=chatgpt-codex-oauth
JARVIS_CODEX_OAUTH_ENABLED=true
```

The keepalive gateway itself is intentionally lightweight and does not need the app database. The full Jarvis app still needs `DATABASE_URL` when you run the whole server.

Optional:

```text
JARVIS_CODEX_COMMAND=codex
JARVIS_CODEX_OAUTH_MODEL=chatgpt-codex-oauth/auto
```

Local Windows gateway stability options:

```text
# The default supervised gateway entry is the lightweight Codex-only server.
JARVIS_OAUTH_GATEWAY_ENTRY=scripts/jarvis-codex-gateway-server.mjs

# Only use this after `codex login status` succeeds manually on the same machine.
JARVIS_CODEX_OAUTH_SKIP_CHECK=true
```

Then start the gateway:

```powershell
npm.cmd run jarvis:oauth:gateway
```

## Desktop auto-start and keepalive

On the Windows desktop that owns the Codex/ChatGPT login, install the gateway as a per-user scheduled task:

```powershell
npm.cmd run jarvis:oauth:gateway:install-startup
```

This creates a Scheduled Task named `Jarvis Codex OAuth Gateway` that starts at Windows login. The task runs the watchdog from the repo root. Reinstalling the task from this repo stops stale gateway/watchdog processes first, so the task cannot silently keep running from an older checkout.

The supervisor starts the lightweight Codex-only gateway, restarts it if the process exits, and health-checks the local gateway plus the optional public tunnel URL. In supervised mode, `JARVIS_OAUTH_GATEWAY_ENTRY` is ignored by default so a local `.env.local` cannot accidentally make the keepalive task boot the full Jarvis server. Set `JARVIS_OAUTH_GATEWAY_ALLOW_FULL_SERVER=true` only when you intentionally want that heavier behavior.

By default, a public tunnel failure is reported but does not restart the local gateway. Set `JARVIS_OAUTH_GATEWAY_RESTART_ON_PUBLIC_FAILURE=true` only if the public tunnel is managed by the same process and a local restart is known to fix it.

The supervised background process skips the startup-only `codex login status` probe by default because that command can fail in a non-interactive Windows Scheduled Task even when Codex is usable for real requests. If Codex is actually logged out, provider calls still fail clearly in the gateway logs and doctor output.

Useful commands:

```powershell
# Preflight check
npm.cmd run jarvis:oauth:gateway -- --check

# Start supervised gateway in the current terminal
npm.cmd run jarvis:oauth:gateway:supervisor

# Check local process, public tunnel, scheduled task, and last supervisor status
npm.cmd run jarvis:oauth:gateway:doctor

# Remove the login task
npm.cmd run jarvis:oauth:gateway:uninstall-startup
```

Logs are written under:

```text
.jarvis/logs/
```

Keep Tailscale running and keep the PC awake. The scheduled task starts the gateway after login; it cannot run while the machine is fully shut down or asleep.

### Stable public URL with Tailscale Funnel

Use Tailscale Funnel for the public gateway URL instead of temporary Cloudflare tunnels. On the desktop gateway host, Funnel should point the machine's stable Tailscale HTTPS name at the local gateway:

```powershell
tailscale serve --bg 5000
tailscale funnel --bg 5000
tailscale funnel status
```

The current stable gateway URL for this machine is:

```text
https://battles-pc.tailf68942.ts.net
```

Railway should use that value for `JARVIS_CODEX_GATEWAY_URL`. The local `.env.local` should use the same value so `npm.cmd run jarvis:oauth:gateway:doctor` checks the same path that hosted Jarvis uses.

Vercel/Railway can host proxy code, but they cannot use this desktop's local Codex/ChatGPT login by themselves. A hosted proxy would still need a stable private path back to this PC, so Tailscale Funnel is the simpler durable layer.

## Hosted Jarvis calling the gateway

For Railway/hosted Jarvis, keep Codex authenticated on the gateway host and set these variables on both sides:

Gateway host:

```txt
JARVIS_CODEX_OAUTH_ENABLED=true
JARVIS_CODEX_GATEWAY_TOKEN=<long random shared secret>
```

Hosted Jarvis:

```txt
JARVIS_CODEX_GATEWAY_URL=https://your-codex-gateway-host.example.com
JARVIS_CODEX_GATEWAY_TOKEN=<same shared secret>
```

With `JARVIS_CODEX_GATEWAY_URL` set, hosted Jarvis exposes `delegate_to_codex` and forwards the scoped task to `/api/codex/delegate` on the gateway. The gateway runs `codex exec` using its local ChatGPT/Codex OAuth login and returns the result.

## Telegram CodeX piggyback

The local Jarvis OAuth gateway can also front the Telegram CodeX gateway so the Telegram Mini App uses the same public Jarvis tunnel instead of a separate tunnel.

Jarvis gateway host:

```txt
TELEGRAM_CODEX_PROXY_ENABLED=true
TELEGRAM_CODEX_PROXY_TARGET=http://127.0.0.1:8787
TELEGRAM_CODEX_PROXY_PATH=/telegram-codex
```

Telegram CodeX gateway:

```txt
PUBLIC_BASE_PATH=/telegram-codex
MINIAPP_PUBLIC_URL=https://<jarvis-public-host>/telegram-codex/miniapp/
TELEGRAM_UPDATE_MODE=polling
```

Jarvis proxies `/telegram-codex/*` to the local Telegram CodeX process. Polling remains the simplest Telegram update mode for the local bot. If webhook mode is needed later, set `TELEGRAM_UPDATE_MODE=webhook` and Telegram will call `https://<jarvis-public-host>/telegram-codex/telegram/webhook`.

The proxy forwards the original host through `X-Forwarded-Host`. Telegram CodeX allows the local-dev fallback only for direct local hosts; public proxied requests must include valid Telegram Mini App `initData`.

This only works when the local Jarvis gateway or its tunnel is fronting this PC. A Railway-hosted Jarvis process cannot reach `127.0.0.1` on this desktop unless a secure tunnel back to the machine is also configured.

## Guardrails

- Jarvis never reads or exposes Codex OAuth tokens.
- Jarvis can use `chatgpt-codex-oauth` as a model provider for normal turns and can request Jarvis-native tools through the JSON protocol in `server/agent/providers/codexOAuth.ts`.
- Jarvis also has an owner-only `delegate_to_codex` tool. It either calls the configured gateway or shells out locally to `codex exec` so Codex can use the gateway host's configured Codex OAuth, MCP servers, and CLI context for a scoped task.
- `delegate_to_codex` defaults to `read-only`, keeps the working directory inside the Jarvis workspace, and tells Codex not to send, post, delete, purchase, deploy, merge, commit, or mutate external systems unless the user explicitly approved that exact action.
- Railway does not need Codex installed when `JARVIS_CODEX_GATEWAY_URL` is set. Without a gateway URL, direct local delegation only works on a persistent host that has Codex installed and authenticated.
