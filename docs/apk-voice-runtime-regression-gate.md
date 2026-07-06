# APK Voice Runtime Regression Gate

This gate is required for APK-changing work that touches local voice, Local Gemma runtime behavior, Android tool routing, outside-app voice controls, notification reads, screen understanding, approval gates, copy-details diagnostics, or crash/resource recovery.

## Required validation

Run the mocked runtime gate first:

```bash
npm run jarvis:voice-runtime:regression-gate
```

Run the normal repository test suite:

```bash
npm test
```

For APK-changing Android voice/runtime work, also run the emulator smoke test locally when an emulator is available, or verify the GitHub `Android Daemon Emulator E2E` check:

```bash
npm run jarvis:android-daemon:emulator-e2e
```

The emulator smoke uses fake Local Gemma by default. It validates app/device-control wiring, outside-app voice foreground service lifecycle, persistent notification controls, overlay controls, approval controls, accessibility setup, clipboard routing, crash/restart behavior, and daemon tool routing. It must not rely on real Local Gemma inference.

Real Local Gemma performance is a physical-device manual validation step, not an emulator gate. Use the user's Galaxy Fold build test for real model stability, latency, memory pressure, and hardware-specific inference behavior after the APK artifact is built.

## What the mocked gate protects

The mocked runtime tests must cover:

- notification read and follow-up behavior;
- YouTube search and app control through Android tools;
- screen understanding via accessibility first, temporary capture fallback second;
- approval gates and outside-app approval state;
- copy-details diagnostics and clipboard routing;
- crash recovery and resource scheduling;
- blocking false Local Gemma denials of runtime-available capabilities;
- blocking claims of unconfirmed completions;
- ensuring voice chat and TTS use one validated canonical response.

## Pull request expectation

APK voice/runtime PRs should include:

- `npm run jarvis:voice-runtime:regression-gate`
- `npm test`
- `npm run server:build`
- Android Daemon Emulator E2E result or a note explaining why emulator validation could not run
- physical-device Real Local Gemma validation notes only when a real APK behavior change needs phone testing
