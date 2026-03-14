import { NextResponse } from "next/server";
import { runPython, safeJsonParse } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

const EMPTY_ANALYTICS = {
  categories: [],
  total_value: 0,
  leverage_exposure: 0,
  total_pnl_usd: 0,
  totals: {
    total: 0,
    open: 0,
    closed: 0,
    winners: 0,
    losers: 0,
    breakeven: 0,
    win_rate: 0,
  },
};

export async function GET() {
  try {
    const raw = runPython("manage_portfolio.py", ["analytics"]);
    const data = safeJsonParse(raw, EMPTY_ANALYTICS);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { ...EMPTY_ANALYTICS, error: String(err) },
      { status: 500 }
    );
  }
}
