import { NextResponse } from "next/server";
import { readFileSync } from "fs";

export const dynamic = "force-dynamic";

export async function GET() {
  const filePath = process.env.TREVOR_ACTIVE_TRADES_PATH || "/home/trevor/trevor/active_trades.json";
  try {
    const raw = readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw);
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ trades: [], updated_at: null });
  }
}
