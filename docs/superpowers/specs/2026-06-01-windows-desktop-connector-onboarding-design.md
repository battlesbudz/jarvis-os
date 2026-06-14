# Windows Desktop Connector Commercial Onboarding Design

Status: approved by user on 2026-06-01

## Purpose

Jarvis now has a proven Windows desktop-daemon path that lets the hosted Chrome web app reach a paired Windows PC, run Codex through the user's local ChatGPT/Codex OAuth session, and return responses without using the Jarvis OpenAI API-key model path. The next product step is to make that capability commercial: first-time users should be able to set it up without understanding daemons, pair codes, Node, shell commands, scheduled tasks, or OAuth plumbing.

This design defines a Windows-first onboarding and installer flow that turns the current technical setup into a polished customer experience.

## Current Baseline

The implementation already proved these capabilities:

- Hosted Jarvis can route model calls through the desktop daemon using `chatgpt-codex-oauth`.
- The desktop daemon can run a controlled `codex_oauth_prompt` operation against local Codex.
- A Windows watchdog can keep the daemon running and reconnect it after process restarts.
- Production Chrome web app coach chat was verified end to end through the daemon-backed Codex OAuth path.

Relevant current code paths:

- `server/agent/providers/codexOAuth.ts`
- `server/daemon/bridge.ts`
- `daemon/jarvis-daemon.js`
- `scripts/install-jarvis-desktop-daemon-watchdog.ps1`
- `scripts/start-jarvis-desktop-daemon-watchdog.ps1`
- `app/(tabs)/profile.tsx`

## Goals

- Make setup feel magical and non-technical.
- Lead with the benefit: "Use your ChatGPT subscription with Jarvis."
- Ship Windows first because the working path is already proven there.
- Provide a signed Windows installer download from Jarvis.
- Wrap the existing daemon in a polished tray app so users have a quiet status and recovery surface.
- Handle prerequisites automatically when possible.
- Provide guided fallback only when automation cannot complete a step.
- Prove success with a visible, memorable verification moment.
- Keep model-provider fallback choices out of this project, while leaving room for an OpenRouter/Jarvis Cloud AI default later.

## Non-Goals

- Building Mac/Linux connector support.
- Building the OpenRouter/default model subscription system.
- Building Microsoft Store distribution for v1.
- Replacing the existing daemon engine.
- Exposing technical setup commands as the primary experience.
- Adding repeated permission prompts during the happy path.

## Product Positioning

### Onboarding Headline

Use this benefit-first headline during first-run setup:

> Use your ChatGPT subscription with Jarvis

This is the commercial hook. It tells the user what they gain, not what technical component they are installing.

### Settings Label

Use plain management language after setup:

> Connected Windows PC

Settings should describe the thing being managed: status, health checks, reconnect, uninstall, and troubleshooting for the desktop connector.

## First-Run User Flow

1. User signs into Jarvis.
2. Jarvis shows a first-run setup card: "Use your ChatGPT subscription with Jarvis."
3. Jarvis shows one clear up-front disclosure.
4. User clicks "Set it up for me."
5. Jarvis downloads a signed Windows installer.
6. User runs the installer.
7. Jarvis web app watches for the connector to come online.
8. Installer handles prerequisites, pairing, watchdog setup, and Codex login checks.
9. If Codex/ChatGPT sign-in is needed, the installer opens the unavoidable OpenAI/Codex sign-in step and explains it in plain English.
10. Jarvis runs the final verification ceremony.
11. Jarvis web app advances to "Connected."
12. Settings now shows "Connected Windows PC."

## Up-Front Disclosure

The setup should not use multiple permission gates. Instead, it should have one honest disclosure before setup begins:

> Jarvis can connect this Windows PC so it can use Codex through your ChatGPT subscription and help with desktop tasks when you ask.
>
> By continuing, you allow Jarvis to install and keep a desktop connector running on this computer. This gives Jarvis the ability to use Codex locally, control your desktop, and run shell commands through the connector. If you do not want that, skip this step and use Jarvis with another model provider instead.

Primary action:

> Set it up for me

Secondary action:

> Skip desktop connector

The secondary action should continue to the app and leave room for a future OpenRouter/Jarvis Cloud AI model path. The default provider system itself is out of scope for this project.

## Installer Shape

V1 should be a polished tray wrapper around the existing desktop daemon.

The product should be experienced as:

- Signed Windows installer
- Jarvis tray app
- Quiet connector service/watchdog
- Plain-English status and troubleshooting

The implementation can still reuse:

- Existing desktop daemon process
- Existing daemon pairing/reconnect state
- Existing watchdog behavior
- Existing Codex OAuth provider route

The user should not need to know the daemon exists.

## Prerequisite Strategy

The installer should be automatic-first and guided-fallback second.

Preferred behavior:

- Bundle or privately manage as much runtime dependency as possible.
- Check whether Codex is available.
- If Codex is missing, try to install or repair it automatically.
- If automatic setup fails, show a single guided recovery screen.
- If Codex login is missing, open the Codex/OpenAI login flow and wait for completion.
- If the connector cannot pair, ask the web app for a fresh pairing session automatically.

Recovery copy should be plain:

> Jarvis needs Codex installed to use your ChatGPT subscription. Click Continue and Jarvis will finish setting it up.

Avoid exposing commands unless the user opens advanced troubleshooting.

## Tray App Behavior

The tray app should be a status light and emergency handle, not another product the user has to manage.

Default tray state:

- Quiet by default.
- Starts with Windows.
- Shows healthy/connecting/error state.
- Does not nag.
- Does not expose logs in the normal path.

Tray menu:

- Jarvis Connected / Connecting / Needs attention
- Open Jarvis
- Check connection
- Reconnect
- Troubleshooting
- Quit Jarvis Connector
- Uninstall

The tray app may open troubleshooting logs only when the user explicitly asks.

## Final Verification Ceremony

Setup should end with a visible Windows Terminal proof moment.

Jarvis opens a controlled terminal script that shows a polished ASCII "JARVIS" logo, short status checks, and a final success message.

Approved ceremony content direction:

```text
        _   _     ____   __     __  ___   ____
       | | / \   |  _ \  \ \   / / |_ _| / ___|
    _  | |/ _ \  | |_) |  \ \ / /   | |  \___ \
   | |_| / ___ \ |  _ <    \ V /    | |   ___) |
    \___/_/   \_\|_| \_\    \_/    |___| |____/

[BOOT] Jarvis desktop connector is coming online
[ OK ] Jarvis account linked
[ OK ] Windows connector installed
[ OK ] Startup watchdog enabled
[ OK ] Local shell verified
[ OK ] Codex / ChatGPT sign-in verified
[ OK ] Test response received from Codex

JARVIS: Hello, world. I am awake.

Press any key to close this window.
```

This ceremony should prove:

- Jarvis can reach the connector.
- The connector can use local shell access.
- Codex/ChatGPT OAuth is available.
- A real test response can be received.

It should not show raw logs or scary implementation details during success. If a check fails, the terminal can say "Jarvis needs one more step" while the app shows the recovery action.

## Settings Management

After setup, Profile/Settings should show a "Connected Windows PC" card.

The card should include:

- Connection status
- Computer name
- Last seen time
- Codex OAuth status
- Startup/watchdog status
- Check connection
- Reconnect
- Run verification again
- Uninstall connector
- Advanced troubleshooting

The current Profile connected-channel UI already has a desktop daemon surface, but it is too technical for commercial onboarding. It should evolve into this management card.

## Error Handling

The happy path should remain simple. Error handling should be staged by severity:

- Minor delay: "Jarvis is still connecting to your PC..."
- Missing prerequisite: "Jarvis needs one more component and can install it for you."
- Login required: "Sign into ChatGPT/Codex to continue."
- Pairing expired: "This setup session expired. Jarvis is creating a fresh one."
- Watchdog failed: "Jarvis connected, but automatic startup needs repair."
- Full failure: "Jarvis could not finish setup. Open troubleshooting or use another provider."

No error screen should lead with stack traces, command output, or environment variable names.

## Security and Trust

The commercial flow should be magical, but not deceptive.

Trust requirements:

- Signed installer.
- One clear disclosure before setup.
- Visible tray app after installation.
- Easy uninstall.
- Advanced troubleshooting available on demand.
- Plain-English explanation that the connector can control the desktop and run shell commands.

The setup should avoid repeated permission gates during the happy path because the user has already chosen to connect the computer.

## Suggested Technical Architecture

This is a design-level architecture, not an implementation plan.

- Web app first-run wizard creates a short-lived setup session.
- User downloads a signed Windows connector installer tied to that session or account.
- Installer launches a tray wrapper app.
- Tray wrapper manages the daemon child process and watchdog installation.
- Daemon pairs or reconnects with the Jarvis server.
- Server records the connected Windows PC state.
- Web app polls or subscribes to setup progress.
- Final verification runs through the same daemon bridge used by production model calls.
- Settings uses the same health endpoint/state to show "Connected Windows PC."

## Success Metrics

- User can complete setup without typing commands.
- User understands the connector has desktop and shell access before continuing.
- Installer completes happy path without manual pair-code entry.
- Web app automatically detects when the connector comes online.
- Final verification proves shell and Codex access.
- User can find the connector later in Settings and in the Windows tray.
- Support/debugging can recover failed installs without asking the user to understand the daemon internals.

## Open Questions for Implementation Planning

- Exact packaging choice: Tauri, Electron, or another Windows-native wrapper.
- Whether to bundle Node/runtime privately or compile the daemon into the connector package.
- Best supported Codex installation method for Windows.
- Exact signed installer distribution and code-signing provider.
- Whether setup progress should be streamed over WebSocket or polled.
- How to represent multiple connected PCs later, even though v1 only needs the current Windows PC path.

## Approved Decisions

- Windows-first.
- First-run setup wizard is the main onboarding path.
- Installer handles prerequisites automatically.
- One up-front disclosure instead of repeated permission gates.
- Onboarding headline: "Use your ChatGPT subscription with Jarvis."
- Settings label: "Connected Windows PC."
- Skip path leaves room for future OpenRouter/Jarvis Cloud AI fallback.
- Small tray app, quiet by default.
- Final verification includes a visible terminal "Jarvis wakes up" ceremony.
- Direct signed Windows installer for v1.
- Polished tray wrapper around the existing daemon.
- Automatic Codex/prerequisite install first, guided fallback second.
