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
    }
  }
}

function generateToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

export const authRouter = Router();

function getGoogleRedirectUri(req: Request): string {
  const host = req.hostname;
  return `https://${host}/api/auth/google/callback`;
}

authRouter.get("/google/start", (req: Request, res: Response) => {
  const clientId = process.env.GOOGLE_WEB_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({ error: "Google client ID not configured" });
  }
  const redirectUri = getGoogleRedirectUri(req);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid profile email",
    access_type: "offline",
    prompt: "select_account",
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

authRouter.get("/google/callback", async (req: Request, res: Response) => {
  try {
    const { code, error } = req.query as { code?: string; error?: string };

    if (error || !code) {
      return res.redirect("/login?googleError=cancelled");
    }

    const clientId = process.env.GOOGLE_WEB_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return res.redirect("/login?googleError=config");
    }

    const redirectUri = getGoogleRedirectUri(req);

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error("Token exchange failed:", err);
      return res.redirect("/login?googleError=token");
    }

    const tokens = await tokenRes.json() as {
      access_token?: string;
      id_token?: string;
      error?: string;
    };

    if (tokens.error || !tokens.access_token) {
      return res.redirect("/login?googleError=token");
    }

    const userInfoRes = await fetch("https://www.googleapis.com/userinfo/v2/me", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userInfoRes.ok) {
      return res.redirect("/login?googleError=userinfo");
    }

    const googleUser = await userInfoRes.json() as {
      id: string;
      name?: string;
      email?: string;
    };

    if (!googleUser.id) {
      return res.redirect("/login?googleError=userinfo");
    }

    const existing = await db.select().from(users)
      .where(eq(users.googleId, googleUser.id)).limit(1);

    let user;
    if (existing.length > 0) {
      user = existing[0];
      if (googleUser.name && googleUser.name !== user.displayName) {
        await db.update(users).set({ displayName: googleUser.name }).where(eq(users.id, user.id));
        user = { ...user, displayName: googleUser.name };
      }
    } else {
      const base = googleUser.email ? googleUser.email.split("@")[0] : `google_${googleUser.id.slice(0, 8)}`;
      let uniqueUsername = base;
      const existingUsername = await db.select().from(users).where(eq(users.username, base)).limit(1);
      if (existingUsername.length > 0) {
        uniqueUsername = `${base}_${Date.now().toString(36)}`;
      }
      const [newUser] = await db.insert(users).values({
        username: uniqueUsername,
        googleId: googleUser.id,
        displayName: googleUser.name || uniqueUsername,
      }).returning();
      user = newUser;
    }

    const jwtToken = generateToken(user.id);
    const displayName = encodeURIComponent(user.displayName || user.username);
    res.redirect(`/login?googleToken=${jwtToken}&username=${displayName}`);
  } catch (error) {
    console.error("Google callback error:", error);
    res.redirect("/login?googleError=server");
  }
});

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
      if (googleUser.name && googleUser.name !== user.displayName) {
        await db.update(users)
          .set({ displayName: googleUser.name })
          .where(eq(users.id, user.id));
        user = { ...user, displayName: googleUser.name };
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
      }).returning();
      user = newUser;
    }

    const token = generateToken(user.id);

    res.json({
      token,
      userId: user.id,
      username: user.displayName || user.username,
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
    const payload = jwt.verify(token, JWT_SECRET) as { userId: string };

    const [user] = await db.select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      createdAt: users.createdAt,
    }).from(users).where(eq(users.id, payload.userId)).limit(1);

    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    res.json({
      userId: user.id,
      username: user.displayName || user.username,
    });
  } catch (error) {
    return res.status(401).json({ error: "Invalid token" });
  }
});

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.path.startsWith("/api/auth/")) {
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
    const payload = jwt.verify(token, JWT_SECRET) as { userId: string };
    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
