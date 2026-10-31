/**
 * Offline end-to-end test of the LIVE pipeline (no network, no keys): Yahoo
 * Finance, Google News and Gemini are served by scripts/mock-upstream.mjs.
 * The Next.js cache layer is swapped for direct loaders here; see
 * scripts/test-cache.mjs for the same pipeline behind the real server cache.
 *
 * Run: npm run test:live
 */
import assert from "node:assert/strict";
// @ts-expect-error — plain JS test helper without type declarations
import { calls, geminiRequests, installMockUpstream } from "./mock-upstream.mjs";

const NOW = new Date("2026-11-02T03:00:00Z"); // Mon 08:30 IST, pre-open
installMockUpstream({ now: NOW });

async function main() {
  const { runScan, loadLiveMarketData } = await import("../src/lib/scanner");
  const { evaluateWithGemini } = await import("../src/lib/gemini");
  const { scanToHistory } = await import("../src/lib/history");
  const { WATCHLIST } = await import("../src/lib/watchlist");
  type Deps = Parameters<typeof runScan>[1];

  const direct: Deps = {
    getLiveMarketData: async (now) => ({ md: await loadLiveMarketData(now), cache: "miss" }),
    evaluateShared: async (input, model) => ({
      ai: await evaluateWithGemini({ apiKey: "server-key", model: model ?? undefined, input }),
      cache: "miss",
    }),
    evaluateWithKey: (input, apiKey, model) => evaluateWithGemini({ apiKey, model: model ?? undefined, input }),
    marketRefreshSeconds: 180,
  };

  console.log("Live-path test (mocked network)");
  const scan = await runScan({ mode: "live", now: NOW }, direct);
  console.log(`  scan ${scan.duration_ms}ms, engine=${scan.engine}, model=${scan.model}, regime=${scan.market.regime}`);
  console.log(`  ${scan.shortlist_size}/${scan.universe_size} passed; picks: ${scan.picks.map((p) => `${p.symbol}(${p.conviction})`).join(", ")}`);
  if (scan.notice) console.log(`  notice: ${scan.notice}`);

  assert.equal(scan.simulated, false, "should be live, not simulated");
  assert.equal(scan.universe_size, WATCHLIST.length);
  assert.equal(scan.engine, "gemini");
  assert.equal(calls.gemini, 1);
  assert.deepEqual(scan.picks.map((p) => p.symbol), ["LT", "INFY"], "AI order kept, hallucinated FAKE dropped");

  const req = JSON.stringify(geminiRequests[0]);
  assert.ok(req.includes("responseJsonSchema"), "structured output schema sent");
  assert.ok(!/current_price|"ema20"|"atr14"/.test(req), "absolute prices never sent to the model");

  const infy = scan.picks.find((p) => p.symbol === "INFY");
  assert.ok(infy && !infy.breakdown.technical_trigger.includes("₹"), "price-bearing AI text replaced by deterministic copy");
  for (const p of scan.picks) {
    const atr = p.metrics.atr14;
    assert.ok(Math.abs(p.levels.target_price - (p.current_price + 2.5 * atr)) <= 0.05, `${p.symbol} target`);
    assert.ok(Math.abs(p.levels.stop_loss - (p.current_price - 1.5 * atr)) <= 0.05, `${p.symbol} stop`);
    assert.equal(p.news.length, 1, `${p.symbol}: only the <24h headline kept`);
    assert.ok(!p.news[0]?.title.endsWith("Example Times"), "source suffix stripped");
    assert.match(p.detected_at, /^\d{2} [A-Z][a-z]{2} \d{4} • \d{2}:\d{2}:\d{2} (AM|PM) IST$/);
    assert.equal(p.detected_at_iso, scan.scanned_at_iso, "detection time = when the data was fetched");
  }

  // Same cached market data → same scan id and same history rows, for every user.
  const md = await loadLiveMarketData(NOW);
  const fromCache: Deps = { ...direct, getLiveMarketData: async () => ({ md, cache: "hit" }), evaluateShared: null };
  const a = await runScan({ mode: "live", now: NOW }, fromCache);
  const b = await runScan({ mode: "live", now: NOW }, fromCache);
  assert.equal(a.id, b.id, "deterministic scan id for identical data");
  assert.deepEqual(scanToHistory(a).map((h) => h.id), scanToHistory(b).map((h) => h.id));
  assert.equal(a.engine, "rules", "no key → rules engine, still live");
  assert.equal(a.cache?.market, "hit");
  assert.ok(a.picks.length >= 2 && a.picks.length <= 3);
  console.log(`  rules engine picks: ${a.picks.map((p) => p.symbol).join(", ")}`);

  // A failing feed falls back to clearly-flagged simulated data.
  const down: Deps = { ...direct, getLiveMarketData: async () => Promise.reject(new Error("Yahoo Finance rate-limited this server")) };
  const sim = await runScan({ mode: "live", now: NOW }, down);
  assert.equal(sim.simulated, true);
  assert.equal(sim.cache, null);
  assert.ok(sim.id.includes(":sim:"));
  assert.ok(scanToHistory(sim).every((h) => h.id.includes(":sim:")), "simulated history rows never merge with live ones");

  console.log(`  upstream calls: yahoo=${calls.yahoo} news=${calls.news} gemini=${calls.gemini}`);
  console.log("\n✓ live path OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
