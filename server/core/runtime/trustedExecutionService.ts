import { resolveTrustedExecution } from "./trustedExecutionPolicy";
import {
  issueDirectExecutionAuthority,
  issueStandingExecutionAuthority,
} from "./trustedExecutionRepository";
import type {
  DirectAuthorityIssueInput,
  StandingAuthorityIssueInput,
  TrustedExecutionAuthorityIssueResult,
  TrustedExecutionResolution,
  TrustedExecutionResolutionInput,
} from "./trustedExecutionTypes";

export type TrustedExecutionServiceInput =
  | {
      resolution: TrustedExecutionResolutionInput & { sourceType: "direct_command" };
      authority: DirectAuthorityIssueInput;
    }
  | {
      resolution: TrustedExecutionResolutionInput & { sourceType: "standing_grant" };
      authority: StandingAuthorityIssueInput;
    };

export interface TrustedExecutionServiceResult {
  resolution: TrustedExecutionResolution;
  authority?: TrustedExecutionAuthorityIssueResult;
  compatibilityMode: "legacy" | "trusted_execution";
}

/**
 * Single server-owned entry point for authority classification and issuance.
 * Feature-disabled requests deliberately return to the existing legacy owner;
 * no authority or approval record is created by this path.
 */
export async function resolveAndIssueTrustedExecution(
  input: TrustedExecutionServiceInput,
): Promise<TrustedExecutionServiceResult> {
  const resolution = resolveTrustedExecution(input.resolution);
  if (resolution.code === "feature_disabled") {
    return { resolution, compatibilityMode: "legacy" };
  }
  if (resolution.decision !== "execute") {
    return { resolution, compatibilityMode: "trusted_execution" };
  }
  const authority = input.resolution.sourceType === "direct_command"
    ? await issueDirectExecutionAuthority((input as Extract<TrustedExecutionServiceInput, { resolution: { sourceType: "direct_command" } }>).authority)
    : await issueStandingExecutionAuthority((input as Extract<TrustedExecutionServiceInput, { resolution: { sourceType: "standing_grant" } }>).authority);
  return { resolution, authority, compatibilityMode: "trusted_execution" };
}
