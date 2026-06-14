const CONNECTED_ACCOUNTS_EXECUTE_TOOL = "connected_accounts_execute";

export function withApprovalMarkerForTool(
  toolName: string,
  params: Record<string, unknown>,
): Record<string, unknown> {
  if (toolName !== CONNECTED_ACCOUNTS_EXECUTE_TOOL) return params;
  return {
    ...params,
    approved: true,
    _approved: true,
  };
}
