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

## Required Runtime Secret
The database URL is intentionally not committed to the repo. It must live in Railway service variables:

```txt
DATABASE_URL=postgresql://...
```

Local tests that need the database skip when `DATABASE_URL` is missing.
