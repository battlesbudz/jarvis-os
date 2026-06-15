# Public Compatibility Notes

Jarvis OS is the public product and project name.

Some compatibility-sensitive identifiers may still use earlier internal values until a dedicated migration is planned and tested:

- mobile package IDs
- iOS bundle identifiers
- URL schemes
- OAuth callback defaults
- hosted-domain defaults
- existing release/update channels

Those identifiers affect installed Android updates, deep links, OAuth redirects, and external integrations. Renaming them casually can strand existing installs or break login flows.

Public docs, display names, release text, and contributor-facing language should say **Jarvis OS**. Compatibility identifiers should only remain where there is a concrete migration risk, and their presence should be documented rather than treated as stale branding.

## Current Compatibility Identifiers

| Identifier | Current value | Where it appears | Why it remains | Migration status |
|---|---|---|---|---|
| Expo slug | `gameplan` | `app.json` | Expo project/update identity can affect existing development and release channels. | Keep until Expo migration is planned. |
| URL scheme | `gameplan` | `app.json` scheme list and auth intent filter | Existing deep links and OAuth callbacks may still target this scheme. | Keep alongside `jarvis` for now. |
| Android package ID | `com.gameplan` | `app.json` Android package | Android updates require the same package ID for in-place upgrades. | Requires a dedicated package migration. |
| iOS bundle ID | `com.gameplan` | `app.json` iOS bundle identifier | iOS bundle identity affects app install/update continuity. | Requires a dedicated bundle migration. |
| Hosted app origin | `https://gameplanjarvisai.up.railway.app/` | `app.json`, `eas.json`, release build environment | Existing OAuth callbacks, builds, and deployed clients may depend on this domain. | Keep until hosted-domain migration is tested. |

Before changing compatibility identifiers:

1. List every affected app, OAuth client, deep link, release asset, and update manifest.
2. Confirm whether existing users need in-place upgrades.
3. Add focused tests for login, app update, daemon pairing, and deep links.
4. Publish migration notes in the release.
