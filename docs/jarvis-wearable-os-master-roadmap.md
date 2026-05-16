# Jarvis Wearable OS - Master Vision, Research, Architecture & Implementation Roadmap

> Version: Living Document v2
> Last reviewed: May 16, 2026
> Source found at: `C:\Users\justi\OneDrive\Desktop\Jarvis\docs\jarvis-wearable-os-master-roadmap.md`
>
> Purpose: Long-term architectural vision plus implementation roadmap for building a persistent wearable ambient AI operating system across XR glasses, phones, desktops, cloud agents, Android daemon, desktop daemon, and future spatial computing devices.
>
> Primary Goal: Build a hardware-agnostic ambient AI system that can persist across wearable devices and intelligently assist with productivity, coding, environmental awareness, workflow orchestration, memory, and contextual interaction.

---

## Current Status Snapshot

| Area | Status | Notes |
|---|---|---|
| Jarvis Core | In progress | Agent harness, tool registry, background jobs, channels, memory, and autonomy policy exist. |
| Event Bus | In progress | Gateway/event bus and channel/session events exist, but there is not yet a unified wearable OS event schema. |
| Voice System | In progress | App voice, realtime voice, TTS, wake-word/Talk Mode, and daemon relay pieces exist. Needs wearable-specific latency and UX hardening. |
| Vision System | In progress | Screenshot/screen understanding, image understanding, OCR-like screen mapping, and Android daemon visual tools exist. Always-on wearable vision is not implemented. |
| Memory System | In progress | Typed memory, hybrid retrieval, people sync, weekly patterns, dream insights, and SOUL regeneration exist. Spatial memory is still conceptual. |
| Agent Layer | In progress | Research, writing, planning, email, deep research, build-feature, custom/named agents, job queue, and approval gates exist. |
| Device Adapter Layer | Early / partial | Desktop daemon and Android daemon exist. XR-specific adapters such as VITURE, XREAL, OpenXR, Vision Pro, and Ray-Ban adapters do not exist yet. |
| Wearable HUD | Not started | No persistent XR HUD runtime yet. Current notification surfaces are mobile, Telegram, Discord, Slack, WhatsApp, in-app, and daemon notifications. |
| Spatial Runtime | Not started | No `SpatialWindow`, `SpatialAnchor`, or persistent spatial workspace implementation yet. |
| Hardware Abstraction | Partial | Channel/device pairing exists for daemon and external channels. XR capability negotiation is still future work. |

---

## What Has Already Been Completed

- [x] Core Express + Drizzle + Expo application foundation
- [x] Tool-calling agent harness in `server/agent/harness.ts`
- [x] Agent tool registry and capability grouping
- [x] Background job queue with persistent `agent_jobs`
- [x] Deliverable inbox with approve/edit/revise/discard/save-to-Drive flows
- [x] Autonomy policy and runtime for queued work and approval-gated actions
- [x] Telegram, Discord, Slack, WhatsApp, in-app, webchat, and daemon channel architecture
- [x] Desktop daemon package under `daemon/`
- [x] Android daemon project under `android-daemon/`
- [x] Daemon pairing, permissions, and command routes
- [x] Android screen understanding and control tools
- [x] App voice/realtime voice routes, TTS tools, and Talk Mode daemon relay pieces
- [x] Long-term memory tables with categories, tiers, types, confidence, source tracking, review state, and optional embeddings
- [x] Hybrid memory retrieval with FTS and optional semantic embeddings
- [x] People sync and relationship context for meeting briefs
- [x] Weekly pattern recognition and SOUL regeneration
- [x] Nervous System signals, Dream Cycle, prediction validation, emotional state, and gut scan primitives
- [x] Code/build agent tools such as `build_feature`, `delegate_to_codex`, `project_shell`, `deploy_app`, `self_diagnose`, and `self_heal`

---

## What Is Left

- [ ] Define a formal wearable OS event schema and route all daemon, voice, vision, notification, and agent events through it.
- [ ] Create a real device adapter interface for wearable hardware capabilities.
- [ ] Add first XR target adapter, likely VITURE/Android-compatible before Vision Pro.
- [ ] Build a wearable HUD runtime for persistent notifications, agent status, and lightweight overlays.
- [ ] Design a low-friction wearable voice loop with interrupt handling, wake state, and clear fallback states.
- [ ] Add wearable frame capture and manual "what am I looking at?" vision flow before attempting always-on camera.
- [ ] Add spatial runtime primitives: `SpatialWindow`, `SpatialAnchor`, `SpatialNotification`, `SpatialWorkspace`, and `SpatialMemory`.
- [ ] Add spatial/workstation integration for coding workflows: build status, Codex job status, agent monitoring, and task delegation in a HUD.
- [ ] Add XR/device capability negotiation so Jarvis can degrade gracefully per hardware.
- [ ] Build spatial memory and environment memory only after privacy, consent, retention, and review controls are clear.
- [ ] Harden daemon security: audit logs, per-action approval, sandbox defaults, recovery, and clear user controls.
- [ ] Run real-device proof-of-concept testing with VITURE/Neckband, Android daemon, and existing Jarvis server.

---

## Core Philosophy

### Jarvis Is Not

- A chatbot
- A voice assistant
- A smart-glasses app
- A single-device application

### Jarvis Is

- A persistent ambient AI layer
- A wearable operating environment
- A context-aware orchestration system
- A multi-agent workflow engine
- A spatial computing middleware platform
- A memory, reasoning, and execution architecture

The hardware is replaceable. The intelligence layer is the product.

---

## Vision Statement

Jarvis should eventually behave like a persistent cognitive operating system that:

- Sees through wearable devices
- Understands spatial context
- Maintains long-term memory
- Delegates and executes tasks autonomously
- Communicates naturally through voice and visual overlays
- Operates continuously across devices
- Assists proactively rather than reactively
- Acts as a personal intelligence amplification layer

Jarvis should feel less like using software and more like a persistent intelligent system living around the user.

---

## Long-Term Desired Experience

The user can:

- Wear lightweight XR glasses
- Talk naturally to Jarvis
- Receive contextual updates while walking around
- Work from floating virtual workstations
- Delegate tasks to autonomous agents
- Have Jarvis monitor builds, projects, communication, and workflows
- Visually inspect environments with AI assistance
- Maintain persistent context across devices and sessions
- Seamlessly transition between ambient mode and workstation mode

---

## Strategic Architecture Principle

Jarvis Core must be independent from:

- VITURE
- XREAL
- Apple Vision Pro
- Meta Ray-Bans
- Vuzix
- Phones
- Desktop operating systems

All hardware should interact through adapters. The intelligence layer must survive hardware evolution.

---

## Jarvis Exists In Three Modes

### 1. Ambient Mode

Purpose:

- Walking around
- Notifications
- Quick commands
- Environmental awareness
- Passive updates
- Memory augmentation

Hardware examples:

- Meta Ray-Bans
- Future lightweight AR glasses
- Earbuds

Status:

- [x] Proactive notification logic exists
- [x] Channels and preferences exist
- [x] Daemon wake/Talk Mode primitives exist
- [ ] Wearable-specific ambient UX does not exist yet

### 2. Workstation Mode

Purpose:

- Coding
- Productivity
- Multi-monitor workflows
- Agent orchestration
- Spatial desktop systems

Hardware examples:

- VITURE Beast
- XREAL One Pro
- Future XR displays

Status:

- [x] Codex/build-agent and job monitoring primitives exist
- [x] Desktop daemon can run shell/file/notification operations
- [x] Android daemon can observe and manipulate screen UI
- [ ] Spatial workstation UI and virtual monitor workflows do not exist yet

### 3. Spatial Intelligence Mode

Purpose:

- Environmental understanding
- Real-world overlays
- Object recognition
- Spatial memory
- Mixed reality workflows

Hardware examples:

- Apple Vision Pro
- Future open AR systems
- Advanced Vuzix-style devices

Status:

- [x] Image/screenshot understanding primitives exist
- [x] Android screen map and element interaction primitives exist
- [ ] Real-world wearable camera capture is not implemented
- [ ] Spatial anchors and environmental overlays are not implemented

---

## Recommended MVP Direction

### First Hardware Target

Primary recommendation remains:

```txt
VITURE Beast
VITURE Neckband or Android-compatible compute
Samsung Fold / Android daemon
Jarvis Server
Cloud + Local Agents
```

Reasons:

- Affordable
- Lightweight
- Wearable workstation capability
- Android ecosystem compatibility
- Existing Jarvis Android daemon investment
- Good bridge from current daemon control into wearable workstation mode

The Beast is not the final platform. It is the first interface target.

---

## Why Not Start With Vision Pro

Vision Pro remains a future spatial upgrade target, not the initial validation platform, because it is:

- Expensive
- Heavy
- Closed
- Less socially wearable
- More session-based than ambient
- Higher complexity for MVP iteration

---

## High-Level System Architecture

```txt
[ XR Glasses / Devices ]
          |
   Device Adapter Layer
          |
   Interface Runtime Layer
          |
       Jarvis Core
          |
---------------------------------
Memory | Agents | Vision | Voice
Reasoning | Workflows | Context
---------------------------------
          |
Tooling / APIs / Cloud / Local Compute
```

---

## Major Components And Review

### 1. Jarvis Core

Responsibilities:

- Context orchestration
- Event routing
- State management
- Session persistence
- Agent coordination
- Memory retrieval
- Decision-making

Current review:

- [x] Agent orchestration exists.
- [x] Tool routing exists.
- [x] Job/session persistence exists.
- [x] Memory retrieval exists.
- [ ] Core events are still spread across channels, gateway, daemon, jobs, and diagnostics instead of one wearable OS event contract.

### 2. Device Adapter Layer

Purpose: abstract all hardware.

Future adapter shape:

```txt
/devices
  /viture
  /xreal
  /vision-pro
  /meta-rayban
  /vuzix
  /desktop
  /android
```

Current review:

- [x] Desktop daemon exists.
- [x] Android daemon exists.
- [x] Daemon pairing and permissions exist.
- [ ] Dedicated `devices/` abstraction does not exist.
- [ ] XR-specific adapters do not exist.

### 3. Event Bus

Everything in Jarvis should become an event:

```txt
USER_SPOKE
TASK_STARTED
TASK_COMPLETED
BUILD_FAILED
EMAIL_RECEIVED
VISION_FRAME_CAPTURED
SPATIAL_WINDOW_CREATED
NOTIFICATION_REQUESTED
DEVICE_CONNECTED
```

Current review:

- [x] Gateway event bus exists.
- [x] Diagnostics events exist.
- [x] Job lifecycle events exist.
- [x] Channel/session events exist.
- [ ] A single canonical wearable OS event schema has not been defined.

### 4. Voice System

Responsibilities:

- Wake word
- Speech-to-text
- Intent parsing
- Conversational memory
- Interrupt handling
- Text-to-speech
- Streaming voice responses

Current review:

- [x] App voice and realtime voice files exist.
- [x] TTS tool exists.
- [x] Wake-word context and Android daemon Talk Mode relay exist.
- [ ] Wearable low-latency loop needs real-device validation.
- [ ] Interrupt/resume UX needs hardening.

### 5. Vision System

Responsibilities:

- OCR
- Object recognition
- Environmental analysis
- Scene understanding
- Screenshot analysis
- Grow-room assistance
- Real-world contextual awareness

Current review:

- [x] Image understanding exists.
- [x] Android screenshot/screen understanding exists.
- [x] Screen map / element tools exist.
- [ ] Manual wearable frame capture is not implemented.
- [ ] Always-on wearable vision is intentionally not implemented yet.

### 6. Spatial Runtime Layer

Future internal concepts:

```txt
SpatialWindow
SpatialAnchor
SpatialNotification
SpatialScene
SpatialMemory
SpatialWorkspace
```

Current review:

- [ ] No spatial runtime exists yet.
- [ ] No spatial anchors exist yet.
- [ ] No persistent spatial workspace exists yet.

### 7. Memory System

Memory types:

- Episodic memory
- Spatial memory
- Procedural memory
- Semantic memory
- Agent memory

Current review:

- [x] Episodic/semantic/procedural/contextual memory categories exist in the schema.
- [x] Agent/private memory exists for custom agents.
- [x] Weekly patterns and SOUL regeneration exist.
- [ ] Spatial memory is not implemented yet.
- [ ] Wearable privacy/retention controls need to be defined before spatial memory.

### 8. Agent Layer

Examples:

- Code Agent
- Research Agent
- Browser Agent
- Calendar Agent
- Communication Agent
- Monitoring Agent
- Spatial Assistant Agent

Current review:

- [x] Research, writing, planning, email, deep research, build-feature, monitoring, memory, and named/custom agent primitives exist.
- [x] Background jobs and deliverables exist.
- [x] Approval gates exist.
- [ ] Spatial Assistant Agent does not exist yet.
- [ ] Wearable-specific agent status HUD does not exist yet.

---

## Development Roadmap

### Phase 0 - Foundation

Goal: create scalable architecture.

- [x] Current repo architecture exists
- [x] Logging and diagnostics exist
- [x] Workflow orchestration foundation exists
- [x] Memory architecture exists
- [ ] Formal wearable event specifications still needed
- [ ] Formal device adapter interfaces still needed

### Phase 1 - Voice Jarvis MVP

Goal: conversational wearable AI.

- [x] Push-to-talk / app voice primitives
- [x] STT/TTS primitives
- [x] Conversation persistence
- [x] Basic commands and tool calls
- [x] Agent launching through jobs/tools
- [ ] Wearable wake-word loop needs production proof
- [ ] Interruptible low-latency wearable conversation needs hardening

### Phase 2 - Wearable HUD System

Goal: persistent wearable updates.

- [x] Notification priorities and channel preferences exist
- [x] Agent/job updates exist in Inbox
- [x] Daemon native notifications exist
- [ ] XR HUD rendering not started
- [ ] Overlay UI not started
- [ ] Voice interaction with overlays not started

### Phase 3 - Workstation Integration

Goal: spatial coding workflows.

- [x] Codex/build-agent integration exists
- [x] Agent monitoring/jobs exist
- [x] Build/test/deploy tools exist
- [x] Desktop daemon can run local operations
- [ ] Remote desktop/spatial multi-monitor integration not started
- [ ] Agent monitoring HUD not started

### Phase 4 - Vision-Aware Jarvis

Goal: environmental understanding.

- [x] Screen analysis and image understanding exist
- [x] Android daemon visual control exists
- [ ] Wearable camera frame capture not started
- [ ] Real-world object recognition not started
- [ ] Grow-room real-world assistance not implemented as wearable flow

### Phase 5 - Spatial Runtime

Goal: true spatial interaction.

- [ ] Anchored windows
- [ ] Spatial persistence
- [ ] Gesture support
- [ ] Environmental overlays
- [ ] Workspace memory

### Phase 6 - Hardware Abstraction

Goal: support multiple XR ecosystems.

- [x] Desktop and Android daemon pairing primitives exist
- [ ] OpenXR integration
- [ ] VITURE/XREAL adapters
- [ ] Device capability negotiation
- [ ] Unified rendering model

### Phase 7 - Ambient AI Operating System

Goal: persistent intelligence layer.

- [x] Proactive heartbeat and autonomy primitives exist
- [x] Persistent memory and autonomous workflows exist
- [x] Contextual interruption logic exists in early form through heartbeat/action suppression/preferences
- [x] Device continuity exists in early form through channels and daemon pairing
- [ ] Full cross-device ambient orchestration is not complete
- [ ] Wearable-first context loop is not complete

---

## Immediate MVP Plan

### Step 1 - Wearable OS Architecture Contract

- [ ] Define event types and payloads.
- [ ] Define device capability interface.
- [ ] Define notification/HUD primitives.
- [ ] Define privacy boundaries for wearable camera and spatial memory.

### Step 2 - Android/Daemon Wearable Bridge

- [ ] Treat the existing Android daemon as the first wearable edge adapter.
- [ ] Add explicit device capabilities to daemon handshake metadata.
- [ ] Add a `VISION_FRAME_CAPTURED` event for manual camera/frame capture.
- [ ] Add proof-of-concept notification forwarding to a wearable display path.

### Step 3 - Voice Loop Hardening

- [ ] Measure latency for wake -> transcript -> tool/action -> spoken response.
- [ ] Add interruption/resume state.
- [ ] Add wearable fallback states: listening, thinking, acting, blocked, needs approval.

### Step 4 - HUD Proof Of Concept

- [ ] Display job status and priority notifications in a minimal wearable-compatible view.
- [ ] Support "what are you working on?" voice query.
- [ ] Support approve/discard for one deliverable type from wearable UI or voice.

### Step 5 - Workstation Mode

- [ ] Show Codex/build job state.
- [ ] Show active agents and failed checks.
- [ ] Let user delegate one coding/research task from wearable voice.

### Step 6 - Vision-Aware Manual Capture

- [ ] Manual "Jarvis, look at this" flow.
- [ ] Capture a frame from device/Android path.
- [ ] Run image/screen understanding.
- [ ] Store result as reviewable, privacy-scoped context.

---

## Engineering Principles

### Do Not

- Hardcode device assumptions
- Build for one hardware vendor
- Overfocus on graphics early
- Chase perfect AR immediately
- Build everything synchronously
- Add always-on camera memory before privacy and review controls exist

### Do

- Build modular systems
- Abstract interfaces
- Prioritize usefulness
- Focus on low-friction interaction
- Build persistent context systems
- Prioritize orchestration and memory
- Keep wearable actions approval-gated and observable

---

## Strategic Thesis

The real value is probably not:

- the glasses
- the rendering
- the holograms
- the XR visuals

The real value is likely:

- contextual intelligence
- orchestration
- persistent memory
- ambient assistance
- proactive workflows
- cognitive augmentation

Jarvis is fundamentally a persistent intelligence layer that happens to use wearable interfaces.

The future likely belongs not to the company with the fanciest glasses, but to the company that builds the best persistent intelligence layer across all wearable devices.

Jarvis should aim to become a cross-device ambient cognitive operating system.
