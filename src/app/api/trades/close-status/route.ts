import { NextRequest, NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tradeId = searchParams.get("trade_id");

  if (!tradeId) {
    return NextResponse.json(
      { error: "trade_id query parameter required" },
      { status: 400 }
    );
  }

  try {
    const raw = await runPython("query_close.py", ["status", tradeId]);
    const data = safeJsonParse(raw, { status: "unknown" });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
