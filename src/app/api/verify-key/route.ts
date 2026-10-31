import { NextResponse, type NextRequest } from "next/server";
import { ApiError as GenAiError } from "@google/genai";
import { errorMessage } from "@/lib/async";
import { DEFAULT_MODEL, verifyGeminiKey } from "@/lib/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/** Round-trips a one-word prompt so the API Setup tab can confirm a key works. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const key = req.headers.get("x-gemini-key")?.trim() || process.env.GEMINI_API_KEY?.trim();
  if (!key) return NextResponse.json({ ok: false, error: "No key provided." }, { status: 400 });
  let model: string | undefined;
  try {
    const body = (await req.json()) as { model?: unknown };
    if (typeof body.model === "string") model = body.model.slice(0, 64);
  } catch {
    /* body optional */
  }
  try {
    const result = await verifyGeminiKey(key, model);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err: unknown) {
    const status = err instanceof GenAiError ? err.status : 500;
    const hint =
      status === 400 || status === 401 || status === 403
        ? "Google rejected this key. Check it was copied fully from aistudio.google.com/apikey."
        : status === 404
          ? "That model name isn't available to this key."
          : status === 429
            ? "Key works but is rate-limited right now."
            : errorMessage(err).slice(0, 160);
    if (status === 429) {
      return NextResponse.json({ ok: true, model: model ?? DEFAULT_MODEL, warning: hint });
    }
    return NextResponse.json({ ok: false, error: hint }, { status: 400 });
  }
}
