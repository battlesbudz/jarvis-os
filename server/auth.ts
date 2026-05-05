import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "./db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";

import crypto from "crypto";

function getJwtSecret(): string {
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }
  const generated = crypto.randomBytes(32).toString("hex");
  process.env.JWT_SECRET = generated;
  console.log("Generated JWT_SECRET (set JWT_SECRET env var for persistent tokens across restarts)");
  return generated;
}

const JWT_SECRET = getJwtSecret();
const TOKEN_EXPIRY = "30d";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      authScope?: "user" | "webchat";
    }
  }
}

export function generateToken(userId: string): string {
  return jwt.sign({ userId, scope: "user" }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

export function generateWebchatToken(userId: string): string {
  return jwt.sign({ userId, scope: "webchat" }, JWT_SECRET, { expiresIn: "24h" });
}

function isWebchatScopedPath(req: Request): boolean {
  if (req.method === "GET" && req.path === "/api/webchat/events") return true;
  if (req.method === "POST" && req.path === "/api/coach/chat") return true;
  if (["GET", "PUT", "DELETE"].includes(req.method) && req.path === "/api/data/chat-history") return true;
  if (["GET", "PUT"].includes(req.method) && req.path === "/api/data/coach-session-id") return true;
  return false;
}

function stripPort(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (trimmed.startsWith("[::1]")) return "::1";
  return trimmed.split(":")[0] || trimmed;
}

function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  const normalised = stripPort(host.split(",")[0] || "");
  return normalised === "localhost" || normalised === "127.0.0.1" || normalised === "::1";
}

function isLoopbackIp(ip: string | undefined): boolean {
  if (!ip) return true;
  const normalised = ip.trim().toLowerCase();
  return normalised === "::1" ||
    normalised === "127.0.0.1" ||
    normalised === "::ffff:127.0.0.1" ||
    normalised.startsWith("127.");
}

function isLocalDashboardRequest(req: Request): boolean {
  const host = (req.headers["x-forwarded-host"] as string | undefined) || req.headers.host;
  if (!isLoopbackHost(host)) return false;

  const forwardedFor = (req.headers["x-forwarded-for"] as string | undefined)
    ?.split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);
  if (forwardedFor?.length && !forwardedFor.every(isLoopbackIp)) return false;

  return isLoopbackIp(req.socket.remoteAddress);
}

export const authRouter = Router();

authRouter.post("/register", async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }

    if (username.length < 3) {
      return res.status(400).json({ error: "Username must be at least 3 characters" });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const existing = await db.select().from(users).where(eq(users.username, username)).limit(1);
    if (existing.length > 0) {
      return res.status(409).json({ error: "Username already taken" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [user] = await db.insert(users).values({
      username,
      password: hashedPassword,
    }).returning();

    const token = generateToken(user.id);

    res.status(201).json({
      token,
      userId: user.id,
      username: user.username,
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ error: "Failed to create account" });
  }
});

authRouter.post("/login", async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }

    const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);
    if (!user) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    if (!user.password) {
      return res.status(401).json({ error: "This account uses Google Sign-In" });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const token = generateToken(user.id);

    res.json({
      token,
      userId: user.id,
      username: user.username,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Failed to log in" });
  }
});

authRouter.post("/google", async (req: Request, res: Response) => {
  try {
    const { idToken, accessToken } = req.body;

    if (!idToken && !accessToken) {
      return res.status(400).json({ error: "ID token or access token is required" });
    }

    let googleUser: { id: string; name?: string; email?: string };

    if (idToken) {
      const tokenInfoRes = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`
      );

      if (!tokenInfoRes.ok) {
        return res.status(401).json({ error: "Invalid Google ID token" });
      }

      const tokenInfo = await tokenInfoRes.json() as {
        sub: string;
        name?: string;
        email?: string;
        aud?: string;
        error_description?: string;
      };

      if (tokenInfo.error_description) {
        return res.status(401).json({ error: "Invalid Google ID token" });
      }

      const validClientIds = [
        process.env.GOOGLE_WEB_CLIENT_ID,
        process.env.GOOGLE_IOS_CLIENT_ID,
        process.env.GOOGLE_ANDROID_CLIENT_ID,
      ].filter(Boolean);

      if (validClientIds.length > 0 && tokenInfo.aud && !validClientIds.includes(tokenInfo.aud)) {
        return res.status(401).json({ error: "Token audience mismatch" });
      }

      if (!tokenInfo.sub) {
        return res.status(401).json({ error: "Could not retrieve Google user info" });
      }

      googleUser = { id: tokenInfo.sub, name: tokenInfo.name, email: tokenInfo.email };
    } else {
      const userInfoRes = await fetch(
        `https://www.googleapis.com/userinfo/v2/me`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (!userInfoRes.ok) {
        return res.status(401).json({ error: "Invalid Google access token" });
      }

      const info = await userInfoRes.json() as {
        id: string;
        name?: string;
        email?: string;
      };

      if (!info.id) {
        return res.status(401).json({ error: "Could not retrieve Google user info" });
      }

      googleUser = info;
    }

    if (!googleUser.id) {
      return res.status(401).json({ error: "Could not retrieve Google user info" });
    }

    const existing = await db.select().from(users)
      .where(eq(users.googleId, googleUser.id))
      .limit(1);

    let user;
    if (existing.length > 0) {
      user = existing[0];
      const updates: Partial<typeof users.$inferInsert> = {};
      if (googleUser.name && googleUser.name !== user.displayName) updates.displayName = googleUser.name;
      if (googleUser.email && googleUser.email !== user.email) updates.email = googleUser.email;
      if (Object.keys(updates).length > 0) {
        await db.update(users).set(updates).where(eq(users.id, user.id));
        user = { ...user, ...updates };
      }
    } else {
      const username = googleUser.email
        ? googleUser.email.split("@")[0]
        : `google_${googleUser.id.slice(0, 8)}`;

      let uniqueUsername = username;
      const existingUsername = await db.select().from(users)
        .where(eq(users.username, username)).limit(1);
      if (existingUsername.length > 0) {
        uniqueUsername = `${username}_${Date.now().toString(36)}`;
      }

      const [newUser] = await db.insert(users).values({
        username: uniqueUsername,
        googleId: googleUser.id,
        displayName: googleUser.name || uniqueUsername,
        email: googleUser.email || null,
      }).returning();
      user = newUser;
    }

    const token = generateToken(user.id);

    res.json({
      token,
      userId: user.id,
      username: user.displayName || user.username,
      email: user.email || null,
    });
  } catch (error) {
    console.error("Google auth error:", error);
    res.status(500).json({ error: "Failed to authenticate with Google" });
  }
});

authRouter.get("/me", async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No token provided" });
    }

    const token = authHeader.slice(7);
    const payload = jwt.verify(token, JWT_SECRET) as { userId: string; scope?: string };
    if (payload.scope === "webchat") {
      return res.status(401).json({ error: "Invalid token" });
    }

    const [user] = await db.select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      email: users.email,
      createdAt: users.createdAt,
    }).from(users).where(eq(users.id, payload.userId)).limit(1);

    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    res.json({
      userId: user.id,
      username: user.displayName || user.username,
      email: user.email || null,
    });
  } catch (error) {
    return res.status(401).json({ error: "Invalid token" });
  }
});

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.path.startsWith("/api/auth/")) {
    return next();
  }

  if (req.path === "/api/oauth/google/callback" || req.path === "/api/oauth/microsoft/callback") {
    return next();
  }

  if (!req.path.startsWith("/api/")) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    const token = authHeader.slice(7);

    // Dashboard internal secret — localhost-only bypass
    const dashSecret = process.env.DASHBOARD_SECRET;
    if (dashSecret && token === dashSecret && isLocalDashboardRequest(req)) {
      const [firstUser] = await db.select({ id: users.id }).from(users).limit(1);
      if (firstUser) {
        req.userId = firstUser.id;
        req.authScope = "user";
        return next();
      }
    }

    const payload = jwt.verify(token, JWT_SECRET) as { userId: string; scope?: string };
    if (payload.scope === "webchat" && !isWebchatScopedPath(req)) {
      return res.status(403).json({ error: "Webchat token is not allowed for this endpoint" });
    }
    req.userId = payload.userId;
    req.authScope = payload.scope === "webchat" ? "webchat" : "user";
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

/**
 * Non-middleware version: extracts and validates the bearer token from a request
 * and returns the userId, or null if unauthenticated. Does NOT send any response.
 * Safe to use inside async route handlers alongside other auth strategies.
 */
export async function getUserIdFromRequest(req: Request): Promise<string | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const token = authHeader.slice(7);
    const dashSecret = process.env.DASHBOARD_SECRET;
    if (dashSecret && token === dashSecret && isLocalDashboardRequest(req)) {
      const [firstUser] = await db.select({ id: users.id }).from(users).limit(1);
      return firstUser?.id ?? null;
    }
    const payload = jwt.verify(token, JWT_SECRET) as { userId: string; scope?: string };
    if (payload.scope === "webchat" && !isWebchatScopedPath(req)) return null;
    return payload.userId ?? null;
  } catch {
    return null;
  }
}
