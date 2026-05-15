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

## Guardrails

- Jarvis never reads or exposes Codex OAuth tokens.
- This path is for no-tool text turns. Jarvis tool-calling turns are filtered away from this provider because Codex CLI cannot return Jarvis function calls in the same structured format as the model APIs.
- Railway will not be able to use this unless the Railway container has Codex installed and authenticated, which is usually not the right deployment shape. Use it on a persistent local/private gateway host.
