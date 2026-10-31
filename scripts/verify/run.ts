/**
 * `npm run verify` — today's real scan plus the accuracy replay, on your own
 * machine, through the app's production code (no Next.js server needed).
 * Prints the same data as GET /api/verify on a deployment.
 *
 *   npm run verify                       # rules engine
 *   GEMINI_API_KEY=... npm run verify    # Gemini ranking, as on Vercel
 */
import { evaluateWithGemini } from "../../src/lib/gemini";
import { loadLiveMarketData, runScan } from "../../src/lib/scanner";
import { buildVerifyReport } from "../../src/lib/verify";
import type { Stats } from "../../src/lib/backtest";

const key = process.env.GEMINI_API_KEY?.trim() || null;
const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

async function main() {
  const now = new Date();
  console.log(`\nPulseAlpha accuracy check — ${now.toISOString()}\n`);

  // 1. Today's scan, exactly as /api/scan builds it.
  const scan = await runScan(
    { mode: "live", now },
    {
      getLiveMarketData: async (n) => ({ md: await loadLiveMarketData(n), cache: "miss" }),
      evaluateShared: key
        ? async (input, model) => ({ ai: await evaluateWithGemini({ apiKey: key, model: model ?? undefined, input }), cache: "miss" })
        : null,
      evaluateWithKey: (input, apiKey, model) => evaluateWithGemini({ apiKey, model: model ?? undefined, input }),
      marketRefreshSeconds: 180,
    },
  );
  if (scan.simulated) {
    console.log(`Live data unavailable — ${scan.notice}\nCheck your internet connection or retry in a minute.`);
    process.exit(1);
  }
  console.log(`Market regime: ${scan.market.summary} (score ${scan.market.score})`);
  console.log(`Engine: ${scan.engine}${scan.model ? ` (${scan.model})` : ""}. Detected at ${scan.scanned_at}\n`);
  if (scan.picks.length === 0) console.log("No picks today — nothing cleared the filter.\n");
  for (const p of scan.picks) {
    console.log(`#${p.rank} ${p.symbol} — ${p.name} (${p.sector})   conviction ${p.conviction}`);
    console.log(`   Price ${inr(p.current_price)} (${pct(p.day_change_pct)})`);
    console.log(
      `   Buy zone ${inr(p.levels.entry_low)}–${inr(p.levels.entry_high)} | Target ${inr(p.levels.target_price)} (${pct(p.levels.target_pct)}) | Stop ${inr(p.levels.stop_loss)} (${pct(p.levels.stop_pct)})`,
    );
    console.log(
      `   RSI ${p.metrics.rsi14} | Volume ${p.metrics.volume_ratio}x | 20-EMA ${inr(p.metrics.ema20)} | 50-EMA ${inr(p.metrics.ema50)} | ATR ${inr(p.metrics.atr14)}`,
    );
    console.log(`   Catalyst: ${p.catalyst}`);
    for (const n of p.news.slice(0, 2)) console.log(`   News: ${n.title} — ${n.source}`);
    console.log("");
  }
  if (scan.notice) console.log(`Notice: ${scan.notice}\n`);

  // 2. Accuracy report (same as GET /api/verify).
  console.log("Building the accuracy report (≈1 year of history per stock)…");
  const v = await buildVerifyReport(now);
  const f = v.todayFunnel;
  console.log(
    `\nFilter funnel today: ${f.scanned} scanned → ${f.aboveEma20} above 20-EMA, ${f.rsiInBand} RSI 55–72, ${f.volumeOk} volume >1.5x → ${f.passedAll} passed all three`,
  );
  console.log("\nCross-check these against any chart (last 3 sessions + computed indicators):");
  for (const d of v.dataCheck) {
    const s = d.lastSessions.map((x) => `${x.date} C ${x.close} V ${x.volume.toLocaleString("en-IN")}`).join(" | ");
    const c = d.computed;
    console.log(`  ${d.symbol.padEnd(10)} ${s}`);
    if (c) console.log(`  ${"".padEnd(10)} RSI ${c.rsi14}  20-EMA ${c.ema20}  50-EMA ${c.ema50}  ATR ${c.atr14}  Vol ${c.volume_ratio}x`);
  }

  const b = v.backtest;
  console.log(`\nReplay ${b.period.from} → ${b.period.to}, ${b.symbols} stocks. Break-even target-hit rate ignoring timeouts: ${b.breakEvenHitRatePct}%`);
  console.log("Group".padEnd(30) + "Trades  Target   Stop  Timeout  Win%   Avg ret    PF");
  const row = (name: string, s: Stats) =>
    console.log(
      name.padEnd(30) +
        String(s.trades).padStart(6) +
        `${s.hitRatePct.toFixed(1)}%`.padStart(8) +
        `${((s.stopHits / Math.max(1, s.trades)) * 100).toFixed(1)}%`.padStart(7) +
        `${((s.timeouts / Math.max(1, s.trades)) * 100).toFixed(1)}%`.padStart(9) +
        `${s.winRatePct.toFixed(1)}%`.padStart(7) +
        pct(s.avgReturnPct).padStart(9) +
        s.profitFactor.toFixed(2).padStart(6),
    );
  for (const h of b.horizons) {
    row(`Top picks, ${h.sessions}-day hold`, h.topPicks);
    row(`All signals, ${h.sessions}-day hold`, h.allSignals);
    row(`Baseline (no filter), ${h.sessions}d`, h.baselineEveryDay);
  }
  console.log("\nMost recent top picks and how they ended:");
  for (const t of b.recentTopPicks) console.log(`  ${t.signalDate}  ${t.symbol.padEnd(11)} ${t.outcome.padEnd(8)} ${pct(t.returnPct)} in ${t.sessions} sessions`);
  console.log("\nAssumptions:");
  for (const a of v.assumptions) console.log(`  - ${a}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
