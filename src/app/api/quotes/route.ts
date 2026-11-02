import { NextResponse, type NextRequest } from "next/server";
import { getQuotes } from "@/lib/live-data";
import { MAX_QUOTE_SYMBOLS, yahooSymbolFor } from "@/lib/live-pure";
import type { ApiError, QuotesResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * Public: latest prices for up to 30 watchlist symbols, e.g.
 * /api/quotes?symbols=LT,INFY,^NSEI. Only watchlist symbols are accepted, so
 * this can't be used as a general Yahoo proxy; results come from a 15-second
 * server cache shared by every viewer.
 */
export async function GET(req: NextRequest): Promise<NextResponse<QuotesResponse | ApiError>> {
  const symbols = [
    ...new Set((req.nextUrl.searchParams.get("symbols") ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)),
  ];
  if (symbols.length === 0) return NextResponse.json({ error: "Pass ?symbols=LT,INFY" }, { status: 400, headers: NO_STORE });
  if (symbols.length > MAX_QUOTE_SYMBOLS) {
    return NextResponse.json({ error: `At most ${MAX_QUOTE_SYMBOLS} symbols per request.` }, { status: 400, headers: NO_STORE });
  }
  const unknown = symbols.filter((s) => yahooSymbolFor(s) === null);
  if (unknown.length > 0) {
    return NextResponse.json({ error: `Unknown symbol: ${unknown.slice(0, 3).join(", ")}` }, { status: 400, headers: NO_STORE });
  }
  return NextResponse.json(await getQuotes(symbols), { headers: NO_STORE });
}
