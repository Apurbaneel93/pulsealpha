import { unstable_cache } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { errorMessage } from "@/lib/async";
import { isOwnerRequest } from "@/lib/owner";
import { istDateKey } from "@/lib/time";
import { buildVerifyReport, type VerifyReport } from "@/lib/verify";
import type { ApiError } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** One report per IST day, shared by everyone; refreshed at most every 6 hours. */
const cachedReport = unstable_cache(
  async (istDay: string): Promise<VerifyReport> => {
    void istDay;
    return buildVerifyReport(new Date());
  },
  ["pulsealpha:verify:v1"],
  { revalidate: 6 * 3600, tags: ["pulsealpha:verify"] },
);

/**
 * Read-only accuracy report: today's filter funnel, raw recent sessions for
 * cross-checking, and a ~9-month replay of the same filter and ATR levels.
 * Owner-only: a cold build replays ~9 months of history for the whole
 * watchlist, which is far too heavy to leave open to the public.
 */
export async function GET(req: NextRequest): Promise<NextResponse<VerifyReport | ApiError>> {
  if (!isOwnerRequest(req)) {
    return NextResponse.json({ error: "Owner sign-in required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const report = await cachedReport(istDateKey(new Date()));
    return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: `Verification failed: ${errorMessage(err)}` },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
