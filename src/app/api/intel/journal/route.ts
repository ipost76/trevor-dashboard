import { NextRequest, NextResponse } from "next/server";
import { runPython } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") ?? 30)));
  try {
    const stdout = await runPython("query_journal_list.py", [String(limit)]);
    return NextResponse.json(JSON.parse(stdout));
  } catch (err) {
    return NextResponse.json({ trades: [], budget: {}, error: String(err) }, { status: 200 });
  }
}
