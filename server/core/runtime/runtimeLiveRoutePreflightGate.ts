import { getRuntimeFeatureFlags, type RuntimeFeatureFlagEnv } from "./runtimeFeatureFlags";
import { isRuntimeOwnedGoldenWorkflowAllowed, matchRuntimeOwnedGoldenWorkflow } from "./runtimeOwnedGoldenWorkflow";
import { executeRuntimeReadOnly, type RuntimeReadOnlyExecutionResult } from "./runtimeReadOnlyExecutor";
import type { ExecuteRuntimeEventInput } from "./runtimeTypes";

export type RuntimeLiveRoutePreflightStatus =
  | "runtime_disabled"
  | "runtime_readonly_allowed"
  | "legacy_route_allowed"
  | "blocked";

export interface RuntimeLiveRoutePreflightGate {
  status: RuntimeLiveRoutePreflightStatus;
  routeOwner: "core_runtime" | "legacy_route";
  reason: string;
  shouldUseRuntime: boolean;
  shouldContinueLegacy: boolean;
  runtime: RuntimeReadOnlyExecutionResult | null;
  runtimeWorkflowId: string | null;
}

export function preflightRuntimeLiveRoute(
  input: ExecuteRuntimeEventInput,
  env: RuntimeFeatureFlagEnv = process.env,
): RuntimeLiveRoutePreflightGate {
  const flags = getRuntimeFeatureFlags(env);
  if (!flags.liveExecutionEnabled) {
    return {
      status: "runtime_disabled",
      routeOwner: "legacy_route",
      reason: "Runtime live execution is disabled; continue with the existing route owner.",
      shouldUseRuntime: false,
      shouldContinueLegacy: true,
      runtime: null,
      runtimeWorkflowId: null,
    };
  }

  const runtime = executeRuntimeReadOnly(input);
  if (runtime.execution.status === "completed") {
    const workflow = matchRuntimeOwnedGoldenWorkflow(runtime);
    if (!workflow || !isRuntimeOwnedGoldenWorkflowAllowed(workflow.workflowId, flags.liveWorkflowIds)) {
      return {
        status: "legacy_route_allowed",
        routeOwner: "legacy_route",
        reason: workflow
          ? `Runtime workflow ${workflow.workflowId} is not enabled for live ownership.`
          : "Runtime read-only executor completed, but no runtime-owned golden workflow matched.",
        shouldUseRuntime: false,
        shouldContinueLegacy: true,
        runtime,
        runtimeWorkflowId: workflow?.workflowId ?? null,
      };
    }

    return {
      status: "runtime_readonly_allowed",
      routeOwner: "core_runtime",
      reason: workflow.reason,
      shouldUseRuntime: true,
      shouldContinueLegacy: false,
      runtime,
      runtimeWorkflowId: workflow.workflowId,
    };
  }

  if (runtime.execution.status === "blocked") {
    return {
      status: "blocked",
      routeOwner: "core_runtime",
      reason: runtime.execution.reason,
      shouldUseRuntime: false,
      shouldContinueLegacy: false,
      runtime,
      runtimeWorkflowId: null,
    };
  }

  return {
    status: "legacy_route_allowed",
    routeOwner: "legacy_route",
    reason: "Runtime read-only executor declined; continue with the existing route owner.",
    shouldUseRuntime: false,
    shouldContinueLegacy: true,
    runtime,
    runtimeWorkflowId: null,
  };
}
