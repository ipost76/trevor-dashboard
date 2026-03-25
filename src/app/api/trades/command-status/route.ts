import { NextRequest, NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const tradeId = new URL(request.url).searchParams.get("trade_id");
  if (!tradeId) {
    return NextResponse.json({ error: "trade_id required" }, { status: 400 });
  }
  try {
    const raw = runPython("query_hub_commands.py", ["status", tradeId]);
    return NextResponse.json(safeJsonParse(raw, { status: "unknown" }));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
