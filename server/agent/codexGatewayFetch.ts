import { ProxyAgent } from "undici";

let cachedProxyUrl: string | null = null;
let cachedProxyAgent: ProxyAgent | null = null;

function getGatewayProxyUrl(): string | null {
  const raw = (
    process.env.JARVIS_CODEX_GATEWAY_PROXY_URL ||
    process.env.JARVIS_TAILSCALE_HTTP_PROXY_URL ||
    ""
  ).trim();
  return raw || null;
}

function getGatewayProxyDispatcher(): ProxyAgent | undefined {
  const proxyUrl = getGatewayProxyUrl();
  if (!proxyUrl) return undefined;
  if (!cachedProxyAgent || cachedProxyUrl !== proxyUrl) {
    cachedProxyAgent = new ProxyAgent(proxyUrl);
    cachedProxyUrl = proxyUrl;
  }
  return cachedProxyAgent;
}

export function fetchCodexGateway(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const dispatcher = getGatewayProxyDispatcher();
  if (!dispatcher) return fetch(input, init);
  return fetch(input, { ...init, dispatcher } as RequestInit & { dispatcher: ProxyAgent });
}
