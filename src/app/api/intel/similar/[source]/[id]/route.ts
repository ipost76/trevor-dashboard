import { NextRequest, NextResponse } from "next/server";
import { runPython } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params { source: string; id: string; }

export async function GET(_req: NextRequest, { params }: { params: Promise<Params> }) {
  const { source, id } = await params;
  if (source !== "auto_trades") {
    return NextResponse.json({ error: "invalid source" }, { status: 400 });
  }
  const tradeId = Number(id);
  if (!Number.isInteger(tradeId) || tradeId <= 0) {
    return NextResponse.json({ error: "invalid trade id" }, { status: 400 });
  }
  try {
    const stdout = runPython("query_similar_trades.py", [source, String(tradeId)]);
    return NextResponse.json(JSON.parse(stdout));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 200 });
  }
}
