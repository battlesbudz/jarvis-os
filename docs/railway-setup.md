# Railway Setup

## Node Version
This repo is pinned to Node 22 in two places:
- `package.json` uses `engines.node = 22.x`.
- `.nvmrc` contains `22`.

Railway is configured with the Railpack builder in `railway.json`, so Railpack should read `.nvmrc` and build with Node 22.

If Railway still chooses the wrong version, add this variable in the Railway service:

```txt
RAILPACK_NODE_VERSION=22
```

## Required Runtime Secrets
The database URL and provider-credential encryption key are intentionally not committed to the repo. They must live in Railway service variables:

```txt
DATABASE_URL=postgresql://...
JARVIS_PROVIDER_AUTH_ENCRYPTION_KEY=<at-least-32-random-bytes>
```

Generate the encryption key locally with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

The encryption key must be stable across deploys. Changing or removing it makes existing per-user API-key and ChatGPT subscription profiles unreadable. Jarvis refuses to start a subscription login when it is absent, preventing the callback failure that would otherwise occur after the user signs in.

Local tests that need the database skip when `DATABASE_URL` is missing.
