import { NextResponse } from "next/server";
import { DEFAULT_MODEL } from "@/lib/gemini";
import { MARKET_REVALIDATE_SECONDS } from "@/lib/scan-service";
import type { ServerConfig } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Capability flags only — never returns secrets. */
export async function GET(): Promise<NextResponse<ServerConfig>> {
  return NextResponse.json(
    {
      hasServerKey: Boolean(process.env.GEMINI_API_KEY?.trim()),
      defaultModel: DEFAULT_MODEL,
      marketRefreshSeconds: MARKET_REVALIDATE_SECONDS,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
