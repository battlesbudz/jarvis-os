/**
 * App Project Runner — orchestrates standalone app build projects.
 *
 * This module extends the project runner concept specifically for building
 * SEPARATE applications (not Jarvis itself). Each project gets an isolated
 * workspace directory, runs npm/npx commands through projectShellTool, and
 * uses browser tools to visually verify the app during the TEST_UI phase.
 *
 * Phases: SCAFFOLD → IMPLEMENT_BACKEND → IMPLEMENT_FRONTEND → INTEGRATE → TEST_UI → PACKAGE
 */

import * as path from "path";
import * as fs from "fs";
import { spawnSync } from "child_process";
import * as os from "os";
import { db } from "../db";
import { eq, asc } from "drizzle-orm";
import * as schema from "@shared/schema";
import type { ProjectPlanStep } from "@shared/schema";
import { runAgent } from "./harness";
import { verifyJobOutput } from "./orchestrator";
import { filterToolsByGroups, type ToolGroup } from "./tools/index";
import { getValidGoogleTokens } from "../userTokenStore";
import { submitAgentJob } from "./jobClient";
import { getChannel } from "../channels/registry";
import { stopProjectServer } from "./tools/projectShellTool";
import { getAndClearAppProjectScreenshotCount } from "./tools/browserTools";
import { sendToDiscordUser } from "../discord/manager";

export type AppFramework = "nextjs" | "react-vite" | "node-express" | "custom";

const AUTONOMOUS_INTERVAL_MINUTES = 30;
const STEPS_PER_SESSION = 2;
const MAX_STEP_VERIFY_RETRIES = 2;
const MAX_CONSECUTIVE_ERRORS = 3;

// ── Phase → tool groups ────────────────────────────────────────────────────────

function appToolGroupsForPhase(phase: string): ToolGroup[] {
  const p = phase.toUpperCase();
  if (p === "SCAFFOLD") return ["app_build", "research"];
  if (p.startsWith("IMPLEMENT")) return ["app_build", "self_edit", "research", "memory"];
  if (p === "INTEGRATE") return ["app_build", "research"];
  if (p === "TEST_UI") return ["app_build", "browser", "research"];
  if (p === "PACKAGE") return ["app_build"];
  return ["app_build", "research"];
}

// ── Deterministic phase verification ───────────────────────────────────────────

/**
 * Run deterministic (tool-based, not LLM-based) checks after the agent completes a step.
 * Returns a failure reason string if the step should be retried, or null if it passed.
 *
 * IMPLEMENT_* phases: runs `npx tsc --noEmit --skipLibCheck` when a tsconfig.json
 *   exists. A non-zero exit means the step needs correction.
 *
 * TEST_UI phase: prefers a real browser_screenshot (via side-effect counter). If the
 *   hosted browser cannot launch in the container, fall back to command-based app
 *   validation so the project does not get permanently stuck before packaging.
 */
async function runDeterministicVerification(
  phase: string,
  workspaceDir: string,
  reply: string,
  projectId?: string,
): Promise<string | null> {
  const p = phase.toUpperCase();

  if (p.startsWith("IMPLEMENT") || p === "INTEGRATE") {
    const tsconfigPath = path.join(workspaceDir, "tsconfig.json");
    if (!fs.existsSync(tsconfigPath)) return null;

    const result = spawnSync("npx", ["tsc", "--noEmit", "--skipLibCheck"], {
      cwd: workspaceDir,
      env: { ...process.env, HOME: os.homedir() },
      encoding: "utf8",
      timeout: 120_000,
    });

    if (result.status !== 0) {
      const errors = (result.stdout ?? "").slice(0, 800) + (result.stderr ?? "").slice(0, 400);
      return `TypeScript type-check failed (npx tsc --noEmit --skipLibCheck). Fix all TS errors before this step can be accepted.\n${errors}`;
    }
    return null;
  }

  if (p === "TEST_UI") {
    const screenshotCount = projectId ? getAndClearAppProjectScreenshotCount(projectId) : 0;
    if (screenshotCount === 0) {
      const packagePath = path.join(workspaceDir, "package.json");
      if (!fs.existsSync(packagePath)) return null;
      try {
        const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8")) as { scripts?: Record<string, string> };
        if (pkg.scripts?.build) {
          const result = spawnSync("npm", ["run", "build"], {
            cwd: workspaceDir,
            env: { ...process.env, HOME: os.homedir() },
            encoding: "utf8",
            timeout: 180_000,
          });
          if (result.status !== 0) {
            const errors = (result.stdout ?? "").slice(0, 1000) + (result.stderr ?? "").slice(0, 600);
            return `TEST_UI fallback build failed (npm run build). Fix the app before packaging.\n${errors}`;
          }
        }
      } catch (err) {
        return `TEST_UI fallback validation failed: ${err instanceof Error ? err.message : String(err)}`;
      }
      return null;
    }

    const replyLower = reply.toLowerCase();
    const errorPatterns = [
      "err_connection_refused",
      "connection refused",
      "econnrefused",
      "this site can't be reached",
      "this page can't be displayed",
      "unable to connect",
      "net::err_",
      "failed to navigate",
    ];
    for (const pat of errorPatterns) {
      if (replyLower.includes(pat)) {
        return `TEST_UI screenshot shows a browser error (\"${pat}\"). Make sure the dev server is running on the correct port before taking a screenshot.`;
      }
    }

    return null;
  }

  return null;
}

// ── Planning prompt ────────────────────────────────────────────────────────────

function buildAppPlanningPrompt(
  title: string,
  description: string,
  goal: string,
  framework: AppFramework,
): string {
  return `You are Jarvis, building a STANDALONE application completely separate from yourself.
This app will live in its own directory with its own package.json, dependencies, and dev server.

Project: ${title}
Description: ${description || "(none provided)"}
Framework: ${framework}
Goal: ${goal}

Produce a phased build plan with 6-16 steps. Use exactly these phases:

SCAFFOLD — create the project (npx create-next-app, vite, express-generator, etc.)
IMPLEMENT_BACKEND — database, API routes, business logic
IMPLEMENT_FRONTEND — React components, pages, layouts, styling
INTEGRATE — wire frontend to backend, environment config
TEST_UI — start dev server, load in browser, screenshot, verify all flows
PACKAGE — build for production, zip the output

Each step must have specific acceptance_criteria. The TEST_UI phase must include at
least 3 browser interaction steps (navigate, interact, screenshot, verify).

Use project_shell to run all commands. The project workspace will be created automatically.
Do NOT use phases outside the 6 listed above.

Return JSON only:
{
  "plan": [
    {
      "step_id": "step_001",
      "label": "Scaffold Next.js project",
      "phase": "SCAFFOLD",
      "acceptance_criteria": "package.json exists, npm run dev starts successfully"
    },
    ...more steps...
  ],
  "questions": ["Any ambiguity 1"],
  "summary": "One paragraph overview of the plan"
}

Return ONLY the JSON object, nothing else.`;
}

// ── Step prompt ────────────────────────────────────────────────────────────────

function buildAppStepPrompt(
  project: schema.JarvisProject,
  step: ProjectPlanStep,
  sessionHistory: string,
  userAnswer?: string,
): string {
  const plan = asPlan(project.plan);
  const completedSteps = plan.filter((s) => s.status === "complete");
  const completedSummary = completedSteps.length > 0
    ? completedSteps.map((s) => `- ${s.label}: ${s.output?.slice(0, 200) || "completed"}`).join("\n")
    : "(none yet)";

  const devPort = project.devServerPort;
  const workspaceDir = project.workspaceDir ?? path.join(process.cwd(), "projects", project.id);
  const framework = project.appFramework ?? "custom";

  const answerContext = userAnswer
    ? `\n\n**User's answer to the previous question:**\n${userAnswer}\n\nUse this answer to guide this step.`
    : "";

  const testUiHint = step.phase.toUpperCase() === "TEST_UI"
    ? `\n\n**TEST_UI phase instructions:**
1. Start the dev server using project_shell with background=true: e.g. 'npm run dev'
2. The server URL will be returned (e.g. http://localhost:${devPort ?? 3001})
3. Use browser_navigate to load that URL
4. Take a screenshot with browser_screenshot
5. Use browser_snapshot to read the accessibility tree
6. Evaluate against acceptance criteria
7. If something is broken, fix it with project_shell, restart the server, and re-test
8. Repeat until the UI meets acceptance criteria`
    : "";

  return `You are Jarvis, building a STANDALONE application in its own isolated workspace.

**Project:** ${project.title}
**Framework:** ${framework}
**Workspace directory:** ${workspaceDir}
**Dev server port:** ${devPort ?? "(not yet assigned — will be assigned when you start the server)"}
**Goal:** ${project.goal}

CRITICAL: All code changes must go inside ${workspaceDir}.
Use project_shell to run commands. NEVER touch Jarvis's own source files.

**Session history:**
${sessionHistory || "(this is the first session)"}

**Previously completed steps:**
${completedSummary}${answerContext}${testUiHint}

**Current step to complete:**
Label: ${step.label}
Phase: ${step.phase}
Acceptance criteria: ${step.acceptance_criteria || "step completed successfully"}

Execute this step using your available tools. When using project_shell:
- All commands run in the workspace directory automatically
- Use npm, npx, node, git, zip, ls, cat, mkdir, cp, mv, rm, echo, curl
- For dev servers: set background=true

Produce a clear, detailed output that satisfies the acceptance criteria.
At the end, include:
## Step Output Summary
<one paragraph summary of what was accomplished>

If you need to ask the user a critical question before you can continue, respond with ONLY:
QUESTION: <your question here>

Otherwise, complete the step and show your work.`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function asPlan(raw: unknown): ProjectPlanStep[] {
  if (!Array.isArray(raw)) return [];
  return raw as ProjectPlanStep[];
}

async function sendAppProjectMessage(
  userId: string,
  originChannel: string | undefined,
  message: string,
): Promise<void> {
  try {
    const origin = (originChannel ?? "").toLowerCase();
    if (origin === "telegram") {
      const telegramCh = getChannel("telegram");
      if (telegramCh) await telegramCh.sendMessage(userId, message, {}).catch(() => {});
    } else if (origin.startsWith("discord")) {
      await sendToDiscordUser(userId, message).catch(() => {});
    }
    const inAppCh = getChannel("in_app");
    if (inAppCh) await inAppCh.sendMessage(userId, message, {}).catch(() => {});
  } catch (err) {
    console.error("[AppProjectRunner] sendAppProjectMessage failed:", err);
  }
}

async function sendAppProjectQuestion(
  userId: string,
  originChannel: string | undefined,
  message: string,
): Promise<Record<string, unknown>> {
  await sendAppProjectMessage(userId, originChannel, message);
  return {};
}

// ── Start app project ─────────────────────────────────────────────────────────

export async function startAppProject(input: {
  userId: string;
  title: string;
  description: string;
  goal: string;
  framework: AppFramework;
  originChannel?: string;
}): Promise<{ projectId: string }> {
  const workspaceDir = path.join(process.cwd(), "projects", "placeholder");

  const [project] = await db
    .insert(schema.jarvisProjects)
    .values({
      userId: input.userId,
      title: input.title,
      description: input.description,
      goal: input.goal,
      status: "planning",
      originChannel: input.originChannel,
      appFramework: input.framework,
      autonomousMode: true,
      updatedAt: new Date(),
    })
    .returning({ id: schema.jarvisProjects.id });

  const projectId = project.id;

  const realWorkspaceDir = path.join(process.cwd(), "projects", projectId);
  fs.mkdirSync(realWorkspaceDir, { recursive: true });

  await db
    .update(schema.jarvisProjects)
    .set({ workspaceDir: realWorkspaceDir, updatedAt: new Date() })
    .where(eq(schema.jarvisProjects.id, projectId));

  console.log(`[AppProjectRunner] startAppProject: created project ${projectId} for user ${input.userId} framework=${input.framework}`);

  await submitAgentJob({
    userId: input.userId,
    agentType: "app_project",
    title: `Plan app: ${input.title}`,
    prompt: `Run planning phase for app project ${projectId}`,
    input: { projectId, phase: "planning", originChannel: input.originChannel },
  });

  return { projectId };
}

// ── Run app project session ───────────────────────────────────────────────────

export async function runAppProjectSession(
  projectId: string,
  _sessionNumber: number,
  userAnswer?: string,
): Promise<{ status: string; stepsCompleted: number; summary: string }> {
  const startTime = Date.now();

  const [project] = await db
    .select()
    .from(schema.jarvisProjects)
    .where(eq(schema.jarvisProjects.id, projectId))
    .limit(1);

  if (!project) throw new Error(`App project ${projectId} not found`);

  if (project.status === "paused" || project.status === "complete" || project.status === "failed") {
    return { status: project.status, stepsCompleted: 0, summary: `Project is ${project.status}` };
  }

  const sessions = await db
    .select()
    .from(schema.jarvisProjectSessions)
    .where(eq(schema.jarvisProjectSessions.projectId, projectId))
    .orderBy(asc(schema.jarvisProjectSessions.sessionNumber));

  const sessionNumber = sessions.length + 1;
  const sessionHistory = sessions
    .slice(-3)
    .map((s) => `Session ${s.sessionNumber}: ${s.summary || "completed"}`)
    .join("\n");

  // ── Planning phase ──────────────────────────────────────────────────────────
  if (project.status === "planning") {
    return await runAppPlanningSession(project, sessionNumber, startTime);
  }

  // ── Question pending — re-notify ──────────────────────────────────────────
  if (project.status === "waiting_for_input" && project.questionPending && !userAnswer) {
    await sendAppProjectMessage(
      project.userId,
      project.originChannel ?? undefined,
      `⏳ **App Project: ${project.title}** is waiting for your answer:\n\n${project.questionPending}`,
    );
    if (project.autonomousMode) {
      const nextReminder = new Date(Date.now() + AUTONOMOUS_INTERVAL_MINUTES * 60 * 1000);
      await db
        .update(schema.jarvisProjects)
        .set({ nextRunAt: nextReminder, updatedAt: new Date() })
        .where(eq(schema.jarvisProjects.id, projectId));
    }
    return { status: "waiting_for_input", stepsCompleted: 0, summary: "Waiting for user input" };
  }

  // ── Building phase ─────────────────────────────────────────────────────────
  let currentPlan = asPlan(project.plan);
  const pendingSteps = currentPlan
    .map((s, i) => ({ ...s, _idx: i }))
    .filter((s) => s.status === "pending");

  if (pendingSteps.length === 0) {
    await markAppProjectComplete(project, sessions.length);
    return { status: "complete", stepsCompleted: 0, summary: "All steps complete!" };
  }

  const stepsToRun = pendingSteps.slice(0, STEPS_PER_SESSION);
  const completedLabels: string[] = [];
  let verificationRetriesTotal = 0;
  let sessionSummary = "";
  let remainingAnswer: string | undefined = userAnswer;

  const { getModel } = await import("../lib/modelPrefs");
  const orchModel = await getModel(project.userId, "orchestrator");

  for (const step of stepsToRun) {
    let tokens: string[] = [];
    try {
      tokens = await getValidGoogleTokens(project.userId);
    } catch {
      // no Google tokens — fine
    }
    const hasGoogle = tokens.length > 0;
    const googleAccessToken = tokens[0] ?? null;

    const stepTools = filterToolsByGroups(appToolGroupsForPhase(step.phase), hasGoogle);
    const stepPrompt = buildAppStepPrompt(project, step, sessionHistory, remainingAnswer);
    remainingAnswer = undefined;

    let reply = "";
    try {
      let correctionContext: string | undefined;
      for (let attempt = 0; attempt <= MAX_STEP_VERIFY_RETRIES; attempt++) {
        const prompt = correctionContext
          ? `${stepPrompt}\n\n[Previous attempt rejected: ${correctionContext}. Address this in your response.]`
          : stepPrompt;

        const result = await runAgent({
          messages: [
            {
              role: "system",
              content: `You are Jarvis, building a standalone app. Your workspace is at ${project.workspaceDir ?? path.join(process.cwd(), "projects", projectId)}.
Use project_shell for ALL file system operations and commands. Never touch Jarvis's own source files.`,
            },
            { role: "user", content: prompt },
          ],
          tools: stepTools,
          context: {
            userId: project.userId,
            googleAccessToken,
            channel: "AppProjectRunner",
            state: { pendingAttachments: [] },
            projectId,
            // Grant localhost:3001-3999 access only during TEST_UI so the agent
            // can visually verify its own dev server. Denied in all other phases.
            browserLocalhostException: step.phase.toUpperCase() === "TEST_UI",
          },
          maxTurns: 12,
        });
        reply = result.reply?.trim() || "";

        if (reply.startsWith("QUESTION:")) break;

        // ── Deterministic verification (tool-based, not LLM-based) ────────────
        const workspaceForVerify = project.workspaceDir ?? path.join(process.cwd(), "projects", projectId);
        const deterministicFailure = await runDeterministicVerification(step.phase, workspaceForVerify, reply, projectId);
        if (deterministicFailure) {
          correctionContext = deterministicFailure;
          if (attempt < MAX_STEP_VERIFY_RETRIES) {
            console.log(`[AppProjectRunner] deterministic check failed for "${step.label}" attempt ${attempt + 1}: ${deterministicFailure.slice(0, 120)}`);
            continue;
          }
        }

        // ── LLM-based quality verification ────────────────────────────────────
        const acceptanceCriteria = step.phase.toUpperCase() === "TEST_UI"
      ? `Use browser_screenshot when the hosted browser is available; otherwise command-based validation such as npm run build is acceptable. The app must not show an obvious browser/dev-server error. ${step.acceptance_criteria || ""}`
          : (step.acceptance_criteria || "step completed successfully");

        const verification = await verifyJobOutput({
          agentType: "project_step",
          originalPrompt: `Phase: ${step.phase}\nLabel: ${step.label}\nAcceptance criteria: ${acceptanceCriteria}`,
          result: reply,
          orchestratorModel: orchModel,
          correctionContext,
        });

        if (verification.passed === true || verification.passed === null) break;

        correctionContext = verification.reason;
        if (attempt < MAX_STEP_VERIFY_RETRIES) {
          verificationRetriesTotal++;
          console.log(`[AppProjectRunner] step "${step.label}" verify retry ${attempt + 1}: ${verification.reason}`);
        }
      }
    } catch (err) {
      console.error(`[AppProjectRunner] step "${step.label}" threw error:`, err);
      const newErrors = (project.consecutiveErrors ?? 0) + 1;
      if (newErrors >= MAX_CONSECUTIVE_ERRORS) {
        await db
          .update(schema.jarvisProjects)
          .set({ status: "paused", consecutiveErrors: newErrors, updatedAt: new Date() })
          .where(eq(schema.jarvisProjects.id, projectId));
        await sendAppProjectMessage(
          project.userId,
          project.originChannel ?? undefined,
          `⚠️ **App Project: ${project.title}** paused after ${newErrors} errors.\n\nLast error: ${String(err).slice(0, 200)}`,
        );
        return { status: "paused", stepsCompleted: completedLabels.length, summary: "Paused after too many errors" };
      }
      await db
        .update(schema.jarvisProjects)
        .set({ consecutiveErrors: newErrors, updatedAt: new Date() })
        .where(eq(schema.jarvisProjects.id, projectId));
      continue;
    }

    // ── Question check ──────────────────────────────────────────────────────
    if (reply.startsWith("QUESTION:")) {
      const question = reply.slice("QUESTION:".length).trim();
      await sendAppProjectQuestion(
        project.userId,
        project.originChannel ?? undefined,
        `❓ **App Project: ${project.title}** needs your input:\n\n${question}`,
      );
      await db
        .update(schema.jarvisProjects)
        .set({
          questionPending: question,
          questionAskedAt: new Date(),
          status: "waiting_for_input",
          consecutiveErrors: 0,
          updatedAt: new Date(),
        })
        .where(eq(schema.jarvisProjects.id, projectId));

      const durationMs = Date.now() - startTime;
      await db.insert(schema.jarvisProjectSessions).values({
        projectId,
        sessionNumber,
        stepsCompleted: completedLabels.length,
        stepLabels: completedLabels,
        durationMs,
        status: "waiting_for_input",
        summary: `Paused: ${question.slice(0, 200)}`,
      });
      return { status: "waiting_for_input", stepsCompleted: completedLabels.length, summary: question };
    }

    // ── Mark step complete ──────────────────────────────────────────────────
    const extractSummary = (text: string): string => {
      const match = text.match(/## Step Output Summary\s*([\s\S]*?)(?:\n##|$)/);
      return match ? match[1].trim().slice(0, 500) : text.slice(0, 300);
    };
    const stepOutput = extractSummary(reply);

    currentPlan = currentPlan.map((s, i) =>
      i === step._idx
        ? { ...s, status: "complete" as const, output: stepOutput, completedAt: new Date().toISOString() }
        : s,
    );

    await db
      .update(schema.jarvisProjects)
      .set({
        plan: currentPlan,
        currentStepIndex: step._idx + 1,
        lastProgressAt: new Date(),
        consecutiveErrors: 0,
        updatedAt: new Date(),
      })
      .where(eq(schema.jarvisProjects.id, projectId));

    completedLabels.push(step.label);
    sessionSummary = stepOutput;
    console.log(`[AppProjectRunner] completed step "${step.label}" for project ${projectId}`);
  }

  const durationMs = Date.now() - startTime;
  const remainingAfterSession = currentPlan.filter((s) => s.status === "pending").length;
  const totalComplete = currentPlan.filter((s) => s.status === "complete").length;

  await db.insert(schema.jarvisProjectSessions).values({
    projectId,
    sessionNumber,
    stepsCompleted: completedLabels.length,
    stepLabels: completedLabels,
    durationMs,
    verificationRetries: verificationRetriesTotal,
    status: "complete",
    summary: sessionSummary || completedLabels.join(", "),
  });

  if (remainingAfterSession === 0) {
    await markAppProjectComplete(project, sessionNumber);
    return { status: "complete", stepsCompleted: completedLabels.length, summary: "All steps complete!" };
  }

  const nextLabel = currentPlan.find((s) => s.status === "pending")?.label ?? "next step";
  const progressMsg =
    `🏗️ **App Project: ${project.title}** — Session ${sessionNumber} complete\n` +
    `✅ Steps done: ${totalComplete}/${currentPlan.length}\n` +
    `🔨 This session: ${completedLabels.map((l) => `"${l}"`).join(", ")}\n` +
    `⏭ Next: "${nextLabel}"\n` +
    `🕐 Next session in ${AUTONOMOUS_INTERVAL_MINUTES} min (autonomous mode)`;

  await sendAppProjectMessage(project.userId, project.originChannel ?? undefined, progressMsg);

  if (project.autonomousMode) {
    const nextRunAt = new Date(Date.now() + AUTONOMOUS_INTERVAL_MINUTES * 60 * 1000);
    await db
      .update(schema.jarvisProjects)
      .set({ nextRunAt, updatedAt: new Date() })
      .where(eq(schema.jarvisProjects.id, projectId));
    console.log(`[AppProjectRunner] autonomous project ${projectId} scheduled for ${nextRunAt.toISOString()}`);
  }

  return {
    status: "building",
    stepsCompleted: completedLabels.length,
    summary: sessionSummary,
  };
}

// ── Planning session ──────────────────────────────────────────────────────────

async function runAppPlanningSession(
  project: schema.JarvisProject,
  sessionNumber: number,
  startTime: number,
): Promise<{ status: string; stepsCompleted: number; summary: string }> {
  let tokens: string[] = [];
  try {
    tokens = await getValidGoogleTokens(project.userId);
  } catch {
    // no Google tokens
  }
  const googleAccessToken = tokens[0] ?? null;
  const framework = (project.appFramework ?? "custom") as AppFramework;

  const planningPrompt = buildAppPlanningPrompt(
    project.title ?? "Untitled App",
    project.description ?? "",
    project.goal ?? "",
    framework,
  );

  const result = await runAgent({
    messages: [
      { role: "system", content: "You are Jarvis, an autonomous AI app builder. Respond with JSON only." },
      { role: "user", content: planningPrompt },
    ],
    tools: [],
    context: {
      userId: project.userId,
      googleAccessToken,
      channel: "AppProjectRunner/planning",
      state: { pendingAttachments: [] },
      projectId: project.id,
    },
    maxTurns: 3,
  });

  let planData: { plan: Omit<ProjectPlanStep, "status">[]; questions?: string[]; summary?: string } | null = null;
  try {
    const jsonMatch = result.reply.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      planData = JSON.parse(jsonMatch[0]);
    }
  } catch {
    console.error(`[AppProjectRunner] failed to parse planning response for project ${project.id}`);
  }

  if (!planData?.plan?.length) {
    await db
      .update(schema.jarvisProjects)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(schema.jarvisProjects.id, project.id));
    return { status: "failed", stepsCompleted: 0, summary: "Planning failed: could not generate a plan" };
  }

  const plan: ProjectPlanStep[] = planData.plan.map((s, i) => ({
    ...s,
    step_id: s.step_id || `step_${String(i + 1).padStart(3, "0")}`,
    status: "pending",
  }));

  const questions = planData.questions?.filter(Boolean) ?? [];
  const durationMs = Date.now() - startTime;

  if (questions.length > 0) {
    const questionText = questions.map((q, i) => `${i + 1}. ${q}`).join("\n");
    await sendAppProjectQuestion(
      project.userId,
      project.originChannel ?? undefined,
      `📋 **App Project: ${project.title}** — Plan created with ${plan.length} steps!\n\n` +
      `Before I start building, I have a few questions:\n\n${questionText}`,
    );
    await db
      .update(schema.jarvisProjects)
      .set({
        plan,
        status: "waiting_for_input",
        questionPending: `Questions before building:\n\n${questionText}`,
        questionAskedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.jarvisProjects.id, project.id));
  } else {
    await db
      .update(schema.jarvisProjects)
      .set({ plan, status: "building", updatedAt: new Date() })
      .where(eq(schema.jarvisProjects.id, project.id));

    await sendAppProjectMessage(
      project.userId,
      project.originChannel ?? undefined,
      `📋 **App Project: ${project.title}** — Plan ready!\n\n` +
      `${plan.length} steps: ${[...new Set(plan.map((s) => s.phase))].join(" → ")}\n\n` +
      `${planData.summary || ""}\n\n` +
      `Starting build now — I'll update you every ${AUTONOMOUS_INTERVAL_MINUTES} minutes.`,
    );

    await submitAgentJob({
      userId: project.userId,
      agentType: "app_project",
      title: `Build: ${project.title} (session 1)`,
      prompt: `Continue building app project ${project.id}`,
      input: { projectId: project.id },
    });
  }

  await db.insert(schema.jarvisProjectSessions).values({
    projectId: project.id,
    sessionNumber,
    stepsCompleted: 0,
    stepLabels: [],
    durationMs,
    status: "complete",
    summary: `Planning complete: ${plan.length} steps created`,
  });

  return { status: questions.length > 0 ? "waiting_for_input" : "building", stepsCompleted: 0, summary: planData.summary || "" };
}

// ── Mark complete ─────────────────────────────────────────────────────────────

async function markAppProjectComplete(project: schema.JarvisProject, sessionNumber: number): Promise<void> {
  stopProjectServer(project.id);

  await db
    .update(schema.jarvisProjects)
    .set({ status: "complete", lastProgressAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.jarvisProjects.id, project.id));

  console.log(`[AppProjectRunner] project ${project.id} complete — handing off to appDelivery`);
}

// ── Answer question ───────────────────────────────────────────────────────────

export async function answerAppProjectQuestion(projectId: string, answer: string): Promise<void> {
  const [project] = await db
    .select()
    .from(schema.jarvisProjects)
    .where(eq(schema.jarvisProjects.id, projectId))
    .limit(1);

  if (!project) throw new Error(`App project ${projectId} not found`);

  await db
    .update(schema.jarvisProjects)
    .set({
      questionPending: null,
      questionAskedAt: null,
      status: "building",
      updatedAt: new Date(),
    })
    .where(eq(schema.jarvisProjects.id, projectId));

  await submitAgentJob({
    userId: project.userId,
    agentType: "app_project",
    title: `Build: ${project.title} (resumed after answer)`,
    prompt: `Continue building app project ${projectId}. User answered the pending question.`,
    input: { projectId, userAnswer: answer },
  });
}
