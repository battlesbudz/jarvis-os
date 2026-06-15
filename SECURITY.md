# Security Policy

Jarvis OS connects to personal accounts, long-term memory, local computers, Android devices, and hosted infrastructure. Treat every deployment as a privileged personal operating system, not a demo chatbot.

## Supported Branch

Security fixes are made against the latest commit on `main`.

| Branch | Supported |
|---|---|
| `main` | Yes |
| Feature branches and old historical branches | No |

## Reporting A Vulnerability

Do not file public GitHub issues for security bugs.

Use GitHub private vulnerability reporting for this repository, or contact the repository owner directly if private reporting is unavailable. Include:

1. A short description of the issue
2. Minimal reproduction steps, request payloads, or affected files
3. Expected impact
4. Known workarounds
5. Whether credentials, local files, device permissions, or third-party accounts are involved

You should receive an acknowledgement within 72 hours.

## Security Boundaries

High-risk Jarvis behavior must remain approval-gated and observable:

- Sending email, posting publicly, making purchases, deploying, modifying production infrastructure, or changing calendar data
- Running desktop shell commands or reading/writing local files through the desktop connector
- Using Android accessibility/device-control actions
- Changing memory, SOUL/context, provider credentials, or approval policies
- Applying code changes or self-repair suggestions

If a contribution weakens one of these boundaries, it should be treated as security-sensitive.

## Self-Hosting Responsibilities

Self-hosters are responsible for:

- Keeping `.env` and platform variables private
- Rotating leaked OAuth tokens, provider keys, bot tokens, and database credentials immediately
- Setting strong `JWT_SECRET` and `DASHBOARD_SECRET` values
- Restricting connector roots and daemon permissions to directories/devices they intend Jarvis to access
- Reviewing provider spend limits and third-party account scopes
- Running Jarvis behind HTTPS in production

## Connector And Device Risks

- **Desktop connector / daemon:** Can execute local operations when paired and permitted. Set `JARVIS_DAEMON_ROOT` to a specific workspace directory, not a home directory or drive root.
- **Android daemon:** May use accessibility, notification listener, wake/talk mode, and optional device-admin permissions. Build or download only trusted APKs from the official project release path.
- **ChatGPT subscription path:** Runs through the desktop connector/Codex OAuth path. Do not expose local helper ports publicly.
- **Provider profiles:** Stored provider credentials must remain encrypted and scoped to the owning user.

## Hardening Checklist

- [ ] `JWT_SECRET` is at least 32 random bytes
- [ ] `DASHBOARD_SECRET` is at least 32 random bytes if dashboard secret auth is enabled
- [ ] `NODE_ENV=production` in hosted environments
- [ ] `DATABASE_URL` uses SSL in production
- [ ] `APP_BASE_URL` and `EXPO_PUBLIC_DOMAIN` point to the intended public host
- [ ] `JARVIS_DAEMON_ROOT` points to a narrow workspace directory
- [ ] API/provider keys have spend caps where available
- [ ] Channel webhook secrets are set only for enabled channels
- [ ] `.env`, local connector state, keystores, and generated private artifacts are not committed
- [ ] Approval gates remain enabled for high-risk actions

Generate local secrets with:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Use different values for `JWT_SECRET`, `DASHBOARD_SECRET`, OAuth state secrets, and channel webhook secrets.

## If A Credential Leaks

1. Revoke it at the provider.
2. Rotate it in `.env`, Railway variables, GitHub secrets, and any local connector state.
3. Audit provider access logs for the suspected window.
4. File a private security report if project behavior contributed to the leak.
