# Jarvis Personal Operating Layer Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved Jarvis personal operating layer redesign across the existing Expo app, centered on a command center shell, plain-language navigation, visible context, memory/device control, and approval-first action UX.

**Architecture:** Keep Expo Router and the existing backend contracts. Add a shared Jarvis product/content contract, reusable command-center shell components, and screen-specific Jarvis components that wrap or migrate the current Mission Control, Jarvis chat, agents, memory, settings, and connector surfaces into the new information architecture. Use source-level contract tests first so copy, routes, and safety language stay aligned while screens are migrated in small commits.

**Tech Stack:** Expo Router, React Native / React Native Web, TypeScript, TanStack Query, Ionicons, existing `Colors`, `npx.cmd tsx` source assertions, `npm.cmd test`, `npm.cmd run server:build`, Expo web smoke via Playwright screenshot.

---

## Scope Check

The approved spec covers one frontend redesign across many screens. This plan keeps it in one plan because the work is one product surface, but breaks execution into independent reviewable slices:

1. Product copy and design contracts.
2. Shared command-center shell.
3. Navigation and route IA.
4. Home command center.
5. Missions, Memory, Devices, Automations, Skills, Approvals, Activity, Settings, and Brain Settings.
6. Onboarding and landing.
7. QA, screenshots, and docs.

Backend changes are out of scope unless an existing route is missing data already available in the app. Use existing endpoints and local fallback content for the first frontend pass.

## Reference Docs

- Approved spec: `docs/superpowers/specs/2026-06-05-jarvis-personal-operating-layer-frontend-spec.md`
- Previous design spec: `docs/superpowers/specs/2026-06-05-jarvis-os-command-center-relaunch-design.md`
- Current frontend app: `app/`, `components/`, `constants/`, `lib/`

## Branch And Dirty Worktree Rules

Before executing any task:

```powershell
git -C C:\Users\justi\Documents\Codex\2026-05-05\files-mentioned-by-the-user-jarvis-os\github-push\jarvis-os status -sb
```

Expected branch:

```text
codex/replit-main-continuation
```

Do not stage unrelated backend, memory, migration, generated build, or schema files that already exist in the worktree. Each task below lists the exact files to stage.

## File Structure

Create these shared frontend contract files:

- `constants/jarvisProduct.ts`: approved consumer-facing labels, status pills, context panel labels, safety copy, page copy, skill packs, and route metadata.
- `constants/jarvisTheme.ts`: shell spacing, status colors, risk colors, breakpoints, and reusable layout constants that extend `constants/colors.ts` without replacing it.
- `lib/jarvisCommandCenter.ts`: data adapters and fallback data for command center context, suggested actions, approvals, activity, devices, automations, skills, and missions.

Create these shell components:

- `components/jarvis/JarvisAppShell.tsx`: responsive command-center frame with top bar, optional web sidebar, main content, and context panel.
- `components/jarvis/JarvisTopBar.tsx`: Jarvis identity and live status pills.
- `components/jarvis/JarvisSidebar.tsx`: desktop sidebar navigation for Home, Missions, Memory, Devices, Automations, Skills, Approvals, Activity, Settings.
- `components/jarvis/JarvisContextPanel.tsx`: Current Focus, What I See, What I Remember, What Needs Approval.
- `components/jarvis/JarvisCommandInput.tsx`: command/delegation input with the approved placeholder.
- `components/jarvis/JarvisCards.tsx`: shared action, status, risk, and section card primitives.
- `components/jarvis/JarvisPage.tsx`: page header, subtitle, scroll layout, and empty/error/loading states.

Create or replace these screen components:

- `components/jarvis/home/HomeCommandCenter.tsx`
- `components/jarvis/missions/MissionsScreen.tsx`
- `components/jarvis/memory/JarvisMemoryScreen.tsx`
- `components/jarvis/devices/DevicesScreen.tsx`
- `components/jarvis/automations/AutomationsScreen.tsx`
- `components/jarvis/skills/SkillsScreen.tsx`
- `components/jarvis/approvals/ApprovalsScreen.tsx`
- `components/jarvis/activity/ActivityScreen.tsx`
- `components/jarvis/settings/JarvisSettingsScreen.tsx`
- `components/jarvis/brain/BrainSettingsScreen.tsx`
- `components/jarvis/onboarding/JarvisOnboardingScreen.tsx`
- `components/jarvis/landing/JarvisLandingPage.tsx`

Modify or create these route files:

- Modify `app/(tabs)/_layout.tsx`: mobile tab titles and hidden route registration.
- Modify `app/(tabs)/index.tsx`: Home command center route.
- Modify `app/(tabs)/goals.tsx`: Missions route.
- Modify `app/(tabs)/profile.tsx`: Memory route or profile-to-memory bridge.
- Modify `app/(tabs)/settings.tsx`: Settings route.
- Modify `app/skills.tsx`: Skills route.
- Modify `app/onboarding.tsx`: first-run Jarvis onboarding.
- Create `app/devices.tsx`: Devices route.
- Create `app/automations.tsx`: Automations route.
- Create `app/approvals.tsx`: Approvals route.
- Create `app/activity.tsx`: Activity route.
- Create `app/brain-settings.tsx`: Brain Settings route.
- Create `app/landing.tsx`: public landing page route.

Create tests and docs:

- `scripts/__tests__/jarvisFrontendProductContract.assert.ts`: copy, route, and terminology contract checks.
- `scripts/__tests__/jarvisFrontendRouteContract.assert.ts`: source-level route wiring checks.
- `docs/operations/jarvis-frontend-redesign-qa.md`: manual QA and screenshot checklist.

## Task 1: Product Copy And Data Contract

**Files:**
- Create: `constants/jarvisProduct.ts`
- Create: `constants/jarvisTheme.ts`
- Create: `lib/jarvisCommandCenter.ts`
- Create: `scripts/__tests__/jarvisFrontendProductContract.assert.ts`

- [ ] **Step 1: Write the failing product contract test**

Create `scripts/__tests__/jarvisFrontendProductContract.assert.ts`:

```ts
import assert from "node:assert/strict";
import {
  JARVIS_APPROVAL_SAFETY_COPY,
  JARVIS_CONTEXT_SECTIONS,
  JARVIS_NAV_ITEMS,
  JARVIS_PRIMARY_INPUT_PLACEHOLDER,
  JARVIS_STATUS_PILLS,
  JARVIS_TAGLINE,
  JARVIS_VISIBLE_COPY_VALUES,
} from "../../constants/jarvisProduct";

const navLabels = JARVIS_NAV_ITEMS.map((item) => item.label);
assert.deepEqual(navLabels, [
  "Home",
  "Missions",
  "Memory",
  "Devices",
  "Automations",
  "Skills",
  "Approvals",
  "Activity",
  "Settings",
]);

assert.equal(JARVIS_TAGLINE, "Jarvis is your personal operating layer.");
assert.equal(JARVIS_PRIMARY_INPUT_PLACEHOLDER, "What should I handle next?");
assert.equal(
  JARVIS_APPROVAL_SAFETY_COPY,
  "Jarvis will never send, purchase, delete, or commit changes without your approval unless you explicitly allow it.",
);
assert.deepEqual(
  JARVIS_CONTEXT_SECTIONS.map((section) => section.label),
  ["Current Focus", "What I See", "What I Remember", "What Needs Approval"],
);
assert.ok(JARVIS_STATUS_PILLS.some((pill) => pill.label === "Local Brain Active"));
assert.ok(JARVIS_STATUS_PILLS.some((pill) => pill.label === "Android Connected"));
assert.ok(JARVIS_STATUS_PILLS.some((pill) => pill.label === "Waiting for Approval"));

const forbiddenDefaultTerms = [
  "Chatbot",
  "Prompt",
  "Token",
  "Daemon",
  "Vector",
  "Pipeline",
  "Inference",
  "Embedding",
];

const visibleCopy = JARVIS_VISIBLE_COPY_VALUES.join("\n");
for (const term of forbiddenDefaultTerms) {
  assert.equal(
    visibleCopy.includes(term),
    false,
    `Default consumer copy must not include technical term: ${term}`,
  );
}

console.log("OK: Jarvis frontend product contract matches approved personal operating layer spec");
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
npx.cmd tsx scripts/__tests__/jarvisFrontendProductContract.assert.ts
```

Expected: FAIL because `constants/jarvisProduct.ts` does not exist.

- [ ] **Step 3: Create the Jarvis product contract**

Create `constants/jarvisProduct.ts`:

```ts
export type JarvisRouteId =
  | "home"
  | "missions"
  | "memory"
  | "devices"
  | "automations"
  | "skills"
  | "approvals"
  | "activity"
  | "settings";

export interface JarvisNavItem {
  id: JarvisRouteId;
  label: string;
  href: string;
  icon: string;
  mobileTab?: boolean;
  badgeKey?: "approvals" | "memory" | "signals";
}

export interface JarvisStatusPill {
  id: string;
  label: string;
  tone: "online" | "ready" | "attention" | "private" | "idle";
}

export interface JarvisContextSection {
  id: "focus" | "signals" | "memory" | "approvals";
  label: string;
}

export const JARVIS_TAGLINE = "Jarvis is your personal operating layer.";

export const JARVIS_SUBTAGLINE =
  "It remembers what matters, understands your devices, and helps you act - with your approval.";

export const JARVIS_PRIMARY_INPUT_PLACEHOLDER = "What should I handle next?";

export const JARVIS_APPROVAL_SAFETY_COPY =
  "Jarvis will never send, purchase, delete, or commit changes without your approval unless you explicitly allow it.";

export const JARVIS_NAV_ITEMS: JarvisNavItem[] = [
  { id: "home", label: "Home", href: "/(tabs)", icon: "home-outline", mobileTab: true },
  { id: "missions", label: "Missions", href: "/(tabs)/goals", icon: "flag-outline", mobileTab: true },
  { id: "memory", label: "Memory", href: "/(tabs)/profile", icon: "library-outline", mobileTab: true, badgeKey: "memory" },
  { id: "devices", label: "Devices", href: "/devices", icon: "phone-portrait-outline" },
  { id: "automations", label: "Automations", href: "/automations", icon: "repeat-outline" },
  { id: "skills", label: "Skills", href: "/skills", icon: "construct-outline" },
  { id: "approvals", label: "Approvals", href: "/approvals", icon: "shield-checkmark-outline", badgeKey: "approvals" },
  { id: "activity", label: "Activity", href: "/activity", icon: "pulse-outline" },
  { id: "settings", label: "Settings", href: "/(tabs)/settings", icon: "settings-outline", mobileTab: true },
];

export const JARVIS_CONTEXT_SECTIONS: JarvisContextSection[] = [
  { id: "focus", label: "Current Focus" },
  { id: "signals", label: "What I See" },
  { id: "memory", label: "What I Remember" },
  { id: "approvals", label: "What Needs Approval" },
];

export const JARVIS_STATUS_PILLS: JarvisStatusPill[] = [
  { id: "local-brain", label: "Local Brain Active", tone: "online" },
  { id: "cloud-brain", label: "Cloud Brain Ready", tone: "ready" },
  { id: "android", label: "Android Connected", tone: "online" },
  { id: "desktop", label: "Desktop Connected", tone: "ready" },
  { id: "memory", label: "Memory Synced", tone: "ready" },
  { id: "approval", label: "Waiting for Approval", tone: "attention" },
  { id: "private", label: "Private Mode On", tone: "private" },
];

export const JARVIS_HOME_HEADER = {
  eyebrow: "Command Center",
  title: "Your personal operating layer is online.",
  subtitle: "Ask Jarvis to think, remember, or act.",
};

export const JARVIS_SUGGESTED_ACTIONS = [
  {
    title: "Continue Jarvis Build",
    description: "Pick up where you left off in the Android Device Link and Brain Routing work.",
    icon: "code-slash-outline",
  },
  {
    title: "Review Notifications",
    description: "Summarize important messages and ignore the noise.",
    icon: "notifications-outline",
  },
  {
    title: "Draft Business Update",
    description: "Turn recent progress into an investor or partner update.",
    icon: "document-text-outline",
  },
  {
    title: "Plan Today",
    description: "Build a schedule around meetings, coding, errands, and recovery time.",
    icon: "calendar-outline",
  },
];

export const JARVIS_VISIBLE_COPY_VALUES = [
  JARVIS_TAGLINE,
  JARVIS_SUBTAGLINE,
  JARVIS_PRIMARY_INPUT_PLACEHOLDER,
  JARVIS_APPROVAL_SAFETY_COPY,
  JARVIS_HOME_HEADER.eyebrow,
  JARVIS_HOME_HEADER.title,
  JARVIS_HOME_HEADER.subtitle,
  ...JARVIS_NAV_ITEMS.map((item) => item.label),
  ...JARVIS_CONTEXT_SECTIONS.map((section) => section.label),
  ...JARVIS_STATUS_PILLS.map((pill) => pill.label),
  ...JARVIS_SUGGESTED_ACTIONS.flatMap((card) => [card.title, card.description]),
];
```

- [ ] **Step 4: Create theme constants**

Create `constants/jarvisTheme.ts`:

```ts
import Colors from "@/constants/colors";

export const JarvisLayout = {
  maxContentWidth: 1480,
  sidebarWidth: 232,
  contextPanelWidth: 320,
  topBarHeight: 68,
  mobileBottomSpace: 92,
  radius: {
    panel: 8,
    card: 8,
    pill: 999,
    control: 8,
  },
  gap: {
    xs: 6,
    sm: 10,
    md: 14,
    lg: 20,
    xl: 28,
  },
};

export const JarvisStatusColors = {
  online: { fg: Colors.green, bg: Colors.greenDim, border: Colors.greenGlow },
  ready: { fg: Colors.cyan, bg: Colors.cyanDim, border: Colors.cyanGlow },
  attention: { fg: Colors.warning, bg: Colors.warningDim, border: "rgba(245,158,11,0.32)" },
  private: { fg: Colors.violet, bg: Colors.violetDim, border: Colors.violetGlow },
  idle: { fg: Colors.textSecondary, bg: Colors.surfaceAlt, border: Colors.border },
};

export const JarvisRiskColors = {
  low: { fg: Colors.success, bg: Colors.successDim, border: "rgba(16,185,129,0.32)" },
  medium: { fg: Colors.warning, bg: Colors.warningDim, border: "rgba(245,158,11,0.32)" },
  high: { fg: Colors.error, bg: Colors.errorDim, border: "rgba(239,68,68,0.32)" },
};
```

- [ ] **Step 5: Create data adapters and fallback content**

Create `lib/jarvisCommandCenter.ts`:

```ts
import { JARVIS_SUGGESTED_ACTIONS, JARVIS_STATUS_PILLS } from "@/constants/jarvisProduct";

export type JarvisRisk = "low" | "medium" | "high";

export interface JarvisSuggestedAction {
  title: string;
  description: string;
  icon: string;
}

export interface JarvisContextPanelData {
  focus: string;
  signals: string[];
  memory: string[];
  approvals: string[];
}

export interface JarvisMission {
  id: string;
  name: string;
  status: "Active" | "Planning" | "Monitoring" | "Research" | "Paused";
  lastActivity: string;
  nextBestMove: string;
  connectedFiles: string;
  connectedDevices: string;
  automations: string;
}

export interface JarvisApproval {
  id: string;
  title: string;
  target: string;
  reason: string;
  risk: JarvisRisk;
  actions: string[];
}

export const defaultJarvisStatusPills = JARVIS_STATUS_PILLS;

export const defaultJarvisContext: JarvisContextPanelData = {
  focus: "Jarvis Project / Android Device Link",
  signals: [
    "3 unread priority notifications",
    "1 calendar conflict",
    "Android connected 12 min ago",
    "Desktop idle",
  ],
  memory: [
    "Justin prefers direct investor language",
    "Battles Budz is a high-priority project",
    "Ask before sending external messages",
  ],
  approvals: ["2 approvals", "1 permission request"],
};

export const defaultSuggestedActions: JarvisSuggestedAction[] = JARVIS_SUGGESTED_ACTIONS;

export const defaultMissions: JarvisMission[] = [
  {
    id: "jarvis-android",
    name: "Jarvis Android Device Link",
    status: "Active",
    lastActivity: "Updated today",
    nextBestMove: "Harden approval flow and Play Store onboarding.",
    connectedFiles: "Android connector, approval policy, onboarding notes",
    connectedDevices: "Android Phone, Desktop",
    automations: "Approval guard, connection health check",
  },
  {
    id: "battles-budz",
    name: "Battles Budz Launch",
    status: "Planning",
    lastActivity: "Reviewed this week",
    nextBestMove: "Draft licensing checklist and investor materials.",
    connectedFiles: "Licensing notes, investor draft",
    connectedDevices: "Desktop",
    automations: "Weekly business update draft",
  },
  {
    id: "personal-admin",
    name: "Personal Admin",
    status: "Monitoring",
    lastActivity: "Checked today",
    nextBestMove: "Clean notifications and calendar conflicts.",
    connectedFiles: "Calendar, messages",
    connectedDevices: "Android Phone, Browser",
    automations: "Morning briefing, calendar guard",
  },
];

export const defaultApprovals: JarvisApproval[] = [
  {
    id: "message-andrea",
    title: "Jarvis wants to send a message",
    target: "To: Andrea",
    reason: "Andrea asked if you were on your way. This matches your usual tone.",
    risk: "medium",
    actions: ["Approve & Send", "Edit First", "Deny", "Always Ask for This"],
  },
  {
    id: "banking-app",
    title: "Jarvis wants to open your banking app",
    target: "Financial app",
    reason: "You asked to check whether a payment posted.",
    risk: "high",
    actions: ["Approve", "Deny", "Always Ask for Financial Apps"],
  },
];
```

- [ ] **Step 6: Run the product contract test**

Run:

```powershell
npx.cmd tsx scripts/__tests__/jarvisFrontendProductContract.assert.ts
```

Expected: PASS with:

```text
OK: Jarvis frontend product contract matches approved personal operating layer spec
```

- [ ] **Step 7: Commit Task 1**

Run:

```powershell
git -C C:\Users\justi\Documents\Codex\2026-05-05\files-mentioned-by-the-user-jarvis-os\github-push\jarvis-os add constants/jarvisProduct.ts constants/jarvisTheme.ts lib/jarvisCommandCenter.ts scripts/__tests__/jarvisFrontendProductContract.assert.ts
git -C C:\Users\justi\Documents\Codex\2026-05-05\files-mentioned-by-the-user-jarvis-os\github-push\jarvis-os commit -m "Add Jarvis frontend product contract"
```

## Task 2: Command Center Shell Components

**Files:**
- Create: `components/jarvis/JarvisCards.tsx`
- Create: `components/jarvis/JarvisTopBar.tsx`
- Create: `components/jarvis/JarvisSidebar.tsx`
- Create: `components/jarvis/JarvisContextPanel.tsx`
- Create: `components/jarvis/JarvisCommandInput.tsx`
- Create: `components/jarvis/JarvisPage.tsx`
- Create: `components/jarvis/JarvisAppShell.tsx`
- Create: `scripts/__tests__/jarvisShellSource.assert.ts`

- [ ] **Step 1: Write the failing shell source test**

Create `scripts/__tests__/jarvisShellSource.assert.ts`:

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const requiredFiles = [
  "components/jarvis/JarvisCards.tsx",
  "components/jarvis/JarvisTopBar.tsx",
  "components/jarvis/JarvisSidebar.tsx",
  "components/jarvis/JarvisContextPanel.tsx",
  "components/jarvis/JarvisCommandInput.tsx",
  "components/jarvis/JarvisPage.tsx",
  "components/jarvis/JarvisAppShell.tsx",
];

for (const file of requiredFiles) {
  const abs = path.join(root, file);
  assert.equal(fs.existsSync(abs), true, `${file} should exist`);
  const source = fs.readFileSync(abs, "utf8");
  assert.match(source, /export /, `${file} should export a component or helper`);
}

const shell = fs.readFileSync(path.join(root, "components/jarvis/JarvisAppShell.tsx"), "utf8");
assert.match(shell, /JarvisTopBar/);
assert.match(shell, /JarvisSidebar/);
assert.match(shell, /JarvisContextPanel/);
assert.match(shell, /Platform\.OS === "web"/);

const topBar = fs.readFileSync(path.join(root, "components/jarvis/JarvisTopBar.tsx"), "utf8");
assert.match(topBar, /Personal Operating Layer/);
assert.match(topBar, /Local Brain Active/);

const commandInput = fs.readFileSync(path.join(root, "components/jarvis/JarvisCommandInput.tsx"), "utf8");
assert.match(commandInput, /What should I handle next\?/);

console.log("OK: Jarvis shell components are present and wired to approved product language");
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
npx.cmd tsx scripts/__tests__/jarvisShellSource.assert.ts
```

Expected: FAIL because `components/jarvis/JarvisCards.tsx` does not exist.

- [ ] **Step 3: Create shared card primitives**

Create `components/jarvis/JarvisCards.tsx` with:

```tsx
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { JarvisRiskColors, JarvisStatusColors } from "@/constants/jarvisTheme";
import type { JarvisRisk } from "@/lib/jarvisCommandCenter";

export function StatusPill({
  label,
  tone = "idle",
}: {
  label: string;
  tone?: keyof typeof JarvisStatusColors;
}) {
  const color = JarvisStatusColors[tone] ?? JarvisStatusColors.idle;
  return (
    <View style={[styles.statusPill, { backgroundColor: color.bg, borderColor: color.border }]}>
      <View style={[styles.statusDot, { backgroundColor: color.fg }]} />
      <Text style={[styles.statusText, { color: color.fg }]}>{label}</Text>
    </View>
  );
}

export function RiskBadge({ risk }: { risk: JarvisRisk }) {
  const color = JarvisRiskColors[risk];
  return (
    <View style={[styles.riskBadge, { backgroundColor: color.bg, borderColor: color.border }]}>
      <Text style={[styles.riskText, { color: color.fg }]}>{risk.toUpperCase()} RISK</Text>
    </View>
  );
}

export function JarvisActionCard({
  title,
  description,
  icon,
  onPress,
}: {
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.actionCard}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={18} color={Colors.primary} />
      </View>
      <View style={styles.actionTextBlock}>
        <Text style={styles.actionTitle}>{title}</Text>
        <Text style={styles.actionDescription}>{description}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
    </Pressable>
  );
}

export function JarvisInfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.infoCard}>
      <Text style={styles.infoTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 7,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
  },
  riskBadge: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  riskText: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
  },
  actionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    padding: 14,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.greenDim,
  },
  actionTextBlock: {
    flex: 1,
    gap: 4,
  },
  actionTitle: {
    color: Colors.text,
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
  actionDescription: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: "Inter_400Regular",
  },
  infoCard: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    padding: 14,
    gap: 10,
  },
  infoTitle: {
    color: Colors.text,
    fontSize: 13,
    fontFamily: "Inter_700Bold",
  },
});
```

- [ ] **Step 4: Create the top bar, sidebar, context, input, page, and shell**

Use the same component naming and exports listed below:

```tsx
// components/jarvis/JarvisTopBar.tsx
import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";
import { JARVIS_STATUS_PILLS } from "@/constants/jarvisProduct";
import { StatusPill } from "@/components/jarvis/JarvisCards";

export function JarvisTopBar() {
  return (
    <View style={styles.bar}>
      <View style={styles.identity}>
        <Text style={styles.brand}>JARVIS</Text>
        <Text style={styles.subtitle}>Personal Operating Layer</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills}>
        {JARVIS_STATUS_PILLS.map((pill) => (
          <StatusPill key={pill.id} label={pill.label} tone={pill.tone} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: 68,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.background,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  identity: { width: 220, gap: 2 },
  brand: { color: Colors.text, fontSize: 18, fontFamily: "Inter_800ExtraBold", letterSpacing: 0 },
  subtitle: { color: Colors.textSecondary, fontSize: 12, fontFamily: "Inter_500Medium" },
  pills: { alignItems: "center", gap: 8, paddingRight: 18 },
});
```

```tsx
// components/jarvis/JarvisSidebar.tsx
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Link, usePathname } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { JARVIS_NAV_ITEMS } from "@/constants/jarvisProduct";

export function JarvisSidebar() {
  const pathname = usePathname();
  return (
    <View style={styles.sidebar}>
      <Text style={styles.label}>COMMAND CENTER</Text>
      {JARVIS_NAV_ITEMS.map((item) => {
        const active = pathname === item.href || (item.id === "home" && pathname === "/");
        return (
          <Link key={item.id} href={item.href as never} asChild>
            <Pressable style={[styles.navItem, active && styles.navItemActive]}>
              <Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={18} color={active ? Colors.primary : Colors.textSecondary} />
              <Text style={[styles.navLabel, active && styles.navLabelActive]}>{item.label}</Text>
            </Pressable>
          </Link>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    width: 232,
    borderRightWidth: 1,
    borderRightColor: Colors.border,
    backgroundColor: Colors.surface,
    paddingHorizontal: 12,
    paddingTop: 18,
    gap: 6,
  },
  label: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    marginBottom: 10,
    paddingHorizontal: 8,
  },
  navItem: {
    minHeight: 42,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
  },
  navItemActive: { backgroundColor: Colors.greenDim },
  navLabel: { color: Colors.textSecondary, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  navLabelActive: { color: Colors.text },
});
```

Create `JarvisContextPanel.tsx`, `JarvisCommandInput.tsx`, `JarvisPage.tsx`, and `JarvisAppShell.tsx` with these required exports:

```tsx
export function JarvisContextPanel({ data = defaultJarvisContext }: { data?: JarvisContextPanelData }) { /* render the four approved context sections */ }
export function JarvisCommandInput({ onSubmit }: { onSubmit?: (value: string) => void }) { /* TextInput placeholder uses JARVIS_PRIMARY_INPUT_PLACEHOLDER */ }
export function JarvisPage({ eyebrow, title, subtitle, children }: JarvisPageProps) { /* scrollable page body with consistent header */ }
export default function JarvisAppShell({ children, contextData }: JarvisAppShellProps) { /* top bar, web sidebar, main content, web context panel */ }
```

The implementation must:

1. Use `Platform.OS === "web"` to show the left sidebar and right context panel.
2. Show the context panel inside the main scroll area on native/mobile screens.
3. Use `Colors.background`, `Colors.surface`, `Colors.border`, and `JarvisLayout`.
4. Use `letterSpacing: 0` for brand and headings.

- [ ] **Step 5: Run shell source test**

Run:

```powershell
npx.cmd tsx scripts/__tests__/jarvisShellSource.assert.ts
```

Expected: PASS with:

```text
OK: Jarvis shell components are present and wired to approved product language
```

- [ ] **Step 6: Commit Task 2**

Run:

```powershell
git -C C:\Users\justi\Documents\Codex\2026-05-05\files-mentioned-by-the-user-jarvis-os\github-push\jarvis-os add components/jarvis/JarvisCards.tsx components/jarvis/JarvisTopBar.tsx components/jarvis/JarvisSidebar.tsx components/jarvis/JarvisContextPanel.tsx components/jarvis/JarvisCommandInput.tsx components/jarvis/JarvisPage.tsx components/jarvis/JarvisAppShell.tsx scripts/__tests__/jarvisShellSource.assert.ts
git -C C:\Users\justi\Documents\Codex\2026-05-05\files-mentioned-by-the-user-jarvis-os\github-push\jarvis-os commit -m "Add Jarvis command center shell"
```

## Task 3: Navigation And Route IA

**Files:**
- Modify: `app/(tabs)/_layout.tsx`
- Create: `app/devices.tsx`
- Create: `app/automations.tsx`
- Create: `app/approvals.tsx`
- Create: `app/activity.tsx`
- Create: `app/brain-settings.tsx`
- Create: `app/landing.tsx`
- Create: `scripts/__tests__/jarvisFrontendRouteContract.assert.ts`

- [ ] **Step 1: Write the failing route contract test**

Create `scripts/__tests__/jarvisFrontendRouteContract.assert.ts`:

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

const layout = read("app/(tabs)/_layout.tsx");
for (const title of ["Home", "Jarvis", "Missions", "Memory", "Settings"]) {
  assert.match(layout, new RegExp(`title: "${title}"`), `mobile tab should include title ${title}`);
}
assert.equal(layout.includes("Mission Control"), false, "default navigation should not show Mission Control");
assert.equal(layout.includes("Agents"), false, "default navigation should not show Agents as a primary consumer label");
assert.equal(layout.includes("Profile"), false, "default navigation should not show Profile as the Memory surface");

const expectedRoutes = [
  ["app/devices.tsx", "DevicesScreen"],
  ["app/automations.tsx", "AutomationsScreen"],
  ["app/approvals.tsx", "ApprovalsScreen"],
  ["app/activity.tsx", "ActivityScreen"],
  ["app/brain-settings.tsx", "BrainSettingsScreen"],
  ["app/landing.tsx", "JarvisLandingPage"],
];

for (const [file, component] of expectedRoutes) {
  const source = read(file);
  assert.match(source, new RegExp(component), `${file} should render ${component}`);
  assert.match(source, /JarvisAppShell|JarvisLandingPage/, `${file} should use Jarvis shell or public landing`);
}

console.log("OK: Jarvis frontend routes match the approved information architecture");
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
npx.cmd tsx scripts/__tests__/jarvisFrontendRouteContract.assert.ts
```

Expected: FAIL because new routes do not exist and tab labels still use old naming.

- [ ] **Step 3: Update mobile tab labels**

Modify `app/(tabs)/_layout.tsx`:

1. Keep `usePendingMemoryBadge`.
2. Change native tab labels:
   - `index`: `Home`
   - `insights`: `Jarvis`
   - `goals`: `Missions`
   - `profile`: `Memory`
   - `settings`: `Settings`
3. Hide `agents`, `inbox`, `scheduled`, `projects`, and `connectionUx` from default consumer tabs.
4. Use icons that map to the new labels.
5. Keep badge count on `profile`, but label it as Memory.

Required Classic tab screen block:

```tsx
<Tabs.Screen
  name="index"
  options={{
    title: "Home",
    tabBarIcon: ({ color, focused }) => (
      <Ionicons name={focused ? "home" : "home-outline"} size={24} color={color} />
    ),
  }}
/>
<Tabs.Screen
  name="insights"
  options={{
    title: "Jarvis",
    tabBarIcon: ({ color, focused }) => (
      <Ionicons name={focused ? "sparkles" : "sparkles-outline"} size={24} color={color} />
    ),
  }}
/>
<Tabs.Screen
  name="goals"
  options={{
    title: "Missions",
    tabBarIcon: ({ color, focused }) => (
      <Ionicons name={focused ? "flag" : "flag-outline"} size={24} color={color} />
    ),
  }}
/>
<Tabs.Screen
  name="profile"
  options={{
    title: "Memory",
    tabBarBadge: pendingMemoryCount > 0 ? pendingMemoryCount : undefined,
    tabBarBadgeStyle: { backgroundColor: Colors.primary, color: "#fff", fontSize: 10 },
    tabBarIcon: ({ color, focused }) => (
      <Ionicons name={focused ? "library" : "library-outline"} size={24} color={color} />
    ),
  }}
/>
<Tabs.Screen
  name="settings"
  options={{
    title: "Settings",
    tabBarIcon: ({ color, focused }) => (
      <Ionicons name={focused ? "settings" : "settings-outline"} size={24} color={color} />
    ),
  }}
/>
```

- [ ] **Step 4: Add route wrappers**

Create these route files:

```tsx
// app/devices.tsx
import DevicesScreen from "@/components/jarvis/devices/DevicesScreen";
export default DevicesScreen;
```

```tsx
// app/automations.tsx
import AutomationsScreen from "@/components/jarvis/automations/AutomationsScreen";
export default AutomationsScreen;
```

```tsx
// app/approvals.tsx
import ApprovalsScreen from "@/components/jarvis/approvals/ApprovalsScreen";
export default ApprovalsScreen;
```

```tsx
// app/activity.tsx
import ActivityScreen from "@/components/jarvis/activity/ActivityScreen";
export default ActivityScreen;
```

```tsx
// app/brain-settings.tsx
import BrainSettingsScreen from "@/components/jarvis/brain/BrainSettingsScreen";
export default BrainSettingsScreen;
```

```tsx
// app/landing.tsx
import JarvisLandingPage from "@/components/jarvis/landing/JarvisLandingPage";
export default JarvisLandingPage;
```

- [ ] **Step 5: Add temporary screen stubs so routes compile**

Create temporary but user-facing components for the routes in this task. Each should use `JarvisAppShell` and `JarvisPage`.

Example for `components/jarvis/devices/DevicesScreen.tsx`:

```tsx
import React from "react";
import JarvisAppShell from "@/components/jarvis/JarvisAppShell";
import { JarvisInfoCard } from "@/components/jarvis/JarvisCards";
import { JarvisPage } from "@/components/jarvis/JarvisPage";

export default function DevicesScreen() {
  return (
    <JarvisAppShell>
      <JarvisPage
        eyebrow="Devices"
        title="The places Jarvis can see, assist, and act."
        subtitle="Manage connected phones, desktops, browsers, and permission boundaries."
      >
        <JarvisInfoCard title="Android Phone">Connected surfaces and approval rules will appear here.</JarvisInfoCard>
      </JarvisPage>
    </JarvisAppShell>
  );
}
```

For the other route stubs, use these header pairs:

```text
Automations | Small routines Jarvis can run for you automatically or with approval.
Approvals | Review actions before Jarvis takes them.
Activity | A clear record of what Jarvis saw, suggested, and did.
Brain Settings | Choose how Jarvis thinks, acts, and balances privacy with intelligence.
```

Create `components/jarvis/landing/JarvisLandingPage.tsx` with public copy from the approved spec and without authenticated shell chrome.

- [ ] **Step 6: Run route contract test**

Run:

```powershell
npx.cmd tsx scripts/__tests__/jarvisFrontendRouteContract.assert.ts
```

Expected: PASS with:

```text
OK: Jarvis frontend routes match the approved information architecture
```

- [ ] **Step 7: Commit Task 3**

Run:

```powershell
git -C C:\Users\justi\Documents\Codex\2026-05-05\files-mentioned-by-the-user-jarvis-os\github-push\jarvis-os add 'app/(tabs)/_layout.tsx' app/devices.tsx app/automations.tsx app/approvals.tsx app/activity.tsx app/brain-settings.tsx app/landing.tsx components/jarvis/devices/DevicesScreen.tsx components/jarvis/automations/AutomationsScreen.tsx components/jarvis/approvals/ApprovalsScreen.tsx components/jarvis/activity/ActivityScreen.tsx components/jarvis/brain/BrainSettingsScreen.tsx components/jarvis/landing/JarvisLandingPage.tsx scripts/__tests__/jarvisFrontendRouteContract.assert.ts
git -C C:\Users\justi\Documents\Codex\2026-05-05\files-mentioned-by-the-user-jarvis-os\github-push\jarvis-os commit -m "Wire Jarvis personal operating layer routes"
```

## Task 4: Home Command Center

**Files:**
- Create: `components/jarvis/home/HomeCommandCenter.tsx`
- Modify: `app/(tabs)/index.tsx`
- Create: `scripts/__tests__/jarvisHomeCommandCenter.assert.ts`

- [ ] **Step 1: Write the failing Home source test**

Create `scripts/__tests__/jarvisHomeCommandCenter.assert.ts`:

```ts
import assert from "node:assert/strict";
import fs from "node:fs";

const home = fs.readFileSync("components/jarvis/home/HomeCommandCenter.tsx", "utf8");
const route = fs.readFileSync("app/(tabs)/index.tsx", "utf8");

assert.match(home, /What should I handle next\?/);
assert.match(home, /Continue Jarvis Build/);
assert.match(home, /Review Notifications/);
assert.match(home, /Draft Business Update/);
assert.match(home, /Plan Today/);
assert.match(home, /JarvisCommandInput/);
assert.match(home, /JarvisActionCard/);
assert.match(route, /HomeCommandCenter/);
assert.equal(home.includes("Message Jarvis"), false);
assert.equal(home.includes("Mission Control"), false);

console.log("OK: Home command center uses approved Jarvis command UX");
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
npx.cmd tsx scripts/__tests__/jarvisHomeCommandCenter.assert.ts
```

Expected: FAIL because `HomeCommandCenter.tsx` does not exist.

- [ ] **Step 3: Build the Home command center**

Create `components/jarvis/home/HomeCommandCenter.tsx`:

```tsx
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import JarvisAppShell from "@/components/jarvis/JarvisAppShell";
import { JarvisActionCard, JarvisInfoCard } from "@/components/jarvis/JarvisCards";
import { JarvisCommandInput } from "@/components/jarvis/JarvisCommandInput";
import { JarvisPage } from "@/components/jarvis/JarvisPage";
import Colors from "@/constants/colors";
import { JARVIS_HOME_HEADER, JARVIS_SUGGESTED_ACTIONS } from "@/constants/jarvisProduct";

export default function HomeCommandCenter() {
  return (
    <JarvisAppShell>
      <JarvisPage
        eyebrow={JARVIS_HOME_HEADER.eyebrow}
        title={JARVIS_HOME_HEADER.title}
        subtitle={JARVIS_HOME_HEADER.subtitle}
      >
        <View style={styles.commandBlock}>
          <Text style={styles.prompt}>What should I handle next?</Text>
          <JarvisCommandInput />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Suggested Actions</Text>
          <View style={styles.actionGrid}>
            {JARVIS_SUGGESTED_ACTIONS.map((action) => (
              <JarvisActionCard
                key={action.title}
                title={action.title}
                description={action.description}
                icon={action.icon as never}
              />
            ))}
          </View>
        </View>

        <JarvisInfoCard title="Activity Timeline">
          <Text style={styles.timelineText}>Jarvis saw - thought - asked - acted</Text>
          <Text style={styles.timelineDetail}>Recent work and approval history will appear here as Jarvis handles missions.</Text>
        </JarvisInfoCard>
      </JarvisPage>
    </JarvisAppShell>
  );
}

const styles = StyleSheet.create({
  commandBlock: {
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    padding: 16,
  },
  prompt: {
    color: Colors.text,
    fontSize: 18,
    fontFamily: "Inter_700Bold",
  },
  section: { gap: 12 },
  sectionTitle: {
    color: Colors.text,
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
  actionGrid: {
    gap: 10,
  },
  timelineText: {
    color: Colors.text,
    fontSize: 13,
    fontFamily: "Inter_700Bold",
  },
  timelineDetail: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "Inter_400Regular",
  },
});
```

- [ ] **Step 4: Replace the Home route**

Replace `app/(tabs)/index.tsx` with:

```tsx
import HomeCommandCenter from "@/components/jarvis/home/HomeCommandCenter";

export default HomeCommandCenter;
```

The previous mission-control tabbed experience remains available through the components it used; it is no longer the default Home route.

- [ ] **Step 5: Run Home test**

Run:

```powershell
npx.cmd tsx scripts/__tests__/jarvisHomeCommandCenter.assert.ts
```

Expected: PASS with:

```text
OK: Home command center uses approved Jarvis command UX
```

- [ ] **Step 6: Commit Task 4**

Run:

```powershell
git -C C:\Users\justi\Documents\Codex\2026-05-05\files-mentioned-by-the-user-jarvis-os\github-push\jarvis-os add components/jarvis/home/HomeCommandCenter.tsx 'app/(tabs)/index.tsx' scripts/__tests__/jarvisHomeCommandCenter.assert.ts
git -C C:\Users\justi\Documents\Codex\2026-05-05\files-mentioned-by-the-user-jarvis-os\github-push\jarvis-os commit -m "Redesign Home as Jarvis command center"
```

## Task 5: Missions And Memory Screens

**Files:**
- Create: `components/jarvis/missions/MissionsScreen.tsx`
- Create: `components/jarvis/memory/JarvisMemoryScreen.tsx`
- Modify: `app/(tabs)/goals.tsx`
- Modify: `app/(tabs)/profile.tsx`
- Create: `scripts/__tests__/jarvisMissionsMemory.assert.ts`

- [ ] **Step 1: Write the failing Missions and Memory test**

Create `scripts/__tests__/jarvisMissionsMemory.assert.ts`:

```ts
import assert from "node:assert/strict";
import fs from "node:fs";

const missions = fs.readFileSync("components/jarvis/missions/MissionsScreen.tsx", "utf8");
const memory = fs.readFileSync("components/jarvis/memory/JarvisMemoryScreen.tsx", "utf8");
const goalsRoute = fs.readFileSync("app/(tabs)/goals.tsx", "utf8");
const profileRoute = fs.readFileSync("app/(tabs)/profile.tsx", "utf8");

for (const text of ["Long-running goals Jarvis is helping you move forward.", "Next Best Move", "Ask Jarvis for Next Move", "Let Jarvis Monitor This"]) {
  assert.match(missions, new RegExp(text));
}
for (const text of ["What Jarvis knows about you", "Identity", "People", "Projects", "Preferences", "Rules", "Learned Patterns", "Forget This", "Ask Before Using"]) {
  assert.match(memory, new RegExp(text));
}
assert.match(goalsRoute, /MissionsScreen/);
assert.match(profileRoute, /JarvisMemoryScreen/);

console.log("OK: Missions and Memory screens use approved Jarvis IA and trust copy");
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
npx.cmd tsx scripts/__tests__/jarvisMissionsMemory.assert.ts
```

Expected: FAIL until both screens and route wrappers are updated.

- [ ] **Step 3: Build Missions screen**

Create `components/jarvis/missions/MissionsScreen.tsx`:

```tsx
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import JarvisAppShell from "@/components/jarvis/JarvisAppShell";
import { JarvisInfoCard } from "@/components/jarvis/JarvisCards";
import { JarvisPage } from "@/components/jarvis/JarvisPage";
import Colors from "@/constants/colors";
import { defaultMissions } from "@/lib/jarvisCommandCenter";

export default function MissionsScreen() {
  return (
    <JarvisAppShell>
      <JarvisPage
        eyebrow="Missions"
        title="Long-running goals Jarvis is helping you move forward."
        subtitle="A mission is more than a task. It is something Jarvis can help monitor, plan, and move."
      >
        <View style={styles.grid}>
          {defaultMissions.map((mission) => (
            <JarvisInfoCard key={mission.id} title={mission.name}>
              <Text style={styles.meta}>Status: {mission.status}</Text>
              <Text style={styles.meta}>Last Activity: {mission.lastActivity}</Text>
              <Text style={styles.label}>Next Best Move</Text>
              <Text style={styles.body}>{mission.nextBestMove}</Text>
              <Text style={styles.meta}>Connected Files: {mission.connectedFiles}</Text>
              <Text style={styles.meta}>Connected Devices: {mission.connectedDevices}</Text>
              <Text style={styles.meta}>Automations: {mission.automations}</Text>
              <View style={styles.actions}>
                {["Start Mission", "Add Context", "Ask Jarvis for Next Move", "Let Jarvis Monitor This"].map((action) => (
                  <Text key={action} style={styles.action}>{action}</Text>
                ))}
              </View>
            </JarvisInfoCard>
          ))}
        </View>
      </JarvisPage>
    </JarvisAppShell>
  );
}

const styles = StyleSheet.create({
  grid: { gap: 12 },
  label: { color: Colors.text, fontSize: 12, fontFamily: "Inter_700Bold", marginTop: 4 },
  body: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular" },
  meta: { color: Colors.textSecondary, fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  action: { color: Colors.primary, fontSize: 12, fontFamily: "Inter_700Bold" },
});
```

- [ ] **Step 4: Build Memory screen**

Create `components/jarvis/memory/JarvisMemoryScreen.tsx`:

```tsx
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import JarvisAppShell from "@/components/jarvis/JarvisAppShell";
import { JarvisInfoCard } from "@/components/jarvis/JarvisCards";
import { JarvisPage } from "@/components/jarvis/JarvisPage";
import Colors from "@/constants/colors";

const memorySections = [
  ["Identity", "Who you are, what matters, and how you operate."],
  ["People", "Important people, relationships, tone preferences, and boundaries."],
  ["Projects", "Your active work, goals, files, and context."],
  ["Preferences", "How you like Jarvis to write, decide, remind, and act."],
  ["Rules", "Hard boundaries Jarvis must follow."],
  ["Learned Patterns", "Habits Jarvis has noticed and can use with approval."],
];

const memoryCards = [
  ["Writing Style", "Justin prefers direct, confident language with minimal corporate fluff."],
  ["Action Boundary", "Ask before sending messages, making purchases, deleting files, or changing calendar events."],
  ["Project Priority", "Jarvis AI and Battles Budz are high-priority active projects."],
  ["Work Pattern", "Justin often works late and prefers summaries before deep execution."],
];

export default function JarvisMemoryScreen() {
  return (
    <JarvisAppShell>
      <JarvisPage
        eyebrow="Memory"
        title="What Jarvis knows about you, your work, and how you like things done."
        subtitle="Review, edit, pin, and limit what Jarvis can use."
      >
        <View style={styles.sectionGrid}>
          {memorySections.map(([title, body]) => (
            <JarvisInfoCard key={title} title={title}>
              <Text style={styles.body}>{body}</Text>
            </JarvisInfoCard>
          ))}
        </View>
        <View style={styles.cardGrid}>
          {memoryCards.map(([title, body]) => (
            <JarvisInfoCard key={title} title={title}>
              <Text style={styles.body}>{body}</Text>
              <Text style={styles.actions}>Edit Memory   Forget This   Pin Memory   Use More Often   Ask Before Using</Text>
            </JarvisInfoCard>
          ))}
        </View>
      </JarvisPage>
    </JarvisAppShell>
  );
}

const styles = StyleSheet.create({
  sectionGrid: { gap: 10 },
  cardGrid: { gap: 10 },
  body: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular" },
  actions: { color: Colors.primary, fontSize: 12, lineHeight: 18, fontFamily: "Inter_700Bold" },
});
```

- [ ] **Step 5: Replace route wrappers**

Replace `app/(tabs)/goals.tsx` with:

```tsx
import MissionsScreen from "@/components/jarvis/missions/MissionsScreen";

export default MissionsScreen;
```

Replace `app/(tabs)/profile.tsx` with:

```tsx
import JarvisMemoryScreen from "@/components/jarvis/memory/JarvisMemoryScreen";

export default JarvisMemoryScreen;
```

- [ ] **Step 6: Run Missions and Memory test**

Run:

```powershell
npx.cmd tsx scripts/__tests__/jarvisMissionsMemory.assert.ts
```

Expected: PASS with:

```text
OK: Missions and Memory screens use approved Jarvis IA and trust copy
```

- [ ] **Step 7: Commit Task 5**

Run:

```powershell
git -C C:\Users\justi\Documents\Codex\2026-05-05\files-mentioned-by-the-user-jarvis-os\github-push\jarvis-os add components/jarvis/missions/MissionsScreen.tsx components/jarvis/memory/JarvisMemoryScreen.tsx 'app/(tabs)/goals.tsx' 'app/(tabs)/profile.tsx' scripts/__tests__/jarvisMissionsMemory.assert.ts
git -C C:\Users\justi\Documents\Codex\2026-05-05\files-mentioned-by-the-user-jarvis-os\github-push\jarvis-os commit -m "Add Jarvis Missions and Memory screens"
```

## Task 6: Devices, Automations, Skills, And Approvals

**Files:**
- Modify: `components/jarvis/devices/DevicesScreen.tsx`
- Modify: `components/jarvis/automations/AutomationsScreen.tsx`
- Modify: `components/jarvis/skills/SkillsScreen.tsx`
- Modify: `components/jarvis/approvals/ApprovalsScreen.tsx`
- Modify: `app/skills.tsx`
- Create: `scripts/__tests__/jarvisTrustSurfaces.assert.ts`

- [ ] **Step 1: Write the failing trust surfaces test**

Create `scripts/__tests__/jarvisTrustSurfaces.assert.ts`:

```ts
import assert from "node:assert/strict";
import fs from "node:fs";

const devices = fs.readFileSync("components/jarvis/devices/DevicesScreen.tsx", "utf8");
const automations = fs.readFileSync("components/jarvis/automations/AutomationsScreen.tsx", "utf8");
const skills = fs.readFileSync("components/jarvis/skills/SkillsScreen.tsx", "utf8");
const approvals = fs.readFileSync("components/jarvis/approvals/ApprovalsScreen.tsx", "utf8");
const skillsRoute = fs.readFileSync("app/skills.tsx", "utf8");

for (const text of ["Can See", "Can Suggest", "Can Act", "Needs Approval", "Blocked", "Financial apps"]) {
  assert.match(devices, new RegExp(text));
}
assert.match(automations, /Jarvis will never send, purchase, delete, or commit changes without your approval unless you explicitly allow it\./);
for (const text of ["Morning Briefing", "Notification Triage", "Investor Update Draft", "Calendar Guard"]) {
  assert.match(automations, new RegExp(text));
}
for (const text of ["Cannabis Business Ops", "Household Manager", "Developer Mode", "Research Assistant"]) {
  assert.match(skills, new RegExp(text));
}
for (const text of ["Approve & Send", "Edit First", "Deny", "Always Ask for Financial Apps"]) {
  assert.match(approvals, new RegExp(text));
}
assert.match(skillsRoute, /SkillsScreen/);

console.log("OK: Devices, Automations, Skills, and Approvals expose approved trust UX");
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
npx.cmd tsx scripts/__tests__/jarvisTrustSurfaces.assert.ts
```

Expected: FAIL until these screens include the required copy and route wiring.

- [ ] **Step 3: Build Devices screen content**

Replace the placeholder in `components/jarvis/devices/DevicesScreen.tsx` with cards for:

```text
Android Phone
Desktop
Browser
```

Each card must show:

```text
Connected or Not Connected
Can See
Can Suggest
Can Act
Needs Approval
Blocked
```

The Android card must include:

```text
See notifications: On
Read screen text: On
Tap and swipe: Ask first
Type messages: Ask first
Send messages: Always ask
Make purchases: Blocked
Delete content: Blocked
Financial apps: Always ask
```

- [ ] **Step 4: Build Automations screen content**

Replace the placeholder in `components/jarvis/automations/AutomationsScreen.tsx` with:

1. Required safety copy from `JARVIS_APPROVAL_SAFETY_COPY`.
2. Cards for Morning Briefing, Notification Triage, Investor Update Draft, Grocery Builder, and Calendar Guard.
3. Actions: Turn On, Preview, Edit Rules, Require Approval, Pause.

- [ ] **Step 5: Build Skills screen content and route**

Create `components/jarvis/skills/SkillsScreen.tsx` with skill pack cards:

```text
Cannabis Business Ops
Household Manager
Developer Mode
Business Operator
Research Assistant
```

Each card must show actions:

```text
Install Skill
Update Skill
View Sources
Limit Access
Remove Skill
```

Replace `app/skills.tsx` with:

```tsx
import SkillsScreen from "@/components/jarvis/skills/SkillsScreen";

export default SkillsScreen;
```

- [ ] **Step 6: Build Approvals screen content**

Replace the placeholder in `components/jarvis/approvals/ApprovalsScreen.tsx` with approval cards for:

```text
Jarvis wants to send a message
Jarvis wants to open your banking app
Jarvis wants to move 14 files into a project folder
```

Each card must show:

```text
Reason
Risk
Actions
```

Use `RiskBadge` from `JarvisCards.tsx`.

- [ ] **Step 7: Run trust surfaces test**

Run:

```powershell
npx.cmd tsx scripts/__tests__/jarvisTrustSurfaces.assert.ts
```

Expected: PASS with:

```text
OK: Devices, Automations, Skills, and Approvals expose approved trust UX
```

- [ ] **Step 8: Commit Task 6**

Run:

```powershell
git -C C:\Users\justi\Documents\Codex\2026-05-05\files-mentioned-by-the-user-jarvis-os\github-push\jarvis-os add components/jarvis/devices/DevicesScreen.tsx components/jarvis/automations/AutomationsScreen.tsx components/jarvis/skills/SkillsScreen.tsx components/jarvis/approvals/ApprovalsScreen.tsx app/skills.tsx scripts/__tests__/jarvisTrustSurfaces.assert.ts
git -C C:\Users\justi\Documents\Codex\2026-05-05\files-mentioned-by-the-user-jarvis-os\github-push\jarvis-os commit -m "Add Jarvis trust and capability surfaces"
```

## Task 7: Activity, Settings, And Brain Settings

**Files:**
- Modify: `components/jarvis/activity/ActivityScreen.tsx`
- Modify: `components/jarvis/settings/JarvisSettingsScreen.tsx`
- Modify: `components/jarvis/brain/BrainSettingsScreen.tsx`
- Modify: `app/(tabs)/settings.tsx`
- Create: `scripts/__tests__/jarvisActivitySettings.assert.ts`

- [ ] **Step 1: Write the failing Activity and Settings test**

Create `scripts/__tests__/jarvisActivitySettings.assert.ts`:

```ts
import assert from "node:assert/strict";
import fs from "node:fs";

const activity = fs.readFileSync("components/jarvis/activity/ActivityScreen.tsx", "utf8");
const settings = fs.readFileSync("components/jarvis/settings/JarvisSettingsScreen.tsx", "utf8");
const brain = fs.readFileSync("components/jarvis/brain/BrainSettingsScreen.tsx", "utf8");
const settingsRoute = fs.readFileSync("app/(tabs)/settings.tsx", "utf8");

for (const text of ["what Jarvis saw, suggested, and did", "View Decision Summary", "Undo", "Never Do This Again"]) {
  assert.match(activity, new RegExp(text));
}
for (const text of ["Privacy", "Memory", "Devices", "Approvals", "Models", "Voice", "Notifications", "Developer Mode", "Billing"]) {
  assert.match(settings, new RegExp(text));
}
for (const text of ["Local Brain", "Cloud Brain", "Hosted Open Brain", "Private", "Balanced", "Maximum"]) {
  assert.match(brain, new RegExp(text));
}
assert.match(settingsRoute, /JarvisSettingsScreen/);

console.log("OK: Activity, Settings, and Brain Settings match approved Jarvis IA");
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
npx.cmd tsx scripts/__tests__/jarvisActivitySettings.assert.ts
```

Expected: FAIL until the three screens and settings route are updated.

- [ ] **Step 3: Build Activity screen**

Update `components/jarvis/activity/ActivityScreen.tsx` with timeline examples:

```text
Saw notification from Andrea. Suggested reply. Waiting for approval.
Summarized 12 notifications. Ignored 9 low-priority items. Flagged 3 as important.
Opened Jarvis repo. Read current notes file. Suggested next implementation step.
```

Each event card must expose:

```text
What happened
Why Jarvis did it
What data was used
Whether approval was required
Whether it changed anything
```

Actions:

```text
View Decision Summary
Undo
Mark Helpful
Never Do This Again
```

- [ ] **Step 4: Build Settings screen**

Create `components/jarvis/settings/JarvisSettingsScreen.tsx` with settings groups:

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

Each group should have one sentence describing the behavior it controls and a `Manage` action.

Replace `app/(tabs)/settings.tsx` with:

```tsx
import JarvisSettingsScreen from "@/components/jarvis/settings/JarvisSettingsScreen";

export default JarvisSettingsScreen;
```

- [ ] **Step 5: Build Brain Settings screen**

Update `components/jarvis/brain/BrainSettingsScreen.tsx` with:

```text
Brain Settings
Choose how Jarvis thinks, acts, and balances privacy with intelligence.
```

Brain type cards:

```text
Local Brain
Fast, private, on-device. Best for short commands and device control.

Cloud Brain
More powerful reasoning for complex tasks, research, and planning.

Hosted Open Brain
Lower-cost intelligence for free-tier tasks and background work.
```

Mode selector cards:

```text
Private
Use local models whenever possible.

Balanced
Use local models for simple actions and cloud models for harder thinking.

Maximum
Use the strongest available model for best quality.
```

- [ ] **Step 6: Run Activity and Settings test**

Run:

```powershell
npx.cmd tsx scripts/__tests__/jarvisActivitySettings.assert.ts
```

Expected: PASS with:

```text
OK: Activity, Settings, and Brain Settings match approved Jarvis IA
```

- [ ] **Step 7: Commit Task 7**

Run:

```powershell
git -C C:\Users\justi\Documents\Codex\2026-05-05\files-mentioned-by-the-user-jarvis-os\github-push\jarvis-os add components/jarvis/activity/ActivityScreen.tsx components/jarvis/settings/JarvisSettingsScreen.tsx components/jarvis/brain/BrainSettingsScreen.tsx 'app/(tabs)/settings.tsx' scripts/__tests__/jarvisActivitySettings.assert.ts
git -C C:\Users\justi\Documents\Codex\2026-05-05\files-mentioned-by-the-user-jarvis-os\github-push\jarvis-os commit -m "Add Jarvis Activity Settings and Brain Settings"
```

## Task 8: First-Run Onboarding And Public Landing

**Files:**
- Modify: `components/jarvis/onboarding/JarvisOnboardingScreen.tsx`
- Modify: `components/jarvis/landing/JarvisLandingPage.tsx`
- Modify: `app/onboarding.tsx`
- Create: `scripts/__tests__/jarvisOnboardingLanding.assert.ts`

- [ ] **Step 1: Write the failing onboarding and landing test**

Create `scripts/__tests__/jarvisOnboardingLanding.assert.ts`:

```ts
import assert from "node:assert/strict";
import fs from "node:fs";

const onboarding = fs.readFileSync("components/jarvis/onboarding/JarvisOnboardingScreen.tsx", "utf8");
const landing = fs.readFileSync("components/jarvis/landing/JarvisLandingPage.tsx", "utf8");
const onboardingRoute = fs.readFileSync("app/onboarding.tsx", "utf8");

for (const text of ["Meet Jarvis", "Choose How Jarvis Thinks", "Connect Your Devices", "Set Your Boundaries", "Give Jarvis Its First Mission", "Launch Command Center"]) {
  assert.match(onboarding, new RegExp(text));
}
for (const text of ["Jarvis is your personal operating layer.", "What Jarvis Does", "Local Brain", "Cloud Brain", "You stay in control.", "Open Command Center"]) {
  assert.match(landing, new RegExp(text));
}
assert.match(onboardingRoute, /JarvisOnboardingScreen/);

console.log("OK: Onboarding and landing use approved Jarvis product story");
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
npx.cmd tsx scripts/__tests__/jarvisOnboardingLanding.assert.ts
```

Expected: FAIL until onboarding and landing are replaced.

- [ ] **Step 3: Build onboarding**

Replace the current coaching-style onboarding with `components/jarvis/onboarding/JarvisOnboardingScreen.tsx`.

Required steps:

```text
Meet Jarvis
Choose How Jarvis Thinks
Connect Your Devices
Set Your Boundaries
Give Jarvis Its First Mission
```

Required final behavior:

```ts
await setOnboardingComplete();
router.replace("/(tabs)");
```

Do not remove existing local storage helpers. Reuse `setOnboardingComplete` from `@/lib/storage`.

Replace `app/onboarding.tsx` with:

```tsx
import JarvisOnboardingScreen from "@/components/jarvis/onboarding/JarvisOnboardingScreen";

export default JarvisOnboardingScreen;
```

- [ ] **Step 4: Build landing**

Update `components/jarvis/landing/JarvisLandingPage.tsx` with sections:

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

Hero:

```text
Jarvis is your personal operating layer.
It sees what you allow, remembers what matters, and helps you act across your devices.
Open Command Center
See How It Works
```

Trust copy:

```text
You stay in control.
Jarvis can suggest actions automatically, but sensitive actions require approval.
Before Jarvis sends, buys, deletes, posts, or changes something important, you see exactly what it plans to do.
```

- [ ] **Step 5: Run onboarding and landing test**

Run:

```powershell
npx.cmd tsx scripts/__tests__/jarvisOnboardingLanding.assert.ts
```

Expected: PASS with:

```text
OK: Onboarding and landing use approved Jarvis product story
```

- [ ] **Step 6: Commit Task 8**

Run:

```powershell
git -C C:\Users\justi\Documents\Codex\2026-05-05\files-mentioned-by-the-user-jarvis-os\github-push\jarvis-os add components/jarvis/onboarding/JarvisOnboardingScreen.tsx components/jarvis/landing/JarvisLandingPage.tsx app/onboarding.tsx scripts/__tests__/jarvisOnboardingLanding.assert.ts
git -C C:\Users\justi\Documents\Codex\2026-05-05\files-mentioned-by-the-user-jarvis-os\github-push\jarvis-os commit -m "Add Jarvis onboarding and landing story"
```

## Task 9: Verification, Visual QA, And Operations Notes

**Files:**
- Create: `docs/operations/jarvis-frontend-redesign-qa.md`
- Modify: `package.json` only if adding explicit test scripts is still useful after Task 1 through Task 8.

- [ ] **Step 1: Run all source-level frontend contract checks**

Run:

```powershell
npx.cmd tsx scripts/__tests__/jarvisFrontendProductContract.assert.ts
npx.cmd tsx scripts/__tests__/jarvisShellSource.assert.ts
npx.cmd tsx scripts/__tests__/jarvisFrontendRouteContract.assert.ts
npx.cmd tsx scripts/__tests__/jarvisHomeCommandCenter.assert.ts
npx.cmd tsx scripts/__tests__/jarvisMissionsMemory.assert.ts
npx.cmd tsx scripts/__tests__/jarvisTrustSurfaces.assert.ts
npx.cmd tsx scripts/__tests__/jarvisActivitySettings.assert.ts
npx.cmd tsx scripts/__tests__/jarvisOnboardingLanding.assert.ts
```

Expected: every command prints its `OK:` line and exits 0.

- [ ] **Step 2: Run repo tests**

Run:

```powershell
npm.cmd test
```

Expected: existing agent/source tests pass. If unrelated backend memory tests fail because of pre-existing dirty work, capture the exact failing test names and do not change unrelated backend files in this frontend pass.

- [ ] **Step 3: Run server build**

Run:

```powershell
npm.cmd run server:build
```

Expected: build exits 0.

- [ ] **Step 4: Start Expo web for visual verification**

Run:

```powershell
$env:CI='1'; npx.cmd expo start --web --port 19006 --clear
```

Expected: Expo starts on:

```text
http://localhost:19006
```

Keep the process running for screenshots.

- [ ] **Step 5: Capture desktop and mobile screenshots**

Run:

```powershell
npx.cmd playwright screenshot http://localhost:19006 C:\tmp\jarvis-home-desktop.png --viewport-size=1440,1000
npx.cmd playwright screenshot http://localhost:19006 C:\tmp\jarvis-home-mobile.png --viewport-size=390,844
```

Expected:

1. Desktop screenshot shows top status bar, left sidebar, Home command center, and right context panel.
2. Mobile screenshot shows compact top status, command center content, and reachable navigation.
3. Text does not overlap.
4. The page does not read as a chat clone.
5. The default visible UI does not show the avoided technical terms as headings or primary labels.

- [ ] **Step 6: Write QA notes**

Create `docs/operations/jarvis-frontend-redesign-qa.md`:

```md
# Jarvis Frontend Redesign QA

Date: 2026-06-05

## Contract Checks

- `jarvisFrontendProductContract.assert.ts`: pass
- `jarvisShellSource.assert.ts`: pass
- `jarvisFrontendRouteContract.assert.ts`: pass
- `jarvisHomeCommandCenter.assert.ts`: pass
- `jarvisMissionsMemory.assert.ts`: pass
- `jarvisTrustSurfaces.assert.ts`: pass
- `jarvisActivitySettings.assert.ts`: pass
- `jarvisOnboardingLanding.assert.ts`: pass

## Build Checks

- `npm.cmd test`: pass
- `npm.cmd run server:build`: pass

## Visual Checks

- Desktop home screenshot: `C:\tmp\jarvis-home-desktop.png`
- Mobile home screenshot: `C:\tmp\jarvis-home-mobile.png`

## Notes

- Desktop shows the three-zone command center.
- Mobile preserves state, command, context, and approval access.
- Default UI uses Jarvis consumer language.
- Technical terms are limited to Developer Mode or technical documentation.
- Approval-first safety copy is visible on Automations and Approvals.
```

- [ ] **Step 7: Commit Task 9**

Run:

```powershell
git -C C:\Users\justi\Documents\Codex\2026-05-05\files-mentioned-by-the-user-jarvis-os\github-push\jarvis-os add docs/operations/jarvis-frontend-redesign-qa.md
git -C C:\Users\justi\Documents\Codex\2026-05-05\files-mentioned-by-the-user-jarvis-os\github-push\jarvis-os commit -m "Document Jarvis frontend redesign QA"
```

## Final Verification Checklist

Before calling the redesign complete:

- [ ] `npx.cmd tsx scripts/__tests__/jarvisFrontendProductContract.assert.ts`
- [ ] `npx.cmd tsx scripts/__tests__/jarvisShellSource.assert.ts`
- [ ] `npx.cmd tsx scripts/__tests__/jarvisFrontendRouteContract.assert.ts`
- [ ] `npx.cmd tsx scripts/__tests__/jarvisHomeCommandCenter.assert.ts`
- [ ] `npx.cmd tsx scripts/__tests__/jarvisMissionsMemory.assert.ts`
- [ ] `npx.cmd tsx scripts/__tests__/jarvisTrustSurfaces.assert.ts`
- [ ] `npx.cmd tsx scripts/__tests__/jarvisActivitySettings.assert.ts`
- [ ] `npx.cmd tsx scripts/__tests__/jarvisOnboardingLanding.assert.ts`
- [ ] `npm.cmd test`
- [ ] `npm.cmd run server:build`
- [ ] Desktop screenshot at 1440x1000
- [ ] Mobile screenshot at 390x844
- [ ] `git status -sb` checked for unrelated unstaged work

## Acceptance Criteria Mapping

| Approved Spec Requirement | Plan Coverage |
| --- | --- |
| Jarvis is a personal operating layer, not a chat clone | Tasks 1, 2, 4, 9 |
| Three-zone command center | Tasks 2, 4, 9 |
| Plain-language navigation | Tasks 1, 3 |
| Right context panel | Tasks 2, 4 |
| Home suggested actions and command input | Task 4 |
| Missions as long-running goals | Task 5 |
| Editable and inspectable Memory | Task 5 |
| Devices and permissions in plain language | Task 6 |
| Automations with explicit safety copy | Task 6 |
| Skill packs | Task 6 |
| Polished Approvals | Task 6 |
| Activity with decision summaries | Task 7 |
| Settings grouped by trust and behavior | Task 7 |
| Brain Settings in normal language | Task 7 |
| First-run onboarding | Task 8 |
| Public landing page | Task 8 |
| Mobile retains trust model | Task 9 |
| Technical terms absent from default UI | Tasks 1, 3, 9 |
