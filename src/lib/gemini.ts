import "server-only";
import { ApiError, GoogleGenAI, ThinkingLevel } from "@google/genai";
import { errorMessage } from "./async";
import { SYSTEM_INSTRUCTION } from "./gemini-prompt";
import { sessionCloseMs, truncate } from "./rules-engine";
import { formatDetectedAt } from "./time";
import type { CatalystCategory, CatalystFreshness, MarketSnapshot } from "./types";

/** gemini-2.5-flash was retired on 16 Oct 2026; 3.5 Flash is the GA successor. */
export const DEFAULT_MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash";
const FALLBACK_MODEL = "gemini-flash-latest";

export const CATALYST_CATEGORIES: readonly CatalystCategory[] = [
  "Order Win",
  "Earnings Beat",
  "Regulatory",
  "Sector Tailwind",
  "Technical Coil Breakout",
];
export const CATALYST_FRESHNESS: readonly CatalystFreshness[] = ["Unpriced Post-Market", "Ongoing Multi-Day", "Priced-In Recap"];

/** One validated pick from the model. Category and freshness are null when the model returned something outside the allowed set. */
export interface AiPick {
  symbol: string;
  conviction: number;
  catalyst_category: CatalystCategory | null;
  catalyst_freshness: CatalystFreshness | null;
  /** "whyItWillExpandToday": the 2-sentence thesis. */
  thesis: string;
  /** "executionRisk": what would invalidate the setup. */
  execution_risk: string;
}

export interface AiEvaluation {
  picks: AiPick[];
  /** "marketRegimeSummary": one sentence on how today's cues affect follow-through. */
  market_regime_summary: string;
  model: string;
  evaluated_at_iso: string;
}

/** JSON-safe Gemini input. Also used verbatim as the AI cache key, so identical data never pays twice. */
export interface AiInput {
  symbols: string[];
  payload: {
    market_regime: string;
    regime_score: number;
    indices: Array<{ index: string; change_pct: number; above_20_ema: boolean }>;
    /** When the last NSE session closed, so "released after yesterday's close" can be judged from the timestamps. */
    last_session_close_ist: string;
    candidates: Array<Record<string, unknown>>;
  };
}

export function buildAiInput(md: MarketSnapshot): AiInput {
  // Absolute prices are deliberately withheld: the model cannot echo or
  // distort a number it never sees. It reasons over relative metrics only.
  const asOf = md.shortlist[0]?.as_of_session;
  return {
    symbols: md.shortlist.map((s) => s.symbol),
    payload: {
      market_regime: md.market.regime,
      regime_score: md.market.score,
      indices: md.market.indices.map((i) => ({
        index: i.label,
        change_pct: i.changePct,
        above_20_ema: i.aboveEma20,
      })),
      last_session_close_ist: asOf ? formatDetectedAt(new Date(sessionCloseMs(asOf))) : "unknown",
      candidates: md.shortlist.map((s) => ({
        symbol: s.symbol,
        company: s.name,
        sector: s.sector,
        rsi: s.rsi14,
        rvol: s.volume_ratio,
        atrPercent: s.atr_pct,
        coilRatio: s.coil_ratio,
        sma20ExtensionPct: s.sma20_extension_pct,
        headlinesLast24h: (md.news[s.symbol] ?? []).map((n) => ({
          title: n.title,
          source: n.source,
          published: formatDetectedAt(new Date(n.publishedAt)),
        })),
      })),
    },
  };
}

function responseSchema(symbols: string[]) {
  const maxItems = Math.min(3, symbols.length);
  const keys = ["rank", "symbol", "convictionScore", "catalystCategory", "catalystFreshness", "whyItWillExpandToday", "executionRisk"];
  return {
    type: "object",
    properties: {
      marketRegimeSummary: { type: "string", description: "One sentence, no prices." },
      picks: {
        type: "array",
        minItems: Math.min(2, symbols.length),
        maxItems,
        items: {
          type: "object",
          properties: {
            rank: { type: "integer", minimum: 1, maximum: 3 },
            symbol: { type: "string", enum: symbols, description: "Ticker copied exactly from the candidates." },
            convictionScore: { type: "integer", minimum: 1, maximum: 99 },
            catalystCategory: { type: "string", enum: [...CATALYST_CATEGORIES] },
            catalystFreshness: { type: "string", enum: [...CATALYST_FRESHNESS] },
            whyItWillExpandToday: { type: "string", description: "Two sentences, no prices." },
            executionRisk: { type: "string", description: "One short phrase, no prices." },
          },
          required: keys,
          propertyOrdering: keys,
        },
      },
    },
    required: ["marketRegimeSummary", "picks"],
    propertyOrdering: ["marketRegimeSummary", "picks"],
  };
}

const PRICE_PATTERN = /₹|\bRs\.?\s?\d|\bINR\s?\d|\b(target|stop[- ]?loss|entry)\s+(of|at|near)\s+\d/i;

/** True when AI prose tries to mention a price level — those fields get replaced by deterministic copy. */
export function mentionsPrice(text: string): boolean {
  return PRICE_PATTERN.test(text);
}

interface RawPick {
  rank?: unknown;
  symbol: string;
  convictionScore: number;
  catalystCategory?: unknown;
  catalystFreshness?: unknown;
  whyItWillExpandToday: string;
  executionRisk: string;
}

function isRawPick(v: unknown): v is RawPick {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.symbol === "string" &&
    typeof o.convictionScore === "number" &&
    typeof o.whyItWillExpandToday === "string" &&
    typeof o.executionRisk === "string"
  );
}

function oneOf<T extends string>(allowed: readonly T[], value: unknown): T | null {
  return typeof value === "string" ? (allowed.find((a) => a === value.trim()) ?? null) : null;
}

async function callModel(ai: GoogleGenAI, model: string, payload: unknown, symbols: string[]) {
  return ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [{ text: `Screened candidates (JSON). Choose symbols only from this list:\n${JSON.stringify(payload)}` }],
      },
    ],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      responseJsonSchema: responseSchema(symbols),
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  });
}

export async function evaluateWithGemini(args: {
  apiKey: string;
  model?: string;
  input: AiInput;
}): Promise<AiEvaluation> {
  const { apiKey, input } = args;
  const { symbols, payload } = input;
  if (symbols.length === 0) throw new Error("Nothing to evaluate: empty shortlist");
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 30_000 } });

  let model = args.model?.trim() || DEFAULT_MODEL;
  let response;
  try {
    response = await callModel(ai, model, payload, symbols);
  } catch (err: unknown) {
    // Model retired or renamed → retry once on Google's rolling Flash alias.
    if (err instanceof ApiError && err.status === 404 && model !== FALLBACK_MODEL) {
      model = FALLBACK_MODEL;
      response = await callModel(ai, model, payload, symbols);
    } else {
      throw err;
    }
  }

  const text = response.text;
  if (!text) throw new Error("Gemini returned an empty response");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err: unknown) {
    throw new Error(`Gemini returned invalid JSON: ${errorMessage(err)}`);
  }
  const root = parsed as { picks?: unknown; marketRegimeSummary?: unknown };
  const rawPicks = root.picks;
  if (!Array.isArray(rawPicks)) throw new Error("Gemini response missing picks[]");

  const allowed = new Set(symbols);
  const seen = new Set<string>();
  const valid: Array<{ pick: AiPick; rank: number }> = [];
  rawPicks.forEach((p: unknown, index: number) => {
    if (!isRawPick(p) || !allowed.has(p.symbol) || seen.has(p.symbol)) return;
    seen.add(p.symbol);
    valid.push({
      rank: typeof p.rank === "number" && Number.isFinite(p.rank) ? p.rank : index + 1,
      pick: {
        symbol: p.symbol,
        conviction: Math.round(Math.min(99, Math.max(1, p.convictionScore))),
        catalyst_category: oneOf(CATALYST_CATEGORIES, p.catalystCategory),
        catalyst_freshness: oneOf(CATALYST_FRESHNESS, p.catalystFreshness),
        thesis: truncate(p.whyItWillExpandToday.trim(), 260),
        execution_risk: truncate(p.executionRisk.trim(), 90),
      },
    });
  });
  if (valid.length === 0) throw new Error("Gemini returned no valid picks from the shortlist");
  // The model's own rank decides the order; ties keep the order it wrote them in.
  valid.sort((a, b) => a.rank - b.rank);
  const summary = typeof root.marketRegimeSummary === "string" ? truncate(root.marketRegimeSummary.trim(), 200) : "";
  return {
    picks: valid.slice(0, 3).map((v) => v.pick),
    market_regime_summary: summary,
    model,
    evaluated_at_iso: new Date().toISOString(),
  };
}

/** Cheap round-trip used by the "Test key" button. */
export async function verifyGeminiKey(apiKey: string, model?: string): Promise<{ ok: true; model: string }> {
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 15_000 } });
  let m = model?.trim() || DEFAULT_MODEL;
  const ping = (name: string) =>
    ai.models.generateContent({
      model: name,
      contents: "Reply with the single word: ok",
      config: { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } },
    });
  try {
    await ping(m);
  } catch (err: unknown) {
    if (err instanceof ApiError && err.status === 404 && m !== FALLBACK_MODEL) {
      m = FALLBACK_MODEL;
      await ping(m);
    } else throw err;
  }
  return { ok: true, model: m };
}
