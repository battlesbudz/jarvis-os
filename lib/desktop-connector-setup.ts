import { fetch } from "expo/fetch";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import {
  desktopConnectorSetupResponseSchema,
  desktopConnectorStatusResponseSchema,
  type DesktopConnectorSetupResponse,
  type DesktopConnectorStatusResponse,
} from "@shared/desktopConnectorSetup";

export const DESKTOP_CONNECTOR_AUTH_BRIDGE_KEY = "jarvis_web_desktop_connector_auth_bridge";

function getDesktopConnectorAuthBridgeToken(): string | null {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(DESKTOP_CONNECTOR_AUTH_BRIDGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: unknown };
    return typeof parsed.token === "string" && parsed.token ? parsed.token : null;
  } catch {
    return null;
  }
}

export function clearDesktopConnectorAuthBridge(): void {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return;
  try {
    window.localStorage.removeItem(DESKTOP_CONNECTOR_AUTH_BRIDGE_KEY);
  } catch {
    // Ignore storage access failures; setup can still proceed through the normal app auth path.
  }
}

async function desktopConnectorApiRequest(
  method: string,
  route: string,
  data?: unknown | undefined,
): Promise<Response> {
  const bridgeToken = getDesktopConnectorAuthBridgeToken();
  if (!bridgeToken) return apiRequest(method, route, data);

  const url = new URL(route, getApiUrl());
  const headers: Record<string, string> = {
    Authorization: `Bearer ${bridgeToken}`,
  };
  if (data) headers["Content-Type"] = "application/json";

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
  return res;
}

export async function startDesktopConnectorSetup(): Promise<DesktopConnectorSetupResponse> {
  const res = await desktopConnectorApiRequest("POST", "/api/desktop-connector/setup-session", {
    consentedToDesktopControl: true,
  });
  return desktopConnectorSetupResponseSchema.parse(await res.json());
}

export async function getDesktopConnectorSetupStatus(setupId: string): Promise<DesktopConnectorStatusResponse> {
  const res = await desktopConnectorApiRequest("GET", `/api/desktop-connector/setup-session/${encodeURIComponent(setupId)}`);
  return desktopConnectorStatusResponseSchema.parse(await res.json());
}

export async function verifyDesktopConnector(): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const res = await apiRequest("POST", "/api/desktop-connector/verify", {});
  return await res.json();
}
