# Jarvis OS Command Center Relaunch Design

## Status

Approved design direction: Command Center Relaunch.

User request: "Can you do a massive overhaul of the UI and UX of the entire app and brand it for everything Jarvis? Jarvis Is Joint Autonomous Runtime Virtual Intelligence System. Make it all branded to him."

## Objective

Turn the existing Gameplanjarvisai Expo app into a coherent Jarvis OS command surface. The app should feel like the control layer for JARVIS: Joint Autonomous Runtime Virtual Intelligence System, not a generic coach, productivity app, or chatbot.

## Product Positioning

Jarvis is a persistent cognitive operating system for memory, work, decisions, channels, agents, approvals, and device/runtime control. The interface should make autonomous work observable, reviewable, approval-gated, and recoverable.

The redesign must preserve the current app's functionality while making the product identity clear across every major user-facing surface.

## Current App Surfaces

The current Expo Router app includes:

- Primary tabs: Mission Control, Jarvis/chat, Agents, Settings, Profile.
- Hidden tab routes and standalone flows: Inbox, Goals, Projects, Scheduled, Connection UX, onboarding, login, Vault, Voice Realtime, Focus Timer, Jarvis Report, Skills, Code Proposals, Capability Gaps, Inbox Rules, Self Repair History, Desktop Connector Setup.
- Shared UI components: goal cards, task cards, morning brief, progress ring, agent cards, sheets/modals, mission control sub-screens, connector cards, markdown rendering, and Jarvis sprite.

## Approved Approach

Use approach A: Command Center Relaunch.

This is not a full architecture rewrite. It is a UI/UX and brand-system overhaul that keeps the existing route structure and APIs while introducing a more deliberate Jarvis OS shell, shared design primitives, and consistent product language.

## Design Principles

1. Jarvis first
   - The first viewport should make "JARVIS" and "Joint Autonomous Runtime Virtual Intelligence System" clear.
   - Avoid treating Jarvis as a feature inside the app. Jarvis is the app's operating layer.

2. Observable autonomy
   - Jobs, approvals, deliverables, memories, agents, channels, and daemon state should be visible as runtime signals.
   - The user should understand what Jarvis is doing, what needs review, and what is safe to approve.

3. Command over clutter
   - Dense operational surfaces are acceptable, but they must be organized for scanning.
   - Use status rows, runtime cards, segmented controls, tables/lists, and compact cards instead of decorative card piles.

4. Approval-aware UX
   - Approval gates must feel intentional and protected.
   - Action language should distinguish draft, review, approve, run, send, connect, and retry.

5. Continuity and memory
   - Memory review should look like a core Jarvis safety feature, not a profile afterthought.
   - Use language such as memory vault, learning queue, confidence, source, review, and verified.

6. Cross-device runtime
   - Desktop connector, Android daemon, Telegram, Discord, Slack, WhatsApp, web, and voice should appear as nodes in Jarvis's runtime, not isolated settings.

## Information Architecture

Keep the existing route structure for risk control, but reframe the navigation labels and hierarchy.

Primary navigation:

- Command: Mission Control and runtime dashboard.
- Jarvis: conversational runtime, voice, command input, and approval-aware action cards.
- Agents: Jarvis council, workforce, jobs, agent detail, and self-repair.
- Vault: profile, memories, people, identity, wiki, pending memory review.
- System: settings, integrations, daemon nodes, health, skills, code proposals, capability gaps.

Routes can continue to live where they are today. The first pass should change labels, headers, shared components, and cross-links without moving route files.

## Visual System

### Palette

Use a dark precision interface with luminous operational accents:

- Runtime background: near-black blue/graphite.
- Surface: layered dark panels with restrained borders.
- Primary accent: Jarvis green for healthy/online/approve/safe.
- Secondary accent: cyan for intelligence, command input, and active runtime.
- Tertiary accent: violet for memory/council/deep cognition.
- Warning: amber for attention/review.
- Error: red for blocked/offline/failed.

Reduce one-note purple or green dominance by using each color for semantic roles.

### Typography

Keep Inter as the base family.

Use:

- Tight, readable headers for operational screens.
- Small uppercase labels only for system statuses and section labels.
- Tabular numbers for counts, queues, usage, timers, and runtime metrics.
- Avoid oversized hero text except on login/onboarding or an intentionally branded command landing area.

### Shape and Layout

- Use 8 to 14 px radii for operational cards and panels.
- Avoid nested cards where possible.
- Prefer full-width bands, section rows, list cards, and split panels.
- Use compact segmented controls for modes and sub-screens.
- Use icons for actions where available, with labels when command meaning is not obvious.

### Motion

Use subtle motion only for:

- Runtime online pulse.
- Active voice/listening state.
- New approval or memory item entrance.
- Agent/job progress changes.

Respect reduced-motion preferences where existing platform support allows.

## Shared Components To Add

### JarvisBrandMark

Purpose: Replace inconsistent logos/sprites in headers with a consistent mark.

Behavior:

- Compact "J" mark for small headers and tabs.
- Expanded lockup for login/onboarding: "JARVIS" plus "Joint Autonomous Runtime Virtual Intelligence System."
- Optional online/active state.

### JarvisScreenShell

Purpose: Shared layout wrapper for top-level screens.

Props:

- title
- subtitle
- statusLabel
- statusTone
- primaryAction
- children

It should handle safe-area top padding, background, header spacing, and a consistent runtime header.

### RuntimeStatusPill

Purpose: Reusable status indicator.

Tones:

- online
- checking
- waiting
- review
- blocked
- offline

### RuntimeMetricCard

Purpose: Compact metric cards for queue count, approvals, connected nodes, memory review, usage, and agent status.

### ApprovalActionCard

Purpose: Consistent approval UX for deliverables, connected-account actions, command execution, email/message sending, and daemon actions.

Required states:

- draft
- review required
- approving
- approved
- rejected
- failed

### MemoryReviewCard

Purpose: Consistent card for pending memories and living context updates.

Required fields:

- learned content
- source
- confidence
- why Jarvis learned it
- approve/edit/reject controls

### RuntimeNodeCard

Purpose: Show integrations and devices as Jarvis runtime nodes.

Examples:

- Telegram
- Discord
- Slack
- WhatsApp
- Gmail/Google
- Outlook
- Windows PC connector
- Android daemon
- Codex OAuth gateway
- Railway production

## Screen Designs

### Login

Goal: Immediately establish Jarvis identity.

Changes:

- Replace generic login treatment with JARVIS lockup.
- Add full name: Joint Autonomous Runtime Virtual Intelligence System.
- Explain login in one sentence: "Sign in to connect your memory, channels, agents, and runtime."
- Keep existing Google, Telegram, mobile auth, and password fallback behavior.

### Onboarding

Goal: Introduce Jarvis as a runtime partner, not only a coach.

Changes:

- Replace "coach" language with Jarvis OS language.
- Ask for identity, priority objective, current obligations, decision pressure, and connection preferences.
- Make final step "Activate Jarvis Runtime" instead of generic connect-calendar framing.

### Command Tab

Goal: Make Mission Control the app's operational home.

Changes:

- Header: JARVIS Command, Prime status, runtime health.
- First panel: runtime metrics for jobs, approvals, memory review, channels, and nodes.
- Main sections: Needs Review, Running Now, Today's Command Plan, Memory Queue, Runtime Nodes.
- Keep existing sub-screens but make them feel like system panes: Tasks, Calendar, Projects, Memory, Usage, Visual Office.

### Jarvis Tab

Goal: Make chat feel like Jarvis's command interface.

Changes:

- Rename visible "coach" copy to Jarvis or runtime modes.
- Keep coaching modes, but present them as Jarvis response modes: Sharp, Drill, Mentor, Strategist, Flow.
- Give command input a stronger affordance: "Ask Jarvis or assign work..."
- Approval cards should use shared ApprovalActionCard styling.
- Voice entry should be visible and branded as Jarvis Voice.

### Agents Tab

Goal: Present agents as Jarvis's council and autonomous workforce.

Changes:

- Header: Jarvis Council.
- Sections: Core Council, Active Work, Custom Agents, Self-Repair.
- Use role language from the repo: ATLAS, HERALD, ORACLE, SCOUT, FORGE, ECHO where applicable.
- Replace generic role color/icon choices with semantic Jarvis role tokens.
- Surface "Jarvis synthesized this" trace when jobs return from agents.

### Vault/Profile Tab

Goal: Make identity and memory review first-class.

Changes:

- Rename Profile to Vault in primary navigation.
- Group panels as Identity Kernel, Memory Review, People, Progress, Connections, Notes.
- Show pending memory/living updates prominently.
- Make "why Jarvis learned this" visible wherever available.
- Keep rewards and progress, but make them secondary to identity/memory safety.

### System Tab

Goal: Turn Settings into a runtime operations console.

Changes:

- Rename Settings to System in navigation.
- Organize into Runtime Nodes, Connected Accounts, Notifications, Autonomy and Approvals, Skills, Health, Code Proposals, Capability Gaps.
- Keep existing settings functions and routes.
- Use RuntimeNodeCard for connectors and health states.

### Voice Realtime

Goal: Make voice feel like a Jarvis runtime mode.

Changes:

- Keep the existing voice flow.
- Rebrand header and helper copy around Jarvis Voice.
- Show clear states: connecting, listening, thinking, speaking, interrupted, failed.
- Keep interrupt as a high-priority action.

### Desktop Connector Setup

Goal: Make device pairing feel like adding a runtime node.

Changes:

- Rename framing to Windows Runtime Node.
- Emphasize approvals, auditability, and safe device control.
- Preserve existing setup flow.

### Vault Route

Goal: Connect wiki/vault language to Jarvis memory.

Changes:

- Header: Jarvis Vault.
- Subtitle: "Compounding memory and context."
- Empty state: explain that pages are generated from verified context and reviewable learning.

## Copy System

Replace generic terms where appropriate:

- Coach -> Jarvis or Jarvis Mode
- Profile -> Vault
- Settings -> System
- Connect apps -> Add runtime nodes
- Tasks -> Command Plan
- Inbox -> Review Queue
- Deliverables -> Reviewable outputs
- Memories -> Memory Vault or Learning Queue
- Integrations -> Runtime Nodes
- Running jobs -> Active workers

Do not rename backend concepts or database fields as part of the first pass unless required by visible UI text.

## Data And API Behavior

The first implementation pass should not change server APIs or persistence.

Allowed:

- Reuse existing queries.
- Add small UI mapping helpers.
- Add constants for labels, tones, and icon metadata.
- Add derived counts on the client.

Avoid:

- Schema changes.
- Route moves.
- Auth changes.
- Memory pipeline behavior changes.
- Approval policy changes.
- Daemon behavior changes.

## Accessibility

Requirements:

- Text must fit on mobile widths.
- Buttons and touch targets should remain at least 44 px tall where practical.
- Status color must be paired with labels, not color alone.
- Important memory, approval, and error text should be selectable where existing component patterns support it.
- Voice and approval actions must have clear labels.

## Responsive Behavior

Mobile:

- Single-column command surface.
- Horizontal segmented controls may remain.
- Runtime metrics collapse to two-column or one-column depending width.

Web:

- Use wider split panels where screens already support web.
- Avoid tiny fixed-width mobile-only layouts on desktop web.

## Testing And Verification

Minimum checks after implementation:

- `npm.cmd test`
- `npm.cmd run server:build`

UI verification:

- Start Expo web.
- Verify login/onboarding render.
- Verify primary tabs render: Command, Jarvis, Agents, Vault, System.
- Verify Mission Control runtime metrics and sub-tabs.
- Verify Jarvis chat input and approval card states.
- Verify Agents list and empty/loading states.
- Verify Vault/Profile pending memory badge and panels.
- Verify System connectors/health sections.
- Verify mobile-width layout has no clipped primary text.

## Rollout Plan

Phase 1: Shared brand foundation

- Update colors/tokens.
- Add shared Jarvis UI primitives.
- Update tab labels and shell.

Phase 2: Highest-traffic screens

- Command/Mission Control.
- Jarvis chat.
- Agents.

Phase 3: Trust and system screens

- Vault/Profile.
- System/Settings.
- Voice.
- Desktop connector.

Phase 4: Remaining standalone routes

- Vault route.
- Skills.
- Code proposals.
- Capability gaps.
- Inbox rules.
- Self-repair history.
- Focus timer.
- Jarvis report.

## Acceptance Criteria

- The app visibly presents itself as JARVIS: Joint Autonomous Runtime Virtual Intelligence System.
- Primary navigation uses Jarvis OS language.
- Major screens share a consistent dark Jarvis runtime visual system.
- Mission Control becomes a coherent command dashboard.
- Chat, agents, profile, and settings no longer feel like separate products.
- Approval, memory review, and runtime status are visually distinct and easy to scan.
- Existing user flows remain functional.
- Standard tests/builds pass or any failures are documented with exact reasons.

## Intentional Non-Goals

- No backend API rewrite.
- No database schema changes.
- No approval policy weakening.
- No deployment or production settings change in the design/spec step.
- No public push or merge without explicit user approval.

## Spec Self-Review

- Placeholder scan: no TBD or TODO placeholders remain.
- Consistency check: the design uses "Jarvis OS" and "JARVIS: Joint Autonomous Runtime Virtual Intelligence System" consistently.
- Scope check: this is a large UI/UX overhaul, but it can be implemented in phased, testable passes without touching backend behavior.
- Ambiguity check: the approved direction is Command Center Relaunch; route moves and backend changes are explicitly out of scope for the first pass.
