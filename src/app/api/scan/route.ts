import { NextResponse, type NextRequest } from "next/server";
import { errorMessage } from "@/lib/async";
import { isOwnerRequest, isSameOrigin } from "@/lib/owner";
import { scan } from "@/lib/scan-service";
import type { ApiError, DataMode, ScanRequestBody, ScanResult } from "@/lib/types";

export const runtime = "nodejs";
// The HTTP response is never cached — the data behind it is (see lib/scan-service.ts).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" } as const;

function respond(result: ScanResult): NextResponse<ScanResult> {
  const headers: Record<string, string> = { ...NO_STORE };
  if (result.cache) headers["X-PulseAlpha-Cache"] = `market=${result.cache.market}; ai=${result.cache.ai ?? "none"}`;
  return NextResponse.json(result, { headers });
}

/**
 * The shared live scan: what the app loads on open, and what Vercel Cron
 * calls at 08:30 IST to warm the cache. Uses the server's GEMINI_API_KEY (or
 * the rules engine). Repeat calls are served from the server cache.
 */
export async function GET(): Promise<NextResponse<ScanResult | ApiError>> {
  try {
    return respond(await scan({ mode: "live" }));
  } catch (err: unknown) {
    console.error("[PulseAlpha] scan failed:", errorMessage(err));
    return NextResponse.json({ error: `Scan failed: ${errorMessage(err)}` }, { status: 500, headers: NO_STORE });
  }
}

/**
 * Owner-only. Body: { mode?: "live" | "demo", model?: string }.
 * An optional `x-gemini-key` header evaluates with the owner's own key; market
 * data still comes from the shared cache. Everyone else uses GET above, so no
 * visitor can spend a key, pick a model or reach demo mode.
 */
export async function POST(req: NextRequest): Promise<NextResponse<ScanResult | ApiError>> {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Cross-site request refused." }, { status: 403, headers: NO_STORE });
  }
  if (!isOwnerRequest(req)) {
    return NextResponse.json({ error: "Owner sign-in required." }, { status: 401, headers: NO_STORE });
  }
  let body: ScanRequestBody = {};
  try {
    const text = await req.text();
    body = text ? (JSON.parse(text) as ScanRequestBody) : {};
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400, headers: NO_STORE });
  }
  const mode: DataMode = body.mode === "demo" ? "demo" : "live";
  try {
    return respond(
      await scan({
        mode,
        userKey: req.headers.get("x-gemini-key"),
        model: typeof body.model === "string" ? body.model.slice(0, 64) : null,
      }),
    );
  } catch (err: unknown) {
    console.error("[PulseAlpha] scan failed:", errorMessage(err));
    return NextResponse.json({ error: `Scan failed: ${errorMessage(err)}` }, { status: 500, headers: NO_STORE });
  }
}
