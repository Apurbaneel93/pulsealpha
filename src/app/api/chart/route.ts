import { NextResponse, type NextRequest } from "next/server";
import { errorMessage } from "@/lib/async";
import { getChart } from "@/lib/live-data";
import { CHART_RANGES, isChartRange, yahooSymbolFor } from "@/lib/live-pure";
import type { ApiError, ChartPayload } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * Public: price history for one watchlist symbol, e.g.
 * /api/chart?symbol=LT&range=1d. Ranges: 1d, 5d, 1m, 3m, 6m, 1y. Symbols and
 * ranges are whitelisted, so the set of cache entries is small and fixed.
 */
export async function GET(req: NextRequest): Promise<NextResponse<ChartPayload | ApiError>> {
  const symbol = (req.nextUrl.searchParams.get("symbol") ?? "").trim().toUpperCase();
  const range = req.nextUrl.searchParams.get("range") ?? "1d";
  if (yahooSymbolFor(symbol) === null) {
    return NextResponse.json({ error: "Unknown symbol." }, { status: 400, headers: NO_STORE });
  }
  if (!isChartRange(range)) {
    return NextResponse.json({ error: `range must be one of ${CHART_RANGES.join(", ")}` }, { status: 400, headers: NO_STORE });
  }
  try {
    return NextResponse.json(await getChart(symbol, range), { headers: NO_STORE });
  } catch (err: unknown) {
    console.error(`[PulseAlpha] chart ${symbol} ${range} failed:`, errorMessage(err));
    return NextResponse.json({ error: "Chart data is unavailable right now." }, { status: 502, headers: NO_STORE });
  }
}
