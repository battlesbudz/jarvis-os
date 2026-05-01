import type { AgentTool, ToolResult } from "../types";
import { db } from "../../db";
import { desc, eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { attemptCloudDeploy, type DeployProvider } from "../cloudDeploy";

export const deployAppTool: AgentTool = {
  name: "deploy_app",
  description:
    "Deploy a completed standalone app project to the cloud and get a live URL. " +
    "Next.js/React-Vite apps deploy to Vercel; Node.js/Express apps deploy to Railway. " +
    "Use this when the user asks to deploy their app, get a live URL, or publish their project. " +
    "Requires VERCEL_TOKEN or RAILWAY_TOKEN in secrets.",
  parameters: {
    type: "object",
    properties: {
      project_id: {
        type: "string",
        description:
          "ID of the completed app project to deploy. If omitted, the most recently completed project is used.",
      },
      provider: {
        type: "string",
        enum: ["vercel", "railway", "auto"],
        description:
          "Deployment provider. 'auto' (default) selects based on framework. " +
          "'vercel' always deploys to Vercel. 'railway' always deploys to Railway.",
      },
    },
    required: [],
  },
  async execute(args, ctx): Promise<ToolResult> {
    const userId = ctx.userId;
    const providedProjectId = args.project_id ? String(args.project_id).trim() : null;
    const rawProvider = String(args.provider ?? "auto").toLowerCase();
    const provider: DeployProvider =
      rawProvider === "vercel" ? "vercel"
      : rawProvider === "railway" ? "railway"
      : "auto";

    // ── Resolve target project ─────────────────────────────────────────────────
    let project: typeof schema.jarvisProjects.$inferSelect | undefined;

    if (providedProjectId) {
      const rows = await db
        .select()
        .from(schema.jarvisProjects)
        .where(eq(schema.jarvisProjects.id, providedProjectId))
        .limit(1);
      project = rows[0];
      if (!project) {
        return { ok: false, content: `Project "${providedProjectId}" not found.` };
      }
      if (project.userId !== userId) {
        return { ok: false, content: "You don't have access to that project." };
      }
    } else {
      const rows = await db
        .select()
        .from(schema.jarvisProjects)
        .where(eq(schema.jarvisProjects.userId, userId))
        .orderBy(desc(schema.jarvisProjects.updatedAt))
        .limit(20);

      project = rows.find((r) => r.status === "complete");
      if (!project) {
        const latest = rows[0];
        if (!latest) {
          return {
            ok: false,
            content: "No app project found for your account. Ask Jarvis to build an app first.",
          };
        }
        return {
          ok: false,
          content:
            `Your most recent project "${latest.title}" is not complete yet ` +
            `(status: ${latest.status}). Wait for it to finish building before deploying.`,
        };
      }
    }

    if (project.status !== "complete") {
      return {
        ok: false,
        content:
          `"${project.title}" is still building (status: ${project.status}). ` +
          "Deploy it once the build completes.",
      };
    }

    const workspaceDir = project.workspaceDir;
    if (!workspaceDir) {
      return { ok: false, content: "Project workspace directory is missing — cannot deploy." };
    }

    const framework = project.appFramework ?? "custom";

    // ── Check credentials ──────────────────────────────────────────────────────
    const hasVercel = !!process.env.VERCEL_TOKEN;
    const hasRailway = !!process.env.RAILWAY_TOKEN;

    if (!hasVercel && !hasRailway) {
      return {
        ok: false,
        content:
          "No deployment credentials are configured.\n\n" +
          "• **Vercel** (Next.js / React-Vite): add `VERCEL_TOKEN` to your secrets " +
          "(vercel.com/account/tokens).\n" +
          "• **Railway** (Node.js / Express): add `RAILWAY_TOKEN` to your secrets " +
          "(railway.app/account/tokens).\n\n" +
          "Your zip download link from the delivery message is still available.",
      };
    }

    if (provider === "vercel" && !hasVercel) {
      return {
        ok: false,
        content:
          "VERCEL_TOKEN is not configured. Add it to your secrets to enable Vercel deployment.",
      };
    }
    if (provider === "railway" && !hasRailway) {
      return {
        ok: false,
        content:
          "RAILWAY_TOKEN is not configured. Add it to your secrets to enable Railway deployment.",
      };
    }

    console.log(
      `[deploy_app] project=${project.id} framework=${framework} provider=${provider}`,
    );

    // Pass the provider preference directly — attemptCloudDeploy will respect it
    const result = await attemptCloudDeploy(
      workspaceDir,
      project.title ?? "jarvis-app",
      framework,
      provider,
    );

    if (result.url) {
      const providerLabel = result.provider === "vercel" ? "Vercel" : "Railway";
      return {
        ok: true,
        content:
          `✅ **${project.title}** is live on ${providerLabel}!\n\n` +
          `🌐 **Live URL:** ${result.url}\n\n` +
          `Share this link with anyone — the app is publicly accessible.`,
        label: "deploy_app",
        detail: result.url,
      };
    }

    if (!result.attempted) {
      // No suitable token found (shouldn't normally reach here after credential checks above)
      const suggestion =
        framework === "nextjs" || framework === "react-vite"
          ? "VERCEL_TOKEN"
          : "RAILWAY_TOKEN";
      return {
        ok: false,
        content: `No deployment token available for "${framework}" apps. Add \`${suggestion}\` to your secrets.`,
        label: "deploy_app",
      };
    }

    // Deployment was attempted but failed
    const providerLabel =
      provider === "vercel" ? "Vercel"
      : provider === "railway" ? "Railway"
      : framework === "nextjs" || framework === "react-vite" ? "Vercel"
      : "Railway";

    return {
      ok: false,
      content:
        `Deployment to ${providerLabel} failed. ` +
        "Verify your API token is valid and has the necessary permissions, then try again. " +
        "Your zip download link from the delivery message is still available.",
      label: "deploy_app",
    };
  },
};
