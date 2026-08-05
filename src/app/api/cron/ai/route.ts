import { NextResponse } from "next/server";
import { ingestAi } from "@/ingest/ai";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Generation is slow per item and this drains a queue of them. The per-run
// cap (AI_MAX_GENERATIONS_PER_RUN) is what actually bounds the work; this
// only stops a stalled provider from holding the function open indefinitely.
export const maxDuration = 800;

export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await ingestAi();
    return NextResponse.json(result, {
      status: result.status === "failed" ? 500 : 200,
    });
  } catch (err) {
    console.error("ai ingest failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "ingest failed" },
      { status: 500 },
    );
  }
}
