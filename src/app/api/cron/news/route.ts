import { NextResponse } from "next/server";
import { ingestNews } from "@/ingest/news";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// News ingest fans out over the watchlist and several providers, so it needs
// more headroom than the quote job.
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await ingestNews();
    return NextResponse.json(result, {
      status: result.status === "failed" ? 500 : 200,
    });
  } catch (err) {
    console.error("news ingest failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "ingest failed" },
      { status: 500 },
    );
  }
}
