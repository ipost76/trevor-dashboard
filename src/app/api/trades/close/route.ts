import { NextRequest, NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { trade_id, exit_price } = body;

    if (!trade_id || typeof trade_id !== "string") {
      return NextResponse.json(
        { error: "trade_id (string) is required" },
        { status: 400 }
      );
    }

    const price = Number(exit_price);
    if (!exit_price || isNaN(price) || price <= 0) {
      return NextResponse.json(
        { error: "Valid exit_price (positive number) is required" },
        { status: 400 }
      );
    }

    const raw = await runPython("query_close.py", ["submit", trade_id, String(price)]);
    const data = safeJsonParse(raw, { error: "Failed to parse response" });

    if (data.error) {
      return NextResponse.json(data, { status: 400 });
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
