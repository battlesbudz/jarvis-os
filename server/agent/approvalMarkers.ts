const CONNECTED_ACCOUNTS_EXECUTE_TOOL = "connected_accounts_execute";
const QUEUE_BACKGROUND_JOB_TOOL = "queue_background_job";

export function withApprovalMarkerForTool(
  toolName: string,
  params: Record<string, unknown>,
  gateId?: string,
): Record<string, unknown> {
  if (toolName === QUEUE_BACKGROUND_JOB_TOOL && params.task_scoped_cloud === true) {
    return {
      ...params,
      _approved_cloud_background: true,
      ...(gateId ? { _approval_gate_id: gateId } : {}),
    };
  }
  if (toolName !== CONNECTED_ACCOUNTS_EXECUTE_TOOL) return params;
  return {
    ...params,
    approved: true,
    _approved: true,
  };
}
