/**
 * Unit tests for owner-mode primitives (src/lib/owner.ts): token signing,
 * expiry, tampering, passcode length rule, CSRF guard and the lockout brake.
 *
 * Run: npm run test:owner
 */
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

const PASS = "correct horse battery staple 42";
process.env.OWNER_PASSCODE = PASS;

async function main() {
  const o = await import("../src/lib/owner");
  const req = (headers: Record<string, string> = {}) => new NextRequest("https://pulsealpha.example/api/owner", { method: "POST", headers });

  console.log("Owner-mode unit tests");

  // enablement
  assert.equal(o.ownerEnabled(), true);
  process.env.OWNER_PASSCODE = "short";
  assert.equal(o.ownerEnabled(), false, "passcodes under 12 characters switch owner mode off");
  assert.equal(o.issueOwnerToken(), null);
  assert.equal(o.passcodeMatches("short"), false);
  delete process.env.OWNER_PASSCODE;
  assert.equal(o.ownerEnabled(), false);
  assert.equal(o.verifyOwnerToken("1999999999999.abc"), false);
  process.env.OWNER_PASSCODE = PASS;
  console.log("  ✓ unset or short passcode = nobody can be owner");

  // passcode comparison
  assert.equal(o.passcodeMatches(PASS), true);
  assert.equal(o.passcodeMatches(PASS + " "), false);
  assert.equal(o.passcodeMatches(PASS.toUpperCase()), false);
  assert.equal(o.passcodeMatches(""), false);
  assert.equal(o.passcodeMatches(undefined), false);
  assert.equal(o.passcodeMatches(12345), false);
  assert.equal(o.passcodeMatches("x".repeat(5000)), false);
  console.log("  ✓ only the exact passcode matches");

  // tokens
  const now = Date.UTC(2026, 10, 1, 9, 0, 0);
  const token = o.issueOwnerToken(now)!;
  assert.match(token, /^\d{13}\.[A-Za-z0-9_-]{43}$/);
  assert.equal(o.verifyOwnerToken(token, now + 1000), true);
  assert.equal(o.verifyOwnerToken(token, now + o.OWNER_SESSION_SECONDS * 1000 + 1), false, "expired");
  const [exp, sig] = token.split(".") as [string, string];
  assert.equal(o.verifyOwnerToken(`${Number(exp) + 86_400_000}.${sig}`, now), false, "extended expiry is rejected");
  assert.equal(o.verifyOwnerToken(`${exp}.${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`, now), false, "flipped signature");
  assert.equal(o.verifyOwnerToken(`${exp}.`, now), false);
  assert.equal(o.verifyOwnerToken(`.${sig}`, now), false);
  assert.equal(o.verifyOwnerToken("garbage", now), false);
  assert.equal(o.verifyOwnerToken("", now), false);
  assert.equal(o.verifyOwnerToken(undefined, now), false);
  assert.equal(o.verifyOwnerToken(null, now), false);
  console.log("  ✓ tokens: valid, expired, extended, forged and malformed");

  // rotating the passcode signs everyone out
  process.env.OWNER_PASSCODE = "a completely different passcode";
  assert.equal(o.verifyOwnerToken(token, now + 1000), false, "old sessions die when OWNER_PASSCODE changes");
  process.env.OWNER_PASSCODE = PASS;
  assert.equal(o.verifyOwnerToken(token, now + 1000), true);
  console.log("  ✓ changing OWNER_PASSCODE invalidates existing sessions");

  // request helpers
  const validCookie = o.issueOwnerToken()!;
  assert.equal(o.isOwnerRequest(req({ cookie: `${o.OWNER_COOKIE}=${validCookie}` })), true);
  assert.equal(o.isOwnerRequest(req({ cookie: `${o.OWNER_COOKIE}=${validCookie}x` })), false);
  assert.equal(o.isOwnerRequest(req({ cookie: `other=1` })), false);
  assert.equal(o.isOwnerRequest(req()), false);
  console.log("  ✓ cookie on a request is checked, absent/forged cookie is not owner");

  // CSRF guard
  const host = { host: "pulsealpha.example" };
  assert.equal(o.isSameOrigin(req({ ...host, origin: "https://pulsealpha.example" })), true);
  assert.equal(o.isSameOrigin(req({ ...host, origin: "https://evil.example" })), false);
  assert.equal(o.isSameOrigin(req({ ...host, origin: "null" })), false);
  assert.equal(o.isSameOrigin(req({ ...host, "sec-fetch-site": "cross-site" })), false);
  assert.equal(o.isSameOrigin(req({ ...host, "sec-fetch-site": "same-site" })), false);
  assert.equal(o.isSameOrigin(req({ ...host, "sec-fetch-site": "same-origin", origin: "https://pulsealpha.example" })), true);
  assert.equal(o.isSameOrigin(req({ ...host })), true, "non-browser clients send no Origin");
  assert.equal(o.isSameOrigin(req({ host: "internal", "x-forwarded-host": "pulsealpha.example", origin: "https://pulsealpha.example" })), true);
  console.log("  ✓ cross-site and mismatched-origin requests are refused");

  // lockout
  const t0 = Date.UTC(2026, 10, 1, 9, 0, 0);
  for (let i = 0; i < 4; i++) o.recordFailure("1.2.3.4", t0 + i);
  assert.equal(o.isLockedOut("1.2.3.4", t0 + 10), false, "4 failures: not locked");
  o.recordFailure("1.2.3.4", t0 + 5);
  assert.equal(o.isLockedOut("1.2.3.4", t0 + 10), true, "5 failures: locked");
  assert.equal(o.isLockedOut("5.6.7.8", t0 + 10), false, "other IPs unaffected");
  assert.equal(o.isLockedOut("1.2.3.4", t0 + 15 * 60_000 + 10), false, "lock expires after 15 minutes");
  o.recordFailure("9.9.9.9", t0);
  o.clearFailures("9.9.9.9");
  assert.equal(o.isLockedOut("9.9.9.9", t0), false);
  assert.equal(o.clientIp(req({ "x-real-ip": "7.7.7.7", "x-forwarded-for": "8.8.8.8" })), "7.7.7.7");
  assert.equal(o.clientIp(req({ "x-forwarded-for": "8.8.8.8, 10.0.0.1" })), "8.8.8.8");
  console.log("  ✓ five wrong passcodes lock an IP for 15 minutes");

  console.log("\n✓ owner mode OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
