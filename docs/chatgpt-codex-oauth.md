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
DATABASE_URL=postgresql://...
JARVIS_MODEL_PROVIDER=chatgpt-codex-oauth
JARVIS_CODEX_OAUTH_ENABLED=true
```

Optional:

```text
JARVIS_CODEX_COMMAND=codex
JARVIS_CODEX_OAUTH_MODEL=chatgpt-codex-oauth/auto
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

This creates a Scheduled Task named `Jarvis Codex OAuth Gateway` that starts at Windows login. The task runs `scripts/start-jarvis-oauth-gateway-supervisor.ps1`, which launches `scripts/jarvis-oauth-gateway-supervisor.mjs`. The supervisor restarts the gateway if the Node/server process exits.

Useful commands:

```powershell
# Preflight check
npm.cmd run jarvis:oauth:gateway -- --check

# Start supervised gateway in the current terminal
npm.cmd run jarvis:oauth:gateway:supervisor

# Remove the login task
npm.cmd run jarvis:oauth:gateway:uninstall-startup
```

Logs are written under:

```text
.jarvis/logs/
```

Keep Tailscale running and keep the PC awake. The scheduled task starts the gateway after login; it cannot run while the machine is fully shut down or asleep.

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

## Guardrails

- Jarvis never reads or exposes Codex OAuth tokens.
- Jarvis can use `chatgpt-codex-oauth` as a model provider for normal turns and can request Jarvis-native tools through the JSON protocol in `server/agent/providers/codexOAuth.ts`.
- Jarvis also has an owner-only `delegate_to_codex` tool. It either calls the configured gateway or shells out locally to `codex exec` so Codex can use the gateway host's configured Codex OAuth, MCP servers, and CLI context for a scoped task.
- `delegate_to_codex` defaults to `read-only`, keeps the working directory inside the Jarvis workspace, and tells Codex not to send, post, delete, purchase, deploy, merge, commit, or mutate external systems unless the user explicitly approved that exact action.
- Railway does not need Codex installed when `JARVIS_CODEX_GATEWAY_URL` is set. Without a gateway URL, direct local delegation only works on a persistent host that has Codex installed and authenticated.
