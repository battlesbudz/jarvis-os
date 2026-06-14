# Windows Desktop Connector Release Checklist

## Build Steps

1. Run `npm.cmd run jarvis:desktop-connector:test-config`.
2. Run `npm.cmd run jarvis:desktop-connector:build` on a Windows build machine with Rust/Tauri prerequisites installed.
3. Find the NSIS setup executable under `desktop-connector/src-tauri/target/release/bundle/nsis/`.

Rust/Tauri prerequisites are needed only on build machines, not end-user machines.

## Signing Steps

1. Sign the installer with the Jarvis Windows code-signing certificate.
2. Verify the signature with Explorer or `Get-AuthenticodeSignature <installer.exe>`.
3. Compute the production SHA-256 hash from the signed installer with `Get-FileHash -Algorithm SHA256 <installer.exe>`.
4. Upload the signed installer to the release bucket/static downloads host.

The installer should be signed before setting the production download URL. `JARVIS_WINDOWS_CONNECTOR_SHA256` must match the exact signed installer bytes served at `JARVIS_WINDOWS_CONNECTOR_DOWNLOAD_URL`.

## Production Variables

- `JARVIS_WINDOWS_CONNECTOR_DOWNLOAD_URL`
- `JARVIS_WINDOWS_CONNECTOR_VERSION`
- `JARVIS_WINDOWS_CONNECTOR_SHA256`

## Smoke Test Steps

1. Open Jarvis in Chrome.
2. Go to `/desktop-connector-setup`.
3. Click `Set it up for me`.
4. Confirm the signed installer downloads.
5. Run the installer.
6. Confirm Jarvis sees the connector as connected.
7. Run the verification ceremony.
8. Confirm Profile shows `Connected Windows PC`.
