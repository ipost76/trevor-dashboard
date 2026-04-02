import { NextRequest, NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, ticker } = body;

    if (!action || !["ADD", "REMOVE"].includes(String(action).toUpperCase())) {
      return NextResponse.json(
        { error: 'action must be "ADD" or "REMOVE"' },
        { status: 400 }
      );
    }
    if (!ticker || typeof ticker !== "string" || ticker.trim().length === 0) {
      return NextResponse.json(
        { error: "ticker (non-empty string) is required" },
        { status: 400 }
      );
    }

    const act = String(action).toLowerCase(); // "add" or "remove"
    const raw = runPython("query_live_board.py", [act, ticker.toUpperCase()]);
    const data = safeJsonParse(raw, { error: "Failed to parse response" });

    if (data.error) {
      return NextResponse.json(data, { status: 400 });
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
