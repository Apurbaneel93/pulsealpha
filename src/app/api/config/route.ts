import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_MODEL } from "@/lib/gemini";
import { isOwnerRequest, ownerEnabled } from "@/lib/owner";
import { MARKET_REVALIDATE_SECONDS } from "@/lib/scan-service";
import type { ServerConfig } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Capability flags only — never returns secrets. Server-key status is shown to the owner alone. */
export async function GET(req: NextRequest): Promise<NextResponse<ServerConfig>> {
  const owner = isOwnerRequest(req);
  return NextResponse.json(
    {
      owner,
      ownerEnabled: ownerEnabled(),
      hasServerKey: owner && Boolean(process.env.GEMINI_API_KEY?.trim()),
      defaultModel: DEFAULT_MODEL,
      marketRefreshSeconds: MARKET_REVALIDATE_SECONDS,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
