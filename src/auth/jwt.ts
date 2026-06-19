import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { query, queryOne } from "../db/client.js";

const SECRET = process.env.JWT_SECRET ?? "change-me-in-production";
const TTL_SECONDS = 60 * 60 * 8; // 8 hours

// ── Minimal JWT (HS256, no external deps) ────────────────────────────────

function b64url(buf: Buffer | string): string {
  const s = typeof buf === "string" ? buf : buf.toString("base64");
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function signToken(payload: Record<string, unknown>): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(Buffer.from(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000) })));
  const sig = b64url(createHmac("sha256", SECRET).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expected = b64url(createHmac("sha256", SECRET).update(`${header}.${body}`).digest());
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as Record<string, unknown>;
    const iat = payload.iat as number;
    if (Date.now() / 1000 - iat > TTL_SECONDS) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Password hashing (PBKDF2) ─────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  const { pbkdf2 } = await import("crypto");
  const salt = randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    pbkdf2(password, salt, 100_000, 32, "sha256", (err, key) => {
      if (err) reject(err);
      else resolve(`${salt}:${key.toString("hex")}`);
    });
  });
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const { pbkdf2 } = await import("crypto");
  const [salt, hash] = stored.split(":");
  return new Promise((resolve, reject) => {
    pbkdf2(password, salt, 100_000, 32, "sha256", (err, key) => {
      if (err) reject(err);
      else resolve(timingSafeEqual(Buffer.from(hash, "hex"), key));
    });
  });
}

// ── User management ───────────────────────────────────────────────────────

export interface DashboardUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "manager" | "viewer";
  isActive: boolean;
}

export async function loginUser(email: string, password: string): Promise<string | null> {
  const user = await queryOne<{ id: string; password_hash: string; name: string; role: string; is_active: boolean }>(
    `SELECT id, password_hash, name, role, is_active FROM dashboard_users WHERE email=$1`,
    [email.toLowerCase()]
  );
  if (!user || !user.is_active) return null;
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return null;
  await query(`UPDATE dashboard_users SET last_login_at=NOW() WHERE id=$1`, [user.id]);
  return signToken({ sub: user.id, email, name: user.name, role: user.role });
}

export async function createUser(
  email: string,
  password: string,
  name: string,
  role: "admin" | "manager" | "viewer" = "viewer"
): Promise<DashboardUser> {
  const hash = await hashPassword(password);
  const row = await queryOne<{ id: string }>(
    `INSERT INTO dashboard_users (email, password_hash, name, role)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [email.toLowerCase(), hash, name, role]
  );
  return { id: row!.id, email: email.toLowerCase(), name, role, isActive: true };
}
