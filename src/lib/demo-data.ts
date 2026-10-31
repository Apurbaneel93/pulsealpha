/**
 * Instant demo mode. Generates simulated daily candles that are seeded by the
 * IST calendar date, so a given day always shows the same simulated board.
 * The candles go through the SAME indicator + filter + level pipeline as live
 * data — only the source of the OHLCV differs. Every price here is simulated.
 */
import { snapshotFromSeries, classifyRegime } from "./market-data-pure";
import { passesHardFilter } from "./rules-engine";
import { istDateKey } from "./time";
import { WATCHLIST } from "./watchlist";
import type { Candle, IndexCue, MarketCues, TechnicalSnapshot, WatchlistEntry } from "./types";

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-9);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Approximate price anchors for the simulated board (not live quotes). */
const DEMO_BOARD: ReadonlyArray<{ symbol: string; anchor: number; bullish: boolean }> = [
  { symbol: "INFY", anchor: 1540, bullish: true },
  { symbol: "BHARTIARTL", anchor: 1985, bullish: true },
  { symbol: "LT", anchor: 3820, bullish: true },
  { symbol: "SUNPHARMA", anchor: 1715, bullish: true },
  { symbol: "BEL", anchor: 412, bullish: true },
  { symbol: "RELIANCE", anchor: 1455, bullish: false },
  { symbol: "TCS", anchor: 3140, bullish: false },
  { symbol: "HDFCBANK", anchor: 990, bullish: false },
  { symbol: "ICICIBANK", anchor: 1420, bullish: false },
  { symbol: "TITAN", anchor: 3610, bullish: false },
  { symbol: "TRENT", anchor: 5080, bullish: false },
  { symbol: "MARUTI", anchor: 15850, bullish: false },
  { symbol: "ITC", anchor: 412, bullish: false },
  { symbol: "TATASTEEL", anchor: 166, bullish: false },
];

const SESSIONS = 140;

/** Weekday-only session dates ending at the last completed session before `now`. */
function sessionDates(now: Date, count: number): string[] {
  const dates: string[] = [];
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - 1);
  while (dates.length < count) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) dates.push(new Date(d.getTime() + 3.75 * 3_600_000).toISOString());
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return dates.reverse();
}

function simulate(anchor: number, bullish: boolean, rand: () => number, dates: string[]): Candle[] {
  const n = dates.length;
  const baseVol = 2_000_000 + rand() * 6_000_000;
  // Walk backwards from the anchor so the last close lands near it.
  const closes: number[] = new Array(n);
  closes[n - 1] = anchor * (0.985 + rand() * 0.03);
  for (let i = n - 1; i > 0; i--) {
    const inRun = bullish && i >= n - 26;
    const drift = inRun ? 0.0032 : 0.0002;
    const sigma = inRun ? 0.011 : 0.014;
    const lastDay = bullish && i === n - 1;
    const r = lastDay ? 0.016 + rand() * 0.014 : drift + sigma * gaussian(rand);
    closes[i - 1] = (closes[i] ?? anchor) / (1 + r);
  }
  return closes.map((close, i) => {
    const prev = i > 0 ? (closes[i - 1] ?? close) : close;
    const open = prev * (1 + 0.003 * gaussian(rand));
    const span = Math.abs(close - open) + close * (0.004 + rand() * 0.01);
    const high = Math.max(open, close) + span * rand() * 0.6;
    const low = Math.min(open, close) - span * rand() * 0.6;
    const spike = bullish && i === n - 1 ? 1.75 + rand() * 1.1 : 0.7 + rand() * 0.6;
    return {
      date: dates[i] ?? "",
      open,
      high,
      low,
      close,
      volume: Math.round(baseVol * spike),
    };
  });
}

export interface DemoInputs {
  market: MarketCues;
  snapshots: TechnicalSnapshot[];
}

export function buildDemoInputs(now = new Date()): DemoInputs {
  const day = istDateKey(now);
  const dates = sessionDates(now, SESSIONS);
  const bySymbol = new Map<string, WatchlistEntry>(WATCHLIST.map((w) => [w.symbol, w]));
  const snapshots: TechnicalSnapshot[] = [];

  for (const row of DEMO_BOARD) {
    const entry = bySymbol.get(row.symbol);
    if (!entry) continue;
    // Bullish names: deterministically search seeds until the simulated
    // series genuinely clears the hard filter, so demo picks are honest
    // outputs of the real pipeline rather than hard-coded cards.
    const attempts = row.bullish ? 60 : 1;
    let chosen: TechnicalSnapshot | null = null;
    for (let v = 0; v < attempts; v++) {
      const rand = mulberry32(hash(`${day}:${row.symbol}:${v}`));
      const candles = simulate(row.anchor, row.bullish, rand, dates);
      const snap = snapshotFromSeries(entry, { completed: candles, last: candles[candles.length - 1]?.close ?? 0, inProgress: false });
      if (!snap) continue;
      chosen = snap;
      if (!row.bullish || passesHardFilter(snap)) break;
    }
    if (chosen) snapshots.push(chosen);
  }

  const rand = mulberry32(hash(`${day}:indices`));
  const lastSession = dates[dates.length - 1] ?? now.toISOString();
  const raw: IndexCue[] = [
    { symbol: "^GSPC", label: "S&P 500", last: 6800 + rand() * 300, changePct: 0.25 + rand() * 0.7, aboveEma20: true, sessionDate: lastSession },
    { symbol: "^IXIC", label: "Nasdaq", last: 23000 + rand() * 1200, changePct: 0.45 + rand() * 1.0, aboveEma20: true, sessionDate: lastSession },
    { symbol: "^NSEI", label: "Nifty 50", last: 25600 + rand() * 900, changePct: 0.1 + rand() * 0.6, aboveEma20: true, sessionDate: lastSession },
  ];
  const indices: IndexCue[] = raw.map((i) => ({
    ...i,
    last: Math.round(i.last * 100) / 100,
    changePct: Math.round(i.changePct * 100) / 100,
  }));

  return { market: classifyRegime(indices), snapshots };
}
