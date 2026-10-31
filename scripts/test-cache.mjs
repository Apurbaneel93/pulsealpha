/**
 * Proves the server cache works on a real `next start`, with Yahoo, Google
 * News and Gemini mocked at the fetch layer (scripts/mock-upstream.mjs).
 * Counts every upstream call across a sequence of requests, then restarts the
 * server to show entries survive a new process (as they do across Vercel
 * serverless instances).
 *
 * Run after `npm run build`:  npm run test:cache
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3124;
const BASE = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(path.join(tmpdir(), "pulsealpha-cache-"));
const LOG = path.join(dir, "upstream.log");
writeFileSync(LOG, "");

// Start from an empty server cache so the first request is a genuine miss.
rmSync(path.join(root, ".next", "cache", "fetch-cache"), { recursive: true, force: true });

function counts() {
  const lines = readFileSync(LOG, "utf8").split("\n").filter(Boolean);
  return { yahoo: lines.filter((l) => l === "yahoo").length, news: lines.filter((l) => l === "news").length, gemini: lines.filter((l) => l === "gemini").length };
}

async function startServer() {
  const child = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "start", "-p", String(PORT)], {
    cwd: root,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      MOCK_UPSTREAM: "1",
      MOCK_UPSTREAM_LOG: LOG,
      GEMINI_API_KEY: "server-test-key",
      NODE_OPTIONS: `--import ${path.join(root, "scripts/mock-upstream.mjs")}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`${BASE}/api/config`);
      if (r.ok) return child;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill();
  throw new Error(`server did not start:\n${output}`);
}

async function stopServer(child) {
  child.kill("SIGTERM");
  await new Promise((r) => child.once("exit", r));
}

let requests = 0;
async function call(label, init) {
  requests++;
  const before = counts();
  const t0 = performance.now();
  const res = await fetch(`${BASE}/api/scan`, init);
  const ms = Math.round(performance.now() - t0);
  const body = await res.json();
  assert.equal(res.status, 200, `${label}: ${JSON.stringify(body)}`);
  const after = counts();
  const delta = { yahoo: after.yahoo - before.yahoo, news: after.news - before.news, gemini: after.gemini - before.gemini };
  const cache = body.cache ? `market=${body.cache.market} ai=${body.cache.ai ?? "-"}` : "n/a";
  console.log(
    `  ${label.padEnd(34)} ${String(ms).padStart(5)}ms  ${cache.padEnd(22)} yahoo+${delta.yahoo} news+${delta.news} gemini+${delta.gemini}  ${body.picks.map((p) => p.symbol).join(",")}`,
  );
  return { body, delta };
}

const post = (body, headers = {}) => ({ method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

let server = await startServer();
try {
  console.log("Server cache test (next start, mocked upstream)\n");
  const first = await call("GET  /api/scan   (cold)", undefined);
  assert.equal(first.body.simulated, false);
  assert.equal(first.body.cache.market, "miss");
  assert.equal(first.body.cache.ai, "miss");
  assert.ok(first.delta.yahoo >= 90 && first.delta.gemini === 1);

  const second = await call("GET  /api/scan   (warm)", undefined);
  assert.equal(second.body.cache.market, "hit");
  assert.equal(second.body.cache.ai, "hit");
  assert.deepEqual(second.delta, { yahoo: 0, news: 0, gemini: 0 });
  assert.equal(second.body.id, first.body.id, "same scan for every user");

  const scanNow = await call("POST live      (Scan Market Now)", post({ mode: "live" }));
  assert.deepEqual(scanNow.delta, { yahoo: 0, news: 0, gemini: 0 });
  assert.equal(scanNow.body.id, first.body.id);

  const ownKey = await call("POST live + personal Gemini key", post({ mode: "live" }, { "x-gemini-key": "user-key" }));
  assert.equal(ownKey.body.cache.market, "hit");
  assert.equal(ownKey.body.cache.ai, "miss", "personal keys are never served someone else's AI output");
  assert.equal(ownKey.delta.yahoo, 0);
  assert.equal(ownKey.delta.gemini, 1);

  const demo = await call("POST demo", post({ mode: "demo" }));
  assert.equal(demo.body.cache, null);
  assert.deepEqual(demo.delta, { yahoo: 0, news: 0, gemini: 0 });

  await stopServer(server);
  server = await startServer();
  const restarted = await call("GET  /api/scan   (new process)", undefined);
  assert.equal(restarted.body.cache.market, "hit", "entries survive a new server process");
  assert.deepEqual(restarted.delta, { yahoo: 0, news: 0, gemini: 0 });
  assert.equal(restarted.body.id, first.body.id);

  // Accuracy report: built once, then served from cache.
  for (const label of ["GET  /api/verify   (cold)", "GET  /api/verify   (warm)"]) {
    const before = counts();
    const t0 = performance.now();
    const res = await fetch(`${BASE}/api/verify`);
    const body = await res.json();
    const d = counts().yahoo - before.yahoo;
    assert.equal(res.status, 200, JSON.stringify(body).slice(0, 300));
    assert.ok(body.backtest.horizons.length === 2 && body.todayFunnel.scanned >= 90);
    if (label.includes("warm")) assert.equal(d, 0, "verify report served from cache");
    console.log(`  ${label.padEnd(34)} ${String(Math.round(performance.now() - t0)).padStart(5)}ms  yahoo+${d}  funnel passed=${body.todayFunnel.passedAll}`);
  }

  if (process.env.CACHE_TEST_REVALIDATE === "1") {
    // Slow path (~3 min): let the 180 s revalidate window lapse.
    console.log("\n  waiting 185 s for revalidate: 180 to lapse…");
    await new Promise((r) => setTimeout(r, 185_000));
    const stale = await call("GET  /api/scan   (after 185 s)", undefined);
    assert.equal(stale.body.cache.market, "stale", "served stale while Next refreshes in the background");
    await new Promise((r) => setTimeout(r, 3_000));
    const refreshed = await call("GET  /api/scan   (refreshed)", undefined);
    assert.equal(refreshed.body.cache.market, "hit");
    assert.notEqual(refreshed.body.id, first.body.id, "background revalidation stored new market data");
  }

  const total = counts();
  console.log(`\n  ${requests} requests, 2 server processes → yahoo ${total.yahoo}, news ${total.news}, gemini ${total.gemini} upstream calls`);
  console.log("\n✓ server cache OK");
} finally {
  await stopServer(server);
  rmSync(dir, { recursive: true, force: true });
}
