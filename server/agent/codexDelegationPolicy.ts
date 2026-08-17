export function codexDelegationRequiresConfirmation(args: Record<string, unknown>): boolean {
  return args.sandbox === "workspace-write" || args.allow_external_side_effects === true;
}
