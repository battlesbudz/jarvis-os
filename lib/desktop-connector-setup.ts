import { apiRequest } from "@/lib/query-client";
import {
  desktopConnectorSetupResponseSchema,
  desktopConnectorStatusResponseSchema,
  type DesktopConnectorSetupResponse,
  type DesktopConnectorStatusResponse,
} from "@shared/desktopConnectorSetup";

export async function startDesktopConnectorSetup(): Promise<DesktopConnectorSetupResponse> {
  const res = await apiRequest("POST", "/api/desktop-connector/setup-session", {
    consentedToDesktopControl: true,
  });
  return desktopConnectorSetupResponseSchema.parse(await res.json());
}

export async function getDesktopConnectorSetupStatus(setupId: string): Promise<DesktopConnectorStatusResponse> {
  const res = await apiRequest("GET", `/api/desktop-connector/setup-session/${encodeURIComponent(setupId)}`);
  return desktopConnectorStatusResponseSchema.parse(await res.json());
}

export async function verifyDesktopConnector(): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const res = await apiRequest("POST", "/api/desktop-connector/verify", {});
  return await res.json();
}
