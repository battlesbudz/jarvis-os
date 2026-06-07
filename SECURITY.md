# Security Policy

## Supported versions

This project is in active development on the `codex/replit-main-continuation`
branch. Security fixes are made against the most recent commit on that
branch. Older commits are not patched.

| Branch | Supported |
|---|---|
| `codex/replit-main-continuation` | ✅ |
| `minimax` (and any `minimax-pr-*` branches) | ❌ |
| Anything else | ❌ |

## Reporting a vulnerability

**Please do not file a public GitHub issue for security bugs.**

Use GitHub private vulnerability reporting for this repository, or contact
the repository owner directly if private reporting is unavailable. Include:

1. A short description of the issue
2. A reproducer — minimal code, request, or steps
3. The impact you believe it has
4. Any known workarounds

You should receive an acknowledgement within 72 hours. If you don't,
follow up with a DM to a maintainer.

## What we will do

1. Confirm the report and assign a CVE if appropriate
2. Develop a fix on a private branch
3. Coordinate disclosure timing with you (default: 90 days from report)
4. Credit you in the release notes unless you ask to remain anonymous
5. Push the fix and a `SECURITY.md` addendum describing the issue

## Out-of-scope

The following are not security vulnerabilities in the project itself,
but are risks to be aware of when running it:

- **You** are responsible for the OAuth tokens and API keys you put in
  `.env`. Treat them as production secrets. Don't commit them. Don't
  share them in chat or screenshots.
- **The desktop daemon** (`daemon/jarvis-daemon.js`) runs shell commands
  on the host machine. It is sandboxed to a workspace root
  (`JARVIS_DAEMON_ROOT`), but you must set that root to a directory
  you actually want to expose. Don't point it at `/`, `~`, or any
  directory containing unrelated secrets.
- **The Android daemon APK** runs with notification listener, accessibility,
  and (optionally) device-admin permissions. Only install APKs you
  built yourself or downloaded from the official release URL in
  `ANDROID_APK_URL`.
- **The Patch-package patches** in `patches/` modify dependencies
  post-install. If a patch fails on `npm install`, the install aborts.
  Do not bypass this — read what the patch does before applying it.
- **The Codex OAuth gateway** (`JARVIS_OAUTH_GATEWAY_*`) is a local
  helper that bridges between the Codex CLI and the server. It runs
  on `localhost` by default. Do not expose its port publicly without
  authentication in front of it.
- **Self-modification loops** (Jarvis proposing and applying its own
  code changes) are gated behind the approval flow in
  `server/agent/agentApproval.ts` and `server/agent/codeProposalsRoutes.ts`.
  If you disable those gates, you have removed the only thing
  preventing Jarvis from rewriting its own guardrails. Don't.

## Reporting a compromised credential

If you suspect a token, keystore, or `.env` value has leaked:

1. **Revoke the credential at the source** (GitHub PAT page, Google
   Cloud console, Twilio console, etc.) immediately.
2. **Rotate** — generate a new credential and update `.env` and any
   platform secret stores.
3. **Audit** — check the relevant provider's access logs for the
   time window you suspect.
4. **File a security report** as above so we can add detection / alerting.

## Hardening checklist for self-hosters

- [ ] `JWT_SECRET` is ≥ 32 random bytes
- [ ] `DASHBOARD_SECRET` is set and ≥ 32 random bytes
- [ ] `NODE_ENV=production` in any non-dev environment
- [ ] Database connection uses SSL (`?sslmode=require`)
- [ ] `JARVIS_DAEMON_ROOT` is set to a workspace directory, not `~` or `/`
- [ ] HTTPS is terminated in front of the Express server (Railway,
       Cloudflare, Caddy, etc.)
- [ ] `EXPO_PUBLIC_*` values do not contain server secrets
- [ ] API keys for paid services have spend caps set at the provider
- [ ] `secrets.json` / `attached_assets/` are not committed (gitignore
       should handle this; double-check after a fresh clone)
- [ ] The `patches/` directory contents match upstream maintainers'
       public recommendations
