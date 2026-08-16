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
The database URL and JWT secret are intentionally not committed to the repo. They must live in Railway service variables:

```txt
DATABASE_URL=postgresql://...
JWT_SECRET=<at-least-32-random-bytes>
# Recommended but optional when JWT_SECRET is stable and sufficiently long:
# JARVIS_PROVIDER_AUTH_ENCRYPTION_KEY=<at-least-32-random-bytes>
```

Generate the encryption key locally with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Jarvis prefers the dedicated provider key. When it is absent, Jarvis derives a domain-separated provider-encryption key from a stable `JWT_SECRET`; it never uses the JWT signing key bytes directly. This lets an already secured Railway deployment store subscription credentials without an additional dashboard change. Changing the secret source later makes existing profiles unreadable, so reconnect provider profiles after intentionally switching keys.

Local tests that need the database skip when `DATABASE_URL` is missing.
