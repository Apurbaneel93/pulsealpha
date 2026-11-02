import { unstable_cache } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { errorMessage } from "@/lib/async";
import type { ExperimentReport } from "@/lib/experiment";
import { isOwnerRequest } from "@/lib/owner";
import { istDateKey } from "@/lib/time";
import { buildExperimentReport } from "@/lib/verify";
import type { ApiError } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const cachedExperiment = unstable_cache(
  async (istDay: string): Promise<ExperimentReport> => {
    void istDay;
    return buildExperimentReport(new Date());
  },
  ["pulsealpha:experiment:v1"],
  { revalidate: 6 * 3600, tags: ["pulsealpha:experiment"] },
);

/**
 * Owner-only strategy diagnostics: why the backtest looks the way it does.
 * Read-only; nothing here changes what the app recommends.
 */
export async function GET(req: NextRequest): Promise<NextResponse<ExperimentReport | ApiError>> {
  if (!isOwnerRequest(req)) {
    return NextResponse.json({ error: "Owner sign-in required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const report = await cachedExperiment(istDateKey(new Date()));
    return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: `Experiment failed: ${errorMessage(err)}` },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
