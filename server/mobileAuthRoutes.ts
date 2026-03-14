import { Router } from "express";
import type { Request, Response } from "express";
import { db } from "./db";
import { users, mobileAuthSessions } from "@shared/schema";
import { eq, lt } from "drizzle-orm";
import { generateToken } from "./auth";

export const mobileAuthRouter = Router();

function getCallbackUrl(req: Request): string {
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol;
  const host = (req.headers["x-forwarded-host"] as string) || req.get("host") || "";
  return `${proto}://${host}/api/auth/mobile/callback`;
}

function successHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Signed In — GamePlan</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f0f0f; color: #fff;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; padding: 20px;
    }
    .card { text-align: center; max-width: 340px; }
    .icon { font-size: 56px; margin-bottom: 20px; }
    h2 { font-size: 22px; font-weight: 700; margin-bottom: 10px; }
    p { color: #888; font-size: 15px; line-height: 1.5; }
    .dots { display: inline-flex; gap: 6px; margin-top: 24px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #6366f1;
           animation: pulse 1.2s ease-in-out infinite; }
    .dot:nth-child(2) { animation-delay: 0.2s; }
    .dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes pulse { 0%,80%,100% { opacity: 0.3; } 40% { opacity: 1; } }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h2>Signed in successfully</h2>
    <p>Returning you to GamePlan…</p>
    <div class="dots">
      <div class="dot"></div>
      <div class="dot"></div>
      <div class="dot"></div>
    </div>
  </div>
</body>
</html>`;
}

function errorHtml(message: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Error — GamePlan</title>
  <style>
    body { font-family: sans-serif; background: #0f0f0f; color: #fff;
           display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { text-align: center; padding: 40px; }
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size:48px;margin-bottom:16px">❌</div>
    <h2>Sign-in Failed</h2>
    <p style="color:#888;margin-top:8px">${message}</p>
    <p style="color:#555;margin-top:20px;font-size:13px">You can close this tab and try again.</p>
  </div>
</body>
</html>`;
}

mobileAuthRouter.get("/start", (req: Request, res: Response) => {
  const { session_id } = req.query as Record<string, string>;
  if (!session_id) return res.status(400).json({ error: "session_id required" });

  const clientId = process.env.GOOGLE_WEB_CLIENT_ID;
  if (!clientId) return res.status(500).json({ error: "Google OAuth not configured" });

  const callbackUrl = getCallbackUrl(req);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: "code",
    scope: "openid email profile",
    state: session_id,
    access_type: "offline",
    prompt: "select_account",
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

mobileAuthRouter.get("/callback", async (req: Request, res: Response) => {
  const { code, state: session_id, error } = req.query as Record<string, string>;

  if (error || !code || !session_id) {
    return res.send(errorHtml(error || "Sign-in was cancelled."));
  }

  const clientId = process.env.GOOGLE_WEB_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.send(errorHtml("OAuth credentials not configured on the server."));
  }

  const callbackUrl = getCallbackUrl(req);

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: callbackUrl,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenRes.json() as Record<string, string>;
    if (!tokenData.id_token && !tokenData.access_token) {
      console.error("Mobile auth token exchange failed:", tokenData);
      return res.send(errorHtml("Failed to exchange authorization code. Please try again."));
    }

    let googleUser: { id: string; name?: string; email?: string };

    if (tokenData.id_token) {
      const infoRes = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${tokenData.id_token}`
      );
      const info = await infoRes.json() as Record<string, string>;
      if (!info.sub) return res.send(errorHtml("Could not retrieve Google user info."));
      googleUser = { id: info.sub, name: info.name, email: info.email };
    } else {
      const infoRes = await fetch("https://www.googleapis.com/userinfo/v2/me", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const info = await infoRes.json() as Record<string, string>;
      if (!info.id) return res.send(errorHtml("Could not retrieve Google user info."));
      googleUser = { id: info.id, name: info.name, email: info.email };
    }

    const existing = await db.select().from(users)
      .where(eq(users.googleId, googleUser.id)).limit(1);

    let user;
    if (existing.length > 0) {
      user = existing[0];
    } else {
      const base = googleUser.email
        ? googleUser.email.split("@")[0]
        : `google_${googleUser.id.slice(0, 8)}`;
      let uniqueUsername = base;
      const existingUsername = await db.select().from(users)
        .where(eq(users.username, base)).limit(1);
      if (existingUsername.length > 0) uniqueUsername = `${base}_${Date.now().toString(36)}`;

      const [newUser] = await db.insert(users).values({
        username: uniqueUsername,
        googleId: googleUser.id,
        displayName: googleUser.name || uniqueUsername,
      }).returning();
      user = newUser;
    }

    const token = generateToken(user.id);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await db.insert(mobileAuthSessions).values({
      sessionId: session_id,
      token,
      expiresAt,
    }).onConflictDoUpdate({
      target: mobileAuthSessions.sessionId,
      set: { token, expiresAt },
    });

    return res.send(successHtml());
  } catch (err) {
    console.error("Mobile auth callback error:", err);
    return res.send(errorHtml("An unexpected error occurred. Please try again."));
  }
});

mobileAuthRouter.get("/poll", async (req: Request, res: Response) => {
  const { session_id } = req.query as Record<string, string>;
  if (!session_id) return res.status(400).json({ error: "session_id required" });

  try {
    await db.delete(mobileAuthSessions).where(lt(mobileAuthSessions.expiresAt, new Date()));

    const rows = await db.select().from(mobileAuthSessions)
      .where(eq(mobileAuthSessions.sessionId, session_id)).limit(1);

    if (rows.length === 0) {
      return res.status(404).json({ ready: false });
    }

    const session = rows[0];

    await db.delete(mobileAuthSessions).where(eq(mobileAuthSessions.sessionId, session_id));

    return res.json({ ready: true, token: session.token });
  } catch (err) {
    console.error("Mobile auth poll error:", err);
    return res.status(500).json({ ready: false, error: "Internal error" });
  }
});
