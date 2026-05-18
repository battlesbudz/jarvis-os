import type { Application, NextFunction, Request, Response } from "express";

const DEFAULT_PROXY_PATH = "/telegram-codex";
const DEFAULT_TARGET = "http://127.0.0.1:8787";
const LOCAL_TARGET_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export function registerTelegramCodexProxy(app: Application) {
  const enabled =
    process.env.TELEGRAM_CODEX_PROXY_ENABLED === "true" ||
    Boolean(process.env.TELEGRAM_CODEX_PROXY_TARGET);

  if (!enabled) return;

  const proxyPath = normalizeProxyPath(
    process.env.TELEGRAM_CODEX_PROXY_PATH || DEFAULT_PROXY_PATH,
  );
  const target = new URL(process.env.TELEGRAM_CODEX_PROXY_TARGET || DEFAULT_TARGET);

  if (
    !LOCAL_TARGET_HOSTS.has(target.hostname) &&
    process.env.TELEGRAM_CODEX_PROXY_ALLOW_REMOTE !== "true"
  ) {
    throw new Error(
      `Refusing non-local TELEGRAM_CODEX_PROXY_TARGET host: ${target.hostname}`,
    );
  }

  app.use(proxyPath, async (req: Request, res: Response, next: NextFunction) => {
    try {
      await proxyTelegramCodexRequest(req, res, target);
    } catch (error) {
      next(error);
    }
  });

  console.log(`[TelegramCodeX] Proxy mounted at ${proxyPath} -> ${target.origin}`);
}

async function proxyTelegramCodexRequest(req: Request, res: Response, target: URL) {
  const upstreamUrl = new URL(req.originalUrl, target);
  const headers = proxiedRequestHeaders(req);
  const body = proxiedRequestBody(req);

  if (req.headers.host) headers.set("x-forwarded-host", String(req.headers.host));
  headers.set("x-forwarded-proto", req.protocol || "http");
  if (body) headers.set("content-length", String(body.length));

  const init: RequestInit = {
    method: req.method,
    headers,
    redirect: "manual",
  };

  if (body) {
    init.body = body as BodyInit;
  }

  const upstream = await fetch(upstreamUrl, init);
  res.status(upstream.status);

  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === "transfer-encoding" || lower === "content-encoding") return;
    res.setHeader(key, value);
  });

  res.end(Buffer.from(await upstream.arrayBuffer()));
}

function proxiedRequestHeaders(req: Request) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value) continue;

    const lower = key.toLowerCase();
    if (
      lower === "host" ||
      lower === "content-length" ||
      lower === "connection" ||
      lower === "transfer-encoding" ||
      lower === "accept-encoding"
    ) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, String(value));
    }
  }

  return headers;
}

function proxiedRequestBody(req: Request) {
  if (req.method === "GET" || req.method === "HEAD") return undefined;

  const rawBody = (req as Request & { rawBody?: unknown }).rawBody;
  if (Buffer.isBuffer(rawBody)) return rawBody;

  if (req.body && Object.keys(req.body).length > 0) {
    return Buffer.from(JSON.stringify(req.body));
  }

  return undefined;
}

function normalizeProxyPath(value: string) {
  const trimmed = value.trim().replace(/^\/+|\/+$/g, "");
  return trimmed ? `/${trimmed}` : DEFAULT_PROXY_PATH;
}
