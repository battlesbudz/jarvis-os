# Android Screen Context Operator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a first Jarvis ScreenContextEngine and narrow Android OperatorAction runtime so Jarvis can reason over structured accessibility context and execute tap/type/swipe/navigation actions through one constrained operator contract.

**Architecture:** The Android daemon becomes the source of truth for screen structure. `ScreenContextEngine` reads the accessibility tree into stable JSON with element ids, traits, bounds, redaction, and risk hints. `OperatorAction` parses a small action grammar, and `OperatorActionExecutor` maps those actions to existing accessibility service methods without weakening server approval or Android permission gates.

**Tech Stack:** Kotlin Android daemon, Android AccessibilityService APIs, org.json, Gradle JVM unit tests, existing Jarvis daemon WebSocket op bridge.

---

## File Structure

- Create `android-daemon/app/src/main/java/com/jarvis/daemon/OperatorAction.kt`: pure Kotlin parser and JSON serializer for the narrow operator action grammar.
- Create `android-daemon/app/src/main/java/com/jarvis/daemon/ScreenContextModels.kt`: pure Kotlin data models, redaction helpers, trait names, risk hints, and JSON output helpers.
- Create `android-daemon/app/src/main/java/com/jarvis/daemon/ScreenContextEngine.kt`: Android accessibility tree extractor that returns structured context without taking screenshots.
- Create `android-daemon/app/src/main/java/com/jarvis/daemon/OperatorActionExecutor.kt`: Android action executor that runs only typed operator actions through `JarvisAccessibilityService`.
- Modify `android-daemon/app/src/main/java/com/jarvis/daemon/OpHandler.kt`: wire `android_screen_context` and `android_operator_action`.
- Modify `android-daemon/app/build.gradle`: add JVM test dependency for the new pure-Kotlin contract tests.
- Create `android-daemon/app/src/test/java/com/jarvis/daemon/OperatorActionTest.kt`: parser and safety tests.
- Modify `server/daemon/bridge.ts`: add daemon op types and existing permission mapping for the two new Android ops.
- Modify `server/agent/tools/daemon.ts`: expose the new actions through the existing daemon tool, preserving read versus tap/type permissions.

## Task 1: Operator Action Contract

**Files:**
- Create: `android-daemon/app/src/test/java/com/jarvis/daemon/OperatorActionTest.kt`
- Create: `android-daemon/app/src/main/java/com/jarvis/daemon/OperatorAction.kt`
- Modify: `android-daemon/app/build.gradle`

- [ ] **Step 1: Write the failing tests**

Test cases:
- Parses `tap_element` with `elementId`.
- Rejects unknown action names.
- Marks tap/type/swipe/navigation actions as mutating.
- Serializes `requiresApprovalHint` for mutating actions.

- [ ] **Step 2: Run the test to verify it fails**

Run: `.\gradlew.bat :app:testDebugUnitTest --tests com.jarvis.daemon.OperatorActionTest`

Expected: failure because `OperatorAction` does not exist yet.

- [ ] **Step 3: Implement minimal parser**

`OperatorAction.fromJson(JSONObject)` accepts only:
- `tap_element`
- `tap_coordinates`
- `type_text`
- `swipe`
- `press_key`
- `open_app`
- `wait`
- `done`

It returns a typed action or throws `IllegalArgumentException` with a precise message.

- [ ] **Step 4: Run test to verify it passes**

Run: `.\gradlew.bat :app:testDebugUnitTest --tests com.jarvis.daemon.OperatorActionTest`

Expected: PASS.

## Task 2: Screen Context Models

**Files:**
- Modify: `android-daemon/app/src/test/java/com/jarvis/daemon/OperatorActionTest.kt`
- Create: `android-daemon/app/src/main/java/com/jarvis/daemon/ScreenContextModels.kt`

- [ ] **Step 1: Write failing model/redaction tests**

Test cases:
- Sensitive elements redact `text` and `contentDescription`.
- Non-sensitive elements preserve labels.
- Context JSON includes `generatedAtMs`, `foregroundPackage`, `elements`, and `riskHints`.

- [ ] **Step 2: Run test to verify it fails**

Run: `.\gradlew.bat :app:testDebugUnitTest --tests com.jarvis.daemon.OperatorActionTest`

Expected: failure because model classes do not exist yet.

- [ ] **Step 3: Implement models**

Use data classes with `toJson()` helpers and a single `redactIfSensitive(value, sensitive)` helper. Keep this pure Kotlin except for `org.json`.

- [ ] **Step 4: Run test to verify it passes**

Run: `.\gradlew.bat :app:testDebugUnitTest --tests com.jarvis.daemon.OperatorActionTest`

Expected: PASS.

## Task 3: Accessibility ScreenContextEngine

**Files:**
- Create: `android-daemon/app/src/main/java/com/jarvis/daemon/ScreenContextEngine.kt`
- Modify: `android-daemon/app/src/main/java/com/jarvis/daemon/JarvisAccessibilityService.kt`

- [ ] **Step 1: Add service entrypoint**

Add `fun captureScreenContext(): ScreenContextSnapshot` to `JarvisAccessibilityService` and delegate to `ScreenContextEngine(this).capture()`.

- [ ] **Step 2: Implement tree extraction**

Traverse `rootInActiveWindow` to depth 30, skip zero-area nodes, assign deterministic per-capture ids starting at 1, collect package/activity, bounds, center, view id, class, text, content description, traits, and sensitive flags. Do not capture screenshots.

- [ ] **Step 3: Add risk hints**

Add hints for no active root, password/sensitive fields, scrollable elements, and coordinate fallback availability.

## Task 4: Operator Executor and Daemon Ops

**Files:**
- Create: `android-daemon/app/src/main/java/com/jarvis/daemon/OperatorActionExecutor.kt`
- Modify: `android-daemon/app/src/main/java/com/jarvis/daemon/OpHandler.kt`

- [ ] **Step 1: Wire `android_screen_context`**

`handleScreenContext()` returns `svc.captureScreenContext().toJson()`.

- [ ] **Step 2: Wire `android_operator_action`**

Parse `op.action` as `OperatorAction`, execute through `OperatorActionExecutor`, and return `{ action, mutating, requiresApprovalHint, result }`.

- [ ] **Step 3: Execute narrow actions only**

Use existing service methods:
- `tap_element`: recapture context, find element id, tap center.
- `tap_coordinates`: `performTap`.
- `type_text`: `typeText`.
- `swipe`: `performSwipe`.
- `press_key`: `pressKey`.
- `open_app`: `launchApp`.
- `wait`: sleep within a bounded range.
- `done`: no-op success.

Reject all other action names before execution.

## Task 5: Server Exposure

**Files:**
- Modify: `server/daemon/bridge.ts`
- Modify: `server/agent/tools/daemon.ts`

- [ ] **Step 1: Add typed daemon ops**

Add:
- `{ type: "android_screen_context" }`
- `{ type: "android_operator_action"; action: Record<string, unknown> }`

- [ ] **Step 2: Preserve permission gates**

Map `android_screen_context` to `android_read_screen`.
Map `android_operator_action` to `android_tap_type`.

- [ ] **Step 3: Expose daemon actions**

Add the action names to `daemon_action` enum and Android action list. Add parameter `operatorAction` for `android_operator_action`. Do not remove old actions.

## Task 6: Verification

**Files:**
- All touched files.

- [ ] **Step 1: Android unit tests**

Run: `.\gradlew.bat :app:testDebugUnitTest --tests com.jarvis.daemon.OperatorActionTest`

- [ ] **Step 2: Android compile**

Run: `.\gradlew.bat :app:compileDebugKotlin`

- [ ] **Step 3: Server type/build check**

Run the narrowest existing server build command available from package scripts, preferring `npm.cmd run server:build`.

- [ ] **Step 4: Git review**

Run: `git diff -- android-daemon server/daemon/bridge.ts server/agent/tools/daemon.ts docs/superpowers/plans/2026-06-10-android-screen-context-operator.md`

Confirm no unrelated dirty files were modified.
