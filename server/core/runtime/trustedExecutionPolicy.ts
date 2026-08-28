import type {
  TrustedExecutionCapabilitySnapshot,
  TrustedExecutionResolution,
  TrustedExecutionResolutionInput,
} from "./trustedExecutionTypes";

function missingCapability(capabilities: TrustedExecutionCapabilitySnapshot): string | undefined {
  if (!capabilities.authenticated) return "The request is not bound to an authenticated user.";
  if (!capabilities.ownsTargets) return "The authenticated user does not own every resolved target.";
  if (!capabilities.requiredScopesPresent) return "A required provider or tool scope is missing.";
  if (!capabilities.providerAvailable) return "A required provider is unavailable.";
  if (!capabilities.devicePermissionsPresent) return "A required device permission or pairing is missing.";
  if (!capabilities.withinLimits) return "The request exceeds a configured execution limit.";
  return undefined;
}

function result(
  decision: TrustedExecutionResolution["decision"],
  code: TrustedExecutionResolution["code"],
  reason: string,
  missingFields: string[] = [],
): TrustedExecutionResolution {
  return { decision, code, reason, missingFields };
}

export function resolveTrustedExecution(input: TrustedExecutionResolutionInput): TrustedExecutionResolution {
  if (input.controls.killSwitchEnabled) {
    return result("block", "kill_switch", "Trusted Execution is disabled by the emergency kill switch.");
  }
  if (!input.controls.globalEnabled || !input.controls.userEnabled) {
    return result("block", "feature_disabled", "Trusted Execution is disabled; the legacy approval path remains authoritative.");
  }
  if (!input.authenticatedUserId || !input.sourceActionKey || !input.taskId || !input.originChannel) {
    return result("block", "missing_trusted_identity", "The request lacks stable server-trusted source identity.");
  }
  if (input.sourceType === "direct_command" && !input.sourceTurnId) {
    return result("block", "missing_trusted_identity", "Direct-command authority requires a real authenticated source turn.");
  }
  if (input.genericAffirmativeWithoutTask) {
    return result("block", "generic_affirmative", "A generic affirmative phrase cannot authorize an unrelated or unbound action.");
  }
  if (input.financialTransaction && input.sourceType !== "direct_command") {
    return result("block", "standing_financial_block", "Financial transactions require a current transaction-specific direct command.");
  }
  if (input.hardBlockReasons?.length) {
    return result("block", "hard_block", input.hardBlockReasons.join(" "));
  }
  const capabilityReason = missingCapability(input.capabilities);
  if (capabilityReason) {
    return result("block", "capability_block", capabilityReason);
  }
  const missingFields = Array.from(new Set([
    ...(input.missingMaterialFields ?? []),
    ...(input.allowedActions.length ? [] : ["action"]),
    ...(input.allowedTargets.length ? [] : ["target"]),
    ...(input.intent?.trim() ? [] : ["intent"]),
  ]));
  if (missingFields.length) {
    if (input.sourceType === "standing_grant") {
      return result("block", "missing_material_field", `Standing execution cannot resolve required fields: ${missingFields.join(", ")}.`, missingFields);
    }
    return result("clarify", "missing_material_field", `The request needs ${missingFields.join(", ")} before execution.`, missingFields);
  }
  return result("execute", "ready", "The request is authenticated, bounded, supported, and within configured limits.");
}

export function isUnboundGenericAffirmative(text: string, hasStructuredTask: boolean): boolean {
  if (hasStructuredTask) return false;
  return /^(?:yes|yep|yeah|approved?|confirmed?|go ahead|do it|please proceed|that(?:'s| is) (?:ok|okay))[.!\s]*$/i.test(text.trim());
}
