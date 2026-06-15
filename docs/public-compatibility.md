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

Before changing compatibility identifiers:

1. List every affected app, OAuth client, deep link, release asset, and update manifest.
2. Confirm whether existing users need in-place upgrades.
3. Add focused tests for login, app update, daemon pairing, and deep links.
4. Publish migration notes in the release.
