import { NextResponse } from "next/server";
import { sendDigest } from "@/ingest/digest";
import { isAuthorizedCronRequest } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One model call plus one email, both of which can be slow.
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await sendDigest();
    return NextResponse.json(result, {
      status: result.status === "failed" ? 500 : 200,
    });
  } catch (err) {
    console.error("digest failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "digest failed" },
      { status: 500 },
    );
  }
}
