import type { MobileAuthReturnTarget } from "./mobileAuthHtml";

export type MobileAuthStartFlow = "code" | "implicit";

export function resolveMobileAuthStartFlow({
  requestedFlow,
  returnTarget,
  hasPollSecret,
}: {
  requestedFlow?: string;
  returnTarget: MobileAuthReturnTarget;
  hasPollSecret: boolean;
}): MobileAuthStartFlow {
  if (requestedFlow === "code" || requestedFlow === "implicit") return requestedFlow;
  if (returnTarget === "native" && hasPollSecret) return "implicit";
  return "code";
}
