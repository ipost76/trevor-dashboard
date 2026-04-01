import { NextRequest, NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { trade_id, amount, price } = body;

    if (!trade_id || typeof trade_id !== "string") {
      return NextResponse.json(
        { error: "trade_id (string) is required" },
        { status: 400 }
      );
    }

    const amt = Number(amount);
    if (!amount || isNaN(amt) || amt <= 0) {
      return NextResponse.json(
        { error: "Valid amount (positive number) is required" },
        { status: 400 }
      );
    }

    const pyArgs: string[] = [trade_id, String(amt)];
    if (price != null && Number(price) > 0) {
      pyArgs.push(String(Number(price)));
    }

    const raw = runPython("query_add_position.py", pyArgs);
    const data = safeJsonParse(raw, { error: "Failed to parse response" });

    if (data.error) {
      return NextResponse.json(data, { status: 400 });
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
