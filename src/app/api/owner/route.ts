import { NextResponse, type NextRequest } from "next/server";
import {
  OWNER_COOKIE,
  OWNER_SESSION_SECONDS,
  clearFailures,
  clientIp,
  isLockedOut,
  isOwnerRequest,
  isSameOrigin,
  issueOwnerToken,
  ownerEnabled,
  passcodeMatches,
  recordFailure,
} from "@/lib/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const secure = process.env.NODE_ENV === "production";

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { ...NO_STORE, ...extra } });

/** Is owner sign-in configured, and is this browser signed in? */
export async function GET(req: NextRequest): Promise<NextResponse> {
  return json({ enabled: ownerEnabled(), owner: isOwnerRequest(req) });
}

/** Sign in. Body: { passcode }. Sets an HttpOnly, SameSite=Strict session cookie. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return json({ ok: false, error: "Cross-site request refused." }, 403);
  if (!ownerEnabled()) {
    return json({ ok: false, error: "Owner sign-in isn't set up on this site yet." }, 503);
  }
  const ip = clientIp(req);
  if (isLockedOut(ip)) {
    return json({ ok: false, error: "Too many wrong attempts. Try again in 15 minutes." }, 429, { "Retry-After": "900" });
  }

  let passcode: unknown;
  try {
    passcode = (JSON.parse(await req.text()) as { passcode?: unknown }).passcode;
  } catch {
    passcode = undefined;
  }
  if (!passcodeMatches(passcode)) {
    recordFailure(ip);
    await new Promise((r) => setTimeout(r, 500)); // slows scripted guessing
    return json({ ok: false, error: "Incorrect passcode." }, 401);
  }

  clearFailures(ip);
  const token = issueOwnerToken();
  if (!token) return json({ ok: false, error: "Owner sign-in isn't set up on this site yet." }, 503);
  const res = json({ ok: true });
  res.cookies.set({
    name: OWNER_COOKIE,
    value: token,
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/",
    maxAge: OWNER_SESSION_SECONDS,
  });
  return res;
}

/** Sign out of this browser. */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return json({ ok: false, error: "Cross-site request refused." }, 403);
  const res = json({ ok: true });
  res.cookies.set({ name: OWNER_COOKIE, value: "", httpOnly: true, secure, sameSite: "strict", path: "/", maxAge: 0 });
  return res;
}
