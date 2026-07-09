import { NextRequest, NextResponse } from "next/server";
import { runScan } from "@/lib/scan";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // no secret configured -> locked
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}` || header === secret;
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const summary = await runScan();
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  return handle(req);
}

// GET supported too, so it's easy to test from a browser/curl.
export async function GET(req: NextRequest) {
  return handle(req);
}
