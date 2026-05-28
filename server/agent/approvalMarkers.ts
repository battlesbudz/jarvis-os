const ONE_EXECUTE_ACTION_TOOL = "one_execute_action";

export function withApprovalMarkerForTool(
  toolName: string,
  params: Record<string, unknown>,
): Record<string, unknown> {
  if (toolName !== ONE_EXECUTE_ACTION_TOOL) return params;
  return {
    ...params,
    approved: true,
    _approved: true,
  };
}
