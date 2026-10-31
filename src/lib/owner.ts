import "server-only";
import { createHash, createHmac, scryptSync, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * Owner mode. The site is public; only the owner may use the API Setup tab
 * (personal Gemini key, model override, test-key, demo toggle).
 *
 * - The passcode lives only in the OWNER_PASSCODE environment variable.
 *   Shorter than 12 characters (or unset) → owner mode is off for everyone.
 * - Unlocking sets an HttpOnly, Secure, SameSite=Strict cookie holding
 *   "<expiry>.<HMAC-SHA256(expiry, scrypt(passcode))>". JavaScript can't read
 *   it, other sites can't send it, and it can't be forged without the passcode.
 * - Changing OWNER_PASSCODE signs every existing owner session out.
 */

export const OWNER_COOKIE = "pa_owner";
export const OWNER_SESSION_SECONDS = 30 * 24 * 3600;
const MIN_PASSCODE_LENGTH = 12;

function passcode(): string | null {
  const p = process.env.OWNER_PASSCODE?.trim();
  return p && p.length >= MIN_PASSCODE_LENGTH ? p : null;
}

export const ownerEnabled = (): boolean => passcode() !== null;

// scrypt makes guessing the passcode from a leaked cookie expensive; derived once per instance.
let derived: { passcode: string; key: Buffer } | null = null;
function signingKey(p: string): Buffer {
  if (derived?.passcode !== p) derived = { passcode: p, key: scryptSync(p, "pulsealpha-owner-v1", 32) };
  return derived.key;
}

function sign(payload: string, passcodeValue: string): string {
  return createHmac("sha256", signingKey(passcodeValue)).update(`pulsealpha-owner:${payload}`).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
}

export function issueOwnerToken(now = Date.now()): string | null {
  const key = passcode();
  if (!key) return null;
  const expires = String(now + OWNER_SESSION_SECONDS * 1000);
  return `${expires}.${sign(expires, key)}`;
}

export function verifyOwnerToken(token: string | null | undefined, now = Date.now()): boolean {
  const key = passcode();
  if (!key || !token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expires = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!/^\d{13}$/.test(expires) || Number(expires) < now) return false;
  return safeEqual(signature, sign(expires, key));
}

export function passcodeMatches(input: unknown): boolean {
  const key = passcode();
  if (!key || typeof input !== "string" || input.length > 256) return false;
  return safeEqual(input, key);
}

export function isOwnerRequest(req: NextRequest): boolean {
  return verifyOwnerToken(req.cookies.get(OWNER_COOKIE)?.value);
}

/**
 * CSRF guard for state-changing requests, on top of SameSite=Strict: a browser
 * request that declares itself cross-site, or whose Origin isn't this host, is
 * refused. Non-browser clients send neither header and are judged by the cookie.
 */
export function isSameOrigin(req: NextRequest): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// ── Brute-force brake ───────────────────────────────────────────────────────
// Best-effort per server instance: 5 wrong attempts per IP per 15 minutes.
// The real protection is a long passcode (20+ characters makes guessing
// hopeless); a Vercel Firewall rate-limit rule on /api/owner adds a global cap.

const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 5;
const failures = new Map<string, { count: number; since: number }>();

export function clientIp(req: NextRequest): string {
  return req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export function isLockedOut(ip: string, now = Date.now()): boolean {
  const f = failures.get(ip);
  if (!f) return false;
  if (now - f.since > WINDOW_MS) {
    failures.delete(ip);
    return false;
  }
  return f.count >= MAX_FAILURES;
}

export function recordFailure(ip: string, now = Date.now()): void {
  const f = failures.get(ip);
  if (!f || now - f.since > WINDOW_MS) failures.set(ip, { count: 1, since: now });
  else f.count++;
}

export function clearFailures(ip: string): void {
  failures.delete(ip);
}
