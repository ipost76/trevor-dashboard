import { NextRequest, NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ticker, direction, current_price } = body;

    if (!ticker || typeof ticker !== "string") {
      return NextResponse.json(
        { error: "ticker (string) is required" },
        { status: 400 }
      );
    }
    if (
      !direction ||
      !["LONG", "SHORT"].includes(String(direction).toUpperCase())
    ) {
      return NextResponse.json(
        { error: 'direction must be "LONG" or "SHORT"' },
        { status: 400 }
      );
    }
    const price = Number(current_price);
    if (!current_price || isNaN(price) || price <= 0) {
      return NextResponse.json(
        { error: "current_price (positive number) is required" },
        { status: 400 }
      );
    }

    const raw = runPython("query_live_board.py", [
      "enter",
      ticker.toUpperCase(),
      String(direction).toUpperCase(),
      String(price),
    ]);
    const data = safeJsonParse(raw, { error: "Failed to parse response" });

    if (data.error) {
      return NextResponse.json(data, { status: 400 });
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
