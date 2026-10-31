import "server-only";
import { ApiError, GoogleGenAI, ThinkingLevel } from "@google/genai";
import { errorMessage } from "./async";
import { pctAboveEma20, truncate } from "./rules-engine";
import { formatDetectedAt } from "./time";
import type { MarketSnapshot } from "./types";

/** gemini-2.5-flash was retired on 16 Oct 2026; 3.5 Flash is the GA successor. */
export const DEFAULT_MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash";
const FALLBACK_MODEL = "gemini-flash-latest";

export interface AiPick {
  symbol: string;
  conviction: number;
  catalyst: string;
  global_cue: string;
  technical_trigger: string;
  news_catalyst: string;
}

export interface AiEvaluation {
  picks: AiPick[];
  model: string;
  evaluated_at_iso: string;
}

const SYSTEM_INSTRUCTION = `You are the evaluation layer of a deterministic NSE equity screener.
Every candidate has already passed a hard technical filter (price above 20-EMA, RSI 55–72, volume > 1.5x the 20-day average).
Your job: pick the 2–3 highest-conviction bullish setups for today's Indian session and explain why in plain English.

Hard rules:
1. Choose symbols ONLY from the provided candidates. Never invent a ticker.
2. NEVER state, estimate or alter any price, target, stop-loss, entry or rupee amount. Levels are computed separately in code. Do not write "₹", "Rs" or "INR".
3. Use only numbers that appear in the input (percentages, RSI, volume multiples). Do not fabricate statistics.
4. The news catalyst must come only from the supplied headlines. If a candidate has no headlines, say so plainly — do not imply news exists.
5. Weigh the overnight US cue (especially Nasdaq for IT names), the Nifty regime, technical quality (volume expansion, RSI headroom below 72, 20-EMA above 50-EMA, not over-stretched above the 20-EMA) and catalyst quality.
6. If the regime is bearish, lower conviction scores accordingly.
7. Rank by conviction, highest first. If fewer than 2 candidates are provided, return only those.

Style: "catalyst" is one punchy line of at most 48 characters, e.g. "Nasdaq IT tailwind + 2.4x volume breakout". Each breakdown field is one sentence of at most 140 characters.`;

/** JSON-safe Gemini input. Also used verbatim as the AI cache key, so identical data never pays twice. */
export interface AiInput {
  symbols: string[];
  payload: {
    market_regime: string;
    regime_score: number;
    indices: Array<{ index: string; change_pct: number; above_20_ema: boolean }>;
    candidates: Array<Record<string, unknown>>;
  };
}

export function buildAiInput(md: MarketSnapshot): AiInput {
  // Absolute prices are deliberately withheld: the model cannot echo or
  // distort a number it never sees. It reasons over relative metrics only.
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
      candidates: md.shortlist.map((s) => ({
        symbol: s.symbol,
        company: s.name,
        sector: s.sector,
        day_change_pct: s.day_change_pct,
        rsi_14: s.rsi14,
        volume_ratio_vs_20d: s.volume_ratio,
        pct_above_20_ema: Number(pctAboveEma20(s).toFixed(2)),
        ema20_above_ema50: s.ema20 > s.ema50,
        atr_pct_of_price: Number(((s.atr14 / s.current_price) * 100).toFixed(2)),
        headlines_last_24h: (md.news[s.symbol] ?? []).map((n) => ({
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
  return {
    type: "object",
    properties: {
      picks: {
        type: "array",
        minItems: Math.min(2, symbols.length),
        maxItems,
        items: {
          type: "object",
          properties: {
            symbol: { type: "string", enum: symbols, description: "Ticker copied exactly from the candidates." },
            conviction: { type: "integer", minimum: 1, maximum: 99 },
            catalyst: { type: "string", description: "One line, at most 48 characters, no prices." },
            global_cue: { type: "string", description: "Global/sector cue in one sentence, no prices." },
            technical_trigger: { type: "string", description: "Technical trigger in one sentence, no prices." },
            news_catalyst: {
              type: "string",
              description: "From supplied headlines only; say none if there are none. No prices.",
            },
          },
          required: ["symbol", "conviction", "catalyst", "global_cue", "technical_trigger", "news_catalyst"],
          propertyOrdering: ["symbol", "conviction", "catalyst", "global_cue", "technical_trigger", "news_catalyst"],
        },
      },
    },
    required: ["picks"],
  };
}

const PRICE_PATTERN = /₹|\bRs\.?\s?\d|\bINR\s?\d|\b(target|stop[- ]?loss|entry)\s+(of|at|near)\s+\d/i;

/** True when AI prose tries to mention a price level — those fields get replaced by deterministic copy. */
export function mentionsPrice(text: string): boolean {
  return PRICE_PATTERN.test(text);
}

function isAiPick(v: unknown): v is AiPick {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.symbol === "string" &&
    typeof o.conviction === "number" &&
    typeof o.catalyst === "string" &&
    typeof o.global_cue === "string" &&
    typeof o.technical_trigger === "string" &&
    typeof o.news_catalyst === "string"
  );
}

async function callModel(ai: GoogleGenAI, model: string, payload: unknown, symbols: string[]) {
  return ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [{ text: `Screened candidates (JSON):\n${JSON.stringify(payload)}` }],
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
  const rawPicks = (parsed as { picks?: unknown }).picks;
  if (!Array.isArray(rawPicks)) throw new Error("Gemini response missing picks[]");

  const allowed = new Set(symbols);
  const seen = new Set<string>();
  const picks: AiPick[] = [];
  for (const p of rawPicks) {
    if (!isAiPick(p) || !allowed.has(p.symbol) || seen.has(p.symbol)) continue;
    seen.add(p.symbol);
    picks.push({
      symbol: p.symbol,
      conviction: Math.round(Math.min(99, Math.max(1, p.conviction))),
      catalyst: truncate(p.catalyst.trim(), 56),
      global_cue: truncate(p.global_cue.trim(), 180),
      technical_trigger: truncate(p.technical_trigger.trim(), 180),
      news_catalyst: truncate(p.news_catalyst.trim(), 180),
    });
  }
  if (picks.length === 0) throw new Error("Gemini returned no valid picks from the shortlist");
  return { picks: picks.slice(0, 3), model, evaluated_at_iso: new Date().toISOString() };
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
