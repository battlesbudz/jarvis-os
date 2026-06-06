import type { Request } from "express";

const DEFAULT_PRODUCTION_BASE_URL = "https://gameplanjarvisai.up.railway.app";

function normalizeBaseUrl(value: string): string {
  const raw = value.trim();
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return new URL(withProtocol).origin;
}

export function getPublicBaseUrl(req?: Request): string {
  const explicit =
    process.env.PUBLIC_BASE_URL ||
    process.env.APP_BASE_URL ||
    process.env.SERVER_URL ||
    process.env.RAILWAY_PUBLIC_DOMAIN ||
    process.env.EXPO_PUBLIC_DOMAIN;

  if (explicit) return normalizeBaseUrl(explicit);

  if (req) {
    const forwardedHost = req.headers["x-forwarded-host"];
    const host = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost || req.get("host");
    const forwardedProto = req.headers["x-forwarded-proto"];
    const protocol = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto || req.protocol;
    if (host) return normalizeBaseUrl(`${protocol}://${host}`);
  }

  return process.env.NODE_ENV === "production" ? DEFAULT_PRODUCTION_BASE_URL : "http://localhost:5000";
}
