# Jarvis Personal Operating Layer Frontend Spec

Status: Draft for product/design approval  
Date: 2026-06-05  
Scope: Frontend information architecture, screen model, naming, trust UX, and implementation-ready design requirements

## Objective

Reframe Jarvis from a chat-centered assistant into a living command center for the user's devices, memory, missions, automations, and approvals.

The core product idea:

> Jarvis is your personal operating layer.

Jarvis should feel aware, useful, and bounded. The app must show what Jarvis sees, remembers, is working on, and needs permission to do. The default UI should avoid infrastructure language and should not feel like a ChatGPT clone with sidebars.

## Brand Positioning

Primary tagline:

```text
Jarvis is your personal operating layer.
```

Primary subtagline:

```text
It remembers what matters, understands your devices, and helps you act - with your approval.
```

The expanded acronym, Joint Autonomous Runtime Virtual Intelligence System, can appear once in a small introductory detail or an about/settings surface. It should not drive headings, navigation, or repeated UI copy. The product brand is simply Jarvis.

Jarvis should speak in a calm, direct, useful voice. It can feel slightly futuristic, but never theatrical or corny.

Good voice examples:

```text
I found three things that need your attention.
I can handle this, but I need your approval before sending.
This looks routine. Want me to automate it next time?
I do not have enough context to act safely yet.
I remembered your preference for shorter investor updates.
I paused this automation because it touched a high-risk app.
```

Avoid:

```text
Greetings, sir.
At your command, master.
Your wish is my command.
I have hacked the matrix.
```

## Product Principles

1. Jarvis is not a chat app. It is a command center for delegation, memory, devices, and safe action.
2. The right context panel is a primary product feature, not a secondary sidebar.
3. Users should always know what Jarvis can see, what it remembers, and what needs permission.
4. Consumer-facing labels must be recognizable to non-technical users.
5. Technical infrastructure terms belong in Developer Mode only.
6. Automation must feel useful before it feels powerful.
7. Trust must be visible in the layout, not buried in settings.

## Information Architecture

Primary navigation:

```text
Home
Missions
Memory
Devices
Automations
Skills
Approvals
Activity
Settings
```

Consumer-friendly label mapping:

| Technical Concept | Default UI Label |
| --- | --- |
| Daemon | Device Link |
| Agent Logs | Activity |
| Tool Router | Skills |
| Vector Memory | Memory |
| Pipelines | Automations |
| Inference Provider | Brain Settings |
| Model Router | Brain Routing |

Default UI language should prefer:

```text
Command
Mission
Memory
Device
Skill
Approval
Activity
Focus
Signal
Boundary
Private Mode
Local Brain
Cloud Brain
```

Default UI language should avoid:

```text
Bot
Chatbot
Prompt
Token
Daemon
Vector
Pipeline
Inference
Embedding
```

Those terms may appear in Developer Mode, logs, or technical documentation where they are useful.

## App Shell

Jarvis uses a three-zone command center layout on wide screens:

```text
Left Navigation | Main Console | Right Context Panel
```

The top bar spans the shell and always communicates Jarvis state.

### Top Bar

Top bar content:

```text
JARVIS
Personal Operating Layer

[Local Brain Active] [Cloud Brain Ready] [Android Connected] [Desktop Connected] [Memory Synced]
```

Status pills should be small, readable, and visually alive without becoming noisy. Each pill needs a clear state color and accessible text.

Recommended status pills:

```text
Local Brain Active
Android Connected
Waiting for Approval
Cloud Brain Ready
Cloud Boost Available
Private Mode On
Learning Mode On
Memory Synced
Desktop Connected
Browser Connected
```

The top bar should answer:

```text
Is Jarvis online?
Which brains are available?
Which devices are connected?
Is anything waiting on me?
Is Jarvis operating within my rules?
```

### Left Navigation

The left navigation is for managing Jarvis, not browsing chat threads.

Required items:

```text
Home
Missions
Memory
Devices
Automations
Skills
Approvals
Activity
Settings
```

Each item should have an icon, label, active state, and optional count badge. Badges should be used for meaningful waiting states, such as approvals or priority signals.

### Main Console

The main console is where the user commands, delegates, and reviews work.

Core elements:

```text
Greeting or page header
Command input
Suggested action cards
Active work area
Activity timeline or page-specific content
```

Primary command input placeholder:

```text
What should I handle next?
```

Acceptable alternates:

```text
What do you need handled?
Give Jarvis a task...
Ask, command, or delegate...
```

Avoid:

```text
Message Jarvis...
```

### Right Context Panel

The right panel is required on most authenticated screens. It makes Jarvis feel grounded and accountable.

Recommended sections:

```text
Current Focus
What I See
What I Remember
What Needs Approval
```

Example:

```text
Current Focus
Jarvis Project / Android Device Link

What I See
3 unread priority notifications
1 calendar conflict
Android connected 12 min ago
Desktop idle

What I Remember
Justin prefers direct investor language
Battles Budz is a high-priority project
Ask before sending external messages

What Needs Approval
2 approvals
1 permission request
```

The panel should never expose raw private reasoning. It should show short decision summaries, relevant facts, and pending actions.

### Mobile Behavior

On mobile, the three-zone layout becomes:

```text
Top status strip
Primary screen content
Bottom navigation or compact nav drawer
Context panel as a swipeable sheet or "Context" button
```

The mobile UI must still preserve the same awareness model:

```text
State
Focus
Signals
Memory
Approvals
Activity
```

No critical trust or approval information may be desktop-only.

## Screen Specs

### Home

Purpose: The user's default command center.

Header options:

```text
Good evening, Justin.
I am watching the right signals. What do you want handled?
```

```text
Command Center
Your devices, memory, and automations are online.
```

```text
Your personal operating layer is online.
Ask Jarvis to think, remember, or act.
```

Primary input:

```text
What should I handle next?
```

Suggested action examples:

```text
Continue Jarvis Build
Pick up where you left off in the Android Device Link and Brain Routing work.
```

```text
Review Notifications
Summarize important messages and ignore the noise.
```

```text
Draft Business Update
Turn recent progress into an investor or partner update.
```

```text
Plan Today
Build a schedule around meetings, coding, errands, and recovery time.
```

Personalized cards should be driven by memory, connected devices, recent activity, and current missions.

### Missions

Purpose: Long-running goals Jarvis is helping move forward.

Header:

```text
Missions
Long-running goals Jarvis is helping you move forward.
```

Mission card fields:

```text
Mission Name
Status
Last Activity
Next Best Move
Connected Files
Connected Devices
Automations
```

Example missions:

```text
Jarvis Android Device Link
Status: Active
Next: Harden approval flow and Play Store onboarding.
```

```text
Battles Budz Launch
Status: Planning
Next: Draft licensing checklist and investor materials.
```

```text
Personal Admin
Status: Monitoring
Next: Clean notifications and calendar conflicts.
```

```text
Learning Byte Brain
Status: Research
Next: Compare ByT5, MambaByte, RWKV, and EvaByte.
```

Mission actions:

```text
Start Mission
Pause Mission
Add Context
Ask Jarvis for Next Move
Let Jarvis Monitor This
```

Avoid project-management-heavy or infrastructure-heavy labels such as "execute workflow" in default mode.

### Memory

Purpose: Let users inspect, correct, and control what Jarvis knows.

Header:

```text
Memory
What Jarvis knows about you, your work, and how you like things done.
```

Sections:

```text
Identity
Who you are, what matters, and how you operate.

People
Important people, relationships, tone preferences, and boundaries.

Projects
Your active work, goals, files, and context.

Preferences
How you like Jarvis to write, decide, remind, and act.

Rules
Hard boundaries Jarvis must follow.

Learned Patterns
Habits Jarvis has noticed and can use with approval.
```

Example memory cards:

```text
Writing Style
Justin prefers direct, confident language with minimal corporate fluff.
```

```text
Action Boundary
Ask before sending messages, making purchases, deleting files, or changing calendar events.
```

```text
Project Priority
Jarvis AI and Battles Budz are high-priority active projects.
```

```text
Work Pattern
Justin often works late and prefers summaries before deep execution.
```

Memory actions:

```text
Edit Memory
Forget This
Pin Memory
Use More Often
Ask Before Using
```

Memory must feel editable and under the user's control. This is a trust feature, not just a knowledge store.

### Devices

Purpose: Show where Jarvis can see, assist, and act.

Header:

```text
Devices
The places Jarvis can see, assist, and act.
```

Device card examples:

```text
Android Phone
Connected
Screen Access: On
Notifications: On
Actions: Ask First
Local Brain: Installed
```

```text
Desktop
Connected
Files: Limited
Shell: Approval Required
Notifications: On
```

```text
Browser
Connected
Tabs: Visible
Autofill: Ask First
Research: On
```

Permission groups:

```text
Can See
Can Suggest
Can Act
Needs Approval
Blocked
```

Android permission example:

```text
See notifications       On
Read screen text        On
Tap and swipe           Ask first
Type messages           Ask first
Send messages           Always ask
Make purchases          Blocked
Delete content          Blocked
Financial apps          Always ask
```

The Devices screen should make control feel precise, reversible, and understandable.

### Automations

Purpose: Small routines Jarvis can run automatically or with approval.

Header:

```text
Automations
Small routines Jarvis can run for you automatically or with approval.
```

Safety copy required anywhere automation is introduced:

```text
Jarvis will never send, purchase, delete, or commit changes without your approval unless you explicitly allow it.
```

Automation examples:

```text
Morning Briefing
Every morning, summarize calendar, weather, messages, and priorities.
```

```text
Notification Triage
Watch incoming notifications and only surface what matters.
```

```text
Investor Update Draft
Every Friday, turn project progress into a short update draft.
```

```text
Grocery Builder
When meals are planned, create a grocery list automatically.
```

```text
Calendar Guard
Warn me before I double-book or miss preparation time.
```

Automation actions:

```text
Turn On
Preview
Edit Rules
Require Approval
Pause
```

### Skills

Purpose: Install specialized capability packs for the work Jarvis helps with.

Header:

```text
Skills
Install specialized knowledge and tools for the work Jarvis helps you do.
```

Skill pack examples:

```text
Cannabis Business Ops
Licensing, SOPs, compliance planning, investor updates, and dispensary operations.
```

```text
Household Manager
Meals, groceries, chores, school schedules, appointments, and family reminders.
```

```text
Developer Mode
Repos, terminals, deployment, code review, docs, and debugging.
```

```text
Business Operator
Emails, documents, CRM notes, calendars, follow-ups, and planning.
```

```text
Research Assistant
Web research, source summaries, reports, and knowledge packs.
```

Skill actions:

```text
Install Skill
Update Skill
View Sources
Limit Access
Remove Skill
```

### Approvals

Purpose: Give the user confidence before Jarvis acts.

Header:

```text
Approvals
Review actions before Jarvis takes them.
```

Approval cards must show:

```text
What Jarvis wants to do
Who or what it affects
The exact proposed action
Reason
Risk
Available actions
Whether this can become a future rule
```

Message approval example:

```text
Jarvis wants to send a message

To: Andrea
Message:
"Still working, but I should be home in about 30 minutes."

Reason:
Andrea asked if you were on your way. This matches your usual tone.

Risk:
Medium - external message

Actions:
Approve & Send
Edit First
Deny
Always Ask for This
```

Financial approval example:

```text
Jarvis wants to open your banking app.

Reason:
You asked to check whether a payment posted.

Risk:
High - financial app.

Actions:
Approve
Deny
Always Ask for Financial Apps
```

File approval example:

```text
Jarvis wants to move 14 files into a project folder.

Reason:
These appear related to Battles Budz licensing.

Risk:
Low - reversible file organization.

Actions:
Approve
Review Files
Deny
```

Approvals are a core trust surface and should be visually polished, explicit, and easy to act on.

### Activity

Purpose: A clear record of what Jarvis saw, suggested, asked, and did.

Header:

```text
Activity
A clear record of what Jarvis saw, suggested, and did.
```

Timeline examples:

```text
8:42 PM
Saw notification from Andrea.
Suggested reply.
Waiting for approval.
```

```text
8:35 PM
Summarized 12 notifications.
Ignored 9 low-priority items.
Flagged 3 as important.
```

```text
8:12 PM
Opened Jarvis repo.
Read current notes file.
Suggested next implementation step.
```

Each event should show:

```text
What happened
Why Jarvis did it
What data was used
Whether approval was required
Whether it changed anything
```

Activity actions:

```text
View Decision Summary
Undo
Mark Helpful
Never Do This Again
```

Do not expose raw private reasoning. Show short decision summaries and data provenance.

### Settings

Purpose: Configure trust, behavior, models, devices, and account settings.

Recommended groups:

```text
Privacy
Memory
Devices
Approvals
Models
Voice
Notifications
Developer Mode
Billing
```

Settings should be grouped by trust and behavior, not internal infrastructure.

### Brain Settings

Purpose: Explain privacy and model choices in normal language.

Header:

```text
Brain Settings
Choose how Jarvis thinks, acts, and balances privacy with intelligence.
```

Brain types:

```text
Local Brain
Fast, private, on-device. Best for short commands and device control.
```

```text
Cloud Brain
More powerful reasoning for complex tasks, research, and planning.
```

```text
Hosted Open Brain
Lower-cost intelligence for free-tier tasks and background work.
```

Mode selector:

```text
Private
Use local models whenever possible.

Balanced
Use local models for simple actions and cloud models for harder thinking.

Maximum
Use the strongest available model for best quality.
```

This is where technical architecture becomes understandable to everyday users.

## First-Run Onboarding

Goal: Get to a useful, trusted first mission quickly.

### Screen 1: Meet Jarvis

```text
Meet Jarvis
Your personal operating layer for your devices, memory, and daily work.

Jarvis can help you:
- Understand what is on your screen
- Summarize notifications
- Remember what matters
- Draft replies and documents
- Run approved actions across your devices

Start Setup
```

### Screen 2: Choose How Jarvis Thinks

```text
Choose How Jarvis Thinks

Private Mode
Runs locally whenever possible.

Balanced Mode
Uses local intelligence for quick actions and cloud intelligence for harder work.

Power Mode
Prioritizes the strongest reasoning available.

Continue
```

### Screen 3: Connect Your Devices

```text
Connect Your Devices

Android Phone
Let Jarvis read notifications, understand screens, and help with approved actions.

Desktop
Let Jarvis help with files, apps, code, and workflows.

Browser
Let Jarvis assist with research, tabs, forms, and web tasks.

Connect Android
```

### Screen 4: Set Your Boundaries

```text
Set Your Boundaries

Jarvis can suggest anything.
Jarvis only acts when your rules allow it.

Recommended:
- Always ask before sending messages
- Always ask before purchases
- Always ask before deleting files
- Always ask before financial actions

Use Recommended Safety
```

### Screen 5: Give Jarvis Its First Mission

```text
Give Jarvis Its First Mission

What should Jarvis help you with first?

Run my day
Manage my notifications
Help with my business
Help with coding
Organize my household
Something else

Launch Command Center
```

## Public Landing Page

The public page should sell the product promise without sounding like speculative science fiction.

Recommended structure:

```text
Hero
What Jarvis Does
How It Works
Local + Cloud Brain
Device Control With Approval
Skill Packs
Privacy / Trust
Call to Action
```

Hero copy:

```text
Jarvis is your personal operating layer.

It sees what you allow, remembers what matters, and helps you act across your devices.

Open Command Center
See How It Works
```

Alternative hero options:

```text
An AI with memory, tools, and hands.

Jarvis helps you run your phone, computer, schedule, messages, projects, and daily life - with your approval.
```

```text
One assistant for your devices, memory, and day.

Jarvis learns how you work, helps you stay organized, and handles tasks across your phone and computer.
```

What Jarvis does:

```text
See
Jarvis can understand screens, notifications, files, and connected apps.

Remember
Jarvis builds a private memory of your preferences, projects, people, and routines.

Act
Jarvis can draft, organize, open, click, type, schedule, and automate - within your rules.

Learn
Jarvis gets better the more you correct it, guide it, and use it.
```

Local and cloud brain section:

```text
Built for privacy and scale.

Jarvis uses a local brain for fast, private device control and a cloud brain for deeper reasoning when needed.

You choose the balance:
Private, Balanced, or Maximum Intelligence.
```

Trust section:

```text
You stay in control.

Jarvis can suggest actions automatically, but sensitive actions require approval.

Before Jarvis sends, buys, deletes, posts, or changes something important, you see exactly what it plans to do.
```

Trust bullets:

```text
Approval-first automation
Editable memory
Clear activity history
Device-level boundaries
Private mode
Local model support
```

## Route Mapping For Current App

This spec should guide a future implementation pass against the existing Expo Router app.

Recommended mapping:

| Target Surface | Current Likely Source |
| --- | --- |
| Home / Command Center | `app/(tabs)/index.tsx`, mission control panels |
| Main Console / Ask Jarvis | `app/(tabs)/insights.tsx`, command input components |
| Missions | `app/(tabs)/goals.tsx`, project and task modules |
| Memory | memory panels, profile/vault surfaces |
| Devices | settings connection sections, desktop connector UX |
| Automations | scheduled jobs, inbox rules, heartbeat/monitoring surfaces |
| Skills | agent capabilities, tool/capability modules |
| Approvals | approval gates, inbox/deliverables requiring user action |
| Activity | agent logs, job history, self-repair/code proposal events |
| Settings | `app/(tabs)/settings.tsx`, model/voice/account settings |

Implementation should consolidate scattered surfaces into the new IA without deleting advanced functionality. Technical details can remain available behind Developer Mode.

## Component Requirements

Core shell components:

```text
JarvisAppShell
TopStatusBar
SidebarNavigation
MobileNavigation
MainConsole
ContextPanel
```

Core content components:

```text
CommandInput
SuggestedActionCard
StatusPill
MissionCard
MemoryCard
DeviceCard
PermissionMatrix
AutomationCard
SkillPackCard
ApprovalCard
ActivityEventCard
BrainModeSelector
OnboardingStep
```

Every component should be designed for:

```text
Mobile and desktop layouts
Keyboard and screen reader accessibility
Clear loading, empty, and error states
Approval and safety visibility
Plain-language copy
```

## Visual Direction

Jarvis should feel like a premium operating surface:

1. Dark-first command center aesthetic, but not monochrome.
2. Strong hierarchy between navigation, command input, context, and action cards.
3. Compact status pills with restrained glow.
4. Clear approval risk colors.
5. Dense enough for daily use, not a marketing dashboard full of oversized cards.
6. No corny sci-fi chrome, no fake terminal overload, no decorative noise.
7. Visual states should communicate connected, waiting, paused, blocked, and private.

The design should feel alive through real state, not decoration.

## Trust And Safety Requirements

Jarvis must make action boundaries visible wherever action is possible.

Required rules:

1. External messages require approval unless explicitly allowed by a user rule.
2. Purchases require approval unless explicitly allowed by a user rule.
3. Financial actions and financial app access require high-risk treatment.
4. File deletion requires approval and clear recovery context where possible.
5. Calendar edits require approval unless an automation rule explicitly allows them.
6. Code commits, deploys, or production-affecting changes require approval unless explicitly allowed.
7. Activity records must show whether Jarvis changed anything.
8. Memory must be inspectable, editable, and forgettable.

## Responsive Acceptance Criteria

Desktop:

1. Top bar shows Jarvis identity and status pills.
2. Left navigation exposes all primary surfaces.
3. Main console remains the primary focus.
4. Right context panel is visible on most authenticated screens.
5. Approvals and high-risk states are visible without digging through settings.

Mobile:

1. Status remains visible in a compact top strip.
2. Primary navigation is reachable with one tap.
3. Context panel is available as a sheet or dedicated context view.
4. Approval actions are thumb-friendly and cannot be accidentally hidden.
5. Command input remains easy to access from Home.

## Implementation Phases

This document is a frontend product spec, not the implementation plan. A follow-up implementation plan should break the work into small, reviewable passes:

1. Shell, navigation, top status bar, and context panel.
2. Home command center and suggested action cards.
3. Memory, Devices, Approvals, and Activity trust surfaces.
4. Missions, Automations, Skills, and Brain Settings.
5. First-run onboarding and public landing page.
6. Developer Mode routing for technical surfaces.
7. Responsive QA and accessibility pass.

## Done Criteria

The redesign is successful when:

1. Jarvis no longer reads as a chat app with tabs.
2. The default UI clearly communicates personal operating layer, not chatbot.
3. A non-technical user can understand every primary navigation item.
4. The app shows what Jarvis sees, remembers, is focused on, and needs approval for.
5. Technical terms are absent from default consumer-facing navigation and headings.
6. Automation and device control feel bounded and permissioned.
7. Memory is visibly editable and controllable.
8. Activity gives clear decision summaries without exposing private reasoning.
9. Mobile retains the same trust and awareness model as desktop.
10. The brand is Jarvis first; the acronym is treated as a small supporting detail.
