import { NextRequest, NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker") || "";
  const limit = searchParams.get("limit") || "50";
  try {
    const args = ["exit_signals"];
    if (ticker) args.push(ticker);
    else args.push("");
    args.push(limit);
    const raw = await runPython("query_hub_commands.py", args);
    return NextResponse.json(safeJsonParse(raw, { signals: [] }));
  } catch (err) {
    return NextResponse.json({ signals: [], error: String(err) });
  }
}
