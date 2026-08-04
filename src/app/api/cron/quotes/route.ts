import { NextResponse } from "next/server";
import { ingestQuotes } from "@/ingest/quotes";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";

// Uses the postgres driver and must never be statically evaluated.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await ingestQuotes();
    // 200 even for `partial`: some tickers failing is an expected steady state
    // and must not make the scheduler treat the whole run as broken.
    return NextResponse.json(result, {
      status: result.status === "failed" ? 500 : 200,
    });
  } catch (err) {
    console.error("quote ingest failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "ingest failed" },
      { status: 500 },
    );
  }
}
