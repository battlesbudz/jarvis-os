export function getGoogleOAuthClientId(): string | undefined {
  return process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_WEB_CLIENT_ID;
}

export function getGoogleOAuthConfigStatus():
  | { configured: true }
  | { configured: false; reason: string } {
  const missing: string[] = [];
  if (!getGoogleOAuthClientId()) missing.push("GOOGLE_WEB_CLIENT_ID or GOOGLE_CLIENT_ID");
  if (!process.env.GOOGLE_CLIENT_SECRET) missing.push("GOOGLE_CLIENT_SECRET");

  if (missing.length > 0) {
    return {
      configured: false,
      reason: `Google OAuth missing ${missing.join(", ")}`,
    };
  }

  return { configured: true };
}
