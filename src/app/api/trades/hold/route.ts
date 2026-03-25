import { NextRequest, NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { trade_id } = await request.json();
    if (!trade_id) {
      return NextResponse.json({ error: "trade_id required" }, { status: 400 });
    }
    const raw = runPython("query_hub_commands.py", ["submit", trade_id, "HOLD"]);
    const data = safeJsonParse(raw, { error: "Parse error" });
    return NextResponse.json(data, { status: data.error ? 400 : 200 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
