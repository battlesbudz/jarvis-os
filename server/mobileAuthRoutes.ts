import { Router } from "express";
import type { Request, Response } from "express";
import * as crypto from "crypto";
import { db } from "./db";
import { users, mobileAuthSessions } from "@shared/schema";
import { eq, lt } from "drizzle-orm";
import { generateToken } from "./auth";

export const mobileAuthRouter = Router();

const PENDING_TOKEN_PREFIX = "__PENDING__:";
const COMPLETE_TOKEN_PREFIX = "__COMPLETE__:";
const POLL_SECRET_BYTES = 24;
const BIND_COOKIE_NAME = "mobile_auth_bind";

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function timingSafeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

function isValidSessionId(value: string): boolean {
  return /^[A-Za-z0-9_-]{24,128}$/.test(value);
}

function isValidPollSecret(value: string): boolean {
  return /^[A-Za-z0-9_-]{32,256}$/.test(value);
}

function createOauthState(sessionId: string): string {
  const nonce = crypto.randomBytes(POLL_SECRET_BYTES).toString("base64url");
  return `${sessionId}.${nonce}`;
}

function parseOauthState(state: string): { sessionId: string; nonce: string } | null {
  const [sessionId, nonce, ...extra] = state.split(".");
  if (!sessionId || !nonce || extra.length > 0) return null;
  if (!isValidSessionId(sessionId) || !isValidSessionId(nonce)) return null;
  return { sessionId, nonce };
}

function pendingTokenValue(oauthState: string, pollSecret: string, bindNonce: string): string {
  return `${PENDING_TOKEN_PREFIX}${sha256(oauthState)}:${sha256(pollSecret)}:${sha256(bindNonce)}`;
}

function parsePendingTokenValue(token: string): { stateHash: string; pollHash: string; bindHash: string } | null {
  if (!token.startsWith(PENDING_TOKEN_PREFIX)) return null;
  const rest = token.slice(PENDING_TOKEN_PREFIX.length);
  const [stateHash, pollHash, bindHash, ...extra] = rest.split(":");
  if (!stateHash || !pollHash || !bindHash || extra.length > 0) return null;
  return { stateHash, pollHash, bindHash };
}

function completeTokenValue(pollHash: string, bindHash: string, token: string): string {
  return `${COMPLETE_TOKEN_PREFIX}${pollHash}:${bindHash}:${token}`;
}

function parseCompleteTokenValue(value: string): { pollHash: string; bindHash: string; token: string } | null {
  if (!value.startsWith(COMPLETE_TOKEN_PREFIX)) return null;
  const rest = value.slice(COMPLETE_TOKEN_PREFIX.length);
  const firstSeparator = rest.indexOf(":");
  const secondSeparator = rest.indexOf(":", firstSeparator + 1);
  if (firstSeparator <= 0 || secondSeparator <= firstSeparator) return null;
  const pollHash = rest.slice(0, firstSeparator);
  const bindHash = rest.slice(firstSeparator + 1, secondSeparator);
  const token = rest.slice(secondSeparator + 1);
  if (!pollHash || !bindHash || !token) return null;
  return { pollHash, bindHash, token };
}

function getCallbackUrl(req: Request): string {
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol;
  const host = (req.headers["x-forwarded-host"] as string) || req.get("host") || "";
  return `${proto}://${host}/api/auth/mobile/callback`;
}

function successHtml(token: string): string {
  const encodedToken = encodeURIComponent(token);
  const tokenJson = JSON.stringify(token);
  const originFallback = `/login#auth_token=${encodedToken}`;
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
    <p>Taking you back to GamePlan...</p>
    <div class="dots">
      <div class="dot"></div>
      <div class="dot"></div>
      <div class="dot"></div>
    </div>
  </div>
  <script>
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: 'gameplan-auth-token', token: ${tokenJson} }, window.location.origin);
        window.close();
      }
    } catch(e) {}
    try {
      window.location.href = 'gameplan://auth/complete?token=${encodedToken}';
    } catch(e) {}
    setTimeout(function () {
      try {
        window.location.replace('${originFallback}');
      } catch(e) {}
    }, 800);
  </script>
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

mobileAuthRouter.get("/start", async (req: Request, res: Response) => {
  const { session_id, poll_secret } = req.query as Record<string, string>;
  if (!session_id) return res.status(400).json({ error: "session_id required" });
  if (!isValidSessionId(session_id)) return res.status(400).json({ error: "invalid session_id" });

  const clientId = process.env.GOOGLE_WEB_CLIENT_ID;
  if (!clientId) return res.status(500).json({ error: "Google OAuth not configured" });

  const oauthState = createOauthState(session_id);
  const bindNonce = crypto.randomBytes(POLL_SECRET_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  if (poll_secret) {
    if (!isValidPollSecret(poll_secret)) return res.status(400).json({ error: "invalid poll_secret" });
    await db.insert(mobileAuthSessions).values({
      sessionId: session_id,
      token: pendingTokenValue(oauthState, poll_secret, bindNonce),
      expiresAt,
    }).onConflictDoUpdate({
      target: mobileAuthSessions.sessionId,
      set: {
        token: pendingTokenValue(oauthState, poll_secret, bindNonce),
        expiresAt,
      },
    });
  }

  res.cookie(BIND_COOKIE_NAME, bindNonce, {
    httpOnly: true,
    secure: req.secure || req.headers["x-forwarded-proto"] === "https",
    sameSite: "lax",
    maxAge: 10 * 60 * 1000,
    path: "/api/auth/mobile",
  });

  const callbackUrl = getCallbackUrl(req);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: "code",
    scope: "openid email profile",
    state: oauthState,
    access_type: "offline",
    prompt: "select_account",
    max_age: "0",
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

mobileAuthRouter.get("/callback", async (req: Request, res: Response) => {
  const { code, state, error } = req.query as Record<string, string>;

  if (error || !code || !state) {
    return res.send(errorHtml(error || "Sign-in was cancelled."));
  }

  const parsedState = parseOauthState(state);
  if (!parsedState) {
    return res.send(errorHtml("Invalid sign-in state. Please try again."));
  }
  const { sessionId } = parsedState;

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
      const updates: Record<string, string> = {};
      if (googleUser.name && googleUser.name !== user.displayName) updates.displayName = googleUser.name;
      if (googleUser.email && googleUser.email !== user.email) updates.email = googleUser.email;
      if (Object.keys(updates).length > 0) {
        await db.update(users).set(updates).where(eq(users.id, user.id));
        user = { ...user, ...updates };
      }
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
        email: googleUser.email || null,
      }).returning();
      user = newUser;
    }

    const token = generateToken(user.id);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const pendingRows = await db.select().from(mobileAuthSessions)
      .where(eq(mobileAuthSessions.sessionId, sessionId)).limit(1);
    const pending = pendingRows.length > 0 ? parsePendingTokenValue(pendingRows[0].token) : null;
    const bindNonce = readCookie(req, BIND_COOKIE_NAME);

    if (pending && bindNonce && timingSafeEqual(pending.stateHash, sha256(state)) && timingSafeEqual(pending.bindHash, sha256(bindNonce))) {
      await db.update(mobileAuthSessions)
        .set({ token: completeTokenValue(pending.pollHash, pending.bindHash, token), expiresAt })
        .where(eq(mobileAuthSessions.sessionId, sessionId));
    }

    return res.send(successHtml(token));
  } catch (err) {
    console.error("Mobile auth callback error:", err);
    return res.send(errorHtml("An unexpected error occurred. Please try again."));
  }
});

mobileAuthRouter.get("/poll", async (req: Request, res: Response) => {
  const { session_id, poll_secret } = req.query as Record<string, string>;
  if (!session_id) return res.status(400).json({ error: "session_id required" });
  if (!poll_secret) return res.status(400).json({ error: "poll_secret required" });
  if (!isValidSessionId(session_id) || !isValidPollSecret(poll_secret)) {
    return res.status(400).json({ error: "invalid polling credentials" });
  }

  try {
    await db.delete(mobileAuthSessions).where(lt(mobileAuthSessions.expiresAt, new Date()));

    const rows = await db.select().from(mobileAuthSessions)
      .where(eq(mobileAuthSessions.sessionId, session_id)).limit(1);

    if (rows.length === 0) {
      return res.status(404).json({ ready: false });
    }

    const session = rows[0];
    if (parsePendingTokenValue(session.token)) {
      return res.status(404).json({ ready: false });
    }

    const completed = parseCompleteTokenValue(session.token);
    const bindNonce = readCookie(req, BIND_COOKIE_NAME);
    if (
      !completed ||
      !bindNonce ||
      !timingSafeEqual(completed.pollHash, sha256(poll_secret)) ||
      !timingSafeEqual(completed.bindHash, sha256(bindNonce))
    ) {
      return res.status(404).json({ ready: false });
    }

    await db.delete(mobileAuthSessions).where(eq(mobileAuthSessions.sessionId, session_id));

    return res.json({ ready: true, token: completed.token });
  } catch (err) {
    console.error("Mobile auth poll error:", err);
    return res.status(500).json({ ready: false, error: "Internal error" });
  }
});
