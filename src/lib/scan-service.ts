import "server-only";
import { unstable_cache } from "next/cache";
import { isRateLimitError } from "./async";
import { DEFAULT_MODEL, evaluateWithGemini, type AiInput } from "./gemini";
import { LiveFeedError, loadLiveMarketData, runScan, type ScanDeps, type ScanOptions } from "./scanner";
import { istDateKey } from "./time";
import type { CacheStatus, MarketSnapshot, ScanResult } from "./types";

/**
 * Server-side caching — no database.
 *
 * Both layers use `unstable_cache`, which stores entries through Next.js's
 * server cache handler. On Vercel that is a shared, persistent cache provided
 * by the platform with zero setup, so every user and every serverless
 * instance reads the same entries. (Plain `'use cache'` keeps entries in each
 * instance's memory, which on serverless rarely survives between requests.)
 *
 * Layer 1 — market data (Yahoo + Google News), keyed by IST date,
 *           `revalidate: 180`. This is what protects Yahoo from rate limits.
 * Layer 2 — Gemini evaluation, keyed by its exact JSON input, so the same
 *           market data is never sent to the model twice.
 *
 * Failures throw inside the cached function, so they are never cached.
 */

export const MARKET_REVALIDATE_SECONDS = 180;
/** A cached snapshot older than this is refetched in the foreground rather than served stale. */
const MARKET_MAX_AGE_MS = 15 * 60_000;
const AI_REVALIDATE_SECONDS = 6 * 3600;
/** After Yahoo rate-limits this instance, stop asking for a minute. */
const BACKOFF_MS = 60_000;

export const CACHE_TAGS = { market: "pulsealpha:market", ai: "pulsealpha:ai" } as const;

const cachedMarketData = unstable_cache(
  // The IST date is part of the cache key, so a new trading day never sees yesterday's entry.
  async (istDay: string): Promise<MarketSnapshot> => {
    void istDay;
    return loadLiveMarketData(new Date());
  },
  ["pulsealpha:market-data:v2"],
  { revalidate: MARKET_REVALIDATE_SECONDS, tags: [CACHE_TAGS.market] },
);

const cachedServerEvaluation = unstable_cache(
  async (input: AiInput, model: string) => {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
    return evaluateWithGemini({ apiKey, model, input });
  },
  ["pulsealpha:ai-eval:v1"],
  { revalidate: AI_REVALIDATE_SECONDS, tags: [CACHE_TAGS.ai] },
);

let backoffUntil = 0;

function noteFailure(err: unknown): void {
  if ((err instanceof LiveFeedError && err.rateLimited) || isRateLimitError(err)) {
    backoffUntil = Date.now() + BACKOFF_MS;
  }
}

async function getLiveMarketData(now: Date): Promise<{ md: MarketSnapshot; cache: CacheStatus }> {
  const requestStart = Date.now();
  if (requestStart < backoffUntil) {
    throw new LiveFeedError("Yahoo Finance rate-limited this server; retrying in under a minute", true);
  }
  let md: MarketSnapshot;
  try {
    md = await cachedMarketData(istDateKey(now));
  } catch (err: unknown) {
    noteFailure(err);
    throw err;
  }
  const fetchedAt = Date.parse(md.fetched_at_iso);
  if (fetchedAt >= requestStart) return { md, cache: "miss" };
  const age = requestStart - fetchedAt;
  if (age <= MARKET_REVALIDATE_SECONDS * 1000) return { md, cache: "hit" };
  // Next.js is already refreshing this entry in the background (stale-while-revalidate).
  if (age <= MARKET_MAX_AGE_MS) return { md, cache: "stale" };
  // After a quiet spell the stale entry can be hours old — too old to trade on.
  try {
    return { md: await loadLiveMarketData(now), cache: "miss" };
  } catch (err: unknown) {
    noteFailure(err);
    // Real data with an honest, older timestamp beats simulated data.
    return { md, cache: "stale" };
  }
}

function deps(): ScanDeps {
  const hasServerKey = Boolean(process.env.GEMINI_API_KEY?.trim());
  return {
    getLiveMarketData,
    evaluateShared: hasServerKey
      ? async (input, model) => {
          const requestStart = Date.now();
          const ai = await cachedServerEvaluation(input, model?.trim() || DEFAULT_MODEL);
          return { ai, cache: Date.parse(ai.evaluated_at_iso) >= requestStart ? "miss" : "hit" };
        }
      : null,
    evaluateWithKey: (input, apiKey, model) => evaluateWithGemini({ apiKey, model: model ?? undefined, input }),
    marketRefreshSeconds: MARKET_REVALIDATE_SECONDS,
  };
}

export function scan(opts: ScanOptions): Promise<ScanResult> {
  return runScan(opts, deps());
}
