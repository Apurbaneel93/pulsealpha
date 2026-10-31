import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";
import { errorMessage } from "@/lib/async";
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
 * Run it on a preview deployment before going live.
 */
export async function GET(): Promise<NextResponse<VerifyReport | ApiError>> {
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
