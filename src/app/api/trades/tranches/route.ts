import { NextRequest, NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tradeId = searchParams.get("trade_id");

    if (!tradeId) {
      return NextResponse.json(
        { error: "trade_id query parameter is required" },
        { status: 400 }
      );
    }

    const raw = runPython("query_tranches.py", [tradeId]);
    const data = safeJsonParse(raw, { error: "Failed to parse response" });

    if (data.error) {
      return NextResponse.json(data, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
