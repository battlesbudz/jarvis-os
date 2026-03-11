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
      createdAt: users.createdAt,
    }).from(users).where(eq(users.id, payload.userId)).limit(1);

    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    res.json({
      userId: user.id,
      username: user.username,
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
