/**
 * SecretRef Credential Resolver
 *
 * Provides a single function that resolves a credential value regardless
 * of whether it is stored directly (legacy) or referenced by env-var name.
 *
 * Modes:
 *   "direct"  — return the raw stored value unchanged (existing behaviour)
 *   "env-ref" — look up process.env[envKey]; surface a structured error when missing
 *
 * All integration clients that need a token should call resolveCredential
 * instead of reading the raw field directly, so the rest of the codebase
 * is mode-agnostic.
 */

export type CredentialMode = "direct" | "env-ref";

export interface ResolvedCredential {
  value: string | null;
  source: "direct" | "env";
  missing: boolean;
  errorMessage?: string;
}

/**
 * Resolve a credential given its storage mode.
 *
 * @param mode         "direct" or "env-ref"
 * @param rawValue     The value stored in the DB (used only when mode === "direct")
 * @param envKey       The env-var name (used only when mode === "env-ref")
 */
export function resolveCredential(
  mode: CredentialMode | string | null | undefined,
  rawValue: string | null | undefined,
  envKey: string | null | undefined,
): ResolvedCredential {
  const effectiveMode: CredentialMode =
    mode === "env-ref" ? "env-ref" : "direct";

  if (effectiveMode === "direct") {
    return {
      value: rawValue ?? null,
      source: "direct",
      missing: rawValue == null || rawValue === "",
    };
  }

  if (!envKey || envKey.trim() === "") {
    return {
      value: null,
      source: "env",
      missing: true,
      errorMessage: "env-ref mode requires an env var name (envKey is empty)",
    };
  }

  const envValue = process.env[envKey.trim()] ?? null;
  if (!envValue) {
    return {
      value: null,
      source: "env",
      missing: true,
      errorMessage: `Environment variable "${envKey}" is not set — add it to Railway Variables`,
    };
  }

  return {
    value: envValue,
    source: "env",
    missing: false,
  };
}

/**
 * Convenience: check whether a named env var is present (non-empty).
 * Used by the settings API to power the green/red indicator in the UI
 * without ever sending the secret value to the client.
 */
export function envVarPresent(key: string): boolean {
  const v = process.env[key];
  return typeof v === "string" && v.length > 0;
}
