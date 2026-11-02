/**
 * `npm run verify` — today's real scan plus the accuracy replay, on your own
 * machine, through the app's production code (no Next.js server needed).
 * Prints the same data as GET /api/verify on a deployment.
 *
 *   npm run verify                       # rules engine
 *   GEMINI_API_KEY=... npm run verify    # Gemini ranking, as on Vercel
 */
import { evaluateWithGemini } from "../../src/lib/gemini";
import { EXIT_PLAN } from "../../src/lib/levels";
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
  if (scan.regime_summary) console.log(`Regime read: ${scan.regime_summary}`);
  console.log(`Engine: ${scan.engine}${scan.model ? ` (${scan.model})` : ""}. Detected at ${scan.scanned_at}\n`);
  if (scan.picks.length === 0) console.log("No picks today — nothing cleared the filter.\n");
  for (const p of scan.picks) {
    console.log(`#${p.rank} ${p.symbol} — ${p.name} (${p.sector})   conviction ${p.conviction}`);
    console.log(`   Price ${inr(p.current_price)} (${pct(p.day_change_pct)})`);
    const lv = p.levels;
    console.log(
      `   ${lv.gap_status === "WAIT_FOR_PULLBACK" ? "WAIT FOR PULLBACK" : "ACTIVE BUY ZONE"} (gap ${lv.opening_gap_atr.toFixed(2)} ATR) | Buy zone ${inr(lv.entry_low)}–${inr(lv.entry_high)} | Stop ${inr(lv.stop_loss)} (${pct(lv.stop_pct)})`,
    );
    console.log(
      `   T1 ${inr(lv.target_1)} (${pct(lv.target_1_pct)}) ${EXIT_PLAN.target1} | T2 ${inr(lv.target_2)} (${pct(lv.target_2_pct)}) ${EXIT_PLAN.target2}`,
    );
    console.log(
      `   RSI ${p.metrics.rsi14} | RVOL ${p.metrics.volume_ratio}x | ATR ${p.metrics.atr_pct}% | Coil ${p.metrics.coil_ratio} | ${p.metrics.sma20_extension_pct}% above 20-DMA`,
    );
    console.log(`   ${p.catalyst_category} · ${p.catalyst_freshness}. ${p.breakdown.thesis}`);
    console.log(`   Risk: ${p.execution_risk}`);
    for (const n of p.news.slice(0, 2)) console.log(`   News: ${n.title} — ${n.source}`);
    console.log("");
  }
  if (scan.notice) console.log(`Notice: ${scan.notice}\n`);

  // 2. Accuracy report (same as GET /api/verify).
  console.log("Building the accuracy report (≈1 year of history per stock)…");
  const v = await buildVerifyReport(now);
  const f = v.todayFunnel;
  console.log(
    `\nFilter funnel today: ${f.scanned} scanned → ${f.trend} above 20-DMA, ${f.extension} within 4.5% of it, ${f.rsi} RSI 52–65, ${f.coil} range ≤1.25x ATR, ${f.volatility} ATR ≥2.2%, ${f.volume} RVOL ≥1.5x → ${f.passedAll} passed all six`,
  );
  console.log("\nCross-check these against any chart (last 3 sessions + computed indicators):");
  for (const d of v.dataCheck) {
    const s = d.lastSessions.map((x) => `${x.date} C ${x.close} V ${x.volume.toLocaleString("en-IN")}`).join(" | ");
    const c = d.computed;
    console.log(`  ${d.symbol.padEnd(10)} ${s}`);
    if (c)
      console.log(
        `  ${"".padEnd(10)} RSI ${c.rsi14}  20-DMA ${c.sma20}  ATR ${c.atr14} (${c.atr_pct}%)  Coil ${c.coil_ratio}  Ext ${c.sma20_extension_pct}%  RVOL ${c.volume_ratio}x`,
      );
  }

  const b = v.backtest;
  console.log(`\nReplay ${b.period.from} → ${b.period.to}, ${b.symbols} stocks. Break-even Target-1 hit rate if no runner reaches Target 2: ${b.breakEvenT1RatePct}%`);
  console.log("Group".padEnd(30) + "Trades    T1%    T2%   Stop%    BE%  Timeout  Win%   Avg ret    PF");
  const row = (name: string, s: Stats) => {
    const share = (n: number) => `${((n / Math.max(1, s.trades)) * 100).toFixed(1)}%`;
    console.log(
      name.padEnd(30) +
        String(s.trades).padStart(6) +
        `${s.t1RatePct.toFixed(1)}%`.padStart(7) +
        `${s.t2RatePct.toFixed(1)}%`.padStart(7) +
        share(s.stopHits).padStart(8) +
        share(s.breakevenExits).padStart(7) +
        share(s.timeouts).padStart(9) +
        `${s.winRatePct.toFixed(1)}%`.padStart(7) +
        pct(s.avgReturnPct).padStart(9) +
        s.profitFactor.toFixed(2).padStart(6),
    );
  };
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
