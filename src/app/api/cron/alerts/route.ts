import { NextResponse } from "next/server";
import { ingestAlerts } from "@/ingest/alerts";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Reads that are already indexed, plus one delivery per firing. Fast unless a
// mail provider is slow, which the timeout is here to bound.
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await ingestAlerts();
    return NextResponse.json(result, {
      status: result.status === "failed" ? 500 : 200,
    });
  } catch (err) {
    console.error("alert evaluation failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "evaluation failed" },
      { status: 500 },
    );
  }
}
