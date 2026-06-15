# Jarvis OS Runbook

## Purpose

This is the startup and reliability guide for Jarvis as an agent operating system. It explains how to verify the foundation before adding autonomy.

## Canonical Runtime

Use the checked-out repository root as the source of truth. The public repo should not depend on maintainer-local paths.

```bash
git clone https://github.com/battlesbudz/jarvis-os.git
cd jarvis-os
```

## First Command

Run:

```bash
npm run jarvis:doctor
```

Read the blocker list before starting the server. Fix core blockers first.

## Local Verification

Run:

```bash
npm run jarvis:check
```

This runs the doctor first, then the agent test suite.

## Safe Autonomy Path

Jarvis may act autonomously only through this first-level flow:

1. Check OS readiness.
2. Classify the user request with the autonomy policy.
3. Answer inline for low-risk requests.
4. Queue a background job for multi-step work.
5. Require approval for external actions.
6. Surface results in reviewable inbox/deliverable channels.

## Approval Boundaries

Jarvis must ask before sending messages, changing calendars, posting publicly, deleting data, triggering daemon/device actions, making purchases, committing code, deploying, or taking any legal, compliance, financial, or business-commitment action.

## What This Foundation Does Not Do

- It does not replace `server/agent/harness.ts`.
- It does not move folders.
- It does not enable free-form daemon control.
- It does not make memory writes automatic without consent-safe rules.
- It does not bypass existing channel or integration checks.

## When Something Breaks

1. Run `npm run jarvis:doctor`.
2. If doctor is blocked, fix the named blocker.
3. If doctor is limited, keep core server work going but avoid affected integrations.
4. Run `npm test`.
5. Use `jarvis_self_diagnose` from the agent tool layer when debugging live user-facing behavior.
