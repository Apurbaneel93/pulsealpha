/**
 * Access-control test on a real `next start` (Yahoo, News and Gemini mocked):
 * visitors get the shared scan and nothing else; the owner cookie unlocks
 * personal keys, model overrides, demo mode, key testing and the accuracy
 * report; forged, cross-site and brute-force attempts fail.
 *
 * Run after `npm run build`:  npm run test:access
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3125;
const BASE = `http://127.0.0.1:${PORT}`;
const PASS = "correct horse battery staple 42";
const dir = mkdtempSync(path.join(tmpdir(), "pulsealpha-access-"));
const LOG = path.join(dir, "upstream.log");
writeFileSync(LOG, "");

async function startServer(env = {}) {
  const child = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "start", "-p", String(PORT)], {
    cwd: root,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      MOCK_UPSTREAM: "1",
      MOCK_UPSTREAM_LOG: LOG,
      GEMINI_API_KEY: "server-test-key",
      OWNER_PASSCODE: PASS,
      NODE_OPTIONS: `--import ${path.join(root, "scripts/mock-upstream.mjs")}`,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${BASE}/api/config`)).ok) return child;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill();
  throw new Error(`server did not start:\n${output}`);
}
const stop = async (c) => {
  c.kill("SIGTERM");
  await new Promise((r) => c.once("exit", r));
};

let checks = 0;
const ok = (cond, msg) => {
  assert.ok(cond, msg);
  checks++;
  console.log(`  ✓ ${msg}`);
};

const jsonPost = (body, headers = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});
const api = (p, init) => fetch(`${BASE}${p}`, init);

async function signIn(passcode = PASS, headers = {}) {
  return api("/api/owner", jsonPost({ passcode }, headers));
}
const cookieOf = (res) => {
  const raw = res.headers.getSetCookie().find((c) => c.startsWith("pa_owner="));
  return raw ? raw.split(";")[0] : null;
};

let server = await startServer();
try {
  console.log("Access-control test (next start, mocked upstream)\n");

  console.log("Visitor (no cookie)");
  const cfg = await (await api("/api/config")).json();
  assert.deepEqual(cfg, { owner: false, ownerEnabled: true, hasServerKey: false, defaultModel: cfg.defaultModel, marketRefreshSeconds: 180 });
  ok(cfg.owner === false && cfg.hasServerKey === false, "config: not owner, and the server-key status is hidden");

  const pub = await api("/api/scan");
  ok(pub.status === 200 && (await pub.json()).picks.length >= 2, "GET /api/scan: shared scan works for everyone");

  for (const [label, init] of [
    ["POST /api/scan (live)", jsonPost({ mode: "live" })],
    ["POST /api/scan (demo)", jsonPost({ mode: "demo" })],
    ["POST /api/scan with a Gemini key", jsonPost({ mode: "live" }, { "x-gemini-key": "AIza-attacker" })],
    ["POST /api/scan with a model override", jsonPost({ mode: "live", model: "gemini-3.5-pro" })],
  ]) {
    const r = await api("/api/scan", init);
    ok(r.status === 401, `${label}: 401 for visitors`);
  }
  ok((await api("/api/verify-key", jsonPost({}))).status === 401, "POST /api/verify-key: 401 (can't burn the server key or test stolen keys)");
  ok((await api("/api/verify-key", jsonPost({}, { "x-gemini-key": "AIza-stolen" }))).status === 401, "POST /api/verify-key with a key: 401");
  ok((await api("/api/verify")).status === 401, "GET /api/verify: 401 (heavy report is owner-only)");

  const page = await api("/");
  ok(page.status === 200, "home page is public");
  const html = await page.text();
  ok(!html.includes("AIza") && !html.includes("server-test-key") && !html.includes(PASS), "no secrets in the served HTML");
  for (const [h, v] of [
    ["x-frame-options", "DENY"],
    ["x-content-type-options", "nosniff"],
    ["referrer-policy", "strict-origin-when-cross-origin"],
  ]) ok(page.headers.get(h) === v, `header ${h}: ${v}`);
  const csp = page.headers.get("content-security-policy") ?? "";
  ok(csp.includes("frame-ancestors 'none'") && csp.includes("object-src 'none'") && csp.includes("connect-src 'self'") && !/https?:\/\//.test(csp), "CSP locks scripts, framing and requests to this origin");
  ok(/permissions-policy/i.test([...page.headers.keys()].join(",")) && page.headers.has("strict-transport-security"), "Permissions-Policy and HSTS present");
  ok(page.headers.get("x-powered-by") === null, "no X-Powered-By");
  const ownerPage = await api("/owner");
  const ownerHtml = await ownerPage.text();
  ok(ownerPage.status === 200 && /noindex/.test(ownerHtml), "/owner sign-in page loads and is noindex");

  console.log("\nSign-in");
  const bad = await signIn("wrong passcode here");
  ok(bad.status === 401 && cookieOf(bad) === null, "wrong passcode: 401, no cookie");
  const cross = await signIn(PASS, { origin: "https://evil.example" });
  ok(cross.status === 403 && cookieOf(cross) === null, "right passcode from another site's origin: 403, no cookie");
  const crossFetch = await signIn(PASS, { "sec-fetch-site": "cross-site" });
  ok(crossFetch.status === 403, "browser-declared cross-site request: 403");

  const good = await signIn();
  const cookie = cookieOf(good);
  const setCookie = good.headers.getSetCookie().find((c) => c.startsWith("pa_owner=")) ?? "";
  ok(good.status === 200 && cookie !== null, "right passcode: 200 and a session cookie");
  ok(/HttpOnly/i.test(setCookie) && /SameSite=strict/i.test(setCookie) && /Secure/i.test(setCookie) && /Path=\//i.test(setCookie), "cookie is HttpOnly, Secure, SameSite=Strict");
  ok(!setCookie.includes(PASS) && !JSON.stringify(await good.json()).includes(PASS), "passcode is never echoed back");

  console.log("\nForged cookies");
  const [exp, sig] = cookie.slice("pa_owner=".length).split(".");
  for (const [label, value] of [
    ["random value", "pa_owner=hello"],
    ["valid shape, wrong signature", `pa_owner=${exp}.${"A".repeat(43)}`],
    ["extended expiry", `pa_owner=${Number(exp) + 10 ** 10}.${sig}`],
    ["expired", `pa_owner=${Date.now() - 1000}.${sig}`],
    ["empty", "pa_owner="],
  ]) {
    const r = await api("/api/scan", { ...jsonPost({ mode: "demo" }), headers: { "content-type": "application/json", cookie: value } });
    ok(r.status === 401, `forged cookie (${label}): 401`);
  }

  console.log("\nOwner (valid cookie)");
  const H = { cookie };
  const cfg2 = await (await api("/api/config", { headers: H })).json();
  ok(cfg2.owner === true && cfg2.hasServerKey === true, "config: owner, server-key status visible");
  const demo = await api("/api/scan", jsonPost({ mode: "demo" }, H));
  ok(demo.status === 200 && (await demo.json()).mode === "demo", "POST /api/scan demo mode works");
  const withKey = await api("/api/scan", jsonPost({ mode: "live" }, { ...H, "x-gemini-key": "owner-personal-key" }));
  ok(withKey.status === 200, "POST /api/scan with a personal key works");
  const vk = await api("/api/verify-key", jsonPost({}, H));
  ok(vk.status === 200 && (await vk.json()).ok === true, "POST /api/verify-key works");
  const rep = await api("/api/verify", { headers: H });
  ok(rep.status === 200 && (await rep.json()).backtest, "GET /api/verify works");
  const csrf = await api("/api/scan", jsonPost({ mode: "demo" }, { ...H, origin: "https://evil.example" }));
  ok(csrf.status === 403, "valid cookie + foreign Origin on POST /api/scan: 403 (CSRF guard)");
  const status = await (await api("/api/owner", { headers: H })).json();
  ok(status.owner === true && status.enabled === true, "GET /api/owner reports signed in");

  console.log("\nSign-out");
  const out = await api("/api/owner", { method: "DELETE", headers: H });
  const cleared = out.headers.getSetCookie().find((c) => c.startsWith("pa_owner=")) ?? "";
  ok(out.status === 200 && /Max-Age=0/i.test(cleared), "DELETE /api/owner clears the cookie");

  console.log("\nBrute force");
  const ip = { "x-real-ip": "203.0.113.9" };
  for (let i = 1; i <= 5; i++) assert.equal((await signIn(`guess number ${i} xxxx`, ip)).status, 401);
  const locked = await signIn(PASS, ip);
  ok(locked.status === 429 && locked.headers.get("retry-after") === "900" && cookieOf(locked) === null, "after 5 misses, even the right passcode gets 429 and no cookie");
  ok((await signIn(PASS, { "x-real-ip": "203.0.113.10" })).status === 200, "a different visitor is not locked out");

  await stop(server);

  console.log("\nOwner mode not configured");
  server = await startServer({ OWNER_PASSCODE: "" });
  const off = await (await api("/api/config")).json();
  ok(off.ownerEnabled === false && off.owner === false, "config: ownerEnabled false");
  ok((await signIn()).status === 503, "sign-in refuses with 503");
  ok((await api("/api/scan", jsonPost({ mode: "demo" }, { cookie }))).status === 401, "an old cookie opens nothing");
  ok((await api("/api/scan")).status === 200, "the public scan still works");

  await stop(server);

  console.log("\nShort passcode");
  server = await startServer({ OWNER_PASSCODE: "short" });
  ok((await signIn("short")).status === 503, "passcodes under 12 characters are treated as not configured");

  console.log(`\n✓ access control OK (${checks} checks)`);
} finally {
  await stop(server).catch(() => {});
  rmSync(dir, { recursive: true, force: true });
}
