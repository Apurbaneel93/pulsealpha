import "server-only";
import { errorMessage, isRateLimitError, mapSettled } from "./async";
import { buildDemoInputs } from "./demo-data";
import { buildAiInput, mentionsPrice, type AiEvaluation, type AiInput, type AiPick } from "./gemini";
import { computeLevels } from "./levels";
import { fetchMarketCues, scanUniverse } from "./market-data";
import { fetchHeadlines } from "./news";
import {
  buildBoard,
  classifyCatalyst,
  HARD_FILTER,
  passesHardFilter,
  rankByRules,
  regimeSummary,
  rulesBreakdown,
  rulesExecutionRisk,
} from "./rules-engine";
import { formatDetectedAt } from "./time";
import { WATCHLIST } from "./watchlist";
import type {
  CacheStatus,
  DataMode,
  Engine,
  MarketSnapshot,
  NewsItem,
  Pick,
  ScanResult,
  TechnicalSnapshot,
} from "./types";

/** Cap on how many filtered names go to news + AI (keeps latency, tokens and cache entries small). */
const SHORTLIST_CAP = 10;
/** Below this share of successfully loaded symbols, the live feed is treated as failed. */
const MIN_COVERAGE = 0.35;

export class LiveFeedError extends Error {
  constructor(
    message: string,
    readonly rateLimited = false,
  ) {
    super(message);
  }
}

function newVersion(at: Date): string {
  return `${at.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function loadNews(shortlist: readonly TechnicalSnapshot[], now: Date): Promise<Record<string, NewsItem[]>> {
  const settled = await mapSettled(shortlist, 4, (s) => fetchHeadlines(s.symbol, now));
  const out: Record<string, NewsItem[]> = {};
  settled.forEach((r, i) => {
    const sym = shortlist[i]?.symbol;
    if (sym) out[sym] = r.status === "fulfilled" ? r.value : [];
  });
  return out;
}

export function shortlistFrom(snapshots: readonly TechnicalSnapshot[], market: MarketSnapshot["market"]) {
  const passed = snapshots.filter(passesHardFilter);
  const shortlist = rankByRules(passed, market, new Map())
    .slice(0, SHORTLIST_CAP)
    .map((r) => r.snapshot);
  return { passed_count: passed.length, shortlist, scanned: snapshots.length, board: buildBoard(snapshots, market) };
}

/**
 * Fetch everything a live scan needs: global cues, ~90 stock snapshots, the
 * hard filter, and 24h headlines for the shortlist. This is the expensive,
 * rate-limited step — the server caches its result (see scan-service.ts).
 * Throws LiveFeedError when the feed is unusable; failures are never cached.
 */
export async function loadLiveMarketData(now = new Date()): Promise<MarketSnapshot> {
  const [marketRes, universe] = await Promise.all([
    fetchMarketCues(now).then(
      (m) => ({ ok: true as const, m }),
      (e: unknown) => ({ ok: false as const, e }),
    ),
    scanUniverse(WATCHLIST, now),
  ]);
  const coverage = universe.snapshots.length / universe.attempted;
  if (!marketRes.ok || coverage < MIN_COVERAGE) {
    const rateLimited = universe.rateLimited || (!marketRes.ok && isRateLimitError(marketRes.e));
    const why = rateLimited
      ? "Yahoo Finance rate-limited this server"
      : !marketRes.ok
        ? errorMessage(marketRes.e)
        : `only ${universe.snapshots.length}/${universe.attempted} symbols loaded`;
    throw new LiveFeedError(why, rateLimited);
  }
  const { passed_count, shortlist, scanned, board } = shortlistFrom(universe.snapshots, marketRes.m);
  const news = shortlist.length ? await loadNews(shortlist, now) : {};
  const fetchedAt = new Date();
  return {
    version: newVersion(fetchedAt),
    fetched_at_iso: fetchedAt.toISOString(),
    market: marketRes.m,
    universe_size: universe.attempted,
    failed_symbols: universe.failed,
    passed_count,
    shortlist,
    news,
    scanned,
    board,
  };
}

/** Simulated equivalent of loadLiveMarketData. Pure and instant; never cached or persisted. */
export function loadDemoMarketData(now = new Date()): MarketSnapshot {
  const demo = buildDemoInputs(now);
  const { passed_count, shortlist, scanned, board } = shortlistFrom(demo.snapshots, demo.market);
  return {
    version: `demo-${now.toISOString().slice(0, 10)}`,
    fetched_at_iso: now.toISOString(),
    market: demo.market,
    universe_size: demo.snapshots.length,
    failed_symbols: 0,
    passed_count,
    shortlist,
    news: {},
    scanned,
    board,
  };
}

/** Where a scan's inputs come from. scan-service.ts wires these to the Next.js cache. */
export interface ScanDeps {
  /** Live market data, usually from the shared cache. Throws LiveFeedError if unusable. */
  getLiveMarketData: (now: Date) => Promise<{ md: MarketSnapshot; cache: CacheStatus }>;
  /** Gemini evaluation with the server's key (cacheable by input), or null when no server key exists. */
  evaluateShared: ((input: AiInput, model: string | null) => Promise<{ ai: AiEvaluation; cache: CacheStatus }>) | null;
  /** Gemini evaluation with a user-supplied key (never cached across users). */
  evaluateWithKey: (input: AiInput, key: string, model: string | null) => Promise<AiEvaluation>;
  /** Reported to the client so it can explain how fresh shared data is. */
  marketRefreshSeconds: number;
}

export interface ScanOptions {
  mode: DataMode;
  /** A key the user pasted in API Setup. Takes precedence over the server key. */
  userKey?: string | null;
  model?: string | null;
  now?: Date;
}

export async function runScan(opts: ScanOptions, deps: ScanDeps): Promise<ScanResult> {
  const started = Date.now();
  const now = opts.now ?? new Date();
  const notices: string[] = [];

  // 1. Inputs
  let md: MarketSnapshot;
  let simulated = false;
  let marketCache: CacheStatus | null = null;
  if (opts.mode === "demo") {
    md = loadDemoMarketData(now);
  } else {
    try {
      const live = await deps.getLiveMarketData(now);
      md = live.md;
      marketCache = live.cache;
      if (md.failed_symbols > 0) {
        notices.push(`${md.failed_symbols} of ${md.universe_size} symbols could not be loaded and were skipped.`);
      }
    } catch (err: unknown) {
      md = loadDemoMarketData(now);
      simulated = true;
      notices.push(`Reason: ${err instanceof Error ? err.message : errorMessage(err)}.`);
    }
  }
  const isLiveData = opts.mode === "live" && !simulated;
  const { market, shortlist } = md;
  const newsMap = new Map<string, NewsItem[]>(Object.entries(md.news));

  // 2. Evaluation: Gemini when a key exists, otherwise deterministic rules
  let engine: Engine = "rules";
  let model: string | null = null;
  let aiPicks: AiPick[] = [];
  let aiRegime = "";
  let aiCache: CacheStatus | null = null;
  if (isLiveData && shortlist.length > 0) {
    const input = buildAiInput(md);
    const userKey = opts.userKey?.trim();
    try {
      if (userKey) {
        const ai = await deps.evaluateWithKey(input, userKey, opts.model ?? null);
        aiPicks = ai.picks;
        aiRegime = ai.market_regime_summary;
        model = ai.model;
        aiCache = "miss";
        engine = "gemini";
      } else if (deps.evaluateShared) {
        const res = await deps.evaluateShared(input, opts.model ?? null);
        aiPicks = res.ai.picks;
        aiRegime = res.ai.market_regime_summary;
        model = res.ai.model;
        aiCache = res.cache;
        engine = "gemini";
      } else {
        notices.push("No Gemini key configured — picks ranked by the deterministic rules engine.");
      }
    } catch (err: unknown) {
      notices.push(`AI evaluation unavailable (${errorMessage(err).slice(0, 140)}). Ranked by the rules engine instead.`);
    }
  }

  // 3. Merge: AI chooses order + prose; code owns every number.
  const regimeText = aiRegime && !mentionsPrice(aiRegime) ? aiRegime : regimeSummary(market);
  const ruleRanked = rankByRules(shortlist, market, newsMap);
  const bySymbol = new Map(shortlist.map((s) => [s.symbol, s]));
  /** A stock whose only headlines recap a move that already happened: institutions are selling into it, not buying. */
  const isRecap = (s: TechnicalSnapshot) =>
    (newsMap.get(s.symbol)?.length ?? 0) > 0 && classifyCatalyst(newsMap.get(s.symbol) ?? [], s.as_of_session).freshness === "Priced-In Recap";

  const chosen: Array<{ snapshot: TechnicalSnapshot; ai: AiPick | null; conviction: number }> = [];
  let droppedRecaps = 0;
  for (const p of aiPicks) {
    const snapshot = bySymbol.get(p.symbol);
    if (!snapshot) continue;
    // The prompt tells the model to disqualify recaps. If it flags one anyway, believe the flag.
    if (p.catalyst_freshness === "Priced-In Recap") {
      droppedRecaps += 1;
      continue;
    }
    chosen.push({ snapshot, ai: p, conviction: p.conviction });
  }
  if (chosen.length === 0) {
    // Rules-only: take the top 3, but drop a weak third (conviction < 50) rather than pad the board.
    for (const r of ruleRanked) {
      if (chosen.length >= 3) break;
      if (isRecap(r.snapshot)) {
        droppedRecaps += 1;
        continue;
      }
      if (chosen.length < 2 || r.conviction >= 50) chosen.push({ snapshot: r.snapshot, ai: null, conviction: r.conviction });
    }
  } else {
    // AI returned fewer than 2: top up from the deterministic ranking.
    for (const r of ruleRanked) {
      if (chosen.length >= 2) break;
      if (chosen.some((c) => c.snapshot.symbol === r.snapshot.symbol) || isRecap(r.snapshot)) continue;
      chosen.push({ snapshot: r.snapshot, ai: null, conviction: r.conviction });
    }
  }
  if (droppedRecaps > 0) {
    notices.push(
      `${droppedRecaps} candidate${droppedRecaps === 1 ? "" : "s"} skipped: the news only recaps a move that already happened.`,
    );
  }

  // Setups are "detected" when the data behind them was fetched — identical for
  // every user served from the same cache entry.
  const detectedAt = new Date(md.fetched_at_iso);
  const detected = formatDetectedAt(detectedAt);
  const safe = (text: string | undefined, alt: string) => (text && text.trim() && !mentionsPrice(text) ? text.trim() : alt);
  const picks: Pick[] = chosen.slice(0, 3).map(({ snapshot: s, ai, conviction }, i) => {
    const news = newsMap.get(s.symbol) ?? [];
    const fallback = rulesBreakdown(s, market, news);
    const classified = classifyCatalyst(news, s.as_of_session);
    const category = ai?.catalyst_category ?? classified.category;
    return {
      rank: i + 1,
      symbol: s.symbol,
      name: s.name,
      sector: s.sector,
      current_price: s.current_price,
      day_change_pct: s.day_change_pct,
      levels: computeLevels(s.current_price, s.prev_close, s.atr14),
      metrics: {
        sma20: s.sma20,
        ema20: s.ema20,
        ema50: s.ema50,
        rsi14: s.rsi14,
        atr14: s.atr14,
        atr_pct: s.atr_pct,
        coil_ratio: s.coil_ratio,
        sma20_extension_pct: s.sma20_extension_pct,
        volume_ratio: s.volume_ratio,
      },
      spark: s.spark,
      conviction,
      catalyst: category,
      catalyst_category: category,
      catalyst_freshness: ai?.catalyst_freshness ?? classified.freshness,
      execution_risk: safe(ai?.execution_risk, rulesExecutionRisk(s)),
      breakdown: {
        global_cue: regimeText === regimeSummary(market) ? fallback.global_cue : regimeText,
        technical_trigger: fallback.technical_trigger,
        thesis: safe(ai?.thesis, fallback.thesis),
      },
      news,
      detected_at: detected,
      detected_at_iso: detectedAt.toISOString(),
    };
  });

  if (picks.length === 0) {
    notices.push(
      `None of the ${md.universe_size} scanned stocks cleared the momentum screen (above the 20-DMA but within ${HARD_FILTER.maxExtensionPct}% of it, RSI ${HARD_FILTER.rsiMin}–${HARD_FILTER.rsiMax}, yesterday's range ≤ ${HARD_FILTER.maxCoilRatio}x ATR, ATR ≥ ${HARD_FILTER.minAtrPct}% of price, volume ≥ ${HARD_FILTER.volumeRatioMin}x). No picks are better than forced picks.`,
    );
  }

  return {
    id: [opts.mode, simulated ? "sim" : null, md.version, engine === "gemini" ? model : "rules"].filter(Boolean).join(":"),
    mode: opts.mode,
    engine,
    model,
    simulated,
    notice: notices.length ? notices.join(" ") : null,
    scanned_at: detected,
    scanned_at_iso: detectedAt.toISOString(),
    market,
    regime_summary: regimeText,
    universe_size: md.universe_size,
    shortlist_size: md.passed_count,
    picks,
    board: md.board ?? [],
    board_scanned: md.scanned ?? md.universe_size - md.failed_symbols,
    cache: isLiveData && marketCache ? { market: marketCache, ai: aiCache, refresh_seconds: deps.marketRefreshSeconds } : null,
    duration_ms: Date.now() - started,
  };
}
