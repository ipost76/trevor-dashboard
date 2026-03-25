import { NextRequest, NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { trade_id, exit_price, new_entry, leverage } = body;
    if (!trade_id || !exit_price || !new_entry) {
      return NextResponse.json(
        { error: "trade_id, exit_price, and new_entry required" },
        { status: 400 }
      );
    }
    const params = JSON.stringify({
      exit_price: Number(exit_price),
      new_entry: Number(new_entry),
      leverage: Number(leverage || 1),
    });
    const raw = runPython("query_hub_commands.py", ["submit", trade_id, "FLIP", params]);
    const data = safeJsonParse(raw, { error: "Parse error" });
    return NextResponse.json(data, { status: data.error ? 400 : 200 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
