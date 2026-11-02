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
  assert.deepEqual(
    scan.picks.map((p) => p.symbol),
    ["LT", "INFY"],
    "AI order kept; hallucinated FAKE dropped; BEL dropped because the model itself flagged it a Priced-In Recap",
  );
  assert.match(scan.notice ?? "", /1 candidate skipped/, "the dropped recap is explained");
  assert.ok(scan.regime_summary?.startsWith("US tech closed firm"), "the model's market read is shown");

  // What the model is sent: the exact system prompt, ratios and headlines, never a price.
  const { SYSTEM_INSTRUCTION } = await import("../src/lib/gemini-prompt");
  const sent = geminiRequests[0];
  const req = JSON.stringify(sent);
  assert.ok(req.includes("responseJsonSchema"), "structured output schema sent");
  assert.ok(req.includes(JSON.stringify(SYSTEM_INSTRUCTION).slice(1, 200)), "system prompt sent");
  const sentText: string = sent.contents[0].parts[0].text;
  assert.ok(
    !/current_price|"price"|ema20|ema50|sma20"|atr14|prev_close|entry_|target_|stop_loss|₹/.test(sentText),
    "absolute prices never sent to the model",
  );
  const payload = JSON.parse(sentText.slice(sentText.indexOf("{"))) as {
    last_session_close_ist: string;
    candidates: Array<Record<string, unknown> & { headlinesLast24h: Array<{ title: string; published: string }> }>;
  };
  assert.equal(payload.candidates.length, 3, "all three survivors are sent");
  for (const c of payload.candidates) {
    assert.deepEqual(
      Object.keys(c).sort(),
      ["atrPercent", "coilRatio", "company", "headlinesLast24h", "rsi", "rvol", "sector", "sma20ExtensionPct", "symbol"],
      "exactly the five metrics, the name and the headlines",
    );
    for (const k of ["rsi", "rvol", "atrPercent", "coilRatio", "sma20ExtensionPct"]) assert.equal(typeof c[k], "number");
    assert.equal(c.headlinesLast24h.length, 1, "only the <24h headline");
    assert.match(c.headlinesLast24h[0]!.published, /IST$/, "headline timestamps are in IST");
  }
  assert.match(payload.last_session_close_ist, /IST$/);

  const infy = scan.picks.find((p) => p.symbol === "INFY");
  assert.ok(infy && !infy.breakdown.thesis.includes("₹"), "price-bearing AI text replaced by deterministic copy");
  const lt = scan.picks.find((p) => p.symbol === "LT");
  assert.equal(lt?.catalyst_category, "Order Win");
  assert.equal(lt?.catalyst_freshness, "Unpriced Post-Market");
  assert.equal(lt?.execution_risk, "Skip if opening gap exceeds 0.75 ATR");
  assert.equal(infy?.catalyst_category, "Sector Tailwind");

  for (const p of scan.picks) {
    const atr = p.metrics.atr14;
    const lv = p.levels;
    const gap = (p.current_price - (p.current_price / (1 + p.day_change_pct / 100))) / atr;
    const waiting = lv.gap_status === "WAIT_FOR_PULLBACK";
    assert.equal(waiting, lv.opening_gap_atr > 0.75, `${p.symbol} status follows the 0.75 ATR gap guard`);
    assert.ok(Math.abs(lv.opening_gap_atr - gap) < 0.05, `${p.symbol} gap in ATRs`);
    const base = waiting ? p.current_price / (1 + p.day_change_pct / 100) + 0.35 * atr : p.current_price;
    const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) <= 0.1, `${p.symbol} ${what}: ${a} vs ${b}`);
    near(lv.base_entry, base, "base entry");
    near(lv.entry_low, base - 0.1 * atr, "buy zone low");
    near(lv.entry_high, base + 0.1 * atr, "buy zone high");
    near(lv.stop_loss, base - 0.9 * atr, "stop");
    near(lv.target_1, base + 1.15 * atr, "T1");
    near(lv.target_2, base + 2.0 * atr, "T2");
    assert.ok(lv.stop_loss < lv.entry_low && lv.entry_high < lv.target_1 && lv.target_1 < lv.target_2, `${p.symbol} level order`);
    assert.ok(p.metrics.rsi14 >= 52 && p.metrics.rsi14 <= 65, `${p.symbol} RSI in band`);
    assert.ok(p.metrics.sma20_extension_pct > 0 && p.metrics.sma20_extension_pct <= 4.5, `${p.symbol} extension`);
    assert.ok(p.metrics.coil_ratio <= 1.25 && p.metrics.atr_pct >= 2.2 && p.metrics.volume_ratio >= 1.5, `${p.symbol} coil, ATR%, RVOL`);
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
  assert.ok(a.picks.every((p) => p.catalyst_freshness === "Unpriced Post-Market"), "fresh post-close headlines are detected without the AI");
  assert.ok(a.picks.every((p) => p.execution_risk.length > 0 && p.breakdown.thesis.length > 0));

  // The gap guard shows up on the cards: INFY closed far above its previous close, the others did not.
  const infyRules = a.picks.find((p) => p.symbol === "INFY");
  assert.equal(infyRules?.levels.gap_status, "WAIT_FOR_PULLBACK", "INFY ran more than 0.75 ATR: wait for a pullback");
  assert.ok(a.picks.filter((p) => p.symbol !== "INFY").every((p) => p.levels.gap_status === "ACTIVE_BUY_ZONE"));
  assert.ok(infyRules && infyRules.levels.entry_high < infyRules.current_price, "the pullback buy zone sits below the spike");

  // Full bullish ranking
  const board = a.board ?? [];
  assert.ok(board.length > 0, "board present");
  assert.ok(board.every((r) => r.checks.trend && r.sma20_extension_pct > 0), "board lists only stocks above their 20-DMA");
  for (let i = 1; i < board.length; i++) {
    const p = board[i - 1]!;
    const c = board[i]!;
    assert.ok(p.passed > c.passed || (p.passed === c.passed && p.score >= c.score), "board sorted by checks, then score");
  }
  assert.equal(board.filter((r) => r.passed === 6).length, a.shortlist_size, "full setups on the board = stocks passing the screen");
  assert.equal(a.shortlist_size, 3, "exactly the three built-to-pass names clear the screen");
  assert.ok(a.picks.every((p) => board.some((r) => r.symbol === p.symbol)), "every pick appears on the board");
  assert.equal(a.board_scanned, md.scanned);
  console.log(`  board: ${board.length} of ${a.board_scanned} above the 20-DMA; top 5 ${board.slice(0, 5).map((r) => `${r.symbol}(${r.passed}/6,${r.score})`).join(" ")}`);

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
