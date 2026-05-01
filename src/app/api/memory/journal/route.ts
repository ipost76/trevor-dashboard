import { NextRequest, NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") ?? 50)));
  const q = (url.searchParams.get("q") ?? "").slice(0, 200);
  try {
    const stdout = runPython("query_memory_entries.py", [String(limit), q]);
    return NextResponse.json(
      safeJsonParse(stdout, { entries: [], total: 0, data_available: false, filter: q })
    );
  } catch (err) {
    return NextResponse.json(
      { entries: [], total: 0, data_available: false, filter: q, error: String(err) },
      { status: 200 }
    );
  }
}
